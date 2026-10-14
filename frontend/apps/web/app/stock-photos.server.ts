import type {StockPhoto} from '@shm/ui/image-picker'

const PEXELS_API_URL = 'https://api.pexels.com/v1'
const RESULTS_PER_PAGE = 30
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 500

/** Longest search query the proxy forwards to Pexels. */
export const STOCK_PHOTO_QUERY_MAX_LENGTH = 100

/** A failed request to the Pexels API, carrying the status to relay to the client. */
export class StockPhotoProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

type PexelsPhoto = {
  id: number
  width: number
  height: number
  url: string
  photographer: string
  photographer_url: string
  avg_color: string | null
  alt: string | null
  src: {tiny: string; large2x: string}
}

/** Maps a Pexels API photo to the shape the image picker consumes. */
export function toStockPhoto(photo: PexelsPhoto): StockPhoto {
  return {
    id: photo.id,
    alt: photo.alt ?? '',
    width: photo.width,
    height: photo.height,
    color: photo.avg_color,
    photographer: photo.photographer,
    photographerUrl: photo.photographer_url,
    pageUrl: photo.url,
    thumbUrl: photo.src.tiny,
    downloadUrl: photo.src.large2x,
  }
}

/**
 * Searches Pexels, or lists its curated photos when `query` is empty. Results
 * are cached in memory so repeated searches, and the curated list every picker
 * opens with, don't spend the API's hourly request quota.
 */
export function createStockPhotoSearch({apiKey, fetchImpl = fetch}: {apiKey: string; fetchImpl?: typeof fetch}) {
  const cache = new Map<string, {expiresAt: number; photos: StockPhoto[]}>()

  return async function searchStockPhotos(query: string): Promise<StockPhoto[]> {
    const key = query.toLowerCase()
    const cached = cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.photos

    const url = query
      ? `${PEXELS_API_URL}/search?${new URLSearchParams({
          query,
          per_page: String(RESULTS_PER_PAGE),
          orientation: 'landscape',
        })}`
      : `${PEXELS_API_URL}/curated?${new URLSearchParams({per_page: String(RESULTS_PER_PAGE)})}`
    const response = await fetchImpl(url, {headers: {Authorization: apiKey}})
    if (!response.ok) {
      throw new StockPhotoProviderError(`Pexels request failed (${response.status})`, response.status)
    }
    const body = (await response.json()) as {photos: PexelsPhoto[]}
    const photos = body.photos.map(toStockPhoto)

    cache.delete(key)
    cache.set(key, {expiresAt: Date.now() + CACHE_TTL_MS, photos})
    if (cache.size > CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return photos
  }
}
