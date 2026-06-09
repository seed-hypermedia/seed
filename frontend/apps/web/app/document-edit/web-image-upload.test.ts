import {afterEach, describe, expect, it, vi} from 'vitest'
import {fetchWebImportBlob} from './web-image-upload'

describe('fetchWebImportBlob', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads remote files through the same-origin proxy', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(['image'], {type: 'image/png'})))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchWebImportBlob('https://example.com/image.png')

    expect(fetchMock).toHaveBeenCalledWith('/hm/api/web-file?url=https%3A%2F%2Fexample.com%2Fimage.png')
    expect(result.type).toBe('image/png')
    expect(result.size).toBe(5)
  })
})
