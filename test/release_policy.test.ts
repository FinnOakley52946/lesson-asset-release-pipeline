import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseRelease } from "../src/release_policy.ts";

test("a release waits until its uploaded lesson image can be found", () => {
  assert.deepEqual(diagnoseRelease(false), {
    status: "waiting_for_upload",
    message: "Source image is still awaiting upload.",
  });
  assert.deepEqual(diagnoseRelease(true), {
    status: "ready_to_publish",
    message: "Source image verified; variants may be published.",
  });
});
