// @vitest-environment jsdom
import React from 'react'
import {hmId} from '@shm/shared'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {commentBookmarkTitle, CommentDiscussions, Discussions} from '../comments'
import {TooltipProvider} from '../tooltip'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {
  focusedComment,
  useDocumentCommentsMock,
  useDocumentDiscussionsMock,
  onBookmarkToggleMock,
  currentRoute,
  resourceState,
} = vi.hoisted(() => {
  const focusedComment = {
    id: 'alice/comment',
    version: 'focused-version',
    author: 'alice',
    targetAccount: 'alice',
    targetPath: 'doc',
    targetVersion: 'document-version',
    content: [{block: {id: 'text', type: 'Paragraph', text: 'A comment worth saving'}}],
    createTime: {seconds: 0, nanos: 0},
    updateTime: {seconds: 0, nanos: 0},
    visibility: 'PUBLIC',
  }

  return {
    focusedComment,
    resourceState: {missing: false},
    currentRoute: {value: {key: 'document', panel: null} as any},
    useDocumentCommentsMock: vi.fn<() => any>(() => ({
      data: null,
      error: null,
      isLoading: true,
    })),
    useDocumentDiscussionsMock: vi.fn<() => any>(() => ({
      data: null,
      error: null,
      isLoading: false,
    })),
    onBookmarkToggleMock: vi.fn(),
  }
})

vi.mock('@shm/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/shared')>()
  return {
    ...actual,
    useRouteLink: () => ({href: '#', onClick: vi.fn()}),
    useUniversalAppContext: () => ({}),
  }
})

vi.mock('@shm/shared/comments-service-provider', () => ({
  useCommentsServiceContext: () => ({}),
  useDeleteComment: () => ({mutate: vi.fn(), isLoading: false}),
  useHackyAuthorsSubscriptions: () => {},
  useUpdateComment: () => ({mutate: vi.fn(), isLoading: false}),
}))

vi.mock('@shm/shared/document-actions-context', () => ({
  useDocumentActions: () => ({isBookmarked: () => false, onBookmarkToggle: onBookmarkToggleMock}),
}))

vi.mock('@shm/shared/models/comments', () => ({
  useBlockDiscussions: () => ({data: null, isLoading: false}),
  useCommentReplyCount: () => ({data: 0}),
  useCommentVersions: () => ({
    data: {
      versions: [
        {
          ...focusedComment,
          version: 'old-version',
          content: [{block: {id: 'text', type: 'Paragraph', text: 'Original fragment text'}}],
        },
      ],
    },
    isLoading: false,
  }),
  useDocumentComments: useDocumentCommentsMock,
  useDocumentDiscussions: useDocumentDiscussionsMock,
}))

vi.mock('@shm/shared/models/entity', () => ({
  useAccount: () => ({data: {metadata: {name: 'Alice'}}}),
  useAccounts: (ids: Array<string | null>) => ids.map((id) => ({data: id ? {metadata: {name: 'Alice'}} : undefined})),
  useIsCurrentUser: () => false,
  useResources: () => [],
  useResource: () => ({
    data: resourceState.missing ? {type: 'not-found'} : {type: 'comment', comment: focusedComment},
    error: null,
    isDiscovering: false,
    isFetching: false,
    isLoading: false,
  }),
}))

vi.mock('@shm/shared/readonly-viewer-context', () => ({
  useReadOnlyViewer:
    () =>
    ({blocks, focusBlockId, blockRange}: any) => (
      <p data-testid="comment-text" data-focus={focusBlockId} data-range={JSON.stringify(blockRange)}>
        {blocks.map((node: any) => node.block.text).join('')}
      </p>
    ),
}))

vi.mock('@shm/shared/routes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/shared/routes')>()
  return {
    ...actual,
  }
})

vi.mock('@shm/shared/translation', () => ({
  useTxString: () => (value: string) => value,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  NavContextProvider: ({children}: {children: React.ReactNode}) => children,
  useNavigate: () => vi.fn(),
  useNavigation: () => ({}),
  useNavRoute: () => currentRoute.value,
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function renderCommentDiscussions(selection?: {blockId: string; blockRange: {start: number; end: number}}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root!.render(
      <TooltipProvider>
        <CommentDiscussions targetId={hmId('alice', {path: ['doc']})} commentId="alice/comment" selection={selection} />
      </TooltipProvider>,
    )
  })
}

function renderDiscussions() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root!.render(
      <TooltipProvider>
        <Discussions targetId={hmId('alice', {path: ['doc']})} />
      </TooltipProvider>,
    )
  })
}

