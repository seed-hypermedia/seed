import React, {useEffect} from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {CommentBox} from '../commenting'

const {writeCommentDraftMock, invalidateQueriesMock} = vi.hoisted(() => ({
  writeCommentDraftMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
}))

vi.mock('@/grpc-client', () => ({
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
  useNavigate: () => vi.fn(),
}))

vi.mock('@seed-hypermedia/client', () => ({
  createComment: vi.fn(),
}))

vi.mock('@shm/editor/comment-editor', () => ({
  CommentEditor: ({onContentChange}: {onContentChange?: (blocks: any[]) => void}) => {
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

    return <div data-testid="comment-editor" />
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

vi.mock('@shm/shared/models/comments', () => ({
  useDocumentComments: () => ({data: {comments: []}}),
}))

vi.mock('@shm/shared/models/contacts', () => ({
  useContacts: () => [],
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: {type: 'document', document: {visibility: 'PUBLIC'}}}),
}))

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: invalidateQueriesMock,
}))

vi.mock('@shm/shared/optimistic-comment', () => ({
  applyOptimisticComment: vi.fn(),
  buildOptimisticComment: vi.fn(),
  navigateToComment: vi.fn(),
}))

vi.mock('@shm/shared/routing', () => ({
  useUniversalClient: () => ({
    getSigner: vi.fn(),
    publish: vi.fn(),
  }),
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => ({key: 'document', panel: null}),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function renderCommentBox() {
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
        <CommentBox docId={hmId('alice', {path: ['doc']})} />
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
