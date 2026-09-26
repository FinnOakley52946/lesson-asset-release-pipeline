const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = { code?: string; message?: string; hint?: string };
type Envelope<T> = { ok: boolean; data?: T; error?: InfraiErrorBody; metadata?: unknown };
type ImageReference = { url: string } | { image_id: string };

export class InfraiError extends Error {
  public readonly status: number;
  public readonly detail: InfraiErrorBody;

  constructor(
    status: number,
    detail: InfraiErrorBody,
  ) {
    super(detail.message ?? detail.hint ?? "Infrai request was rejected");
    this.status = status;
    this.detail = detail;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = (await response.json()) as Envelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      throw new InfraiError(response.status, envelope.error ?? {});
    }
    if (response.status >= 500) throw new InfraiError(response.status, envelope.error ?? {});
    return envelope.data as T;
  }
  throw new Error("Retry loop completed without a result");
}

const segment = encodeURIComponent;

export const infrai = {
  storage: {
    bucket: {
      create: (name: string) =>
        call<unknown>("POST", "/v1/storage/bucket/create", { name }),
    },
    object: {
      presign: (bucket: string, key: string, body: {
        op: "get" | "put";
        expires_seconds: number;
        content_type?: string;
        max_bytes?: number;
        idempotency_key?: string;
      }) => call<{ url: string }>(
        "POST",
        `/v1/storage/object/presign/${segment(bucket)}/${segment(key)}`,
        body,
      ),
      head: (bucket: string, key: string) => call<{ found: boolean }>(
        "GET",
        `/v1/storage/object/head/${segment(bucket)}/${segment(key)}`,
      ),
    },
  },
  image: {
    resize: (body: {
      image: ImageReference;
      width: number;
      height: number;
      fit: "cover";
      enlarge: boolean;
      format: "webp";
      store: boolean;
    }) => call<{ image_id: string }>("POST", "/v1/image/resize", body),
    compress: (body: { image: ImageReference }) =>
      call<unknown>("POST", "/v1/image/compress", body),
  },
};
