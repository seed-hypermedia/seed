// @vitest-environment jsdom
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {resetCommentComposerRegistry} from '@shm/shared/models/use-comment-composer'
import WebCommenting from '../commenting'

const {
  createCommentMock,
  commentRecordIdMock,
  invalidateQueriesMock,
  publishMock,
  navigation,
  mountedInitialBlocks,
  emittedContent,
} = vi.hoisted(() => ({
  navigation: {
    route: {key: 'document', panel: null} as any,
    onNavigate: undefined as undefined | ((route: any) => void),
  },
  createCommentMock: vi.fn(),
  commentRecordIdMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  publishMock: vi.fn(),
  mountedInitialBlocks: [] as any[],
  emittedContent: {current: null as null | {blocks: any[]; mediaRefs?: Record<string, string>}},
}))

vi.mock('@/auth', () => ({
  useCreateAccount: () => ({
    content: null,
    userKeyPair: {id: 'alice'},
    createAccount: vi.fn(),
  }),
}))

vi.mock('@/report-error', () => ({
  reportError: vi.fn(),
}))

vi.mock('@remix-run/react', () => ({
  useLocation: () => ({pathname: '/', search: '', hash: '', state: null, key: 'test'}),
  useNavigate: () => vi.fn(),
}))

vi.mock('@seed-hypermedia/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seed-hypermedia/client')>()
  return {
    ...actual,
    commentRecordIdFromBlob: commentRecordIdMock,
    createComment: createCommentMock,
    filesToIpfsBlobs: async () => ({blobs: [], resultCIDs: []}),
  }
})

vi.mock('@shm/editor/comment-editor', () => ({
  CommentEditor: ({
    initialBlocks,
    onContentChange,
    submitButton,
  }: {
    initialBlocks?: any[]
    onContentChange?: (blocks: any[], mediaRefs?: Record<string, string>) => void
    submitButton?: (props: {
      getContent: () => Promise<{blockNodes: any[]}>
      reset: () => void
      disabled: boolean
    }) => React.ReactNode | undefined
  }) => {
    mountedInitialBlocks.push(initialBlocks)
    React.useEffect(() => {
      if (emittedContent.current) onContentChange?.(emittedContent.current.blocks, emittedContent.current.mediaRefs)
    }, [onContentChange])
    return (
      <div data-testid="comment-editor">
        {submitButton?.({getContent: async () => ({blockNodes: []}), reset: vi.fn(), disabled: false})}
      </div>
    )
  },
}))

vi.mock('@shm/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/shared')>()
  return {
    ...actual,
    useUniversalClient: () => ({
      getSigner: vi.fn(() => ({})),
      publish: publishMock,
    }),
    useUniversalAppContext: () => ({originHomeId: undefined}),
  }
})

vi.mock('@shm/shared/models/comments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/models/comments')>()),
  useDocumentComments: () => ({data: {comments: []}}),
}))

