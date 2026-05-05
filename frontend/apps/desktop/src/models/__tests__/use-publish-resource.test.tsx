import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {HMDocument, HMDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const {
  invalidateQueriesMock,
  setQueriesDataByKeyMock,
  getDocumentMock,
  listCapabilitiesMock,
  listDocumentChangesMock,
  publishDocumentMock,
  writeRecentSignerMock,
  writeDraftMock,
  useMyAccountIdsMock,
  useResourceMock,
  prepareHMDocumentMock,
} = vi.hoisted(() => ({
  invalidateQueriesMock: vi.fn(),
  setQueriesDataByKeyMock: vi.fn(),
  getDocumentMock: vi.fn(),
  listCapabilitiesMock: vi.fn(),
  listDocumentChangesMock: vi.fn(),
  publishDocumentMock: vi.fn(),
  writeRecentSignerMock: vi.fn(),
  writeDraftMock: vi.fn(),
  useMyAccountIdsMock: vi.fn(),
  useResourceMock: vi.fn(),
  prepareHMDocumentMock: vi.fn((raw: any) => raw),
}))

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: invalidateQueriesMock,
  setQueriesDataByKey: setQueriesDataByKeyMock,
}))

vi.mock('@/grpc-client', () => ({
  grpcClient: {
    documents: {
      getDocument: getDocumentMock,
      listDocumentChanges: listDocumentChangesMock,
    },
    accessControl: {
      listCapabilities: listCapabilitiesMock,
    },
  },
  domainResolver: vi.fn(),
}))

vi.mock('@/desktop-universal-client', () => ({
  desktopUniversalClient: {
    publishDocument: publishDocumentMock,
  },
}))

vi.mock('@/trpc', () => ({
  client: {
    recentSigners: {
      writeRecentSigner: {mutate: writeRecentSignerMock},
    },
    drafts: {
      write: {mutate: writeDraftMock},
    },
  },
}))

vi.mock('@/models/daemon', () => ({
  useMyAccountIds: useMyAccountIdsMock,
}))

vi.mock('@shm/shared/document-utils', async (orig) => {
  const actual = (await orig()) as any
  return {
    ...actual,
    prepareHMDocument: prepareHMDocumentMock,
  }
})

// `documents.ts` pulls in the BlockNote editor for unrelated reasons (slash
// menu items, draft machine, etc.). Stub those imports so this test doesn't
// load the editor's JSX (which expects React in scope under the classic
// runtime) and only needs the hooks under test.
vi.mock('@shm/editor/blocknote/core', () => ({BlockNoteEditor: class {}}))
vi.mock('../../editor', () => ({hmBlockSchema: {}}))
vi.mock('@/components/onboarding', () => ({dispatchOnboardingDialog: vi.fn()}))
vi.mock('@/selected-account', () => ({useSelectedAccountId: () => null}))
vi.mock('@/models/accounts', () => ({useDraft: () => ({data: undefined})}))
vi.mock('./gateway-settings', () => ({useGatewayUrl: () => ({data: ''}), useGatewayUrlStream: () => ({data: ''})}))
vi.mock('./navigation', () => ({getNavigationChanges: () => []}))
vi.mock('@/utils/useNavigate', () => ({useNavigate: () => vi.fn()}))

vi.mock('@shm/shared/models/entity', async (orig) => {
  const actual = (await orig()) as any
  return {
    ...actual,
    useResource: useResourceMock,
    prepareHMDocumentInfo: actual.prepareHMDocumentInfo ?? ((x: any) => x),
  }
})

// Keep proto Block.fromJson from crashing on simple mock attributes without
// losing the other exports (GetDocumentRequest, etc.) other modules need.
vi.mock('@shm/shared/client/.generated/documents/v3alpha/documents_pb', async () => {
  const actual = (await vi.importActual('@shm/shared/client/.generated/documents/v3alpha/documents_pb')) as any
  return {
    ...actual,
    Block: {...actual.Block, fromJson: (b: any) => b},
  }
})

