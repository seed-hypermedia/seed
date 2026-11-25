import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {
  AVATAR_IMAGE_POLICY,
  CONTENT_IMAGE_POLICY,
  MAX_INPUT_IMAGE_BYTES,
  MAX_INPUT_IMAGE_PIXELS,
  calculateImageSize,
  processImage,
  prepareImageForCrop,
  registerProcessedImage,
  processImageIfSupported,
} from '../image-processing'

const heicMocks = vi.hoisted(() => ({loaded: 0, heicTo: vi.fn()}))
vi.mock('heic-to/csp', () => {
  heicMocks.loaded++
  return {heicTo: heicMocks.heicTo}
})

function animatedGif(width: number, height: number): Uint8Array {
  const header = [...new TextEncoder().encode('GIF89a'), width & 255, width >> 8, height & 255, height >> 8, 0, 0, 0]
  const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0, 0]
  return new Uint8Array([...header, ...frame, ...frame, 0x3b])
}

function largeAnimatedGif(): Uint8Array {
  const base = animatedGif(64, 64)
  const comment = [0x21, 0xfe]
  for (let index = 0; index < 4200; index++) comment.push(255, ...new Uint8Array(255))
  comment.push(0)
  return new Uint8Array([...base.slice(0, 13), ...comment, ...base.slice(13)])
}

function animatedWebp(width: number, height: number): Uint8Array {
  const payload = [
    2,
    0,
    0,
    0,
    (width - 1) & 255,
    ((width - 1) >> 8) & 255,
    ((width - 1) >> 16) & 255,
    (height - 1) & 255,
    ((height - 1) >> 8) & 255,
    ((height - 1) >> 16) & 255,
  ]
  const vp8x = [...new TextEncoder().encode('VP8X'), 10, 0, 0, 0, ...payload]
  const anim = [...new TextEncoder().encode('ANIM'), 0, 0, 0, 0]
  const size = 4 + vp8x.length + anim.length
  return new Uint8Array([
    ...new TextEncoder().encode('RIFF'),
    size & 255,
    (size >> 8) & 255,
    0,
    0,
    ...new TextEncoder().encode('WEBP'),
    ...vp8x,
    ...anim,
  ])
}

function basicWebp(kind: 'VP8 ' | 'VP8L', width: number, height: number): Uint8Array {
  const payload =
    kind === 'VP8 '
      ? [0, 0, 0, 0x9d, 0x01, 0x2a, width & 255, width >> 8, height & 255, height >> 8]
      : [
          0x2f,
          (width - 1) & 255,
          (((width - 1) >> 8) & 0x3f) | (((height - 1) & 3) << 6),
          ((height - 1) >> 2) & 255,
          ((height - 1) >> 10) & 15,
        ]
  const padding = payload.length & 1 ? [0] : []
  const size = 4 + 8 + payload.length + padding.length
  return new Uint8Array([
    ...new TextEncoder().encode('RIFF'),
    size & 255,
    size >> 8,
    0,
    0,
    ...new TextEncoder().encode('WEBP'),
    ...new TextEncoder().encode(kind),
    payload.length,
    0,
    0,
    0,
    ...payload,
    ...padding,
  ])
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(45)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  new DataView(bytes.buffer).setUint32(8, 13)
  bytes.set(new TextEncoder().encode('IHDR'), 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  bytes.set(new TextEncoder().encode('IEND'), 37)
  return bytes
}

function animatedPng(width: number, height: number): Uint8Array {
  const base = pngHeader(width, height)
  const animation = new Uint8Array(20)
  new DataView(animation.buffer).setUint32(0, 8)
  animation.set(new TextEncoder().encode('acTL'), 4)
  new DataView(animation.buffer).setUint32(8, 2)
  return new Uint8Array([...base.slice(0, 33), ...animation, ...base.slice(33)])
}

function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    0x11,
    0,
    0xff,
    0xd9,
  ])
}

