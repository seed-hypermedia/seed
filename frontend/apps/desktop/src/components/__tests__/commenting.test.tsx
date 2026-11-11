import React, {useEffect} from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {queryClient, queryKeys} from '@shm/shared'
import {resetCommentComposerRegistry} from '@shm/shared/models/use-comment-composer'
import type {HMComment, HMListCommentsOutput} from '@seed-hypermedia/client/hm-types'
import {CommentBox} from '../commenting'

const {
  commentDraftLoadMock,
  createCommentMock,
  invalidateQueriesMock,
  publishMock,
  removeCommentDraftMock,
  subscribeContactMock,
  writeCommentDraftMock,
  navigation,
  mountedInitialBlocks,
} = vi.hoisted(() => ({
  navigation: {
    route: {key: 'document', panel: null} as any,
    onNavigate: undefined as undefined | ((route: any) => void),
  },
  commentDraftLoadMock: vi.fn(),
  createCommentMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  publishMock: vi.fn(),
  removeCommentDraftMock: vi.fn(),
  subscribeContactMock: vi.fn(),
  writeCommentDraftMock: vi.fn(),
  mountedInitialBlocks: [] as any[],
}))

vi.mock('@/grpc-client', () => ({
  grpcClient: {},
  domainResolver: vi.fn(),
}))

