# `@shm/ui`

## Local image uploads

The desktop and web apps share `image-processing`. Vault profile forms use the same cropper and image validation. Only
the resulting image is sent to storage. Decoding, conversion, cropping, and resizing run locally; they do not call an
image-conversion service. Video processing is not included.

- Uncropped uploads use `processImage` with the avatar, cover, or content policy.
- Crop fields retain the full-resolution source until the user confirms the crop. HEIC uses a full-resolution, lossless
  PNG preview. Other supported still formats retain their original source for cropping.
- The confirmed crop is the final encoded file. Shared upload adapters reuse it when its dimensions and byte size
  satisfy their policy. A stricter policy still applies its limits.
- Crop fields reject animated images with a visible error. Uncropped uploads preserve supported animation when it fits
  the policy. They reject oversized animation rather than silently flattening it.
- Static output is re-encoded without source metadata. Preserved animations retain their original bytes and metadata.
- Input validation limits files to 64 MiB, 100 million pixels, and 32,768 pixels on either axis. Output limits differ by
  surface. Unsupported or malformed images fail with an error; this is not support for every image format.

`file-drop-guard` is independent of image processing. App roots use it to stop browser navigation for unhandled file
drops. Component handlers still receive drops. Text and link drops keep their existing behavior. This does not turn
every screen into an upload target.

## Verification

Run unit tests with `direnv exec . pnpm --filter @shm/ui test`. The editor package contains real-browser image tests and
a generated HEIC fixture. Start its documented harness on `http://localhost:5180` with
`direnv exec . pnpm --filter @shm/editor test:harness`. These tests check local processing and crop behavior, not a
complete authenticated storage flow in every app.

## Image-processing release gate

Applications consuming `@shm/ui/image-processing` must package `THIRD_PARTY_NOTICES.md` with their distribution and
verify in their production build that `heic-to` remains a separate, lazily loaded chunk rather than startup code. Review
the dependency license obligations before distribution. Decoding currently runs on the renderer thread; worker-based
processing is not included.
