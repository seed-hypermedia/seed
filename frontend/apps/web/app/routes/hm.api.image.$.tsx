import {LoaderFunction} from 'react-router'
import {OptimizedImageSize} from '@shm/shared'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'

import fileTypePkg from 'file-type'
const {fromBuffer} = fileTypePkg as {
  fromBuffer: (buf: Buffer) => Promise<{ext: string; mime: string} | undefined>
}

const CACHE_PATH = path.resolve(
  path.join(process.env.DATA_DIR || process.cwd(), 'image-cache'),
)
const IMG_SIZE_WIDTHS: Record<OptimizedImageSize, number> = {
  S: 120, // larger than any "icon" representations in the UI, so far
  M: 650, // width of the newspaper cards
  L: 1600, // 525 is width of image in banner, 785 is the current max width of document content
  XL: 4000, // the banner can be very wide
}

export const loader: LoaderFunction = async ({params, request}) => {
  const entityPath = params['*']?.split('/')
  const CID = entityPath?.[0]
  const url = new URL(request.url)
  const size = (url.searchParams.get('size') || 'M') as OptimizedImageSize

  if (!CID) return new Response('No CID provided', {status: 400})
  const width = IMG_SIZE_WIDTHS[size]
  if (!width) {
    return new Response(
      `Invalid size, must be ${Object.keys(IMG_SIZE_WIDTHS).join(', ')}`,
      {status: 400},
    )
  }

  // NOTE: We cannot know the extension until we fetch, so keep two cache paths:
  const pngCachePath = path.join(CACHE_PATH, `${CID}.${width}w.png`)
  const gifCachePath = path.join(CACHE_PATH, `${CID}.${width}w.gif`)

  // Check if we have a cached version (prioritize GIF over PNG)
  let cachedFile: Buffer | null = null
  let cachedContentType: string | null = null

  // First check for GIF cache
  try {
    cachedFile = await fs.readFile(gifCachePath)
    cachedContentType = 'image/gif'
  } catch (err) {
    // GIF cache doesn't exist, check PNG cache
    try {
      cachedFile = await fs.readFile(pngCachePath)
      cachedContentType = 'image/png'
    } catch (err) {
      // No cache exists, will need to fetch and process
    }
  }

  // If we have a cached file, serve it (with migration check)
  if (cachedFile && cachedContentType) {
    // Special case: if we only have PNG cache, check if the original is actually a GIF
    if (cachedContentType === 'image/png') {
      try {
        await fs.access(gifCachePath)
        // If we reach here, both PNG and GIF cache exist (shouldn't happen with our logic above)
      } catch (err) {
        // GIF cache doesn't exist. Let's verify the original isn't actually a GIF.
        // If it is, we'll delete the PNG cache and re-process as GIF.
        try {
          const imageUrl = `${DAEMON_HTTP_URL}/ipfs/${CID}`
          const response = await fetch(imageUrl)
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer()
            const imageBuffer = Buffer.from(arrayBuffer)
            const type = await fromBuffer(imageBuffer)
            const isGif = type?.ext === 'gif' || type?.mime === 'image/gif'

            if (isGif) {
              // Original is a GIF but we have it cached as PNG - delete PNG cache and re-process
              await fs.unlink(pngCachePath).catch(() => {}) // Ignore errors if file doesn't exist
              cachedFile = null
              cachedContentType = null
              // This will fall through to the re-processing logic below
            }
          }
        } catch (migrationErr) {
          // If migration check fails, just serve the cached PNG
          console.warn(
            'Failed to check original file type for migration:',
            migrationErr,
          )
        }
      }
    }

    // If we still have a cached file after migration check, serve it
    if (cachedFile && cachedContentType) {
      return new Response(cachedFile, {
        headers: {
          'Content-Type': cachedContentType,
          'Content-Length': String(cachedFile.length),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }
  }

  try {
    // Fetch the original image or gif from the daemon (reuse if we already fetched for migration)
    const imageUrl = `${DAEMON_HTTP_URL}/ipfs/${CID}`
    const response = await fetch(imageUrl)
    if (!response.ok) throw new Error(`Failed to fetch image from ${imageUrl}`)

    const arrayBuffer = await response.arrayBuffer()
    const imageBuffer = Buffer.from(arrayBuffer)

    // Detect type from bytes buffer
    const type = await fromBuffer(imageBuffer)
    const isGif = type?.ext === 'gif' || type?.mime === 'image/gif'

    // Ensure the cache directory exists
    await fs.mkdir(CACHE_PATH, {recursive: true})

    if (isGif) {
      // For GIFs, we preserve the original to maintain animation
      // We don't resize GIFs as it would break animation
      await fs.writeFile(gifCachePath, imageBuffer)
      return new Response(imageBuffer, {
        headers: {
          'Content-Type': 'image/gif',
          'Content-Length': String(imageBuffer.length),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }

    const resizedImage = await sharp(imageBuffer)
      .resize({width, withoutEnlargement: true})
      .png()
      .toBuffer()

    await fs.writeFile(pngCachePath, resizedImage)

    return new Response(resizedImage, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(resizedImage.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (err) {
    console.error('hm.api.image loader error:', err)
    return new Response('Failed to process image', {status: 500})
  }
}