import {usePublishResource} from '../documents'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

type PublishCall = {
  mutateAsync: (args: {
    draft: HMDraft
    destinationId: UnpackedHypermediaId
    accountId: string
    pathOverride?: string[]
  }) => Promise<HMDocument>
}

function makeDraft(overrides: Partial<HMDraft> = {}): HMDraft {
  return {
    id: 'draft-abc',
    locationUid: 'acct-1',
    locationPath: ['parent'],
    editUid: 'acct-1',
    editPath: ['parent', '-draft-abc'],
    metadata: {name: 'My Cool Doc'},
    content: [],
    deps: [],
    visibility: 'PUBLIC',
    navigation: undefined,
  } as unknown as HMDraft & typeof overrides
}

function TestHarness({editId, onReady}: {editId: UnpackedHypermediaId | undefined; onReady: (m: PublishCall) => void}) {
  const mutation = usePublishResource(editId)
  React.useEffect(() => {
    onReady({mutateAsync: mutation.mutateAsync})
    // Only fire once; we don't care about subsequent referential changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

async function renderHarness(editId: UnpackedHypermediaId | undefined): Promise<{
  call: PublishCall
  cleanup: () => void
}> {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let call: PublishCall | null = null
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TestHarness
          editId={editId}
          onReady={(m) => {
            call = m
          }}
        />
      </QueryClientProvider>,
    )
    await Promise.resolve()
  })
  if (!call) throw new Error('TestHarness did not expose mutation')
  return {
    call,
    cleanup: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
      queryClient.clear()
    },
  }
}