function heifHeader(width: number, height: number, extraDimensions: [number, number][] = []): Uint8Array {
  const text = (value: string) => [...new TextEncoder().encode(value)]
  const box = (type: string, data: number[]) => [0, 0, 0, data.length + 8, ...text(type), ...data]
  const makeIspe = (boxWidth: number, boxHeight: number) =>
    box('ispe', [
      0,
      0,
      0,
      0,
      boxWidth >> 24,
      (boxWidth >> 16) & 255,
      (boxWidth >> 8) & 255,
      boxWidth & 255,
      boxHeight >> 24,
      (boxHeight >> 16) & 255,
      (boxHeight >> 8) & 255,
      boxHeight & 255,
    ])
  const ipco = box('ipco', [makeIspe(width, height), ...extraDimensions.map(([w, h]) => makeIspe(w, h))].flat())
  const iprp = box('iprp', ipco)
  const meta = box('meta', [0, 0, 0, 0, ...iprp])
  return new Uint8Array([...box('ftyp', [...text('heic'), 0, 0, 0, 0]), ...meta])
}

function animatedAvif(width: number, height: number): Uint8Array {
  const bytes = heifHeader(width, height)
  bytes.set(new TextEncoder().encode('avis'), 8)
  return bytes
}

afterEach(() => {
  vi.unstubAllGlobals()
  heicMocks.heicTo.mockReset()
})

beforeEach(() => {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return {drawImage: vi.fn()}
      }
      convertToBlob() {
        return new Blob(['normalized'], {type: 'image/webp'})
      }
    },
  )
})

describe('calculateImageSize', () => {
  test('scales an image down without changing its aspect ratio', () => {
    expect(calculateImageSize(6000, 3000, 3000, 2000)).toEqual({
      width: 3000,
      height: 1500,
    })
  })

  test('rejects invalid dimensions and limits', () => {
    expect(() => calculateImageSize(Number.NaN, 100, 100, 100)).toThrow('positive finite')
    expect(() => calculateImageSize(100, 100, 0, 100)).toThrow('positive finite')
  })
})

