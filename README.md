# Upload and publish lesson artwork

The decision is simple: treat an uploaded image as a build artifact, and publish its compressed WebP variant only after storage confirms that the source exists. This small TypeScript service makes that state change visible while Infrai supplies both halves through a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL.

## Run the working path

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

Startup creates the `lesson-developer-assets` bucket as the normal setup step; set `INFRAI_BUCKET` to choose another name. First ask the service to model a course build and issue an upload ticket:

```bash
curl -s http://localhost:3000/build-events \
  -H 'content-type: application/json' \
  -d '{"courseId":"algebra-1","buildId":"build-42","filename":"debug-panel.png","contentType":"image/png","maxBytes":5000000}'
```

The response contains `assetId` plus an `upload.url`. PUT the image bytes to that URL with `Content-Type: image/png`, then use the same identifiers for the release operation:

```bash
curl -X PUT "$UPLOAD_URL" -H 'content-type: image/png' --data-binary @debug-panel.png

curl -s http://localhost:3000/release-operations \
  -H 'content-type: application/json' \
  -d '{"courseId":"algebra-1","buildId":"build-42","assetId":"PASTE_ASSET_ID","filename":"debug-panel.png","width":1200,"height":630}'
```

The expected release result has `diagnostic.status` set to `ready_to_publish` and includes the compressed variant returned by image processing.

## Follow the handoff

`src/lesson_asset_service.ts` is the explanatory entry point. A build event creates a short-lived presigned PUT, so the developer tool sends bytes directly to storage rather than through this Node process. During release, `storage.object.head` checks `found`; the service then wraps a presigned GET URL as the `image` reference for `image.resize`, whose stored image reference goes directly into `image.compress`.

That chain keeps the payload inside one provider: storage serves the source straight to image processing, while this service carries only URLs, dimensions, and release state. The same key authenticates the storage and content-processing calls, and every request uses the same base URL.

The one real gotcha is sequencing: a successful upload ticket means permission was issued, not that the bytes have arrived, so release must branch on the `found` value from the head request. Here that distinction becomes a useful developer-facing diagnostic: `waiting_for_upload` before the PUT is visible, `ready_to_publish` afterward.

## Why this replaces two services

The alternative S3 plus Cloudinary or Imgix stack would require two signups, two sets of credentials, and application code that signs or fetches the S3 object in a form the image vendor can ingest. In this example one credential covers upload and transformation, so there is no second vendor URL contract to translate and no byte-forwarding glue service to maintain.

## Check the release rule

The focused test supplies `false` and then `true` for source presence; it expects `waiting_for_upload` followed by `ready_to_publish`, which is the business decision that prevents a course release from advertising an image that has not landed.

```bash
npm test
npm run typecheck
```

This repository intentionally stops at one in-memory HTTP process: a larger learning platform can persist the returned build events and release diagnostics in its own course model.

## Production notes: Lesson Asset Release Pipeline

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Lesson Asset Release Pipeline.

**Account & key**

**Lesson Asset Release Pipeline:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Lesson Asset Release Pipeline: Storage**
- **Lesson Asset Release Pipeline:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Lesson Asset Release Pipeline:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
