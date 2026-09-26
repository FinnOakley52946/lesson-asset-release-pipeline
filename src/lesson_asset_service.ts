import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { infrai, InfraiError } from "./infrai.ts";
import { diagnoseRelease } from "./release_policy.ts";

const bucket = process.env.INFRAI_BUCKET ?? "lesson-developer-assets";
const port = Number(process.env.PORT ?? 3000);

const buildEventSchema = z.object({
  courseId: z.string().min(1),
  buildId: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().regex(/^image\//),
  maxBytes: z.number().int().positive().max(20_000_000),
}).strict();

const releaseOperationSchema = z.object({
  courseId: z.string().min(1),
  buildId: z.string().min(1),
  assetId: z.string().uuid(),
  filename: z.string().min(1),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
}).strict();

function sourceKey(input: { courseId: string; buildId: string; assetId: string; filename: string }): string {
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `courses/${input.courseId}/builds/${input.buildId}/${input.assetId}/${safeName}`;
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const bucketReady = infrai.storage.bucket.create(bucket);

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/build-events") {
      const input = buildEventSchema.parse(await readJson(request));
      await bucketReady;
      const assetId = randomUUID();
      const key = sourceKey({
        courseId: input.courseId,
        buildId: input.buildId,
        assetId,
        filename: input.filename,
      });
      const upload = await infrai.storage.object.presign(bucket, key, {
        op: "put",
        expires_seconds: 600,
        content_type: input.contentType,
        max_bytes: input.maxBytes,
        idempotency_key: `build-${input.buildId}-${assetId}`,
      });
      send(response, 201, {
        event: "developer_asset_upload_requested",
        buildId: input.buildId,
        assetId,
        upload: { method: "PUT", url: upload.url, contentType: input.contentType },
      });
      return;
    }

    if (request.method === "POST" && request.url === "/release-operations") {
      const input = releaseOperationSchema.parse(await readJson(request));
      await bucketReady;
      const key = sourceKey(input);
      const source = await infrai.storage.object.head(bucket, key);
      const diagnostic = diagnoseRelease(source.found);
      if (!source.found) {
        send(response, 409, { buildId: input.buildId, diagnostic });
        return;
      }

      const download = await infrai.storage.object.presign(bucket, key, {
        op: "get",
        expires_seconds: 300,
        idempotency_key: `release-${input.buildId}-${input.assetId}`,
      });
      const resized = await infrai.image.resize({
        image: { url: download.url },
        width: input.width,
        height: input.height,
        fit: "cover",
        enlarge: false,
        format: "webp",
        store: true,
      });
      const compressed = await infrai.image.compress({ image: { image_id: resized.image_id } });
      send(response, 200, {
        operation: "lesson_asset_release",
        buildId: input.buildId,
        diagnostic,
        variant: compressed,
      });
      return;
    }

    send(response, 404, { message: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      send(response, 400, { message: "Invalid request body", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { message: error.message, detail: error.detail });
      return;
    }
    send(response, 500, { message: error instanceof Error ? error.message : "Unexpected error" });
  }
}).listen(port, () => {
  console.log(`Lesson asset service listening on http://localhost:${port}`);
});
