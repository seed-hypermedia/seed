// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {hmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {BlockEmbedContent} from '../embed-views'
import {ReadOnlyViewerProvider} from '@shm/shared/readonly-viewer-context'
import {CommentContent, QuotedDocBlock} from '../comments'
import type {HMComment, HMDocument} from '@seed-hypermedia/client/hm-types'
import type {NavRoute} from '@shm/shared'
import {TooltipProvider} from '../tooltip'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {source, navigated} = vi.hoisted(() => ({
  source: {
    metadata: {},
    authors: [],
    version: 'version-1',
    content: [
      {block: {id: 'source', type: 'Paragraph', text: 'Before fragment after', attributes: {}, annotations: []}},
    ],
  },
  navigated: {href: '', route: null as NavRoute | null, newWindow: false},
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: (id: ReturnType<typeof hmId> | undefined) => ({
    data: id?.path?.[0] === 'comment' ? {type: 'comment', comment} : {type: 'document', id, document: source},
    isLoading: false,
  }),
  useAccount: () => ({}),
}))
vi.mock('@shm/shared/utils/navigation', () => ({
  useNavigate: () => () => {},
  useNavRoute: () => ({key: 'document', id: hmId('parent')}),
}))
vi.mock('@shm/shared/routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/shared/routing')>()
  return {
    ...actual,
    useUniversalAppContext: () => ({}),
    useRouteLink: (route: NavRoute | null) => {
      const href =
        route?.key === 'comments'
          ? actual.routeToHref(route)
          : route?.key === 'document'
            ? packHmId(route.id)
            : undefined
      return {
        href,
        onClick: (event: React.MouseEvent) => {
          event.preventDefault()
          navigated.href = href || ''
          navigated.route = route
          navigated.newWindow = event.ctrlKey || event.metaKey || event.shiftKey
        },
      }
    },
  }
})
vi.mock('../highlight-context', () => ({useHighlighter: () => () => ({})}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  navigated.href = ''
  navigated.route = null
  navigated.newWindow = false
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.getSelection()?.removeAllRanges()
})

function renderFragment(start = 7, end = 15) {
  const id = hmId('author', {
    path: ['document'],
    version: 'version-1',
    latest: false,
    blockRef: 'source',
    blockRange: {start, end},
  })
  act(() => {
    root.render(
      <TooltipProvider>
        <ReadOnlyViewerProvider value={TestCommentViewer}>
          <BlockEmbedContent
            block={{id: 'embed', type: 'Embed', link: packHmId(id), attributes: {view: 'Content'}}}
            parentBlockId={null}
          />
        </ReadOnlyViewerProvider>
      </TooltipProvider>,
    )
  })
  return id
}

describe('fragment embed interactions', () => {
  it('opens the exact fragment source in a new tab on middle-click', () => {
    const id = renderFragment()
    const event = new MouseEvent('auxclick', {bubbles: true, cancelable: true, button: 1})
    act(() => {
      container.querySelector('p')!.dispatchEvent(event)
    })
    expect(navigated.href).toBe(packHmId(id))
    expect(navigated.newWindow).toBe(true)
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not open the source for selected text, nested links, or right-clicks', () => {
    renderFragment()
    const paragraph = container.querySelector('p')!
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    window.getSelection()!.addRange(range)
    act(() => {
      paragraph.dispatchEvent(new MouseEvent('auxclick', {bubbles: true, cancelable: true, button: 1}))
    })
    expect(navigated.href).toBe('')
    window.getSelection()!.removeAllRanges()

    const nestedLink = document.createElement('a')
    nestedLink.href = 'https://example.com/nested'
    nestedLink.textContent = 'Nested source'
    paragraph.appendChild(nestedLink)
    const nestedEvent = new MouseEvent('auxclick', {bubbles: true, cancelable: true, button: 1})
    act(() => {
      nestedLink.dispatchEvent(nestedEvent)
    })
    expect(navigated.href).toBe('')
    expect(nestedEvent.defaultPrevented).toBe(false)

    act(() => {
      paragraph.dispatchEvent(new MouseEvent('auxclick', {bubbles: true, cancelable: true, button: 2}))
    })
    expect(navigated.href).toBe('')
  })

  it('expands and collapses without navigating, then opens the original fragment link', () => {
    const id = renderFragment(7, 15)
    expect(container.querySelector('p')?.textContent).toBe('fragment')
    const caret = container.querySelector('button')!
    expect(caret.closest('a')).toBeNull()
    act(() => caret.click())
    expect(container.querySelector('p')?.textContent).toBe('Before fragment after')
    expect(caret.getAttribute('aria-expanded')).toBe('true')
    expect(navigated.href).toBe('')
    act(() => caret.click())
    expect(container.querySelector('p')?.textContent).toBe('fragment')
    expect(caret.getAttribute('aria-expanded')).toBe('false')
    const link = container.querySelector('a')!
    expect(link.getAttribute('href')).toBe(packHmId(id))
    act(() => container.querySelector('p')!.click())
    expect(navigated.href).toBe(packHmId(id))
  })

  it('starts collapsed when an existing embed changes to a different fragment', () => {
    renderFragment()
    act(() => container.querySelector('button')!.click())
    renderFragment(0, 6)
    expect(container.querySelector('p')?.textContent).toBe('Before')
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the full block visible when the fragment is outside its text', () => {
    renderFragment(50, 60)
    expect(container.querySelector('p')?.textContent).toBe('Before fragment after')
    expect(container.querySelector('button')).toBeNull()
  })
})

