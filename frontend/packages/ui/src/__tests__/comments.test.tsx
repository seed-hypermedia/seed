// @vitest-environment jsdom
import React from 'react'
import {hmId} from '@shm/shared'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {CommentDiscussions} from '../comments'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@shm/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/shared')>()
  return {
    ...actual,
    useCommentGroups: () => ({data: []}),
    useCommentParents: () => null,
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

vi.mock('@shm/shared/models/comments', () => ({
  useBlockDiscussions: () => ({data: null, isLoading: false}),
  useCommentReplyCount: () => ({data: 0}),
  useCommentVersions: () => ({data: null, isLoading: false}),
  useDocumentComments: () => ({
    data: null,
    error: null,
    isLoading: true,
  }),
  useDocumentDiscussions: () => ({data: null, isLoading: false}),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useIsCurrentUser: () => false,
  useResource: () => ({
    data: null,
    error: null,
    isDiscovering: false,
    isFetching: false,
    isLoading: false,
  }),
}))

vi.mock('@shm/shared/readonly-viewer-context', () => ({
  useReadOnlyViewer: () => false,
}))

vi.mock('@shm/shared/routes', () => ({
  getRoutePanel: () => null,
}))

vi.mock('@shm/shared/translation', () => ({
  useTxString: () => (value: string) => value,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavigate: () => vi.fn(),
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
      <CommentDiscussions
        targetId={hmId('alice', {path: ['doc']})}
        commentId="alice/comment"
        commentEditor={<div data-testid="comment-editor">Editor</div>}
      />,
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
})

describe('CommentDiscussions', () => {
  it('keeps the comment editor mounted in the reply composer slot while the focused thread is loading', () => {
    renderCommentDiscussions()

    expect(document.body.querySelector('[data-testid="comment-editor"]')).not.toBeNull()
  })
})