describe('processImage', () => {
  test('re-encodes a compatible static image within bounds to strip metadata', async () => {
    const file = new File([jpegHeader(1200, 800)], 'photo.jpg', {type: 'image/jpeg'})
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({width: 1200, height: 800, close}))
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {drawImage: vi.fn()}
        }
        convertToBlob() {
          return new Blob(['normalized'], {type: 'image/webp'})
        }
      },
    )

    const result = await processImage(file, CONTENT_IMAGE_POLICY)

    expect(result).not.toBe(file)
    expect(result).toMatchObject({name: 'photo.webp', type: 'image/webp'})
    expect(close).toHaveBeenCalledOnce()
    expect(createImageBitmap).toHaveBeenCalledWith(file, {imageOrientation: 'from-image'})
    expect(heicMocks.loaded).toBe(0)
  })

  test('resizes an oversized image and returns only the encoded file', async () => {
    const file = new File([jpegHeader(6000, 3000)], 'camera.jpg', {type: 'image/jpeg'})
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({width: 6000, height: 3000, close}))
    const convertToBlob = vi.fn().mockResolvedValue(new Blob(['pixels'], {type: 'image/webp'}))
    const drawImage = vi.fn()
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          readonly width: number,
          readonly height: number,
        ) {}
        getContext() {
          return {drawImage}
        }
        convertToBlob = convertToBlob
      },
    )

    const result = await processImage(file, {
      ...CONTENT_IMAGE_POLICY,
      maxWidth: 3000,
      maxHeight: 2000,
    })

    expect(result).not.toBe(file)
    expect(result.name).toBe('camera.webp')
    expect(result.type).toBe('image/webp')
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 3000, 1500)
    expect(convertToBlob).toHaveBeenCalledWith({
      type: 'image/webp',
      quality: CONTENT_IMAGE_POLICY.quality,
    })
    expect(close).toHaveBeenCalledOnce()
  })

  test('preserves an animated GIF that is within the policy bounds', async () => {
    const bytes = animatedGif(64, 64)
    const file = new File([bytes], 'animation.gif', {type: 'image/gif'})
    vi.stubGlobal('createImageBitmap', vi.fn())

    await expect(processImage(file, CONTENT_IMAGE_POLICY)).resolves.toBe(file)
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  test('rejects an oversized animated GIF rather than flattening it', async () => {
    const bytes = animatedGif(800, 800)
    const file = new File([bytes], 'animation.gif', {type: 'image/gif'})

    await expect(processImage(file, {...CONTENT_IMAGE_POLICY, maxWidth: 500, maxHeight: 500})).rejects.toThrow(
      'Animated images cannot be resized',
    )
  })

  test('detects a multi-frame GIF even when it has no loop extension', async () => {
    const bytes = animatedGif(800, 800)
    const file = new File([bytes], 'animation.gif', {type: 'image/gif'})

    await expect(processImage(file, {...CONTENT_IMAGE_POLICY, maxWidth: 500, maxHeight: 500})).rejects.toThrow(
      'Animated images cannot be resized',
    )
  })

  test('does not treat a frame marker inside GIF compressed data as another frame', async () => {
    const bytes = new Uint8Array(29)
    bytes.set(animatedGif(64, 64).slice(0, 28))
    bytes[24] = 2
    bytes[25] = 0x2c
    bytes[26] = 0
    bytes[27] = 0
    bytes[28] = 0x3b
    const file = new File([bytes], 'still.gif', {type: 'image/gif'})
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({width: 64, height: 64, close: vi.fn()}))
    await processImage(file, CONTENT_IMAGE_POLICY)
    expect(createImageBitmap).toHaveBeenCalledOnce()
  })

  test('preserves animated WebP within bounds and rejects oversized ones without decoding', async () => {
    const small = new File([animatedWebp(64, 64)], 'small.webp', {type: 'image/webp'})
    const large = new File([animatedWebp(800, 800)], 'large.webp', {type: 'image/webp'})
    vi.stubGlobal('createImageBitmap', vi.fn())
    await expect(processImage(small, CONTENT_IMAGE_POLICY)).resolves.toBe(small)
    await expect(processImage(large, {...CONTENT_IMAGE_POLICY, maxWidth: 500})).rejects.toThrow(
      'Animated images cannot be resized',
    )
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  test('preserves APNG within bounds and rejects one that needs resizing', async () => {
    const file = new File([animatedPng(64, 64)], 'animation.png', {type: 'image/png'})
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).resolves.toBe(file)

    const oversized = new File([animatedPng(64, 64)], 'oversized.png', {type: 'image/png'})
    await expect(processImage(oversized, {...CONTENT_IMAGE_POLICY, maxWidth: 32})).rejects.toThrow(
      'Animated images cannot be resized',
    )
  })

  test('preserves animated AVIF within bounds and rejects one that needs resizing', async () => {
    const file = new File([animatedAvif(64, 64)], 'animation.avif', {type: 'image/avif'})
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).resolves.toBe(file)

    const oversized = new File([animatedAvif(64, 64)], 'oversized.avif', {type: 'image/avif'})
    await expect(processImage(oversized, {...CONTENT_IMAGE_POLICY, maxWidth: 32})).rejects.toThrow(
      'Animated images cannot be resized',
    )
  })

  test('rejects video files at the image processor boundary', async () => {
    const file = new File(['video'], 'clip.mp4', {type: 'video/mp4'})
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).rejects.toThrow('Unsupported image format: video/mp4')
  })

  test('rejects inputs over the hard byte ceiling before reading or decoding', async () => {
    const arrayBuffer = vi.fn()
    const file = {
      name: 'huge.jpg',
      type: 'image/jpeg',
      size: MAX_INPUT_IMAGE_BYTES + 1,
      arrayBuffer,
    } as unknown as File
    vi.stubGlobal('createImageBitmap', vi.fn())
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).rejects.toThrow('input limit')
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  test('rejects decompression-bomb dimensions before native decoding', async () => {
    const file = new File([pngHeader(MAX_INPUT_IMAGE_PIXELS, 2)], 'bomb.png', {type: 'image/png'})
    vi.stubGlobal('createImageBitmap', vi.fn())
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).rejects.toThrow('safety limit')
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  test('rejects HEIF whose dimensions cannot be found in the bounded header', async () => {
    const file = new File(
      [new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])],
      'unknown.heif',
      {type: 'image/heif'},
    )
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).rejects.toThrow('dimensions')
    expect(heicMocks.heicTo).not.toHaveBeenCalled()
  })

  test('requires a GIF trailer before preserving animation unchanged', async () => {
    const bytes = animatedGif(64, 64)
    const file = new File([bytes.slice(0, -1)], 'truncated.gif', {type: 'image/gif'})
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).rejects.toThrow('Malformed GIF image')
  })

  test('accepts an animated GIF whose valid trailer is beyond the header prefix', async () => {
    const file = new File([largeAnimatedGif()], 'large.gif', {type: 'image/gif'})
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).resolves.toBe(file)
  })

  test.each(['VP8 ', 'VP8L'] as const)('reads dimensions from basic %s WebP', async (kind) => {
    const file = new File([basicWebp(kind, 64, 32)], 'basic.webp', {type: 'image/webp'})
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({width: 64, height: 32, close: vi.fn()}))
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).resolves.not.toBe(file)
  })

  test('reads a VP8 header before its chunk body extends beyond the bounded prefix', async () => {
    const payloadSize = 1_100_000
    const header = new Uint8Array(30)
    header.set(new TextEncoder().encode('RIFF'))
    new DataView(header.buffer).setUint32(4, 4 + 8 + payloadSize, true)
    header.set(new TextEncoder().encode('WEBPVP8 '), 8)
    new DataView(header.buffer).setUint32(16, payloadSize, true)
    header.set([0, 0, 0, 0x9d, 0x01, 0x2a, 64, 0, 32, 0], 20)
    const file = new File([header, new Uint8Array(payloadSize - 10)], 'large.webp', {type: 'image/webp'})
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({width: 64, height: 32, close: vi.fn()}))

    await expect(processImage(file, CONTENT_IMAGE_POLICY)).resolves.not.toBe(file)
  })

  test('rejects malformed WebP chunks with unsigned high-bit lengths', async () => {
    const bytes = animatedWebp(64, 64)
    bytes[16] = 0xff
    bytes[17] = 0xff
    bytes[18] = 0xff
    bytes[19] = 0xff
    const file = new File([bytes], 'broken.webp', {type: 'image/webp'})
    vi.stubGlobal('createImageBitmap', vi.fn())
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).rejects.toThrow('Malformed WebP image')
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  test('rejects truncated GIF structures before decoding', async () => {
    const bytes = animatedGif(64, 64).slice(0, 20)
    const file = new File([bytes], 'broken.gif', {type: 'image/gif'})
    vi.stubGlobal('createImageBitmap', vi.fn())
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).rejects.toThrow('Malformed GIF image')
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  test('uses the actual encoder MIME type for the processed filename', async () => {
    const file = new File([pngHeader(800, 800)], 'large.png', {type: 'image/png'})
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({width: 800, height: 800, close: vi.fn()}))
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {drawImage: vi.fn()}
        }
        convertToBlob() {
          return new Blob(['encoded'], {type: 'image/png'})
        }
      },
    )
    const result = await processImage(file, {...CONTENT_IMAGE_POLICY, maxWidth: 500})
    expect(result.name).toBe('large.png')
    expect(result.type).toBe('image/png')
  })

  test('rejects an encoded image that remains over the output limit', async () => {
    const file = new File([pngHeader(800, 800)], 'large.png', {type: 'image/png'})
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({width: 800, height: 800, close: vi.fn()}))
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {drawImage: vi.fn()}
        }
        convertToBlob() {
          return new Blob(['too large'], {type: 'image/webp'})
        }
      },
    )
    await expect(processImage(file, {...CONTENT_IMAGE_POLICY, maxWidth: 500, maxBytes: 2})).rejects.toThrow(
      'processed image is still too large',
    )
  })

  test('lazily decodes HEIF with orientation and returns only the encoded file', async () => {
    const file = new File([heifHeader(1200, 800)], 'camera.heif', {type: 'image/heif'})
    heicMocks.heicTo.mockResolvedValue({width: 1200, height: 800, close: vi.fn()})
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {drawImage: vi.fn()}
        }
        convertToBlob() {
          return new Blob(['encoded'], {type: 'image/webp'})
        }
      },
    )
    const result = await processImage(file, CONTENT_IMAGE_POLICY)
    expect(heicMocks.loaded).toBe(1)
    expect(heicMocks.heicTo).toHaveBeenCalledWith({
      blob: file,
      type: 'bitmap',
      options: {imageOrientation: 'from-image'},
    })
    expect(result.name).toBe('camera.webp')
    expect(result).not.toBe(file)
  })

  test('recognizes a HEIC extension reported as application/octet-stream', async () => {
    const file = new File([heifHeader(64, 64)], 'camera.heic', {type: 'application/octet-stream'})
    heicMocks.heicTo.mockResolvedValue({width: 64, height: 64, close: vi.fn()})
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {drawImage: vi.fn()}
        }
        convertToBlob() {
          return new Blob(['encoded'], {type: 'image/webp'})
        }
      },
    )

    await expect(processImage(file, CONTENT_IMAGE_POLICY)).resolves.toMatchObject({name: 'camera.webp'})
  })

  test('rejects ISO-BMFF when any encountered ispe exceeds the hard safety limit', async () => {
    const file = new File([heifHeader(MAX_INPUT_IMAGE_PIXELS, 2, [[64, 64]])], 'bomb.heif', {type: 'image/heif'})
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).rejects.toThrow('safety limit')
    expect(heicMocks.heicTo).not.toHaveBeenCalled()
  })

  test('uses metadata before an ISO-BMFF media box extending beyond the bounded prefix', async () => {
    const mediaSize = 1_100_000
    const mdatHeader = new Uint8Array(8)
    new DataView(mdatHeader.buffer).setUint32(0, mediaSize)
    mdatHeader.set(new TextEncoder().encode('mdat'), 4)
    const file = new File([heifHeader(64, 64), mdatHeader, new Uint8Array(mediaSize - 8)], 'large.heif', {
      type: 'image/heif',
    })
    heicMocks.heicTo.mockResolvedValue({width: 64, height: 64, close: vi.fn()})
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {drawImage: vi.fn()}
        }
        convertToBlob() {
          return new Blob(['encoded'], {type: 'image/webp'})
        }
      },
    )
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).resolves.toMatchObject({name: 'large.webp'})
  })
})

