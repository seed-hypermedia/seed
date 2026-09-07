import {describe, expect, it, vi} from 'vitest'
import {createNodePropsFromAttachmentResult, handleLocalMediaPastePlugin} from './handle-local-media-paste-plugin'

describe('local media paste helpers', () => {
  it('leaves rich HTML images to the editor parser without renderer fetch', () => {
    const plugin = handleLocalMediaPastePlugin({})
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const getAsFile = vi.fn(() => null)
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) =>
          type === 'text/html' ? '<p>before</p><img src="https://example.com/image.jpg"><p>after</p>' : '',
        ),
        items: [{type: 'text/html', getAsFile}],
        files: [],
      },
    }
    const view = {
      state: {
        selection: {
          $anchor: {
            parent: {type: {name: 'paragraph'}, nodeSize: 3},
            end: () => 1,
          },
        },
      },
    }

    expect(plugin.props.handlePaste?.(view as never, event as never, undefined as never)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getAsFile).toHaveBeenCalledOnce()

    vi.unstubAllGlobals()
  })

  it('still claims direct clipboard images and inserts their uploaded node', async () => {
    const file = new File(['image'], 'paste.png', {type: 'image/png'})
    const handleFileAttachment = vi.fn().mockResolvedValue({url: 'ipfs://cid'})
    const create = vi.fn((props: Record<string, any>) => ({type: 'image', props}))
    const insert = vi.fn(() => 'transaction')
    const dispatch = vi.fn()
    const plugin = handleLocalMediaPastePlugin({handleFileAttachment})
    const view = {
      dom: {closest: vi.fn(() => null)},
      dispatch,
      state: {
        schema: {nodes: {image: {create}}},
        tr: {insert},
        selection: {
          $anchor: {
            parent: {type: {name: 'paragraph'}, nodeSize: 3},
            end: () => 1,
          },
        },
      },
    }
    const event = {
      clipboardData: {
        getData: vi.fn(() => ''),
        items: [{type: 'image/png', getAsFile: vi.fn(() => file)}],
        files: [],
      },
    }

    expect(plugin.props.handlePaste?.(view as never, event as never, undefined as never)).toBe(true)
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith('transaction'))
    expect(handleFileAttachment).toHaveBeenCalledWith(file)
    expect(create).toHaveBeenCalledWith({name: 'paste.png', url: 'ipfs://cid', displaySrc: ''})
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
