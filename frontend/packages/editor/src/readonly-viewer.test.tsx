// @vitest-environment node
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {QueryClient} from '@tanstack/react-query'
import {afterEach, describe, expect, it} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useRenderResourceStack} from '@shm/shared/render-resource-context'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
// Load the schema through the SSR entry point before importing the viewer.
import {renderDocumentToHTML} from './ssr-render'
import {ReadOnlyViewer} from './readonly-viewer'
import {setSSREmbedRenderer} from './ssr-embed-renderer'

const blocks: HMBlockNode[] = [
  {
    block: {
      id: 'passage',
      type: 'Paragraph',
      text: 'A 😀 link',
      attributes: {},
      annotations: [
        {type: 'Bold', starts: [2], ends: [3]},
        {type: 'Link', starts: [4], ends: [8], link: 'hm://alice/docs'},
      ],
    },
    children: [],
  },
]

function installRenderer() {
  setSSREmbedRenderer((content, rootChildrenType) =>
    renderDocumentToHTML(content, {
      queryClient: new QueryClient(),
      rootChildrenType,
      renderHref: (url) => url.replace('hm://alice', '/alice'),
    }),
  )
}

afterEach(() => setSSREmbedRenderer(null))

describe('shared read-only server renderer', () => {
  it('preserves codepoint annotations, links, and the selected root list type', () => {
    installRenderer()
    const html = renderToStaticMarkup(<ReadOnlyViewer blocks={blocks} rootChildrenType="Ordered" embedded />)
    expect(html).toContain('<strong>😀</strong>')
    expect(html).toContain('href="/alice/docs"')
    expect(html).toContain('data-list-type="Ordered"')
  })

  it('renders code fragments with Unicode intact and no code-block controls', () => {
    installRenderer()
    const html = renderToStaticMarkup(
      <ReadOnlyViewer
        blocks={[
          {
            block: {
              ...blocks[0]!.block,
              type: 'Code',
              text: '😀 value',
              annotations: [{type: 'Link', starts: [0], ends: [7], link: 'hm://alice/docs'}],
            },
            children: [],
          },
        ]}
        presentation="fragment"
        inlinePrefix={<span>Alice: </span>}
        embedded
      />,
    )
    expect(html).toMatch(/<code><a[^>]*>😀 value<\/a><\/code>/)
    expect(html).toContain('href="/alice/docs"')
    expect(html.indexOf('Alice:')).toBeLessThan(html.indexOf('<code>'))
    expect(html).not.toContain('data-content-type="code-block"')
  })

  it('passes pinned comment identity to fragment children', () => {
    installRenderer()
    const id = hmId('alice', {path: ['comments'], version: 'pinned-version'})
    let resource: ReturnType<typeof useRenderResourceStack>[number] | undefined
    function Identity() {
      resource = useRenderResourceStack().at(-1)
      return null
    }
    renderToStaticMarkup(
      <ReadOnlyViewer
        blocks={blocks}
        resourceId={id}
        resourceKind="comment"
        presentation="fragment"
        inlinePrefix={<Identity />}
        embedded
      />,
    )
    expect(resource).toEqual({kind: 'comment', id})
    expect(resource?.id.version).toBe('pinned-version')
  })

  it('stops embeds beyond the supported depth', () => {
    installRenderer()
    expect(renderToStaticMarkup(<ReadOnlyViewer blocks={blocks} embedded depth={4} />)).toBe('')
  })

  it('does not create a browser editor when no server renderer is registered', () => {
    expect(renderToStaticMarkup(<ReadOnlyViewer blocks={blocks} />)).toBe('')
  })
})
