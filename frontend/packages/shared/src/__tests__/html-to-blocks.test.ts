import {describe, expect, it, vi} from 'vitest'
import {HMAnnotation, HMBlock} from '..'
import {htmlToBlocks} from '../html-to-blocks'

describe('htmlToBlocks', () => {
  it('converts paragraphs to blocks', async () => {
    const html = '<p>Hello world</p><p>Another paragraph</p>'
    const mockUploadLocalFile = vi.fn()

    const blocks = await htmlToBlocks(html, '/test/path', mockUploadLocalFile)

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({
      type: 'Paragraph',
      text: 'Hello world',
    })
    expect(blocks[1]).toMatchObject({
      type: 'Paragraph',
      text: 'Another paragraph',
    })
  })

  it('converts images to blocks with figure wrapper', async () => {
    const html = '<figure><img src="test.jpg" /></figure>'
    const mockUploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')

    const blocks = await htmlToBlocks(html, '/test/path', mockUploadLocalFile)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'Image',
      link: 'ipfs://QmTestCID',
    })
    expect(mockUploadLocalFile).toHaveBeenCalledWith('/test/test.jpg')
  })

  it('converts images to blocks', async () => {
    const html = '<img src="test.jpg" />'
    const mockUploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')

    const blocks = await htmlToBlocks(html, '/test/path', mockUploadLocalFile)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'Image',
      link: 'ipfs://QmTestCID',
    })
    expect(mockUploadLocalFile).toHaveBeenCalledWith('/test/test.jpg')
  })

  it('converts bold text to annotations (b) tag', async () => {
    const html = '<p>hello <b>world</b>!</p>'
    const mockUploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')
    const blocks = await htmlToBlocks(html, '/test/path', mockUploadLocalFile)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'Paragraph',
      text: 'hello world!',
      annotations: [
        {
          type: 'Bold',
          starts: [6],
          ends: [11],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('converts bold text to annotations (strong) tag', async () => {
    const html = '<p>hello <strong>world</strong>!</p>'
    const mockUploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')
    const blocks = await htmlToBlocks(html, '/test/path', mockUploadLocalFile)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'Paragraph',
      text: 'hello world!',
      annotations: [
        {
          type: 'Bold',
          starts: [6],
          ends: [11],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('handles empty paragraphs', async () => {
    const html = '<p></p><p>  </p>'
    const mockUploadLocalFile = vi.fn()

    const blocks = await htmlToBlocks(html, '/test/path', mockUploadLocalFile)

    expect(blocks).toHaveLength(0)
  })

  it('handles failed image uploads', async () => {
    const html = '<figure><img src="test.jpg" /></figure>'
    const mockUploadLocalFile = vi.fn().mockResolvedValue(null)

    const blocks = await htmlToBlocks(html, '/test/path', mockUploadLocalFile)

    expect(blocks).toHaveLength(0)
  })
})