describe('processImageIfSupported', () => {
  test('leaves non-image uploads untouched', async () => {
    const file = new File(['video'], 'clip.mp4', {type: 'video/mp4'})

    await expect(processImageIfSupported(file, CONTENT_IMAGE_POLICY)).resolves.toBe(file)
  })

  test('does not inspect an image again after a surface already processed it', async () => {
    const file = new File([pngHeader(64, 64)], 'avatar.png', {type: 'image/png'})
    const decode = vi.fn(async () => ({width: 64, height: 64, close: vi.fn()}))
    vi.stubGlobal('createImageBitmap', decode)

    const processed = await processImage(file, AVATAR_IMAGE_POLICY)
    await processImageIfSupported(processed, CONTENT_IMAGE_POLICY)

    expect(decode).toHaveBeenCalledTimes(1)
  })
})

describe('crop processing boundary', () => {
  test('keeps full-resolution native source unchanged before cropping', async () => {
    const file = new File([jpegHeader(6000, 4000)], 'photo.jpg', {type: 'image/jpeg'})
    await expect(prepareImageForCrop(file)).resolves.toBe(file)
  })

  test('rejects animations instead of giving the cropper a still frame', async () => {
    const file = new File([animatedGif(64, 64)], 'motion.gif', {type: 'image/gif'})
    await expect(prepareImageForCrop(file)).rejects.toThrow('Animated images cannot be cropped')
  })

  test('uses full-resolution lossless PNG for HEIC crop previews', async () => {
    const file = new File([heifHeader(6000, 4000)], 'camera.heic', {type: 'image/heic'})
    const close = vi.fn()
    heicMocks.heicTo.mockResolvedValue({width: 6000, height: 4000, close})
    const encode = vi.fn().mockResolvedValue(new Blob(['preview'], {type: 'image/png'}))
    const draw = vi.fn()
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {drawImage: draw}
        }
        convertToBlob = encode
      },
    )
    await expect(prepareImageForCrop(file)).resolves.toMatchObject({name: 'camera.png', type: 'image/png'})
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 6000, 4000)
    expect(encode).toHaveBeenCalledWith(expect.objectContaining({type: 'image/png'}))
    expect(close).toHaveBeenCalledOnce()
  })

  test('reuses a cropped output within bounds but does not bypass stricter limits', async () => {
    const file = new File([jpegHeader(512, 512)], 'crop.jpg', {type: 'image/jpeg'})
    registerProcessedImage(file, 512, 512)
    await expect(processImage(file, CONTENT_IMAGE_POLICY)).resolves.toBe(file)
    const decode = vi.fn().mockRejectedValue(new Error('stricter policy requires processing'))
    vi.stubGlobal('createImageBitmap', decode)
    await expect(processImage(file, {...AVATAR_IMAGE_POLICY, maxWidth: 128})).rejects.toThrow('stricter policy')
    expect(decode).toHaveBeenCalledOnce()
  })
})