const comment: HMComment = {
  id: 'author/comment',
  version: 'comment-version',
  author: 'author',
  targetAccount: 'site',
  targetPath: '/document',
  targetVersion: 'document-version',
  content: [
    ...source.content,
    {block: {id: 'second', type: 'Paragraph', text: 'Another comment paragraph', attributes: {}, annotations: []}},
  ] as HMBlockNode[],
  visibility: 'PUBLIC',
  createTime: {seconds: 0, nanos: 0},
  updateTime: {seconds: 0, nanos: 0},
}

function TestCommentViewer({
  blocks,
  focusBlockId,
  blockRange,
  inlinePrefix,
}: {
  inlinePrefix?: React.ReactNode
  blocks: HMBlockNode[]
  focusBlockId?: string
  blockRange?: {start?: number; end?: number}
}) {
  return (
    <>
      {inlinePrefix}
      <p data-focus={focusBlockId} data-range={JSON.stringify(blockRange)}>
        {blocks.map((node) => ('text' in node.block ? node.block.text : '')).join('')}
      </p>
    </>
  )
}

function renderCommentFragment() {
  const id = hmId('author', {
    path: ['comment'],
    version: 'comment-version',
    blockRef: 'source',
    blockRange: {start: 7, end: 15},
  })
  act(() =>
    root.render(
      <TooltipProvider>
        <ReadOnlyViewerProvider value={TestCommentViewer}>
          <BlockEmbedContent
            parentBlockId={null}
            depth={0}
            block={{id: 'embed', type: 'Embed', link: packHmId(id), attributes: {view: 'Content'}}}
          />
        </ReadOnlyViewerProvider>
      </TooltipProvider>,
    ),
  )
  return id
}

describe('comment fragment embeds', () => {
  it('shows only the comment fragment, expands with the original highlight, and collapses without navigation', () => {
    renderCommentFragment()
    expect(container.querySelector('p')?.textContent).toBe('fragment')
    expect(container.querySelector('p')?.getAttribute('data-focus')).toBeNull()
    const caret = container.querySelector('button')!
    act(() => caret.click())
    expect(container.querySelector('p')?.textContent).toBe('Before fragment afterAnother comment paragraph')
    expect(container.querySelector('p')?.getAttribute('data-focus')).toBe('source')
    expect(container.querySelector('p')?.getAttribute('data-range')).toBe('{"start":7,"end":15}')
    expect(navigated.href).toBe('')
    act(() => caret.click())
    expect(container.querySelector('p')?.textContent).toBe('fragment')
    act(() => container.querySelector('p')!.click())
    expect(navigated.href).toBe('/hm/site/document/:comments/author/comment?v=comment-version#source[7:15]')
    expect(navigated.route).toMatchObject({
      key: 'comments',
      openComment: comment.id,
      openCommentVersion: comment.version,
      blockId: 'source',
      blockRange: {start: 7, end: 15},
    })
  })

  it('highlights the selected fragment when opening its source comment', () => {
    act(() =>
      root.render(
        <ReadOnlyViewerProvider value={TestCommentViewer}>
          <CommentContent comment={comment} selection={{blockId: 'source', blockRange: {start: 7, end: 15}}} />
        </ReadOnlyViewerProvider>,
      ),
    )
    expect(container.querySelector('p')?.textContent).toBe('Before fragment afterAnother comment paragraph')
    expect(container.querySelector('p')?.getAttribute('data-focus')).toBe('source')
    expect(container.querySelector('p')?.getAttribute('data-range')).toBe('{"start":7,"end":15}')
  })
})

describe('quoted document fragments above the reply editor', () => {
  function renderQuote(start = 7, end = 15) {
    act(() =>
      root.render(
        <TooltipProvider>
          <ReadOnlyViewerProvider value={TestCommentViewer}>
            <QuotedDocBlock
              docId={hmId('site', {path: ['document']})}
              blockId="source"
              blockRange={{start, end}}
              doc={source as unknown as HMDocument}
            />
            <textarea aria-label="Reply" defaultValue="" />
          </ReadOnlyViewerProvider>
        </TooltipProvider>,
      ),
    )
  }

  it('expands the source block with its highlight and preserves the reply during both toggles', () => {
    renderQuote()
    const reply = container.querySelector('textarea')!
    reply.value = 'My unfinished reply'
    expect(container.querySelector('p')?.textContent).toBe('fragment')
    expect(container.querySelector('p')?.getAttribute('data-focus')).toBeNull()
    act(() => container.querySelector('button')!.click())
    expect(container.querySelector('p')?.textContent).toBe('Before fragment after')
    expect(container.querySelector('p')?.getAttribute('data-range')).toBe('{"start":7,"end":15}')
    expect(container.querySelector('textarea')).toBe(reply)
    expect(reply.value).toBe('My unfinished reply')
    act(() => container.querySelector('button')!.click())
    expect(container.querySelector('p')?.textContent).toBe('fragment')
    expect(reply.value).toBe('My unfinished reply')
    expect(navigated.href).toBe('')
  })

  it('collapses when the selected fragment changes, including a return to the previous range', () => {
    renderQuote()
    act(() => container.querySelector('button')!.click())
    renderQuote(0, 6)
    expect(container.querySelector('p')?.textContent).toBe('Before')
    renderQuote()
    expect(container.querySelector('p')?.textContent).toBe('fragment')
  })

  it('shows the full block without a toggle for an invalid range', () => {
    renderQuote(99, 100)
    expect(container.querySelector('p')?.textContent).toBe('Before fragment after')
    expect(container.querySelector('button')).toBeNull()
  })
})
