export type VariantStatus = "waiting_for_upload" | "ready_to_publish";

export type ReleaseDiagnostic = {
  status: VariantStatus;
  message: string;
};

export function diagnoseRelease(sourceFound: boolean): ReleaseDiagnostic {
  return sourceFound
    ? { status: "ready_to_publish", message: "Source image verified; variants may be published." }
    : { status: "waiting_for_upload", message: "Source image is still awaiting upload." };
}
