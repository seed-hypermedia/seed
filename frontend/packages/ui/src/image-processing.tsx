/** Limits and encoding settings for a class of image upload. */
export type ImageProcessingPolicy = {
  maxWidth: number
  maxHeight: number
  maxPixels: number
  maxBytes: number
  outputType: 'image/webp' | 'image/jpeg'
  quality: number
}

/** Absolute input-size ceiling applied before reading or decoding image bytes. */
export const MAX_INPUT_IMAGE_BYTES = 64 * 1024 * 1024

/** Maximum decoded pixel count accepted before invoking an image decoder. */
export const MAX_INPUT_IMAGE_PIXELS = 100_000_000

/** File-picker accept value including formats some browsers omit from image wildcard matching. */
export const IMAGE_FILE_ACCEPT = 'image/*,.heic,.heif,image/heic,image/heif'

const MAX_INPUT_IMAGE_DIMENSION = 32_768
const HEADER_INSPECTION_BYTES = 1024 * 1024

/** Processing defaults for account avatars and entity icons. */
export const AVATAR_IMAGE_POLICY: ImageProcessingPolicy = {
  maxWidth: 1024,
  maxHeight: 1024,
  maxPixels: 1024 * 1024,
  maxBytes: 5 * 1024 * 1024,
  outputType: 'image/webp',
  quality: 0.85,
}

/** Processing defaults for document cover images. */
export const COVER_IMAGE_POLICY: ImageProcessingPolicy = {
  maxWidth: 3840,
  maxHeight: 2160,
  maxPixels: 3840 * 2160,
  maxBytes: 15 * 1024 * 1024,
  outputType: 'image/webp',
  quality: 0.85,
}

/** Processing defaults for document and comment image blocks. */
export const CONTENT_IMAGE_POLICY: ImageProcessingPolicy = {
  maxWidth: 3840,
  maxHeight: 3840,
  maxPixels: 16_000_000,
  maxBytes: 15 * 1024 * 1024,
  outputType: 'image/webp',
  quality: 0.85,
}

/** Calculates the largest contained image size allowed by the supplied bounds. */
export function calculateImageSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
  maxPixels = Number.POSITIVE_INFINITY,
): {width: number; height: number} {
  if (
    ![width, height, maxWidth, maxHeight].every((value) => Number.isFinite(value) && value > 0) ||
    maxPixels <= 0 ||
    Number.isNaN(maxPixels)
  ) {
    throw new Error('Image dimensions and limits must be positive finite numbers')
  }
  const scale = Math.min(1, maxWidth / width, maxHeight / height, Math.sqrt(maxPixels / (width * height)))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

const compatibleTypes = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'])
const processedImages = new WeakMap<File, {width: number; height: number}>()

/** Records a locally encoded output so compatible upload limits do not encode it again. */
export function registerProcessedImage(file: File, width: number, height: number): void {
  processedImages.set(file, {width, height})
}

function isHeic(file: File): boolean {
  return file.type === 'image/heic' || file.type === 'image/heif' || /\.(heic|heif)$/i.test(file.name)
}

/** Returns whether a file is one of the image formats handled by the local processor. */
export function isSupportedImage(file: File): boolean {
  return isHeic(file) || compatibleTypes.has(typeFromFile(file))
}

function typeFromFile(file: File): string {
  if (file.type) return file.type.toLowerCase()
  const extension = file.name.split('.').pop()?.toLowerCase()
  return extension === 'jpg' ? 'image/jpeg' : `image/${extension ?? ''}`
}

async function inspectImageHeader(
  file: File,
  type: string,
): Promise<{animated: boolean; width: number; height: number}> {
  const bytes = new Uint8Array(await file.slice(0, HEADER_INSPECTION_BYTES).arrayBuffer())
  if (type === 'image/gif') return inspectGifHeader(bytes)
  if (type === 'image/webp') return inspectWebp(bytes, file.size, true)
  if (type === 'image/png') return inspectPng(bytes)
  if (type === 'image/jpeg') return inspectJpeg(bytes)
  if (type === 'image/avif' || type === 'image/heic' || type === 'image/heif') return inspectIsoBmff(bytes, file.size)
  throw new Error(`Unsupported image format: ${type || 'unknown'}`)
}

async function inspectAnimation(file: File, type: string): Promise<boolean> {
  if (type === 'image/png') return inspectPngAnimation(new Uint8Array(await file.arrayBuffer()))
  if (type === 'image/avif') {
    return inspectAvifAnimation(new Uint8Array(await file.slice(0, HEADER_INSPECTION_BYTES).arrayBuffer()))
  }
  if (type !== 'image/gif' && type !== 'image/webp') return false
  const bytes = new Uint8Array(await file.arrayBuffer())
  return type === 'image/gif' ? inspectGif(bytes).animated : inspectWebp(bytes, file.size, false).animated
}

function inspectPngAnimation(bytes: Uint8Array): boolean {
  if (bytes.length < 20 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    throw new Error('Malformed PNG image')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let animated = false
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const end = offset + 12 + length
    if (end > bytes.length) throw new Error('Malformed PNG image')
    const chunk = fourCc(bytes, offset + 4)
    if (chunk === 'acTL') {
      if (length !== 8 || view.getUint32(offset + 8) === 0) throw new Error('Malformed APNG image')
      animated = true
    }
    offset = end
    if (chunk === 'IEND') return animated
  }
  throw new Error('Malformed PNG image')
}

function inspectAvifAnimation(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || fourCc(bytes, 4) !== 'ftyp') throw new Error('Malformed AVIF image')
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
  if (size < 16 || size > bytes.length || (size - 16) % 4 !== 0) throw new Error('Malformed AVIF image')
  if (fourCc(bytes, 8) === 'avis') return true
  for (let offset = 16; offset + 4 <= size; offset += 4) {
    if (fourCc(bytes, offset) === 'avis') return true
  }
  return false
}

