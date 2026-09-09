import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {resolveHypermediaUrlMock} = vi.hoisted(() => ({resolveHypermediaUrlMock: vi.fn()}))
vi.mock('@seed-hypermedia/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seed-hypermedia/client')>()),
  resolveHypermediaUrl: resolveHypermediaUrlMock,
}))

const storeData: Record<string, any> = {}

const appStoreMock = {
  get: vi.fn((key: string) => storeData[key]),
  set: vi.fn((key: string, value: any) => {
    storeData[key] = value
  }),
}

const getDocumentMock = vi.fn()
const publishDocumentMock = vi.fn(async () => undefined)
const appInvalidateQueriesMock = vi.fn()
const findDraftByEditMock = vi.fn()
const getDraftMock = vi.fn()
const writeDraftMock = vi.fn(async (_input: any) => ({id: 'draft-parent'}))
const compareAndSwapDraftMock = vi.fn(async (_expected: any, _replacement: any) => true)
const dispatchAllWindowsAppEventMock = vi.fn()

vi.mock('../app-store.mts', () => ({
  appStore: appStoreMock,
}))

vi.mock('../app-grpc', () => ({
  grpcClient: {
    documents: {
      getDocument: getDocumentMock,
    },
    daemon: {
      signData: vi.fn(async () => ({signature: new Uint8Array([1, 2, 3])})),
    },
  },
}))

vi.mock('../app-client', () => ({
  getSigner: vi.fn((accountUid: string) => ({accountUid})),
  seedClient: {
    request: vi.fn(async () => ({type: 'document'})),
    publishDocument: publishDocumentMock,
  },
}))

vi.mock('../app-invalidation', () => ({
  appInvalidateQueries: appInvalidateQueriesMock,
}))

vi.mock('../app-windows', () => ({
  dispatchAllWindowsAppEvent: dispatchAllWindowsAppEventMock,
}))

vi.mock('../app-drafts', () => ({
  compareAndSwapDraft: compareAndSwapDraftMock,
  draftsApi: {
    createCaller: vi.fn(() => ({
      findByEdit: findDraftByEditMock,
      get: getDraftMock,
      write: writeDraftMock,
    })),
  },
}))

vi.mock('@shm/shared/document-utils', () => ({
  prepareHMDocument: (doc: any) => doc,
}))

