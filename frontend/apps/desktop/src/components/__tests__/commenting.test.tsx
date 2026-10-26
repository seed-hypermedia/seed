import React, {useEffect} from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {queryClient, queryKeys} from '@shm/shared'
import type {HMComment, HMListCommentsOutput} from '@seed-hypermedia/client/hm-types'
import {CommentBox} from '../commenting'

const {createCommentMock, invalidateQueriesMock, publishMock, subscribeContactMock, writeCommentDraftMock, navigation} =
  vi.hoisted(() => ({
    navigation: {route: {key: 'document', panel: null} as any},
    createCommentMock: vi.fn(),
    invalidateQueriesMock: vi.fn(),
    publishMock: vi.fn(),
    subscribeContactMock: vi.fn(),
    writeCommentDraftMock: vi.fn(),
  }))

vi.mock('@/grpc-client', () => ({
  grpcClient: {},
  domainResolver: vi.fn(),
}))

vi.mock('@/models/comments', () => ({
  useCommentDraft: () => ({
    data: undefined,
    isInitialLoading: false,
  }),
}))

vi.mock('@/models/push-after-action', () => ({
  usePushAfterAction: () => vi.fn(),
}))

vi.mock('@/selected-account', () => ({
  useSelectedAccount: () => ({
    id: {uid: 'alice'},
    metadata: {name: 'Alice'},
  }),
  useSelectedAccountId: () => 'alice',
}))

vi.mock('@/trpc', () => ({
  client: {
    comments: {
      writeCommentDraft: {
        mutate: writeCommentDraftMock,
      },
      removeCommentDraft: {
        mutate: vi.fn(),
      },
    },
    recentSigners: {
      writeRecentSigner: {
        mutate: vi.fn(),
      },
    },
  },
}))

vi.mock('@/utils/media-drag', () => ({
  handleDragMedia: vi.fn(),
}))

vi.mock('@/utils/useNavigate', () => ({
  useNavigate: () => (route: any) => {
    navigation.route = route
  },
}))

vi.mock('@seed-hypermedia/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seed-hypermedia/client')>()
  return {
    ...actual,
    commentRecordIdFromBlob: vi.fn(),
    createComment: createCommentMock,
  }
})

vi.mock('@shm/editor/comment-editor', () => ({
  CommentEditor: ({
    onContentChange,
    submitButton,
  }: {
    onContentChange?: (blocks: any[]) => void
    submitButton?: (props: {
      getContent: () => Promise<{blockNodes: any[]}>
      reset: () => void
      disabled: boolean
    }) => React.ReactNode | undefined
  }) => {
    useEffect(() => {
      onContentChange?.([
        {
          block: {
            id: 'block-1',
            type: 'Paragraph',
            text: 'unsaved draft',
          },
          children: [],
        },
      ])
    }, [onContentChange])

    return (
      <div data-testid="comment-editor">
        {submitButton?.({getContent: async () => ({blockNodes: []}), reset: vi.fn(), disabled: false})}
      </div>
    )
  },
}))

vi.mock('@shm/shared/client/.generated/documents/v3alpha/documents_pb', async () => {
  const actual = await vi.importActual<typeof import('@shm/shared/client/.generated/documents/v3alpha/documents_pb')>(
    '@shm/shared/client/.generated/documents/v3alpha/documents_pb',
  )
  return {
    ...actual,
    BlockNode: {
      ...actual.BlockNode,
      fromJson: (value: unknown) => value,
    },
  }
})

vi.mock('../desktop-intents', () => ({
  useContactSubscribeIntent: () => subscribeContactMock,
  useDesktopAccountIntent: () => ({content: null, requireAccount: vi.fn()}),
}))

vi.mock('@shm/shared/models/comments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/models/comments')>()),
  useDocumentComments: () => ({data: {comments: []}}),
}))

vi.mock('@shm/shared/models/contacts', () => ({
  useContacts: () => [],
}))

vi.mock('@shm/shared/models/entity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/shared/models/entity')>()
  return {
    ...actual,
    useResource: () => ({data: {type: 'document', document: {visibility: 'PUBLIC'}}}),
  }
})

vi.mock('@shm/shared/models/query-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/models/query-client')>()),
  invalidateQueries: invalidateQueriesMock,
}))

vi.mock('@shm/shared/optimistic-comment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/optimistic-comment')>()),
  buildOptimisticComment: async ({docId, replyParentId}: any) => ({
    id: 'alice/new-comment',
    version: 'optimistic-pending',
    author: 'alice',
    targetAccount: docId.uid,
    targetPath: '/doc',
    targetVersion: 'doc-version',
    replyParent: replyParentId || '',
    content: [],
    visibility: 'PUBLIC',
    createTime: '2026-01-01T00:00:00Z',
    updateTime: '2026-01-01T00:00:00Z',
  }),
}))

vi.mock('@shm/shared/routing', () => ({
  useUniversalClient: () => ({
    getSigner: vi.fn(() => ({})),
    publish: publishMock,
  }),
}))

