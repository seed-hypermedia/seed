// @vitest-environment jsdom
import React from 'react'
import {hmId} from '@shm/shared'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {commentBookmarkTitle, CommentDiscussions} from '../comments'
import {TooltipProvider} from '../tooltip'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {focusedComment, parentComment, useCommentParentsMock, useDocumentCommentsMock, onBookmarkToggleMock} =
  vi.hoisted(() => {
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
    const parentComment = {...focusedComment, id: 'alice/parent', version: 'parent-version'}

    return {
      focusedComment,
      parentComment,
      useCommentParentsMock: vi.fn<() => any>(() => null),
      useDocumentCommentsMock: vi.fn<() => any>(() => ({
        data: null,
        error: null,
        isLoading: true,
      })),
      onBookmarkToggleMock: vi.fn(),
    }
  })

vi.mock('@shm/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/shared')>()
  return {
    ...actual,
    useCommentGroups: () => ({data: []}),
    useCommentParents: useCommentParentsMock,
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
  useCommentVersions: () => ({data: null, isLoading: false}),
  useDocumentComments: useDocumentCommentsMock,
  useDocumentDiscussions: () => ({data: null, isLoading: false}),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useAccount: () => ({data: {metadata: {name: 'Alice'}}}),
  useIsCurrentUser: () => false,
  useResources: () => [],
  useResource: () => ({
    data: {type: 'comment', comment: focusedComment},
    error: null,
    isDiscovering: false,
    isFetching: false,
    isLoading: false,
  }),
}))

vi.mock('@shm/shared/readonly-viewer-context', () => ({
  useReadOnlyViewer: () => false,
}))

vi.mock('@shm/shared/routes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/shared/routes')>()
  return {
    ...actual,
    getRoutePanel: () => null,
  }
})

vi.mock('@shm/shared/translation', () => ({
  useTxString: () => (value: string) => value,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  NavContextProvider: ({children}: {children: React.ReactNode}) => children,
  useNavigate: () => vi.fn(),
  useNavigation: () => ({}),
  useNavRoute: () => ({key: 'document', panel: null}),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function renderCommentDiscussions() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root!.render(
      <TooltipProvider>
        <CommentDiscussions
          targetId={hmId('alice', {path: ['doc']})}
          commentId="alice/comment"
          commentEditor={<div data-testid="comment-editor">Editor</div>}
        />
      </TooltipProvider>,
    )
  })
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  container?.remove()
  root = null
  container = null
  useCommentParentsMock.mockReturnValue(null)
  useDocumentCommentsMock.mockReturnValue({data: null, error: null, isLoading: true})
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  vi.useRealTimers()
  onBookmarkToggleMock.mockReset()
})

describe('CommentDiscussions', () => {
  it('keeps the comment editor mounted in the reply composer slot while the focused thread is loading', () => {
    renderCommentDiscussions()

    expect(document.body.querySelector('[data-testid="comment-editor"]')).not.toBeNull()
  })

  it('keeps the focused comment at the top after rendering its parents', () => {
    vi.useFakeTimers()
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    useCommentParentsMock.mockReturnValue({thread: [parentComment, focusedComment]})
    useDocumentCommentsMock.mockReturnValue({
      data: {comments: [parentComment, focusedComment], authors: {}},
      error: null,
      isLoading: false,
    })

    renderCommentDiscussions()

    act(() => vi.advanceTimersByTime(100))

    expect(scrollIntoView).toHaveBeenCalledWith({behavior: 'instant', block: 'start'})
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
