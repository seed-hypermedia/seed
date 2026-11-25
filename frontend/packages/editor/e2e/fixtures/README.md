# Image test fixture

`checker.heic` is a locally generated 1600 × 1200 red/blue checkerboard. It contains no third-party photo. Each square
is 100 × 100 pixels. The two RGB colors are `(220, 40, 60)` and `(30, 140, 210)`. A generated RGB PNG was encoded with
macOS `sips -s format heic input.png --out checker.heic`.

The test uses real HEVC-compressed pixels to exercise the lazy HEIC decoder. It does not mock decoding.
