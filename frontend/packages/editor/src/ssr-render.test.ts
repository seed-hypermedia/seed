import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {renderDocumentToHTML} from './ssr-render'

describe('renderDocumentToHTML', () => {
  it('renders the document root as an unordered list when rootChildrenType is Unordered', () => {
    const html = renderDocumentToHTML(
      [
        {
          block: {id: 'item-1', type: 'Paragraph', text: 'First', annotations: []},
          children: [],
        },
      ] as HMBlockNode[],
      {rootChildrenType: 'Unordered'},
    )

    expect(html).toContain('<ul class="blockChildren"')
    expect(html).toContain('data-list-type="Unordered"')
    expect(html).toContain('<li class="blockNode" data-node-type="blockNode" data-id="item-1"')
  })

  it('uses renderHref for annotated links', () => {
    const html = renderDocumentToHTML(
      [
        {
          block: {
            id: 'block-1',
            type: 'Paragraph',
            text: 'linked',
            annotations: [{type: 'Link', starts: [0], ends: [6], link: 'hm://uid1/docs/page'}],
          },
          children: [],
        },
      ] as HMBlockNode[],
      {
        renderHref: (url) => (url === 'hm://uid1/docs/page' ? 'https://example.com/docs/page' : url),
      },
    )

    expect(html).toContain('href="https://example.com/docs/page"')
    expect(html).toContain('data-hm-link="hm://uid1/docs/page"')
    expect(html).not.toContain('href="hm://')
  })

  it('preserves inline embed metadata needed for copy-paste round-trips', () => {
    const html = renderDocumentToHTML(
      [
        {
          block: {
            id: 'block-1',
            type: 'Paragraph',
            text: 'inline embed',
            annotations: [{type: 'Embed', starts: [0], ends: [12], link: 'hm://uid1/docs/page'}],
          },
          children: [],
        },
      ] as HMBlockNode[],
      {
        renderHref: (url) => (url === 'hm://uid1/docs/page' ? 'https://example.com/docs/page' : url),
      },
    )

    expect(html).toContain('href="https://example.com/docs/page"')
    expect(html).toContain('data-hm-link="hm://uid1/docs/page"')
    expect(html).toContain('data-inline-embed="hm://uid1/docs/page"')
  })

  it('uses renderHref for SSR embed cards', () => {
    const html = renderDocumentToHTML(
      [
        {
          block: {
            id: 'block-1',
            type: 'Embed',
            text: '',
            link: 'hm://uid1/docs/page',
            annotations: [],
          },
          children: [],
        },
      ] as HMBlockNode[],
      {
        embeds: {
          'hm://uid1/docs/page': {
            title: 'Example',
          },
        },
        renderHref: (url) => (url === 'hm://uid1/docs/page' ? 'https://example.com/docs/page' : url),
      },
    )

    expect(html).toContain('href="https://example.com/docs/page"')
    expect(html).toContain('data-url="hm://uid1/docs/page"')
    expect(html).toContain('data-view="Content"')
    expect(html).toContain('<a class="ssr-card" data-content-type="embed" data-url="hm://uid1/docs/page"')
    expect(html).not.toContain('href="hm://')
  })

  it('preserves embed block metadata even when no SSR card data is available', () => {
    const html = renderDocumentToHTML(
      [
        {
          block: {
            id: 'block-1',
            type: 'Embed',
            text: '',
            link: 'hm://uid1/docs/page',
            attributes: {view: 'Card'},
            annotations: [],
          },
          children: [],
        },
      ] as HMBlockNode[],
      {},
    )

    expect(html).toContain('data-url="hm://uid1/docs/page"')
    expect(html).toContain('data-view="Card"')
    expect(html).toContain('data-content-type="embed"')
  })

  it('renders a TextColor annotation as a span with data-text-color', () => {
    const html = renderDocumentToHTML(
      [
        {
          block: {
            id: 'b1',
            type: 'Paragraph',
            text: 'hello',
            annotations: [{type: 'TextColor', starts: [0], ends: [5], attributes: {value: 'red'}}],
          },
          children: [],
        },
      ] as HMBlockNode[],
      {renderHref: (url) => url},
    )

    expect(html).toContain('<span data-text-color="red">hello</span>')
  })

  it('renders a BackgroundColor annotation as a span with data-background-color', () => {
    const html = renderDocumentToHTML(
      [
        {
          block: {
            id: 'b1',
            type: 'Paragraph',
            text: 'hello',
            annotations: [{type: 'BackgroundColor', starts: [0], ends: [5], attributes: {value: 'yellow'}}],
          },
          children: [],
        },
      ] as HMBlockNode[],
      {renderHref: (url) => url},
    )

    expect(html).toContain('<span data-background-color="yellow">hello</span>')
  })

  it('omits the color span when the color attribute is missing', () => {
    const html = renderDocumentToHTML(
      [
        {
          block: {
            id: 'b1',
            type: 'Paragraph',
            text: 'hello',
            annotations: [{type: 'TextColor', starts: [0], ends: [5], attributes: {}}],
          },
          children: [],
        },
      ] as HMBlockNode[],
      {renderHref: (url) => url},
    )

    expect(html).not.toContain('data-text-color')
    expect(html).toContain('hello')
  })
})
