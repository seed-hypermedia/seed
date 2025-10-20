import {DAEMON_FILE_URL} from '@shm/shared/constants'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import fetch from 'node-fetch'
import sharp from 'sharp'

export async function _processImage(imageCid: string): Promise<string> {
  console.log('~ processImage', imageCid)
  try {
    // Fetch the image
    const response = await fetch(
      `${DAEMON_FILE_URL}/${extractIpfsUrlCid(imageCid)}`,
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`)
    }

    // Get the image buffer
    const imageBuffer = await response.buffer()

    // Check if it's a WebP image
    const metadata = await sharp(imageBuffer).metadata()
    const contentType = response.headers.get('content-type') || ''

    if (metadata.format === 'webp') {
      // Convert WebP to PNG
      const pngBuffer = await sharp(imageBuffer).png().toBuffer()

      // Convert to base64
      return `data:image/png;base64,${pngBuffer.toString('base64')}`
    }

    // For non-WebP images, ensure we're using the correct content type
    // If content type is missing or invalid, use the format from metadata
    const format = metadata.format || 'png'
    const mimeType = contentType.includes('image/')
      ? contentType
      : `image/${format}`

    // Convert to base64 with proper MIME type
    return `data:${mimeType};base64,${imageBuffer.toString('base64')}`
  } catch (error) {
    console.error('Error processing image:', error)
    // Return a placeholder or throw the error
    throw error
  }
}

function withTimeoutThrow<Input, PromiseResult>(
  asyncHandler: (input: Input) => Promise<PromiseResult>,
  label: string,
  timeout: number = 4_000,
): (input: Input) => Promise<PromiseResult> {
  return (input: Input) => {
    return Promise.race([
      asyncHandler(input),
      new Promise<PromiseResult>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Timeout: ${label} (${timeout}ms)`)),
          timeout,
        )
      }),
    ])
  }
}

function withTimeout<Input, PromiseResult>(
  asyncHandler: (input: Input) => Promise<PromiseResult>,
  label: string,
  timeout: number = 4_000,
): (input: Input) => Promise<PromiseResult | null> {
  return (input: Input) => {
    return Promise.race([
      asyncHandler(input),
      new Promise<PromiseResult | null>((resolve, reject) => {
        setTimeout(() => resolve(null), timeout)
      }),
    ])
  }
}

export const processImage = withTimeout(
  _processImage,
  'generating image for author',
  4_000,
)
