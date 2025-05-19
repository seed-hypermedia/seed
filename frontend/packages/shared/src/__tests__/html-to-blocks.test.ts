import {describe, expect, it, vi} from 'vitest'
import {HMAnnotation, HMBlock} from '..'
import {htmlToBlocks} from '../html-to-blocks'

describe('htmlToBlocks', () => {
  it('converts paragraphs to blocks', async () => {
    const html = '<p>Hello world</p><p>Another paragraph</p>'
    const uploadLocalFile = vi.fn()

    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(2)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'Hello world',
    })
    expect(blocks[1].block).toMatchObject({
      type: 'Paragraph',
      text: 'Another paragraph',
    })
  })

  it('converts images to blocks with figure wrapper', async () => {
    const html = '<figure><img src="test.jpg" /></figure>'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')

    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Image',
      link: 'ipfs://QmTestCID',
    })
    expect(uploadLocalFile).toHaveBeenCalledWith('/test/test.jpg')
  })

  it('converts images to blocks', async () => {
    const html = '<img src="test.jpg" />'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')

    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Image',
      link: 'ipfs://QmTestCID',
    })
    expect(uploadLocalFile).toHaveBeenCalledWith('/test/test.jpg')
  })

  it('converts bold text to annotations (b) tag', async () => {
    const html = '<p>hello <b>world</b>!</p>'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
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
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
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

  it('converts bold text to annotations with utf-8 code point offsets', async () => {
    const html = '<p>😄<strong>a</strong></p>'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: '😄a',
      link: '',
      revision: blocks[0].block.revision as string,
      id: blocks[0].block.id as string,
      annotations: [
        {
          type: 'Bold',
          starts: [1],
          ends: [2],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('converts text with link to annotation', async () => {
    const html = '<p>😄<a href="https://github.com">foobar</a></p>'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: '😄foobar',
      link: '',
      revision: blocks[0].block.revision as string,
      id: blocks[0].block.id as string,
      annotations: [
        {
          type: 'Link',
          starts: [1],
          ends: [7],
          link: 'https://github.com',
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('converts text with hm link to annotation', async () => {
    const html = '<p>😄<a href="https://github.com">foobar</a></p>'
    const resolveHMLink = vi
      .fn()
      .mockResolvedValue(Promise.resolve('hm://foobar/baz'))
    const blocks = await htmlToBlocks(html, '/test/path', {resolveHMLink})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: '😄foobar',
      link: '',
      revision: blocks[0].block.revision as string,
      id: blocks[0].block.id as string,
      annotations: [
        {
          type: 'Link',
          starts: [1],
          ends: [7],
          link: 'hm://foobar/baz',
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('handles paragraphs with both links and bolds', async () => {
    const html =
      '<p>foo <a href="https://github.com">bar <strong>baz</strong></a> <strong>qux</strong></p>'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'foo bar baz qux',
      annotations: [
        {
          type: 'Link',
          starts: [4],
          ends: [11],
          link: 'https://github.com',
        } satisfies HMAnnotation,
        {
          type: 'Bold',
          starts: [8],
          ends: [11],
        } satisfies HMAnnotation,
        {
          type: 'Bold',
          starts: [12],
          ends: [15],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('handles multiple paragraphs in correct order', async () => {
    const html = '<p>foo</p><p><strong>bar</strong></p><p>baz</p>'
    const uploadLocalFile = vi.fn()
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(3)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'foo',
    })
    expect(blocks[1].block).toMatchObject({
      type: 'Paragraph',
      text: 'bar',
      annotations: [
        {
          type: 'Bold',
          starts: [0],
          ends: [3],
        } satisfies HMAnnotation,
      ],
    })
    expect(blocks[2].block).toMatchObject({
      type: 'Paragraph',
      text: 'baz',
    })
  })

  it('handles empty paragraphs', async () => {
    const html = '<p></p><p>  </p>'
    const uploadLocalFile = vi.fn()

    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(0)
  })

  it('handles failed image uploads', async () => {
    const html = '<figure><img src="test.jpg" /></figure>'
    const uploadLocalFile = vi.fn().mockResolvedValue(null)

    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(0)
  })

  it('handles main image', async () => {
    const html = `<div class="main-image">
      <div class="post-thumbnail full-width-image">
        <img width="2048" height="1152" src="../images/984ad815087f0d2dc8d8588ca8d5459b.jpg">
      </div>
      <span class="aft-image-caption">
        <p>foo <strong>bar</strong></p>
      </span>
    </div>`
    const uploadLocalFile = vi.fn().mockResolvedValue('TestCID')
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Image',
      link: 'ipfs://TestCID',
    })
    expect(blocks[0].children).toHaveLength(1)
    expect(blocks[0].children?.[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'foo bar',
      annotations: [
        {
          type: 'Bold',
          starts: [4],
          ends: [7],
        } satisfies HMAnnotation,
      ],
    })
  })
})