beforeEach(() => {
  // jsdom does not implement the browser scroll API used by thread focus.
  HTMLElement.prototype.scrollIntoView = vi.fn()
  // jsdom does not implement IntersectionObserver/ResizeObserver, used by LazyCommentGroup.
  class MockIntersectionObserver {
    callback: any
    observe = vi.fn((el: Element) => {
      // LazyCommentGroup renders children only once an entry reports intersecting.
      // Fire synchronously so the first render inside act() includes the children.
      this.callback([{isIntersecting: true, target: el}])
    })
    unobserve = vi.fn()
    disconnect = vi.fn()
    takeRecords = vi.fn(() => [])
    constructor(cb: any) {
      this.callback = cb
    }
  }
  ;(globalThis as any).IntersectionObserver = MockIntersectionObserver
  class MockResizeObserver {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
  ;(globalThis as any).ResizeObserver = MockResizeObserver
})

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  container?.remove()
  root = null
  container = null
  useDocumentCommentsMock.mockReturnValue({data: null, error: null, isLoading: true})
  useDocumentDiscussionsMock.mockReturnValue({data: null, error: null, isLoading: false})
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  Reflect.deleteProperty(globalThis as any, 'IntersectionObserver')
  Reflect.deleteProperty(globalThis as any, 'ResizeObserver')
  Reflect.deleteProperty(navigator, 'clipboard')
  onBookmarkToggleMock.mockReset()
  resourceState.missing = false
  currentRoute.value = {key: 'document', panel: null}
})

describe('CommentDiscussions', () => {
  it('scrolls the selected root into view when the thread loads', () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    useDocumentCommentsMock.mockReturnValue({
      data: {comments: [focusedComment], authors: {}},
      error: null,
      isLoading: false,
    })

    renderCommentDiscussions()

    expect(scrollIntoView).toHaveBeenCalledWith({behavior: 'instant', block: 'start'})
  })

  it('scrolls to the exact reply again after repeated panel navigation', () => {
    const reply = {
      ...focusedComment,
      id: 'bob/reply',
      replyParent: focusedComment.id,
      content: [{block: {id: 'reply-text', type: 'Paragraph', text: 'Selected reply'}}],
    }
    useDocumentCommentsMock.mockReturnValue({data: {comments: [focusedComment, reply], authors: {}}, isLoading: false})
    const id = hmId('alice', {path: ['doc']})
    currentRoute.value = {key: 'document', id, panel: {key: 'comments', id, openComment: reply.id}}
    const scrolled: HTMLElement[] = []
    HTMLElement.prototype.scrollIntoView = function () {
      scrolled.push(this)
    }
    renderCommentDiscussions()
    const renderReply = () =>
      act(() =>
        root!.render(
          <TooltipProvider>
            <CommentDiscussions targetId={id} commentId={reply.id} isEntirelyHighlighted />
          </TooltipProvider>,
        ),
      )
    renderReply()
    expect(scrolled.at(-1)?.textContent).toContain('Selected reply')
    expect(scrolled.at(-1)?.querySelector('.bg-highlight')).not.toBeNull()
    scrolled.length = 0
    currentRoute.value = {...currentRoute.value, panel: {...currentRoute.value.panel}}
    renderReply()
    expect(scrolled).toHaveLength(1)
    expect(scrolled[0]?.textContent).toContain('Selected reply')
  })

  it('shows a missing comment without scrolling to another comment', () => {
    resourceState.missing = true
    useDocumentCommentsMock.mockReturnValue({data: {comments: [], authors: {}}, isLoading: false})
    const scrolled: HTMLElement[] = []
    HTMLElement.prototype.scrollIntoView = function () {
      scrolled.push(this)
    }
    renderCommentDiscussions()
    expect(container?.textContent).toContain('Comment not found')
    expect(scrolled).toEqual([])
  })

  it.each(['panel', 'expanded'] as const)('copies root and reply panel links from the %s layout', async (layout) => {
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = text
        },
      },
    })
    const id = {...hmId('alice', {path: ['doc']}), pageParams: {filter: '"active"'}}
    const thread = {key: 'comments', id, openComment: focusedComment.id}
    currentRoute.value = layout === 'expanded' ? thread : {key: 'document', id, panel: thread}
    const reply = {
      ...focusedComment,
      id: 'bob/reply',
      author: 'bob',
      replyParent: focusedComment.id,
      threadRootVersion: focusedComment.version,
    }
    useDocumentCommentsMock.mockReturnValue({
      data: {comments: [focusedComment, reply], authors: {}},
      error: null,
      isLoading: false,
    })
    renderCommentDiscussions()
    const buttons = Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).filter((button) =>
      button.querySelector('.lucide-link'),
    )
    expect(buttons).toHaveLength(2)
    await act(async () => buttons[1]!.click())
    const url = new URL(copied)
    expect(url.searchParams.get('reply')).toBe(reply.id)
    expect(url.searchParams.get('p.filter')).toBe('"active"')
    expect(url.pathname).toBe('/hm/alice/doc')
    expect(url.searchParams.get('panel')).toBe(`comments/${focusedComment.id}`)
    await act(async () => buttons[0]!.click())
    const rootUrl = new URL(copied)
    expect(rootUrl.pathname).toBe('/hm/alice/doc')
    expect(rootUrl.searchParams.get('panel')).toBe(`comments/${focusedComment.id}`)
    expect(rootUrl.searchParams.has('reply')).toBe(false)
  })

  it('bookmarks a comment snapshot from the comment header', () => {
    useDocumentCommentsMock.mockReturnValue({
      data: {comments: [focusedComment], authors: {}},
      error: null,
      isLoading: false,
    })

    renderCommentDiscussions()
    const button = document.body.querySelector<HTMLButtonElement>('button[aria-label="Add Comment to Bookmarks"]')
    expect(button?.querySelector('.lucide-bookmark')).not.toBeNull()
    act(() => button?.click())

    expect(onBookmarkToggleMock).toHaveBeenCalledWith(expect.objectContaining({uid: 'alice', path: ['comment']}), {
      title: 'A comment worth saving',
      commentId: 'alice/comment',
      targetUrl: 'hm://alice/doc',
      authorAccountId: 'alice',
    })
  })
})