function inspectGifHeader(bytes: Uint8Array): {animated: false; width: number; height: number} {
  if (bytes.length < 10 || fourCc(bytes, 0) !== 'GIF8' || (bytes[4] !== 0x37 && bytes[4] !== 0x39)) {
    throw new Error('Malformed GIF image')
  }
  return {animated: false, width: bytes[6]! | (bytes[7]! << 8), height: bytes[8]! | (bytes[9]! << 8)}
}

function skipGifSubBlocks(bytes: Uint8Array, start: number): number {
  let offset = start
  while (offset < bytes.length) {
    const length = bytes[offset++]!
    if (length === 0) return offset
    offset += length
  }
  return offset
}

function inspectGif(bytes: Uint8Array): {animated: boolean; width: number; height: number} {
  if (bytes.length < 13 || fourCc(bytes, 0) !== 'GIF8' || (bytes[4] !== 0x37 && bytes[4] !== 0x39)) {
    throw new Error('Malformed GIF image')
  }
  const width = bytes[6]! | (bytes[7]! << 8)
  const height = bytes[8]! | (bytes[9]! << 8)
  const globalTableSize = bytes[10]! & 0x80 ? 3 * 2 ** ((bytes[10]! & 7) + 1) : 0
  let offset = 13 + globalTableSize
  let frames = 0
  let hasTrailer = false
  while (offset < bytes.length) {
    const block = bytes[offset++]!
    if (block === 0x3b) {
      hasTrailer = true
      break
    }
    if (block === 0x21) {
      offset = skipGifSubBlocks(bytes, offset + 1)
      continue
    }
    if (block !== 0x2c || offset + 9 > bytes.length) throw new Error('Malformed GIF image')
    const packed = bytes[offset + 8]!
    offset += 9
    if (packed & 0x80) offset += 3 * 2 ** ((packed & 7) + 1)
    offset = skipGifSubBlocks(bytes, offset + 1)
    frames++
  }
  if (offset > bytes.length || !hasTrailer) throw new Error('Malformed GIF image')
  return {animated: frames > 1, width, height}
}

function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0)
}