describe('usePublishResource path resolution', () => {
  beforeEach(() => {
    invalidateQueriesMock.mockReset()
    setQueriesDataByKeyMock.mockReset()
    getDocumentMock.mockReset()
    listCapabilitiesMock.mockReset()
    listDocumentChangesMock.mockReset()
    publishDocumentMock.mockReset()
    writeRecentSignerMock.mockReset()
    writeDraftMock.mockReset()
    useMyAccountIdsMock.mockReset()
    useResourceMock.mockReset()

    useMyAccountIdsMock.mockReturnValue({data: ['acct-1']})
    useResourceMock.mockReturnValue({data: undefined, isFetched: true, isLoading: false})
    publishDocumentMock.mockResolvedValue(undefined)
    writeRecentSignerMock.mockResolvedValue(undefined)
    writeDraftMock.mockResolvedValue(undefined)
    listDocumentChangesMock.mockResolvedValue({changes: []})
  })

  it('renames the placeholder editPath to the title slug on first publish', async () => {
    const editId = hmId('acct-1', {path: ['parent', '-draft-abc']})
    // No doc exists at the placeholder yet → first publish.
    getDocumentMock.mockImplementation(({path}) => {
      if (path === '/parent/-draft-abc') throw new Error('not found')
      // After the publish the renamed path resolves to the new doc.
      return Promise.resolve({version: 'bafynew', account: 'acct-1', path, content: [], metadata: {}})
    })

    const {call, cleanup} = await renderHarness(editId)
    try {
      await act(async () => {
        await call.mutateAsync({
          draft: makeDraft(),
          destinationId: editId,
          accountId: 'acct-1',
        })
      })
    } finally {
      cleanup()
    }

    const publishCalls = publishDocumentMock.mock.calls
    expect(publishCalls).toHaveLength(1)
    const arg = publishCalls[0][0]
    expect(arg.path).toBe('/parent/my-cool-doc')
    expect(arg.account).toBe('acct-1')
  })

  it('honours an explicit pathOverride from the publish popover', async () => {
    const editId = hmId('acct-1', {path: ['parent', '-draft-abc']})
    getDocumentMock.mockImplementation(({path}) => {
      if (path === '/parent/-draft-abc') throw new Error('not found')
      return Promise.resolve({version: 'bafynew', account: 'acct-1', path, content: [], metadata: {}})
    })

    const {call, cleanup} = await renderHarness(editId)
    try {
      await act(async () => {
        await call.mutateAsync({
          draft: makeDraft(),
          destinationId: editId,
          accountId: 'acct-1',
          pathOverride: ['parent', 'my-typed-slug'],
        })
      })
    } finally {
      cleanup()
    }

    expect(publishDocumentMock.mock.calls[0][0].path).toBe('/parent/my-typed-slug')
  })

  it('keeps the existing path on a re-publish (doc already exists at the destination)', async () => {
    const editId = hmId('acct-1', {path: ['parent', 'my-cool-doc']})
    // Existing doc at the destination → re-publish, no rename.
    getDocumentMock.mockResolvedValue({
      version: 'baseVersion',
      account: 'acct-1',
      path: '/parent/my-cool-doc',
      content: [],
      metadata: {},
    })

    const {call, cleanup} = await renderHarness(editId)
    try {
      await act(async () => {
        await call.mutateAsync({
          draft: {...makeDraft(), editPath: ['parent', 'my-cool-doc'], deps: ['baseVersion']},
          destinationId: editId,
          accountId: 'acct-1',
        })
      })
    } finally {
      cleanup()
    }

    expect(publishDocumentMock.mock.calls[0][0].path).toBe('/parent/my-cool-doc')
  })

  it('skips the rename for private drafts and keeps the random-id path', async () => {
    const editId = hmId('acct-1', {path: ['-randomid']})
    // First call (probe) throws → first publish.
    // Second call (post-publish lookup) resolves so the mutation can complete.
    let callCount = 0
    getDocumentMock.mockImplementation(({path}) => {
      callCount += 1
      if (callCount === 1) throw new Error('not found')
      return Promise.resolve({version: 'bafynew', account: 'acct-1', path, content: [], metadata: {}})
    })

    const draft = {
      ...makeDraft(),
      id: 'randomid',
      locationPath: ['-randomid'],
      editPath: ['-randomid'],
      visibility: 'PRIVATE' as const,
    }

    const {call, cleanup} = await renderHarness(editId)
    try {
      await act(async () => {
        await call.mutateAsync({
          draft,
          destinationId: editId,
          accountId: 'acct-1',
        })
      })
    } finally {
      cleanup()
    }

    expect(publishDocumentMock.mock.calls[0][0].path).toBe('/-randomid')
  })

  it('skips the rename for home-doc edits (empty path)', async () => {
    const editId = hmId('acct-1', {path: []})
    // Home doc always exists once the account is created.
    getDocumentMock.mockResolvedValue({
      version: 'baseVersion',
      account: 'acct-1',
      path: '',
      content: [],
      metadata: {},
    })

    const draft = {
      ...makeDraft(),
      locationPath: [],
      editPath: [],
      deps: ['baseVersion'],
    }

    const {call, cleanup} = await renderHarness(editId)
    try {
      await act(async () => {
        await call.mutateAsync({
          draft,
          destinationId: editId,
          accountId: 'acct-1',
        })
      })
    } finally {
      cleanup()
    }

    expect(publishDocumentMock.mock.calls[0][0].path).toBe('')
  })

  it('falls back to untitled-${draftId} when the draft title is empty', async () => {
    const editId = hmId('acct-1', {path: ['parent', '-draft-abc']})
    getDocumentMock.mockImplementation(({path}) => {
      if (path === '/parent/-draft-abc') throw new Error('not found')
      return Promise.resolve({version: 'bafynew', account: 'acct-1', path, content: [], metadata: {}})
    })

    const {call, cleanup} = await renderHarness(editId)
    try {
      await act(async () => {
        await call.mutateAsync({
          draft: {...makeDraft(), metadata: {name: ''}},
          destinationId: editId,
          accountId: 'acct-1',
        })
      })
    } finally {
      cleanup()
    }

    expect(publishDocumentMock.mock.calls[0][0].path).toBe('/parent/untitled-draft-abc')
  })
})
