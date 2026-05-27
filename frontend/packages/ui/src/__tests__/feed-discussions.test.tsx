// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {FeedDiscussions} from '../feed-discussions'
import type {CommentEditorProps} from '../resource-page-common'

;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const mockUseActivityFeed = vi.fn()
const mockUseCommentReplyCount = vi.fn()
const mockUseDocumentComments = vi.fn()
const mockUseResource = vi.fn()
const mockUseAccount = vi.fn()
const mockUseRouteLink = vi.fn()

vi.mock('@shm/shared/use-activity-feed', () => ({
  useActivityFeed: (...args: any[]) => mockUseActivityFeed(...args),
}))

vi.mock('@shm/shared/models/comments', () => ({
  useCommentReplyCount: (...args: any[]) => mockUseCommentReplyCount(...args),
  useDocumentComments: (...args: any[]) => mockUseDocumentComments(...args),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: (...args: any[]) => mockUseResource(...args),
  useAccount: (...args: any[]) => mockUseAccount(...args),
}))

vi.mock('@shm/shared/routing', () => ({
  useRouteLink: (...args: any[]) => mockUseRouteLink(...args),
}))

vi.mock('../comments', () => ({
  CommentContent: ({comment}: {comment: {content?: Array<{block?: {text?: string}}>; id: string}}) => (
    <div>{comment.content?.[0]?.block?.text || comment.id}</div>
  ),
}))

vi.mock('../hm-icon', () => ({
  HMIcon: () => <div data-testid="icon" />,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  mockUseRouteLink.mockReturnValue({href: '#discussion', onClick: vi.fn()})
  mockUseCommentReplyCount.mockReturnValue({data: 4})
  mockUseResource.mockReturnValue({data: null, isLoading: false})
  mockUseDocumentComments.mockReturnValue({data: {comments: []}, isLoading: false})
  mockUseAccount.mockImplementation((id: string | null | undefined) => ({
    data: id
      ? {
          metadata: {
            name: id === 'reply-author' ? 'Reply Author' : 'Root Author',
          },
        }
      : null,
  }))
  mockUseActivityFeed.mockReturnValue({
    data: {
      pages: [
        {
          events: [
            {
              type: 'comment',
              id: 'cid-root',
              feedEventId: 'feed-root',
              eventAtMs: 100,
              time: new Date(100).toISOString(),
              author: {id: {uid: 'root-author'}, metadata: {name: 'Root Author'}},
              replyParentAuthor: null,
              replyingComment: null,
              replyCount: 4,
              commentId: {uid: 'root-author', path: ['root'], id: 'hm://root-author/root', version: 'root-v1'},
              target: {
                id: {uid: 'site', path: ['doc'], id: 'hm://site/doc'},
                metadata: {name: 'Discussion Doc'},
              },
              comment: {
                id: 'root-author/root',
                version: 'root-v1',
                author: 'root-author',
                targetAccount: 'site',
                targetPath: '/doc',
                targetVersion: 'doc-v1',
                content: [{block: {id: 'b1', type: 'Paragraph', text: 'Root comment text', annotations: [], attributes: {}}}],
                createTime: new Date(100).toISOString(),
                updateTime: new Date(100).toISOString(),
                visibility: 'PUBLIC',
              },
            },
            {
              type: 'comment',
              id: 'cid-reply',
              feedEventId: 'feed-reply',
              eventAtMs: 200,
              time: new Date(200).toISOString(),
              author: {id: {uid: 'reply-author'}, metadata: {name: 'Reply Author'}},
              replyParentAuthor: null,
              replyingComment: null,
              replyCount: 0,
              commentId: {uid: 'reply-author', path: ['reply'], id: 'hm://reply-author/reply', version: 'reply-v1'},
              target: {
                id: {uid: 'site', path: ['doc'], id: 'hm://site/doc'},
                metadata: {name: 'Discussion Doc'},
              },
              comment: {
                id: 'reply-author/reply',
                version: 'reply-v1',
                author: 'reply-author',
                targetAccount: 'site',
                targetPath: '/doc',
                targetVersion: 'doc-v1',
                threadRoot: 'root-author/root',
                threadRootVersion: 'root-v1',
                content: [{block: {id: 'b2', type: 'Paragraph', text: 'Latest reply text', annotations: [], attributes: {}}}],
                createTime: new Date(200).toISOString(),
                updateTime: new Date(200).toISOString(),
                visibility: 'PUBLIC',
              },
            },
          ],
        },
      ],
    },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
})

describe('FeedDiscussions', () => {
  it('renders grouped discussion cards with root, latest reply, and reply count', () => {
    function TestCommentEditor(props: CommentEditorProps) {
      return <div>Composer for {props.commentId}</div>
    }

    act(() => {
      root.render(<FeedDiscussions filterResource="hm://site*" CommentEditor={TestCommentEditor} />)
    })

    expect(container.textContent).toContain('Discussion Doc')
    expect(container.textContent).toContain('4 replies')
    expect(container.textContent).toContain('Root comment')
    expect(container.textContent).toContain('Root comment text')
    expect(container.textContent).toContain('Reply')
    expect(container.textContent).toContain('Latest reply text')
    expect(container.textContent).toContain('Reply Author')
    expect(container.textContent).toContain('Reply in thread')
    expect(container.textContent).toContain('Composer for root-author/root')
  })
})
