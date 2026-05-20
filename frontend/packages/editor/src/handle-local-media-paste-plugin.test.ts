import {describe, expect, it, vi, afterEach} from 'vitest'
import {
  createNodePropsFromAttachmentResult,
  extractPastedImageSources,
  imageSourceToFile,
} from './handle-local-media-paste-plugin'

describe('local media paste helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('extracts pasted HTML image sources', () => {
    const html = `
      <p>before</p>
      <img src="data:image/png;base64,abc" alt="pasted screenshot">
      <img src="https://example.com/image.webp">
    `

    expect(extractPastedImageSources(html)).toEqual(['data:image/png;base64,abc', 'https://example.com/image.webp'])
  })

  it('skips Seed image block HTML that the schema parser handles', () => {
    const html = `
      <div data-content-type="image">
        <img src="ipfs://already-a-block">
      </div>
      <p><img src="https://example.com/external.png"></p>
    `

    expect(extractPastedImageSources(html)).toEqual(['https://example.com/external.png'])
  })

  it('converts pasted HTML image sources to Files', async () => {
    const blob = new Blob(['jpeg data'], {type: 'image/jpeg'})
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => blob,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const file = await imageSourceToFile('https://example.com/image.jpg', () => 123)

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/image.jpg')
    expect(file.name).toBe('pasted-image-123.jpg')
    expect(file.type).toBe('image/jpeg')
  })

  it('maps desktop/web document upload results to IPFS node props', () => {
    const file = new File(['image'], 'paste.png', {type: 'image/png'})

    expect(createNodePropsFromAttachmentResult(file, {url: 'ipfs://cid', displaySrc: ''}, 'image')).toEqual({
      name: 'paste.png',
      url: 'ipfs://cid',
      displaySrc: '',
    })
  })

  it('maps web comment mediaRef results to draft media node props', () => {
    const file = new File(['image'], 'paste.png', {type: 'image/png'})
    const mediaRef = {
      draftId: 'draft-1',
      mediaId: 'media-1',
      name: 'paste.png',
      mime: 'image/png',
      size: 5,
    }

    expect(createNodePropsFromAttachmentResult(file, {mediaRef, displaySrc: 'blob://preview'}, 'image')).toEqual({
      name: 'paste.png',
      mediaRef: JSON.stringify(mediaRef),
      displaySrc: 'blob://preview',
    })
  })

  it('maps legacy web binary results to local preview node props', () => {
    const file = new File(['image'], 'paste.png', {type: 'image/png'})
    const fileBinary = new Uint8Array([1, 2, 3])

    expect(createNodePropsFromAttachmentResult(file, {fileBinary, displaySrc: 'blob://preview'}, 'image')).toEqual({
      name: 'paste.png',
      fileBinary,
      displaySrc: 'blob://preview',
    })
  })
})
