import {Code, ConnectError} from '@connectrpc/connect'
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {ResourceVisibility} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {HMDocument, HMDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const {
  inviteToPublishDomainMock,
  requestResourceMock,
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
  inviteToPublishDomainMock: vi.fn(),
  requestResourceMock: vi.fn(),
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

vi.mock('@/models/domain-publishing-invitation', () => ({inviteToPublishDomain: inviteToPublishDomainMock}))

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
    request: requestResourceMock,
    publishDocument: publishDocumentMock,
  },
}))

vi.mock('@/trpc', () => ({
  client: {
    documentCardCleanup: {
      enqueue: {mutate: vi.fn(async () => ({jobId: 'job'}))},
      release: {mutate: vi.fn(async () => {})},
    },
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

vi.mock('@shm/shared/client/.generated/documents/v3alpha/documents_pb', async () => {
  const actual = (await vi.importActual('@shm/shared/client/.generated/documents/v3alpha/documents_pb')) as any
  return actual
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
    inviteToPublishDomainMock.mockReset()
    requestResourceMock
      .mockReset()
      .mockResolvedValue({type: 'document', document: {version: 'parent-version', visibility: 'PUBLIC'}})
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

  it('keeps successful publication successful when the indexed document reload fails', async () => {
    const editId = hmId('acct-1', {path: ['parent', '-draft-abc']})
    getDocumentMock.mockRejectedValue(new Error('index unavailable'))
    publishDocumentMock.mockResolvedValue({version: 'signed-version', genesis: 'signed-genesis', generation: 42})
    const {call, cleanup} = await renderHarness(editId)
    try {
      let result: any
      await act(async () => {
        result = await call.mutateAsync({draft: makeDraft(), destinationId: editId, accountId: 'acct-1'})
      })
      expect(result).toMatchObject({
        version: 'signed-version',
        genesis: 'signed-genesis',
        generationInfo: {generation: BigInt(42)},
      })
    } finally {
      cleanup()
    }
  })

  it('does not inherit metadata retained from the previously viewed parent on first publish', async () => {
    useResourceMock.mockReturnValue({
      isPreviousData: true,
      data: {type: 'document', document: {metadata: {icon: 'parent-icon', summary: 'Parent summary'}, content: []}},
    })
    getDocumentMock.mockResolvedValue({
      version: 'published',
      account: 'acct-1',
      path: '/parent/my-cool-doc',
      content: [],
      metadata: {},
    })
    const {call, cleanup} = await renderHarness(undefined)
    try {
      await act(async () => {
        await call.mutateAsync({
          draft: makeDraft(),
          destinationId: hmId('acct-1', {path: ['parent', '-draft-abc']}),
          accountId: 'acct-1',
        })
      })
      const changes = JSON.stringify(publishDocumentMock.mock.calls[0][0].changes)
      expect(changes).toContain('My Cool Doc')
      expect(changes).not.toContain('parent-icon')
      expect(changes).not.toContain('Parent summary')
    } finally {
      cleanup()
    }
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
    expect(arg.visibility).toBe(ResourceVisibility.UNSPECIFIED)
  })

  it('retargets self query blocks from the placeholder path to the published path on first publish', async () => {
    const editId = hmId('acct-1', {path: ['parent', '-draft-abc']})
    getDocumentMock.mockImplementation(({path}) => {
      if (path === '/parent/-draft-abc') throw new Error('not found')
      return Promise.resolve({version: 'bafynew', account: 'acct-1', path, content: [], metadata: {}})
    })

    const {call, cleanup} = await renderHarness(editId)
    try {
      await act(async () => {
        await call.mutateAsync({
          draft: {
            ...makeDraft(),
            content: [
              {
                id: 'q1',
                type: 'query',
                props: {
                  style: 'Card',
                  columnCount: '3',
                  queryIncludes: JSON.stringify([{space: 'acct-1', path: 'parent/-draft-abc', mode: 'Children'}]),
                  querySort: '[{"term":"UpdateTime","reverse":false}]',
                  queryLimit: '',
                  banner: 'false',
                },
                content: [],
                children: [],
              },
            ] as any,
          },
          destinationId: editId,
          accountId: 'acct-1',
        })
      })
    } finally {
      cleanup()
    }

    const replaceBlock = publishDocumentMock.mock.calls[0][0].changes.find(
      (change: any) => change.op?.case === 'replaceBlock' && change.op.value.id === 'q1',
    )

    const attrs = replaceBlock.op.value.attributes.toJson()
    expect(attrs.query.includes[0]).toMatchObject({
      space: 'acct-1',
      path: 'parent/my-cool-doc',
      mode: 'Children',
    })
  })

  it('omits existing document genesis and generation when a placeholder path first-publishes', async () => {
    const editId = hmId('acct-1', {path: ['parent', '-draft-abc']})
    useResourceMock.mockReturnValue({
      data: {
        type: 'document',
        document: {
          genesis: 'bafy-wrong-existing-genesis',
          generationInfo: {generation: 777},
          content: [],
          detachedBlocks: {},
        },
      },
      isFetched: true,
      isLoading: false,
    })
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
        })
      })
    } finally {
      cleanup()
    }

    const arg = publishDocumentMock.mock.calls[0][0]
    expect(arg.path).toBe('/parent/my-cool-doc')
    expect(arg.baseVersion).toBe('')
    expect(arg.genesis).toBeUndefined()
    expect(arg.generation).toBeUndefined()
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
          pathOverride: ['public', 'slug'],
        })
      })
    } finally {
      cleanup()
    }

    expect(publishDocumentMock.mock.calls[0][0].path).toBe('/-randomid')
    expect(publishDocumentMock.mock.calls[0][0].visibility).toBe(ResourceVisibility.PRIVATE)
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