vi.mock('../logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

async function loadCleanupModule() {
  return await import('../app-document-card-cleanup')
}

function makeParentDocument(content: any[] = []) {
  return {
    id: 'hm://alice/parent',
    account: 'alice',
    path: ['parent'],
    version: 'parent-version',
    genesis: 'parent-genesis',
    generationInfo: {generation: BigInt(11)},
    content,
    metadata: {},
  }
}

const source = 'hm://alice/parent/child'
const parent = 'hm://alice/parent'
const card = (link = source): HMBlockNode => ({
  block: {id: 'card', type: 'Embed', link, attributes: {view: 'Card'}},
  children: [],
})
const text = (value: string): HMBlockNode => ({
  block: {id: 'text', type: 'Paragraph', text: value, attributes: {}},
  children: [],
})

describe('desktop published parent reconciliation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    for (const key of Object.keys(storeData)) delete storeData[key]
    getDocumentMock.mockReset().mockResolvedValue(makeParentDocument())
    publishDocumentMock.mockReset().mockResolvedValue(undefined)
    findDraftByEditMock.mockResolvedValue(null)
    getDraftMock.mockResolvedValue(null)
    compareAndSwapDraftMock.mockResolvedValue(true)
  })
  afterEach(() => vi.useRealTimers())

  it('persists dismissal across restart and clears only dismissed history', async () => {
    storeData['DocumentCardCleanupState-v001'] = {
      jobs: [
        {
          id: 'history-job',
          sourceDocumentId: source,
          parentDocumentId: parent,
          signingAccountUid: 'alice',
          state: 'failedNeedsAttention',
          attempts: 4,
          maxRetries: 3,
          createdAt: 1,
          updatedAt: 1,
          lastError: 'offline',
        },
      ],
    }
    const mod = await loadCleanupModule()
    const api = mod.documentCardCleanupApi.createCaller({})
    await api.dismiss({jobId: 'history-job'})
    expect(storeData['DocumentCardCleanupState-v001'].jobs[0]).toMatchObject({
      state: 'dismissed',
      dismissedAt: 1000,
      lastError: 'offline',
      attempts: 4,
    })
    vi.resetModules()
    const restored = (await loadCleanupModule()).documentCardCleanupApi.createCaller({})
    expect((await restored.getSnapshot()).jobs[0]?.state).toBe('dismissed')
    await restored.enqueue({
      deletedDocumentId: 'hm://alice/parent/other',
      signingAccountUid: 'alice',
      awaitingPrimary: {documentId: 'hm://alice/parent/other', expectedType: 'tombstone'},
    })
    await restored.clearDismissed()
    expect((await restored.getSnapshot()).jobs.map((job: any) => job.state)).toEqual(['awaitingPrimary'])
    expect(storeData['DocumentCardCleanupState-v001'].jobs).toHaveLength(1)
  })

  it('deduplicates pending parent jobs and skips home cleanup', async () => {
    const mod = await loadCleanupModule()
    const api = mod.documentCardCleanupApi.createCaller({})
    expect((await api.enqueue({deletedDocumentId: 'hm://alice', signingAccountUid: 'alice'})).enqueued).toBe(false)
    await api.enqueue({deletedDocumentId: source, signingAccountUid: 'alice'})
    await api.enqueue({deletedDocumentId: source, signingAccountUid: 'alice'})
    expect(mod.getDocumentCardCleanupSnapshotForTest().jobs).toHaveLength(1)
  })

  it('publishes reference-only changes and reads back the actual parent before completing', async () => {
    const mod = await loadCleanupModule()
    const api = mod.documentCardCleanupApi.createCaller({})
    getDocumentMock
      .mockResolvedValueOnce(makeParentDocument([card(), text('published')]))
      .mockResolvedValue({...makeParentDocument([text('published')]), version: 'new'})
    await api.enqueue({deletedDocumentId: source, signingAccountUid: 'alice'})
    await mod.runNextDocumentCardCleanupForTest()
    expect(publishDocumentMock).toHaveBeenCalledOnce()
    expect((publishDocumentMock.mock.calls[0] as any[])[0]).toMatchObject({
      baseVersion: 'parent-version',
      changes: [expect.objectContaining({op: expect.objectContaining({case: 'deleteBlock'})})],
    })
    expect(getDocumentMock).toHaveBeenCalledTimes(2)
    expect(mod.getDocumentCardCleanupSnapshotForTest().jobs[0]).toMatchObject({state: 'done', publishedVersion: 'new'})
  })

  it('publishes first then CAS-rebases a draft without publishing its user text', async () => {
    const {hmBlocksToEditorContent} = await import('@seed-hypermedia/client/hmblock-to-editorblock')
    const mod = await loadCleanupModule()
    const api = mod.documentCardCleanupApi.createCaller({})
    const base = [card(), text('published')]
    const draft = {
      id: 'draft-parent',
      deps: ['parent-version'],
      baseBlocks: base,
      metadata: {name: 'Unpublished title'},
      content: hmBlocksToEditorContent([card(), text('local')]),
    }
    findDraftByEditMock.mockResolvedValue({id: draft.id})
    getDraftMock.mockResolvedValue(draft)
    getDocumentMock
      .mockResolvedValueOnce(makeParentDocument(base))
      .mockResolvedValue({...makeParentDocument([text('published')]), version: 'new.head'})
    await api.enqueue({deletedDocumentId: source, signingAccountUid: 'alice'})
    await mod.runNextDocumentCardCleanupForTest()
    expect(mod.getDocumentCardCleanupSnapshotForTest().jobs[0]?.lastError).toBeUndefined()
    expect(compareAndSwapDraftMock).toHaveBeenCalledOnce()
    const replacement = compareAndSwapDraftMock.mock.calls[0]![1]
    expect(replacement.deps).toEqual(['new', 'head'])
    expect(replacement.baseBlocks).toEqual([text('published')])
    expect(replacement.metadata).toEqual(draft.metadata)
    expect(replacement.content[0].content[0].text).toBe('local')
    expect(dispatchAllWindowsAppEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: draft.id,
        previousContent: expect.any(Array),
        publishedDocument: expect.objectContaining({version: 'new.head'}),
        autoReload: false,
      }),
    )
    expect(writeDraftMock).not.toHaveBeenCalled()
  })

  it('retains publication checkpoint on CAS failure and does not publish again on retry', async () => {
    const {hmBlocksToEditorContent} = await import('@seed-hypermedia/client/hmblock-to-editorblock')
    const mod = await loadCleanupModule()
    const api = mod.documentCardCleanupApi.createCaller({})
    findDraftByEditMock.mockResolvedValue({id: 'draft-parent'})
    getDraftMock.mockResolvedValue({
      id: 'draft-parent',
      deps: ['parent-version'],
      baseBlocks: [card()],
      content: hmBlocksToEditorContent([card()]),
    })
    getDocumentMock
      .mockResolvedValueOnce(makeParentDocument([card()]))
      .mockResolvedValue({...makeParentDocument(), version: 'new'})
    compareAndSwapDraftMock.mockResolvedValueOnce(false).mockResolvedValue(true)
    await api.enqueue({deletedDocumentId: source, signingAccountUid: 'alice'})
    await mod.runNextDocumentCardCleanupForTest()
    expect(mod.getDocumentCardCleanupSnapshotForTest().jobs[0]).toMatchObject({
      state: 'retryScheduled',
      publishedVersion: 'new',
    })
    await mod.runNextDocumentCardCleanupForTest({now: () => 2000})
    expect(publishDocumentMock).toHaveBeenCalledOnce()
    expect(mod.getDocumentCardCleanupSnapshotForTest().jobs[0]?.state).toBe('done')
  })

  it('never mutates a draft when parent publication fails', async () => {
    const mod = await loadCleanupModule()
    const api = mod.documentCardCleanupApi.createCaller({})
    getDocumentMock.mockResolvedValue(makeParentDocument([card()]))
    publishDocumentMock.mockRejectedValue(new Error('offline'))
    await api.enqueue({deletedDocumentId: source, signingAccountUid: 'alice'})
    await mod.runNextDocumentCardCleanupForTest()
    expect(compareAndSwapDraftMock).not.toHaveBeenCalled()
    expect(mod.getDocumentCardCleanupSnapshotForTest().jobs[0]?.state).toBe('retryScheduled')
  })

  it('holds maintenance until the primary operation explicitly succeeds', async () => {
    const mod = await loadCleanupModule()
    const api = mod.documentCardCleanupApi.createCaller({})
    const intent = await api.enqueue({
      deletedDocumentId: source,
      signingAccountUid: 'alice',
      awaitingPrimary: {documentId: source, expectedType: 'tombstone'},
    })
    await mod.runNextDocumentCardCleanupForTest()
    expect(getDocumentMock).not.toHaveBeenCalled()
    await api.release({jobId: intent.jobId!})
    await mod.runNextDocumentCardCleanupForTest()
    expect(getDocumentMock).toHaveBeenCalled()
  })
  it('suppresses an added card when a custom-domain parent link resolves to that child', async () => {
    resolveHypermediaUrlMock.mockResolvedValue({hmId: hmId('alice', {path: ['parent', 'child']})})
    const mod = await loadCleanupModule()
    const api = mod.documentCardCleanupApi.createCaller({})
    getDocumentMock.mockResolvedValue(
      makeParentDocument([
        {block: {id: 'link', type: 'Button', link: 'https://alice.example/parent/child', attributes: {}}, children: []},
      ]),
    )
    await api.enqueue({
      operation: 'add',
      targetDocumentId: source,
      parentDocumentId: parent,
      signingAccountUid: 'alice',
    })
    await mod.runNextDocumentCardCleanupForTest()
    expect(publishDocumentMock).not.toHaveBeenCalled()
    expect(mod.getDocumentCardCleanupSnapshotForTest().jobs[0]?.state).toBe('done')
  })

  it('does not acknowledge a held intent or publish when durable storage fails', async () => {
    const mod = await loadCleanupModule()
    const api = mod.documentCardCleanupApi.createCaller({})
    appStoreMock.set.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    await expect(
      api.enqueue({
        deletedDocumentId: source,
        signingAccountUid: 'alice',
        awaitingPrimary: {documentId: source, expectedType: 'tombstone'},
      }),
    ).rejects.toThrow('disk full')
    await mod.runNextDocumentCardCleanupForTest()
    expect(publishDocumentMock).not.toHaveBeenCalled()
    expect((await api.getSnapshot()).storageError).toBe('disk full')
  })
  it('corrects a draft-only card even when no new parent publication is needed', async () => {
    const {hmBlocksToEditorContent} = await import('@seed-hypermedia/client/hmblock-to-editorblock')
    const mod = await loadCleanupModule()
    const api = mod.documentCardCleanupApi.createCaller({})
    findDraftByEditMock.mockResolvedValue({id: 'draft-parent'})
    getDraftMock.mockResolvedValue({
      id: 'draft-parent',
      deps: ['parent-version'],
      baseBlocks: [],
      content: hmBlocksToEditorContent([card()]),
    })
    getDocumentMock.mockResolvedValue(makeParentDocument())
    await api.enqueue({deletedDocumentId: source, signingAccountUid: 'alice'})
    await mod.runNextDocumentCardCleanupForTest()
    expect(publishDocumentMock).not.toHaveBeenCalled()
    expect(compareAndSwapDraftMock.mock.calls[0]?.[1].content).toEqual([])
  })

  it('publishes a temporary child card at a stable published anchor and retains its local ID', async () => {
    const {hmBlocksToEditorContent} = await import('@seed-hypermedia/client/hmblock-to-editorblock')
    const mod = await loadCleanupModule()
    const api = mod.documentCardCleanupApi.createCaller({})
    const before = text('before')
    const after = {...text('after'), block: {...text('after').block, id: 'after'}} as HMBlockNode
    const base = [before, after]
    const resolved = {...card(), block: {...card().block, id: 'temporary-card'}} as HMBlockNode
    const draftContent = hmBlocksToEditorContent(base)
    draftContent.splice(1, 0, {
      id: 'temporary-card',
      type: 'embed',
      props: {draftId: 'child-draft', url: '', view: 'Card'},
      content: [],
      children: [],
    } as any)
    findDraftByEditMock.mockResolvedValue({id: 'draft-parent'})
    getDraftMock.mockResolvedValue({
      id: 'draft-parent',
      deps: ['parent-version'],
      baseBlocks: base,
      content: draftContent,
    })
    let published = false
    getDocumentMock.mockImplementation(async () =>
      published ? {...makeParentDocument([before, resolved, after]), version: 'new'} : makeParentDocument(base),
    )
    publishDocumentMock.mockImplementation(async () => {
      published = true
    })
    await api.enqueue({
      operation: 'add',
      targetDocumentId: source,
      parentDocumentId: parent,
      signingAccountUid: 'alice',
      childDraftId: 'child-draft',
    })
    await mod.runNextDocumentCardCleanupForTest()
    const changes = (publishDocumentMock.mock.calls[0] as any[])[0].changes
    const move = changes.find((change: any) => change.op.case === 'moveBlock')
    expect(move.op.value).toMatchObject({blockId: 'temporary-card', parent: '', leftSibling: 'text'})
    expect(compareAndSwapDraftMock.mock.calls[0]?.[1].content.map((block: any) => block.id)).toEqual([
      'text',
      'temporary-card',
      'after',
    ])
    expect(compareAndSwapDraftMock.mock.calls[0]?.[1].content[1].props.url).toBe(source)
  })
})
