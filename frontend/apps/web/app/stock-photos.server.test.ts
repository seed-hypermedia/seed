import {describe, expect, it, vi} from 'vitest'
import {createStockPhotoSearch, StockPhotoProviderError} from './stock-photos.server'

const pexelsPhoto = {
  id: 417074,
  width: 5184,
  height: 3456,
  url: 'https://www.pexels.com/photo/lake-and-mountain-417074/',
  photographer: 'Jane Doe',
  photographer_url: 'https://www.pexels.com/@jane',
  avg_color: '#6E7B87',
  alt: 'Lake and mountain',
  src: {
    tiny: 'https://images.pexels.com/photos/417074/tiny.jpeg',
    large2x: 'https://images.pexels.com/photos/417074/large2x.jpeg',
  },
}

function pexelsResponse(status = 200) {
  return new Response(JSON.stringify({photos: [pexelsPhoto]}), {status})
}

describe('createStockPhotoSearch', () => {
  it('lists curated photos for an empty query and maps them for the picker', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => pexelsResponse())
    const search = createStockPhotoSearch({apiKey: 'key', fetchImpl})

    const photos = await search('')

    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('https://api.pexels.com/v1/curated?'), {
      headers: {Authorization: 'key'},
    })
    expect(photos).toEqual([
      {
        id: 417074,
        alt: 'Lake and mountain',
        width: 5184,
        height: 3456,
        color: '#6E7B87',
        photographer: 'Jane Doe',
        photographerUrl: 'https://www.pexels.com/@jane',
        pageUrl: 'https://www.pexels.com/photo/lake-and-mountain-417074/',
        thumbUrl: 'https://images.pexels.com/photos/417074/tiny.jpeg',
        downloadUrl: 'https://images.pexels.com/photos/417074/large2x.jpeg',
      },
    ])
  })

  it('searches landscape photos by keyword', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => pexelsResponse())
    const search = createStockPhotoSearch({apiKey: 'key', fetchImpl})

    await search('mountain lake')

    const url = new URL(String(fetchImpl.mock.calls[0]![0]))
    expect(url.pathname).toBe('/v1/search')
    expect(url.searchParams.get('query')).toBe('mountain lake')
    expect(url.searchParams.get('orientation')).toBe('landscape')
  })

  it('serves repeated queries from the cache, ignoring case', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => pexelsResponse())
    const search = createStockPhotoSearch({apiKey: 'key', fetchImpl})

    await search('Mountains')
    await search('mountains')

    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('reports the Pexels status when the request fails and does not cache the failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => pexelsResponse(429))
    const search = createStockPhotoSearch({apiKey: 'key', fetchImpl})

    await expect(search('sea')).rejects.toEqual(expect.objectContaining({status: 429}))
    await expect(search('sea')).rejects.toBeInstanceOf(StockPhotoProviderError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
