declare module 'heic-to/csp' {
  export function heicTo(options: {blob: Blob; type: 'bitmap'; options?: ImageBitmapOptions}): Promise<ImageBitmap>
}