test('crop export encodes once and survives the upload fallback unchanged', async () => {
  const {cropImageFile} = await import('../image-crop')
  const file = new File([jpegHeader(6000, 4000)], 'photo.jpg', {type: 'image/jpeg'})
  const bitmap = {width: 6000, height: 4000, close: vi.fn()}
  const decode = vi.fn().mockResolvedValue(bitmap)
  vi.stubGlobal('createImageBitmap', decode)
  const drawImage = vi.fn()
  const encode = vi.fn((callback: (blob: Blob) => void) => callback(new Blob(['crop'], {type: 'image/jpeg'})))
  vi.stubGlobal('document', {
    createElement: () => ({getContext: () => ({drawImage, fillRect: vi.fn()}), toBlob: encode}),
  })
  const result = await cropImageFile(file, {x: 2000, y: 1000, width: 2000, height: 2000}, {maxDimension: 512})
  await expect(processImage(result, AVATAR_IMAGE_POLICY)).resolves.toBe(result)
  expect(drawImage).toHaveBeenCalledWith(bitmap, 2000, 1000, 2000, 2000, 0, 0, 512, 512)
  expect(encode).toHaveBeenCalledOnce()
  expect(decode).toHaveBeenCalledOnce()
})

test('accepts an extended-size media box used by camera HEIC files', async () => {
  const media = new Uint8Array(24)
  const view = new DataView(media.buffer)
  view.setUint32(0, 1)
  media.set(new TextEncoder().encode('mdat'), 4)
  view.setBigUint64(8, BigInt(media.length))
  const file = new File([heifHeader(64, 64), media], 'camera.heic', {type: 'image/heic'})
  heicMocks.heicTo.mockRejectedValue(new Error('reached decoder'))
  await expect(prepareImageForCrop(file)).rejects.toThrow('reached decoder')
})
