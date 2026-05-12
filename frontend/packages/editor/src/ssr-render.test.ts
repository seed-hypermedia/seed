import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {renderDocumentToHTML} from './ssr-render'

describe('renderDocumentToHTML', () => {
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
    expect(html).not.toContain('href="hm://')
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
    expect(html).not.toContain('href="hm://')
  })
})