function inspectPng(bytes: Uint8Array): {animated: false; width: number; height: number} {
  if (
    bytes.length < 24 ||
    fourCc(bytes, 12) !== 'IHDR' ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  ) {
    throw new Error('Malformed PNG image')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {animated: false, width: view.getUint32(16), height: view.getUint32(20)}
}

function inspectJpeg(bytes: Uint8Array): {animated: false; width: number; height: number} {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Malformed JPEG image')
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error('Malformed JPEG image')
    const marker = bytes[offset++]!
    if (marker === 0xd9 || marker === 0xda) break
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!
    if (length < 2 || offset + length > bytes.length) throw new Error('Malformed JPEG image')
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (length < 7) throw new Error('Malformed JPEG image')
      return {
        animated: false,
        height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
      }
    }
    offset += length
  }
  throw new Error('JPEG dimensions were not found in the bounded header')
}

function inspectIsoBmff(bytes: Uint8Array, fileSize: number): {animated: false; width: number; height: number} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let sawFtyp = false
  let dimensions: {width: number; height: number} | undefined
  const containers = new Set(['meta', 'iprp', 'ipco'])
  const walk = (start: number, end: number, depth: number): void => {
    if (depth > 4) throw new Error('Malformed ISO-BMFF image')
    let offset = start
    while (offset < end) {
      if (offset + 8 > end) throw new Error('Malformed ISO-BMFF image')
      let size = view.getUint32(offset)
      let headerSize = 8
      const type = fourCc(bytes, offset + 4)
      if (size === 1) {
        if (offset + 16 > end) throw new Error('Malformed ISO-BMFF image')
        size = Number(view.getBigUint64(offset + 8))
        headerSize = 16
      } else if (size === 0) {
        size = fileSize - offset
      }
      if (!Number.isSafeInteger(size) || size < headerSize || offset + size > fileSize) {
        throw new Error('Malformed ISO-BMFF image')
      }
      if (offset + size > end) {
        if (containers.has(type)) throw new Error('Image dimensions were not found in the bounded ISO-BMFF header')
        break
      }
      const data = offset + headerSize
      if (type === 'ftyp') sawFtyp = true
      if (type === 'ispe') {
        if (size < headerSize + 12) throw new Error('Malformed ISO-BMFF image')
        const candidate = {width: view.getUint32(data + 4), height: view.getUint32(data + 8)}
        if (
          candidate.width <= 0 ||
          candidate.height <= 0 ||
          candidate.width > MAX_INPUT_IMAGE_DIMENSION ||
          candidate.height > MAX_INPUT_IMAGE_DIMENSION ||
          candidate.width * candidate.height > MAX_INPUT_IMAGE_PIXELS
        ) {
          throw new Error('Image dimensions exceed the safety limit')
        }
        dimensions ??= candidate
      } else if (containers.has(type)) {
        walk(data + (type === 'meta' ? 4 : 0), offset + size, depth + 1)
      }
      offset += size
    }
  }
  walk(0, bytes.length, 0)
  if (!sawFtyp || !dimensions) throw new Error('Image dimensions were not found in the bounded ISO-BMFF header')
  return {animated: false, ...dimensions}
}

