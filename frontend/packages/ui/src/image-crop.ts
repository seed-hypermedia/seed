/**
 * Pixel rectangle selected within the source image, matching the shape
 * react-easy-crop reports as `croppedAreaPixels`.
 */
export type CropRect = {x: number; y: number; width: number; height: number}

/**
 * The cropper's position and zoom. Stored alongside a selection so reopening the
 * editor restores the user's previous framing instead of resetting to the middle.
 */
export type CropState = {x: number; y: number; zoom: number}

export type CropFormat = 'image/jpeg' | 'image/png' | 'image/webp'

export type CropImageOptions = {
  /** Longest edge of the result, in pixels. The crop is scaled down to fit. */
  maxDimension: number
  /** Defaults to {@link cropOutputFormat} for the source's type. */
  format?: CropFormat
  /** Encoder quality for lossy formats, 0 to 1. Ignored by PNG. */
  quality?: number
}

const EXTENSIONS: Record<CropFormat, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Source types that may carry transparency, which JPEG cannot represent. */
const ALPHA_CAPABLE_TYPES = new Set(['image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'])

/**
 * Output size for a crop, scaled down so its longest edge fits `maxDimension`.
 */
export function cropOutputSize(
  rect: {width: number; height: number},
  maxDimension: number,
): {
  width: number
  height: number
} {
  const longestEdge = Math.max(rect.width, rect.height)
  const scale = longestEdge > maxDimension ? maxDimension / longestEdge : 1
  return {
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  }
}

/**
 * Encoding to emit for a given source type.
 *
 * Sources that can carry transparency stay PNG, because re-encoding them as JPEG
 * would flatten transparent pixels onto a background.
 */
export function cropOutputFormat(sourceType: string): CropFormat {
  return ALPHA_CAPABLE_TYPES.has(sourceType) ? 'image/png' : 'image/jpeg'
}

/**
 * Render rect of file into a new image file, downscaled to maxDimension.
 */
export async function cropImageFile(file: File, rect: CropRect, options: CropImageOptions): Promise<File> {
  const bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'})
  try {
    const size = cropOutputSize(rect, options.maxDimension)
    const format = options.format ?? cropOutputFormat(file.type)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Cannot crop the image: no 2D canvas context is available')
    // JPEG has no alpha channel, so anything transparent would otherwise encode
    // as black rather than as the white it appeared to sit on.
    if (format === 'image/jpeg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, size.width, size.height)
    }
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, size.width, size.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, options.quality ?? 0.9))
    if (!blob) throw new Error('Cannot crop the image: the canvas could not be encoded')
    const baseName = file.name.replace(/\.[^./\\]+$/, '') || 'image'
    return new File([blob], `${baseName}.${EXTENSIONS[format]}`, {type: format})
  } finally {
    bitmap.close()
  }
}
