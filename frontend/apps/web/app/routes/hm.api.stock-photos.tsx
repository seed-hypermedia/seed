import {createStockPhotoSearch, STOCK_PHOTO_QUERY_MAX_LENGTH, StockPhotoProviderError} from '@/stock-photos.server'
import type {LoaderFunction} from '@remix-run/node'
import {json} from '@remix-run/node'

const corsHeaders = {'Access-Control-Allow-Origin': '*'}
const apiKey = process.env.PEXELS_API_KEY
const searchStockPhotos = apiKey ? createStockPhotoSearch({apiKey}) : null

/**
 * Stock photo search for the cover image picker. Keeps the Pexels API key on
 * the server; desktop apps and self-hosted sites call the hyper.media gateway.
 */
export const loader: LoaderFunction = async ({request}) => {
  if (!searchStockPhotos) {
    return json({error: 'Stock photos are not configured'}, {status: 503, headers: corsHeaders})
  }
  const query = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, STOCK_PHOTO_QUERY_MAX_LENGTH)
  try {
    const photos = await searchStockPhotos(query)
    return json({photos}, {headers: {...corsHeaders, 'Cache-Control': 'public, max-age=3600'}})
  } catch (error) {
    const status = error instanceof StockPhotoProviderError && error.status === 429 ? 429 : 502
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Stock photo search failed: ${message}`)
    return json({error: 'Stock photo search failed'}, {status, headers: corsHeaders})
  }
}