describe('commentBookmarkTitle', () => {
  it('normalizes nested comment text and keeps the first 50 characters', () => {
    const content = [
      {
        block: {id: 'one', type: 'Paragraph', text: '  First line\nwith spacing  '},
        children: [{block: {id: 'two', type: 'Paragraph', text: 'and nested content that is long enough'}}],
      },
    ] as any

    expect(commentBookmarkTitle(content)).toBe('First line with spacing and nested content that is')
  })

  it('expands resolved mentions before truncating the snapshot', () => {
    const content = [
      {
        block: {
          id: 'one',
          type: 'Paragraph',
          text: 'wdyt \uFEFF',
          annotations: [{type: 'Embed', link: 'hm://alice', starts: [5], ends: [6]}],
        },
      },
    ] as any

    expect(commentBookmarkTitle(content, {'hm://alice': 'Alice Example'})).toBe('wdyt Alice Example')
  })
})

describe('comment version fragment links', () => {
  it('highlights the original fragment in the pinned historical comment', () => {
    currentRoute.value = {
      key: 'comments',
      id: hmId('alice', {path: ['doc']}),
      openComment: focusedComment.id,
      openCommentVersion: 'old-version',
    }
    useDocumentCommentsMock.mockReturnValue({
      data: {comments: [focusedComment], authors: {}},
      error: null,
      isLoading: false,
    })
    renderCommentDiscussions({blockId: 'text', blockRange: {start: 9, end: 17}})
    const content = container?.querySelector('[data-testid="comment-text"]')
    expect(content?.textContent).toBe('Original fragment text')
    expect(content?.getAttribute('data-focus')).toBe('text')
    expect(content?.getAttribute('data-range')).toBe('{"start":9,"end":17}')
  })
})

describe('Discussions', () => {
  it('renders only comments targeting the current document', () => {
    const directComment = {
      ...focusedComment,
      id: 'alice/direct',
      content: [{block: {id: 'text', type: 'Paragraph', text: 'A direct comment on this document'}}],
    }
    useDocumentDiscussionsMock.mockReturnValue({
      data: {
        discussions: [
          {
            id: directComment.id,
            type: 'commentGroup',
            comments: [directComment],
            moreCommentsCount: 0,
          },
        ],
        authors: {alice: {id: hmId('alice'), metadata: {name: 'Alice'}}},
      },
      error: null,
      isLoading: false,
    })

    renderDiscussions()

    expect(container?.textContent).toContain('A direct comment on this document')
  })

  it('renders the empty state when the document has no discussions', () => {
    useDocumentDiscussionsMock.mockReturnValue({
      data: {discussions: [], authors: {}},
      error: null,
      isLoading: false,
    })

    renderDiscussions()

    // NoComments empty state renders; the discussions list is empty.
    expect(container?.querySelector('[data-comment-id]')).toBeNull()
  })
})