function inspectWebp(
  bytes: Uint8Array,
  fileSize: number,
  boundedPrefix: boolean,
): {animated: boolean; width: number; height: number} {
  if (bytes.length < 12 || fourCc(bytes, 0) !== 'RIFF' || fourCc(bytes, 8) !== 'WEBP') {
    throw new Error('Malformed WebP image')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = view.getUint32(4, true) + 8
  if (end < 12 || end !== fileSize) throw new Error('Malformed WebP image')
  let offset = 12
  let animated = false
  let width: number | undefined
  let height: number | undefined
  while (offset < end) {
    if (offset + 8 > bytes.length) {
      if (boundedPrefix) break
      throw new Error('Malformed WebP image')
    }
    const type = fourCc(bytes, offset)
    const size = view.getUint32(offset + 4, true)
    const data = offset + 8
    const next = data + size + (size & 1)
    if (next <= offset || next > end) throw new Error('Malformed WebP image')
    const bodyExtendsPastPrefix = next > bytes.length
    if (type === 'VP8X' && size >= 10 && data + 10 <= bytes.length) {
      width = 1 + bytes[data + 4]! + (bytes[data + 5]! << 8) + (bytes[data + 6]! << 16)
      height = 1 + bytes[data + 7]! + (bytes[data + 8]! << 8) + (bytes[data + 9]! << 16)
    }
    if (
      type === 'VP8 ' &&
      size >= 10 &&
      data + 10 <= bytes.length &&
      bytes[data + 3] === 0x9d &&
      bytes[data + 4] === 0x01 &&
      bytes[data + 5] === 0x2a
    ) {
      width = (bytes[data + 6]! | (bytes[data + 7]! << 8)) & 0x3fff
      height = (bytes[data + 8]! | (bytes[data + 9]! << 8)) & 0x3fff
    }
    if (type === 'VP8L' && size >= 5 && data + 5 <= bytes.length && bytes[data] === 0x2f) {
      width = 1 + bytes[data + 1]! + ((bytes[data + 2]! & 0x3f) << 8)
      height = 1 + (bytes[data + 2]! >> 6) + (bytes[data + 3]! << 2) + ((bytes[data + 4]! & 0x0f) << 10)
    }
    if (type === 'ANIM' || type === 'ANMF') animated = true
    if (bodyExtendsPastPrefix) {
      if (boundedPrefix) break
      throw new Error('Malformed WebP image')
    }
    offset = next
  }
  if (width === undefined || height === undefined)
    throw new Error('WebP dimensions were not found in the bounded header')
  return {animated, width, height}
}

function withinBounds(width: number, height: number, fileSize: number, policy: ImageProcessingPolicy): boolean {
  return (
    width <= policy.maxWidth &&
    height <= policy.maxHeight &&
    width * height <= policy.maxPixels &&
    fileSize <= policy.maxBytes
  )
}

function outputName(name: string, type: string): string {
  const extension = type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : null
  if (!extension) throw new Error(`This browser returned an unsupported image format: ${type || 'unknown'}`)
  const baseName = name.replace(/\.[^.]+$/, '') || 'image'
  return `${baseName}.${extension}`
}

async function encodeImage(
  image: CanvasImageSource,
  width: number,
  height: number,
  policy: {outputType: string; quality: number},
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image processing is not supported in this browser')
    context.drawImage(image, 0, 0, width, height)
    return canvas.convertToBlob({type: policy.outputType, quality: policy.quality})
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image processing is not supported in this browser')
  context.drawImage(image, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, policy.outputType, policy.quality))
  if (!blob) throw new Error(`This browser cannot encode ${policy.outputType} images`)
  return blob
}

async function inspectSourceImage(file: File) {
  if (file.size > MAX_INPUT_IMAGE_BYTES) throw new Error('Image exceeds the hard input limit')
  const heic = isHeic(file)
  const inputType = heic
    ? file.name.toLowerCase().endsWith('.heif') || file.type.toLowerCase() === 'image/heif'
      ? 'image/heif'
      : 'image/heic'
    : typeFromFile(file)
  if (!heic && !compatibleTypes.has(inputType)) {
    throw new Error(`Unsupported image format: ${inputType || 'unknown'}`)
  }

  const header = await inspectImageHeader(file, inputType)
  if (
    !Number.isFinite(header.width) ||
    !Number.isFinite(header.height) ||
    header.width <= 0 ||
    header.height <= 0 ||
    header.width > MAX_INPUT_IMAGE_DIMENSION ||
    header.height > MAX_INPUT_IMAGE_DIMENSION ||
    header.width * header.height > MAX_INPUT_IMAGE_PIXELS
  ) {
    throw new Error('Image dimensions exceed the safety limit')
  }
  const animated = await inspectAnimation(file, inputType)
  return {...header, animated, heic}
}

