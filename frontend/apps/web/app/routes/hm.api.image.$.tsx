import {LoaderFunction} from '@remix-run/node'
import {DAEMON_HTTP_URL, OptimizedImageSize} from '@shm/shared'
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

  // Serve cached GIF if present
  try {
    const cachedGif = await fs.readFile(gifCachePath)
    return new Response(cachedGif, {
      headers: {
        'Content-Type': 'image/gif',
        'Content-Length': String(cachedGif.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (err) {
    // File does not exist, proceed to download and resize
  }

  // Serve cached PNG if present
  try {
    const cachedPng = await fs.readFile(pngCachePath)
    return new Response(cachedPng, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(cachedPng.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (err) {
    // File does not exist, proceed to download and resize
  }

  try {
    // Fetch the original image or gif from the daemon
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
      // Bypass Sharp to preserve gif animation
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