vi.mock('@/models/comments', () => ({
  commentDraftQueryOptions: (...args: any[]) => ({
    queryKey: ['comment-draft', ...args.map((a) => (a && typeof a === 'object' && 'id' in a ? a.id : a))],
    queryFn: commentDraftLoadMock,
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
        mutate: removeCommentDraftMock,
      },
    },
    recentSigners: {
      writeRecentSigner: {
        mutate: vi.fn(() => Promise.resolve()),
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
    navigation.onNavigate?.(route)
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
    initialBlocks,
    submitButton,
  }: {
    onContentChange?: (blocks: any[]) => void
    initialBlocks?: any[]
    submitButton?: (props: {
      getContent: () => Promise<{blockNodes: any[]}>
      reset: () => void
      disabled: boolean
    }) => React.ReactNode | undefined
  }) => {
    mountedInitialBlocks.push(initialBlocks)
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

let providerQueryClient: QueryClient
let container: HTMLDivElement
let root: Root

function mount(docUidArg = 'alice', onCommentSubmitted?: (comment: HMComment) => void, boxKey?: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  providerQueryClient = new QueryClient({
    defaultOptions: {
      queries: {retry: false},
      mutations: {retry: false},
    },
  })
  act(() => {
    root.render(
      <QueryClientProvider client={providerQueryClient}>
        <CommentBox
          key={boxKey}
          docId={hmId(docUidArg, {path: ['doc']})}
          commentId={navigation.route.openComment}
          onCommentSubmitted={onCommentSubmitted}
        />
      </QueryClientProvider>,
    )
  })
  return {container, root}
}

const flush = () => act(async () => {})

async function mountEditing(docUidArg = 'alice', onCommentSubmitted?: (comment: HMComment) => void) {
  const result = mount(docUidArg, onCommentSubmitted)
  await flush()
  await flush()
  return result
}

function cleanupRendered() {
  act(() => {
    root.unmount()
  })
  container.remove()
}

afterEach(() => {
  vi.clearAllMocks()
  queryClient.clear()
  resetCommentComposerRegistry()
  navigation.route = {key: 'document', panel: null}
  navigation.onNavigate = undefined
  mountedInitialBlocks.length = 0
})

describe('CommentBox draft persistence', () => {
  it('flushes a pending comment draft when unmounted before the debounce fires', async () => {
    commentDraftLoadMock.mockResolvedValue(null)
    writeCommentDraftMock.mockResolvedValue('draft-1')

    mount()
    await flush()

    cleanupRendered()
    await flush()
    await flush()

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
      quotingRange: undefined,
      context: undefined,
    })
  })
})

describe('CommentBox site membership', () => {
  it('joins a remote site before a logged-in account publishes its first comment', async () => {
    commentDraftLoadMock.mockResolvedValue(null)
    subscribeContactMock.mockResolvedValue(undefined)
    createCommentMock.mockReturnValue(new Promise(() => {}))

    const {container} = await mountEditing('site-account')
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

    cleanupRendered()
  })
})

describe('CommentBox publication state', () => {
  it('keeps the context while publishing and advances only to the published reply', async () => {
    const id = hmId('alice', {path: ['doc']})
    navigation.route = {key: 'comments', id, openComment: 'bob/context'}
    commentDraftLoadMock.mockResolvedValue(null)
    createCommentMock.mockResolvedValue({blobs: [{data: new Uint8Array([1])}]})
    let finish!: (value: {cids: string[]}) => void
    publishMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    let submitted: HMComment | undefined
    const {container} = await mountEditing('alice', (comment) => {
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
    expect(invalidateQueriesMock).toHaveBeenCalledWith([queryKeys.COMMENT_REPLY_COUNT], {refetchType: 'all'})
    const comments = queryClient.getQueryData<HMListCommentsOutput>([queryKeys.DOCUMENT_COMMENTS, id])?.comments
    expect(comments).toHaveLength(1)
    expect(comments?.[0]?.version).toBe('published-comment-cid')
    cleanupRendered()
  })

  it('loads a cleared draft on remount after a reply is published', async () => {
    const id = hmId('alice', {path: ['doc']})
    navigation.route = {key: 'comments', id, openComment: 'bob/context'}
    commentDraftLoadMock.mockResolvedValue({
      blocks: [
        {block: {id: 'd1', type: 'Paragraph', text: 'unsent reply', annotations: [], attributes: {}}, children: []},
      ],
    })
    createCommentMock.mockResolvedValue({blobs: [{data: new Uint8Array([1])}]})
    publishMock.mockResolvedValue({cids: ['published-comment-cid']})
    removeCommentDraftMock.mockResolvedValue(undefined)

    const {container} = await mountEditing('alice')
    expect(mountedInitialBlocks.at(-1)?.[0]?.block?.text).toBe('unsent reply')

    navigation.onNavigate = () => {
      act(() => {
        root.render(
          <QueryClientProvider client={providerQueryClient}>
            <CommentBox key="remounted" docId={id} commentId="bob/context" />
          </QueryClientProvider>,
        )
      })
    }

    await act(async () => {
      container.querySelector('button')?.click()
    })
    await vi.waitFor(() => expect(navigation.route.replyCommentId).toBe('alice/new-comment'))
    await flush()

    expect(mountedInitialBlocks.at(-1)).toBeUndefined()
    cleanupRendered()
  })

  it('removes the pending comment and keeps the route when publishing fails', async () => {
    const id = hmId('alice', {path: ['doc']})
    navigation.route = {key: 'comments', id, openComment: 'bob/context'}
    queryClient.setQueryData([queryKeys.DOCUMENT_COMMENTS, id], {comments: [], authors: {}})
    commentDraftLoadMock.mockResolvedValue(null)
    createCommentMock.mockResolvedValue({blobs: [{data: new Uint8Array([1])}]})
    publishMock.mockRejectedValue(new Error('Offline'))
    let submitted: HMComment | undefined
    const {container} = await mountEditing('alice', (comment) => {
      submitted = comment
    })
    await act(async () => {
      container.querySelector('button')?.click()
    })
    await vi.waitFor(() => expect(publishMock).toHaveBeenCalled())
    await flush()
    await flush()
    expect(navigation.route.replyCommentId).toBeUndefined()
    expect(submitted).toBeUndefined()
    expect(queryClient.getQueryData<HMListCommentsOutput>([queryKeys.DOCUMENT_COMMENTS, id])?.comments).toEqual([])
    cleanupRendered()
  })
})