vi.mock('@shm/shared/models/entity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/shared/models/entity')>()
  return {
    ...actual,
    useAccount: () => ({data: {id: {uid: 'alice'}, metadata: {name: 'Alice'}}}),
    useResource: () => ({
      data: {type: 'document', document: {version: 'doc-version', visibility: 'PUBLIC'}},
      isLoading: false,
    }),
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

vi.mock('@shm/shared/translation', () => ({
  useTxString: () => (key: string, render?: (vars: any) => string, vars?: any) =>
    typeof render === 'function' ? render(vars ?? {}) : key,
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  NavContextProvider: ({children}: {children: React.ReactNode}) => children,
  useNavigation: () => ({state: {get: () => ({routes: [navigation.route], routeIndex: 0})}}),
  useNavRoute: () => navigation.route,
  useNavigate: () => (route: any) => {
    navigation.route = route
    navigation.onNavigate?.(route)
  },
}))

vi.mock('@shm/ui/members-facepile', () => ({
  CommentAudience: () => null,
}))

vi.mock('@shm/ui/tooltip', () => ({
  Tooltip: ({children}: {children: React.ReactNode}) => children,
}))

vi.mock('@shm/ui/universal-dialog', () => ({
  useAppDialog: () => ({content: null, open: vi.fn()}),
}))

vi.mock('../comment-target-version', () => ({
  resolveCommentTargetVersion: () => 'doc-version',
}))

vi.mock('../draft-media-db', () => ({
  cleanupOldDraftMedia: async () => {},
  deleteAllDraftMediaForDraft: async () => {},
  revokeHMBlockObjectURLs: vi.fn(),
  getDraftMedia: async () => null,
}))

vi.mock('../email-notifications', () => ({
  EmailNotificationsForm: () => null,
}))

vi.mock('../local-db', () => ({
  hasPromptedEmailNotifications: async () => true,
  setHasPromptedEmailNotifications: vi.fn(),
  setPendingIntent: vi.fn(),
}))

vi.mock('../pending-intent', () => ({
  processPendingIntent: vi.fn(),
}))

vi.mock('../web-perf-marks', () => ({
  isPerfEnabled: () => false,
  markCommentSubmitStart: vi.fn(),
  markCommentSubmitEnd: vi.fn(),
  markEditorLoadEnd: vi.fn(),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let providerQueryClient: QueryClient
let container: HTMLDivElement
let root: Root

function renderWebCommenting(boxKey?: string) {
  act(() => {
    root.render(
      <QueryClientProvider client={providerQueryClient}>
        <WebCommenting key={boxKey} docId={hmId('alice', {path: ['doc']})} commentId="bob/context" isReplying />
      </QueryClientProvider>,
    )
  })
}

const flush = () => act(async () => {})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.clearAllMocks()
  localStorage.clear()
  resetCommentComposerRegistry()
  navigation.route = {key: 'document', panel: null}
  navigation.onNavigate = undefined
  mountedInitialBlocks.length = 0
  emittedContent.current = null
})

describe('WebCommenting publication state', () => {
  it('loads a cleared draft on remount after a reply is published', async () => {
    const id = hmId('alice', {path: ['doc']})
    navigation.route = {key: 'comments', id, openComment: 'bob/context'}
    const draftKey = 'comment-draft-hm://alice/doc-reply-bob/context'
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        docId: 'hm://alice/doc',
        replyCommentId: 'bob/context',
        blocks: [{block: {id: 'draft-block', type: 'Paragraph', text: 'unsent reply', attributes: {}}, children: []}],
        timestamp: Date.now(),
      }),
    )
    createCommentMock.mockResolvedValue({blobs: [{data: new Uint8Array([1])}]})
    commentRecordIdMock.mockResolvedValue('alice/new-comment')
    publishMock.mockResolvedValue({cids: ['published-comment-cid']})

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    providerQueryClient = new QueryClient({
      defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    })
    renderWebCommenting()
    await flush()
    await flush()
    expect(mountedInitialBlocks.at(-1)?.[0]?.block?.text).toBe('unsent reply')

    navigation.onNavigate = () => {
      renderWebCommenting('remounted')
    }

    await act(async () => {
      container.querySelector('button')?.click()
    })
    await vi.waitFor(() => expect(navigation.route.replyCommentId).toBe('alice/new-comment'))
    await flush()

    expect(mountedInitialBlocks.at(-1)).toBeUndefined()
  })

  it('restores mediaRefs into block attributes when the composer remounts', async () => {
    const id = hmId('alice', {path: ['doc']})
    navigation.route = {key: 'comments', id, openComment: 'bob/context'}
    emittedContent.current = {
      blocks: [{block: {id: 'image', type: 'Image', link: 'ipfs://x', attributes: {}}, children: []}],
      mediaRefs: {image: '{"url":"blob:upload","draftId":"d","mediaId":"m"}'},
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    providerQueryClient = new QueryClient({
      defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    })
    renderWebCommenting()
    await flush()
    await flush()
    expect(mountedInitialBlocks.at(-1)).toBeUndefined()

    renderWebCommenting('remounted')
    await flush()

    const remounted = mountedInitialBlocks.at(-1)
    expect(remounted?.[0]?.block?.attributes?.mediaRef).toEqual({
      url: 'blob:upload',
      draftId: 'd',
      mediaId: 'm',
    })
  })
})
