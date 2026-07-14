// @vitest-environment node
// The SSR pipeline runs headless in Node: schema built via getSchema, DOM via
// happy-dom, React node views via renderToString. Visual parity against the
// live editor is verified separately by apps/web/scripts/ssr-parity-check.mjs.
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {queryQueryBlock} from '@shm/shared/models/queries'
import {QueryClient} from '@tanstack/react-query'
import {describe, expect, it} from 'vitest'
import {hmBlockToEditorBlock} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {getQueryBlockInput} from './query-block-input'
import {renderDocumentToHTML} from './ssr-render'

const APP_CONTEXT = {
  origin: 'http://localhost:3000',
  originHomeId: null,
  universalClient: {request: async () => null},
  ipfsFileUrl: 'http://localhost:58001/ipfs',
  openUrl: () => {},
}

function render(blocks: HMBlockNode[], queryClient = new QueryClient()) {
  return renderDocumentToHTML(blocks, {
    queryClient,
    appContext: APP_CONTEXT,
    editorWidth: 668,
    renderHref: (url) => url.replace('hm://uid1', 'http://localhost:3000'),
  })
}

describe('renderDocumentToHTML', () => {
  it('renders text scaffolding with the schema classes and marks', () => {
    const html = render([
      {
        block: {id: 'h1', type: 'Heading', text: 'Hello World', annotations: [], attributes: {}},
        children: [
          {
            block: {
              id: 'p1',
              type: 'Paragraph',
              text: 'Some bold text',
              annotations: [{type: 'Bold', starts: [5], ends: [9]}],
              attributes: {},
            },
            children: [],
          },
        ],
      },
    ] as any)
    expect(html).toBeTruthy()
    // Heading tag IS the blockContent, exactly like the editor's renderHTML.
    expect(html).toMatch(/<h2[^>]*data-content-type="heading"/)
    expect(html).toContain('data-content-type="paragraph"')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('ProseMirror')
    // Real hashed CSS-module classes, not imitations.
    expect(html).toMatch(/class="[^"]*_blockNode_/)
  })

  it('keeps line height for empty paragraphs (ProseMirror trailing break)', () => {
    const html = render([
      {block: {id: 'p1', type: 'Paragraph', text: '', annotations: [], attributes: {}}, children: []},
    ] as any)
    expect(html).toContain('ProseMirror-trailingBreak')
  })

  it('renders an image block through its React node view, caption included', () => {
    const html = render([
      {
        block: {
          id: 'img1',
          type: 'Image',
          text: 'the caption',
          annotations: [],
          link: 'ipfs://bafyimagecid',
          attributes: {width: 400},
        },
        children: [],
      },
    ] as any)
    expect(html).toContain('react-renderer node-image')
    expect(html).toContain('bafyimagecid')
    expect(html).toContain('the caption')
  })

  it('renders code blocks with the shared chrome and highlight spans', () => {
    const html = render([
      {
        block: {
          id: 'c1',
          type: 'Code',
          text: 'const x = 1\n',
          annotations: [],
          attributes: {language: 'javascript'},
        },
        children: [],
      },
    ] as any)
    expect(html).toContain('node-code-block')
    expect(html).toContain('hljs language-javascript')
    expect(html).toContain('hljs-keyword')
    // Text ends with \n → the editor shows a trailing empty line.
    expect(html).toContain('ProseMirror-trailingBreak')
  })

  it('renders multiline code even when highlighting finds no tokens', () => {
    const html = render([
      {
        block: {
          id: 'c2',
          type: 'Code',
          text: 'Entity\nAttribute\nValue',
          annotations: [],
          attributes: {language: 'text'},
        },
        children: [],
      },
    ] as any)
    expect(html).toContain('Entity\nAttribute\nValue')
  })

  it('renders query blocks from the prefetched cache with the exact component key', () => {
    const hmBlock = {
      id: 'q1',
      type: 'Query',
      text: '',
      annotations: [],
      attributes: {
        style: 'List',
        columnCount: 1,
        banner: false,
        query: {includes: [{space: 'z6Mkuid', path: 'notes', mode: 'Children'}]},
      },
    }
    const item = {
      type: 'document',
      id: {
        id: 'z6Mkuid/notes/a',
        uid: 'z6Mkuid',
        path: ['notes', 'a'],
        version: 'v1',
        latest: true,
        blockRef: null,
        blockRange: null,
        hostname: null,
        scheme: null,
      },
      path: ['notes', 'a'],
      authors: ['z6Mkuid'],
      createTime: {seconds: 1700000000n, nanos: 0},
      updateTime: {seconds: 1700000000n, nanos: 0},
      sortTime: new Date(1700000000000),
      genesis: 'g',
      version: 'v1',
      breadcrumbs: [],
      activitySummary: {
        latestComment: null,
        latestChangeTime: {seconds: 1700000000n, nanos: 0},
        isUnread: false,
        latestCommentTime: null,
        latestCommentId: '',
        commentCount: 0,
      },
      generationInfo: {genesis: 'g', generation: 1n},
      metadata: {name: 'A Note'},
      visibility: 'PUBLIC',
    }
    const queryClient = new QueryClient()
    const input = getQueryBlockInput(hmBlockToEditorBlock(hmBlock as any).props as any)
    expect(input).toBeTruthy()
    const key = queryQueryBlock({request: async () => null} as any, input as any).queryKey
    queryClient.setQueryData(key, {
      queryTargetName: 'Notes',
      in: item.id,
      results: [item],
      mode: 'Children',
      interactionSummaries: {},
      accountsMetadata: {z6Mkuid: {id: item.id, metadata: {name: 'Someone'}}},
    })
    const html = render([{block: hmBlock, children: []}] as any, queryClient)
    expect(html).toContain('react-renderer node-query')
    expect(html).toContain('A Note')
    expect(html).not.toContain('data-ssr-error')
  })

  it('renders unknown block types through the real error component', () => {
    const html = render([
      {block: {id: 'u1', type: 'FancyNewType', text: '', annotations: [], attributes: {}}, children: []},
    ] as any)
    expect(html).toContain('data-content-type="unknown"')
    expect(html).toContain('Unsupported Block:')
  })

  it('rewrites hm:// link hrefs via renderHref', () => {
    const html = render([
      {
        block: {
          id: 'p1',
          type: 'Paragraph',
          text: 'linked',
          annotations: [{type: 'Link', starts: [0], ends: [6], link: 'hm://uid1/docs/page'}],
          attributes: {},
        },
        children: [],
      },
    ] as any)
    expect(html).toContain('href="http://localhost:3000/docs/page"')
    expect(html).toContain('data-hm-link="hm://uid1/docs/page"')
  })
})