vi.mock('@shm/ui/tooltip', () => ({
  Tooltip: ({children}: {children: React.ReactNode}) => children,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  NavContextProvider: ({children}: {children: React.ReactNode}) => children,
  useNavigation: () => ({state: {get: () => ({routes: [navigation.route], routeIndex: 0})}}),
  useNavRoute: () => navigation.route,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function renderCommentBox(docUid = 'alice', onCommentSubmitted?: (comment: HMComment) => void) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {retry: false},
      mutations: {retry: false},
    },
  })

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <CommentBox
          docId={hmId(docUid, {path: ['doc']})}
          commentId={navigation.route.openComment}
          onCommentSubmitted={onCommentSubmitted}
        />
      </QueryClientProvider>,
    )
  })

  return {container, root}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

afterEach(() => {
  vi.clearAllMocks()
  queryClient.clear()
  navigation.route = {key: 'document', panel: null}
})

describe('CommentBox draft persistence', () => {
  it('flushes a pending comment draft when unmounted before the debounce fires', async () => {
    writeCommentDraftMock.mockResolvedValue('draft-1')

    const {container, root} = renderCommentBox()

    cleanupRendered(root, container)

    await act(async () => {
      await Promise.resolve()
    })

    expect(writeCommentDraftMock).toHaveBeenCalledWith({
      blocks: [
        {
          block: {
            id: 'block-1',
            type: 'Paragraph',
            text: 'unsaved draft',
          },
          children: [],
        },
      ],
      targetDocId: 'hm://alice/doc',
      replyCommentId: undefined,
      quotingBlockId: undefined,
      context: undefined,
    })
  })
})

describe('CommentBox site membership', () => {
  it('joins a remote site before a logged-in account publishes its first comment', async () => {
    subscribeContactMock.mockResolvedValue(undefined)
    createCommentMock.mockReturnValue(new Promise(() => {}))

    const {container, root} = renderCommentBox('site-account')
    const submit = container.querySelector('button')
    expect(submit).not.toBeNull()

    await act(async () => {
      submit?.click()
    })

    await vi.waitFor(() => {
      expect(subscribeContactMock).toHaveBeenCalledWith({
        accountUid: 'alice',
        subjectUid: 'site-account',
        subscribe: 'site',
      })
    })
    expect(subscribeContactMock.mock.invocationCallOrder[0]).toBeLessThan(
      createCommentMock.mock.invocationCallOrder[0]!,
    )

    cleanupRendered(root, container)
  })
})

describe('CommentBox publication state', () => {
  it('keeps the context while publishing and advances only to the published reply', async () => {
    const id = hmId('alice', {path: ['doc']})
    navigation.route = {key: 'comments', id, openComment: 'bob/context'}
    createCommentMock.mockResolvedValue({blobs: [{data: new Uint8Array([1])}]})
    let finish!: (value: {cids: string[]}) => void
    publishMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    let submitted: HMComment | undefined
    const {container, root} = renderCommentBox('alice', (comment) => {
      submitted = comment
    })
    await act(async () => {
      container.querySelector('button')?.click()
    })
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(navigation.route).toMatchObject({openComment: 'bob/context'})
    expect(navigation.route.replyCommentId).toBeUndefined()
    expect(submitted).toBeUndefined()
    await act(async () => {
      finish({cids: ['published-comment-cid']})
    })
    await vi.waitFor(() => expect(navigation.route.replyCommentId).toBe('alice/new-comment'))
    expect(navigation.route.openComment).toBe('bob/context')
    expect(submitted?.version).toBe('published-comment-cid')
    const comments = queryClient.getQueryData<HMListCommentsOutput>([queryKeys.DOCUMENT_COMMENTS, id])?.comments
    expect(comments).toHaveLength(1)
    expect(comments?.[0]?.version).toBe('published-comment-cid')
    cleanupRendered(root, container)
  })

  it('removes the pending comment and keeps the route when publishing fails', async () => {
    const id = hmId('alice', {path: ['doc']})
    navigation.route = {key: 'comments', id, openComment: 'bob/context'}
    queryClient.setQueryData([queryKeys.DOCUMENT_COMMENTS, id], {comments: [], authors: {}})
    createCommentMock.mockResolvedValue({blobs: [{data: new Uint8Array([1])}]})
    publishMock.mockRejectedValue(new Error('Offline'))
    let submitted: HMComment | undefined
    const {container, root} = renderCommentBox('alice', (comment) => {
      submitted = comment
    })
    await act(async () => {
      container.querySelector('button')?.click()
    })
    await vi.waitFor(() => expect(container.querySelector('button')?.disabled).toBe(false))
    expect(navigation.route.replyCommentId).toBeUndefined()
    expect(submitted).toBeUndefined()
    expect(queryClient.getQueryData<HMListCommentsOutput>([queryKeys.DOCUMENT_COMMENTS, id])?.comments).toEqual([])
    cleanupRendered(root, container)
  })
})