describe('first space publication invitation', () => {
  const homeId = hmId('acct-1', {path: []})
  const publishedHome = {
    version: 'content-version',
    genesis: 'home-genesis',
    account: 'acct-1',
    path: '',
    content: [],
    metadata: {name: 'My Space'},
    visibility: 'PUBLIC',
  }
  function homeDraft(): HMDraft {
    return {...makeDraft(), locationPath: [], editPath: [], metadata: {name: 'My Space'}}
  }
  beforeEach(() => {
    vi.resetAllMocks()
    useMyAccountIdsMock.mockReturnValue({data: ['acct-1']})
    useResourceMock.mockReturnValue({data: undefined, isFetched: true, isLoading: false})
    prepareHMDocumentMock.mockImplementation((raw: any) => raw)
    requestResourceMock.mockResolvedValue({type: 'not-found'})
    getDocumentMock
      .mockRejectedValueOnce(new ConnectError('No home document', Code.NotFound))
      .mockResolvedValue(publishedHome)
    publishDocumentMock.mockResolvedValue({
      version: publishedHome.version,
      genesis: publishedHome.genesis,
      generation: 1,
    })
    listDocumentChangesMock.mockResolvedValue({changes: []})
  })

  it.each(['unified editor', 'legacy draft toolbar'])(
    'invites after a new public home is published through the %s',
    async (flow) => {
      const {call, cleanup} = await renderHarness(flow === 'unified editor' ? homeId : undefined)
      try {
        expect(inviteToPublishDomainMock).not.toHaveBeenCalled()
        await act(async () => {
          await call.mutateAsync({draft: homeDraft(), destinationId: homeId, accountId: 'acct-1'})
        })
        expect(getDocumentMock).toHaveBeenNthCalledWith(1, {account: 'acct-1', path: ''})
        expect(inviteToPublishDomainMock).toHaveBeenCalledExactlyOnceWith(homeId)
      } finally {
        cleanup()
      }
    },
  )

  it('accepts a definitive NotFound when the raw resource probe is unavailable', async () => {
    requestResourceMock.mockRejectedValue(new Error('Raw lookup unavailable'))
    const {call, cleanup} = await renderHarness(homeId)
    try {
      await act(async () => {
        await call.mutateAsync({draft: homeDraft(), destinationId: homeId, accountId: 'acct-1'})
      })
      expect(inviteToPublishDomainMock).toHaveBeenCalledExactlyOnceWith(homeId)
    } finally {
      cleanup()
    }
  })

  it('does not invite when a raw existing document contradicts a stale NotFound response', async () => {
    requestResourceMock.mockResolvedValue({type: 'document', document: publishedHome})
    const {call, cleanup} = await renderHarness(homeId)
    try {
      await act(async () => {
        await call.mutateAsync({draft: homeDraft(), destinationId: homeId, accountId: 'acct-1'})
      })
      expect(inviteToPublishDomainMock).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it('accepts a positive missing-resource result when the document probe fails without a NotFound code', async () => {
    getDocumentMock
      .mockReset()
      .mockRejectedValueOnce(new Error('document lookup unavailable'))
      .mockResolvedValue(publishedHome)
    const {call, cleanup} = await renderHarness(homeId)
    try {
      await act(async () => {
        await call.mutateAsync({draft: homeDraft(), destinationId: homeId, accountId: 'acct-1'})
      })
      expect(inviteToPublishDomainMock).toHaveBeenCalledExactlyOnceWith(homeId)
    } finally {
      cleanup()
    }
  })

  it('invites after a signed first publication even while the indexed document cannot reload', async () => {
    getDocumentMock
      .mockReset()
      .mockRejectedValueOnce(new ConnectError('Missing', Code.NotFound))
      .mockRejectedValue(new Error('index unavailable'))
    const {call, cleanup} = await renderHarness(homeId)
    try {
      let result: HMDocument | undefined
      await act(async () => {
        result = await call.mutateAsync({draft: homeDraft(), destinationId: homeId, accountId: 'acct-1'})
      })
      expect(result?.version).toBe(publishedHome.version)
      expect(inviteToPublishDomainMock).toHaveBeenCalledExactlyOnceWith(homeId)
    } finally {
      cleanup()
    }
  })

  it('does not invite for an update even when the draft has no stored dependencies', async () => {
    getDocumentMock.mockReset().mockResolvedValue(publishedHome)
    const {call, cleanup} = await renderHarness(homeId)
    try {
      await act(async () => {
        await call.mutateAsync({draft: homeDraft(), destinationId: homeId, accountId: 'acct-1'})
      })
      expect(inviteToPublishDomainMock).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it.each(['draft dependencies', 'loaded document', 'site URL', 'private visibility'])(
    'does not invite when the root has %s',
    async (reason) => {
      const draft = homeDraft()
      if (reason === 'draft dependencies') draft.deps = ['existing-version']
      if (reason === 'loaded document')
        useResourceMock.mockReturnValue({
          data: {type: 'document', document: publishedHome},
          isFetched: true,
          isLoading: false,
        })
      if (reason === 'site URL') draft.metadata = {...draft.metadata, siteUrl: 'https://already.example.com'}
      if (reason === 'private visibility') draft.visibility = 'PRIVATE'
      const {call, cleanup} = await renderHarness(homeId)
      try {
        await act(async () => {
          await call.mutateAsync({draft, destinationId: homeId, accountId: 'acct-1'})
        })
        expect(inviteToPublishDomainMock).not.toHaveBeenCalled()
      } finally {
        cleanup()
      }
    },
  )

  it('does not invite for a child publication', async () => {
    const childId = hmId('acct-1', {path: ['child']})
    requestResourceMock.mockResolvedValue({
      type: 'document',
      document: {version: 'parent-version', visibility: 'PUBLIC'},
    })
    getDocumentMock
      .mockReset()
      .mockRejectedValueOnce(new ConnectError('Missing', Code.NotFound))
      .mockResolvedValue({...publishedHome, path: '/child'})
    const {call, cleanup} = await renderHarness(childId)
    try {
      await act(async () => {
        await call.mutateAsync({
          draft: {...makeDraft(), editPath: ['child'], locationPath: []},
          destinationId: childId,
          accountId: 'acct-1',
        })
      })
      expect(inviteToPublishDomainMock).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it('does not use a missing child probe as evidence that an overridden root destination is new', async () => {
    const childId = hmId('acct-1', {path: ['-draft-abc']})
    const {call, cleanup} = await renderHarness(childId)
    try {
      await act(async () => {
        await call.mutateAsync({
          draft: {...makeDraft(), editPath: ['-draft-abc'], locationPath: []},
          destinationId: childId,
          accountId: 'acct-1',
          pathOverride: [],
        })
      })
      expect(getDocumentMock).toHaveBeenNthCalledWith(1, {account: 'acct-1', path: '/-draft-abc'})
      expect(publishDocumentMock.mock.calls[0][0].path).toBe('')
      expect(inviteToPublishDomainMock).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it('does not mistake a transient lookup failure for proof of first publication', async () => {
    getDocumentMock
      .mockReset()
      .mockRejectedValueOnce(new ConnectError('Offline', Code.Unavailable))
      .mockResolvedValue(publishedHome)
    requestResourceMock.mockRejectedValue(new Error('Offline'))
    const {call, cleanup} = await renderHarness(homeId)
    try {
      await act(async () => {
        await call.mutateAsync({draft: homeDraft(), destinationId: homeId, accountId: 'acct-1'})
      })
      expect(inviteToPublishDomainMock).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it('does not invite when publishing over a redirect', async () => {
    requestResourceMock.mockResolvedValue({type: 'redirect'})
    const {call, cleanup} = await renderHarness(homeId)
    try {
      await act(async () => {
        await call.mutateAsync({draft: homeDraft(), destinationId: homeId, accountId: 'acct-1'})
      })
      expect(inviteToPublishDomainMock).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it('does not invite after a rejected publication', async () => {
    publishDocumentMock.mockRejectedValue(new Error('Publish failed'))
    const {call, cleanup} = await renderHarness(homeId)
    try {
      await act(async () => {
        await expect(
          call.mutateAsync({draft: homeDraft(), destinationId: homeId, accountId: 'acct-1'}),
        ).rejects.toThrow('Publish failed')
      })
      expect(inviteToPublishDomainMock).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it('does not invite merely because an existing remote home was loaded', async () => {
    useResourceMock.mockReturnValue({
      data: {type: 'document', document: publishedHome},
      isFetched: true,
      isLoading: false,
    })
    const {cleanup} = await renderHarness(homeId)
    try {
      expect(publishDocumentMock).not.toHaveBeenCalled()
      expect(inviteToPublishDomainMock).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })
})