async function decodeSourceImage(file: File, heic: boolean): Promise<ImageBitmap> {
  const bitmap = heic
    ? await import('heic-to/csp').then(({heicTo}) =>
        heicTo({blob: file, type: 'bitmap', options: {imageOrientation: 'from-image'}}),
      )
    : await createImageBitmap(file, {imageOrientation: 'from-image'})

  try {
    if (
      !Number.isFinite(bitmap.width) ||
      !Number.isFinite(bitmap.height) ||
      bitmap.width <= 0 ||
      bitmap.height <= 0 ||
      bitmap.width > MAX_INPUT_IMAGE_DIMENSION ||
      bitmap.height > MAX_INPUT_IMAGE_DIMENSION ||
      bitmap.width * bitmap.height > MAX_INPUT_IMAGE_PIXELS
    ) {
      throw new Error('Decoded image dimensions exceed the safety limit')
    }
    return bitmap
  } catch (error) {
    bitmap.close()
    throw error
  }
}

/** Validates a still crop source and retains full resolution, converting HEIC to lossless PNG for preview. */
export async function prepareImageForCrop(file: File): Promise<File> {
  const {animated, heic} = await inspectSourceImage(file)
  if (animated) throw new Error('Animated images cannot be cropped; choose a still image')
  if (!heic) return file
  const bitmap = await decodeSourceImage(file, true)
  try {
    const blob = await encodeImage(bitmap, bitmap.width, bitmap.height, {outputType: 'image/png', quality: 1})
    if (blob.type !== 'image/png') throw new Error('This browser cannot prepare a lossless crop preview')
    if (blob.size > MAX_INPUT_IMAGE_BYTES) throw new Error('Crop preview exceeds the hard input limit')
    return new File([blob], outputName(file.name, blob.type), {type: blob.type, lastModified: file.lastModified})
  } finally {
    bitmap.close()
  }
}

/** Decodes a validated still image for cropping without flattening animations. */
export async function decodeImageForCrop(file: File): Promise<ImageBitmap> {
  const {animated, heic} = await inspectSourceImage(file)
  if (animated) throw new Error('Animated images cannot be cropped; choose a still image')
  return decodeSourceImage(file, heic)
}

/**
 * Normalizes a browser image locally, returning the sole file that should be uploaded.
 * Static images are decoded and re-encoded without metadata; supported animations
 * inside the policy bounds are preserved unchanged to avoid flattening their frames.
 */
export async function processImage(file: File, policy: ImageProcessingPolicy): Promise<File> {
  if (file.size > MAX_INPUT_IMAGE_BYTES) throw new Error('Image exceeds the hard input limit')
  if (
    ![policy.maxWidth, policy.maxHeight, policy.maxPixels, policy.maxBytes, policy.quality].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    policy.quality > 1
  ) {
    throw new Error('Image policy limits must be positive finite numbers and quality must not exceed 1')
  }
  const processed = processedImages.get(file)
  if (processed && withinBounds(processed.width, processed.height, file.size, policy)) return file
  const {width, height, animated, heic} = await inspectSourceImage(file)
  if (animated) {
    if (!withinBounds(width, height, file.size, policy)) {
      throw new Error('Animated images cannot be resized; choose a smaller image')
    }
    registerProcessedImage(file, width, height)
    return file
  }

  const bitmap = await decodeSourceImage(file, heic)
  try {
    const size = calculateImageSize(bitmap.width, bitmap.height, policy.maxWidth, policy.maxHeight, policy.maxPixels)
    const blob = await encodeImage(bitmap, size.width, size.height, policy)
    if (blob.size > policy.maxBytes) {
      throw new Error('The processed image is still too large')
    }
    const actualType = blob.type.toLowerCase()
    const result = new File([blob], outputName(file.name, actualType), {
      type: actualType,
      lastModified: file.lastModified,
    })
    registerProcessedImage(result, size.width, size.height)
    return result
  } finally {
    bitmap.close()
  }
}

/** Normalizes supported images while leaving videos and generic files unchanged. */
export async function processImageIfSupported(file: File, policy: ImageProcessingPolicy): Promise<File> {
  return isSupportedImage(file) ? processImage(file, policy) : file
}
