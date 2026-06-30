import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

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

describe('document card cleanup actor', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const key of Object.keys(storeData)) delete storeData[key]
    getDocumentMock.mockResolvedValue(makeParentDocument())
    publishDocumentMock.mockResolvedValue(undefined)
    findDraftByEditMock.mockResolvedValue(null)
    getDraftMock.mockResolvedValue(null)
    writeDraftMock.mockResolvedValue({id: 'draft-parent'})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('models the coordinator and cleanup job as XState machines', async () => {
    const {documentCardCleanupCoordinatorMachine, documentCardCleanupJobMachine} = await import(
      '../app-document-card-cleanup-machine'
    )

    expect(documentCardCleanupCoordinatorMachine.id).toBe('documentCardCleanupCoordinator')
    expect(documentCardCleanupJobMachine.id).toBe('documentCardCleanupJob')
  })

  it('enqueues one idle cleanup job for the deleted document parent and dedupes repeats', async () => {
    const {documentCardCleanupApi, getDocumentCardCleanupSnapshotForTest} = await loadCleanupModule()
    const caller = documentCardCleanupApi.createCaller({})
    const deletedDocumentId = hmId('alice', {path: ['parent', 'child']}).id

    await caller.enqueue({deletedDocumentId, signingAccountUid: 'alice', capabilityId: 'cap-1'})
    await caller.enqueue({deletedDocumentId, signingAccountUid: 'alice', capabilityId: 'cap-1'})

    const snapshot = getDocumentCardCleanupSnapshotForTest()
    expect(snapshot.coordinatorState).toBe('idle')
    expect(snapshot.jobs).toHaveLength(1)
    expect(snapshot.jobs[0]).toMatchObject({
      deletedDocumentId,
      parentDocumentId: hmId('alice', {path: ['parent']}).id,
      signingAccountUid: 'alice',
      capabilityId: 'cap-1',
      state: 'idle',
      attempts: 0,
      maxRetries: 3,
    })
  })

  it('does not enqueue cleanup for a root document because it has no parent card', async () => {
    const {documentCardCleanupApi, getDocumentCardCleanupSnapshotForTest} = await loadCleanupModule()
    const caller = documentCardCleanupApi.createCaller({})

    const result = await caller.enqueue({deletedDocumentId: hmId('alice').id, signingAccountUid: 'alice'})

    expect(result.enqueued).toBe(false)
    expect(result.reason).toBe('no-parent')
    expect(getDocumentCardCleanupSnapshotForTest().jobs).toEqual([])
  })

  it('hydrates existing cleanup jobs from the legacy persisted store shape', async () => {
    const deletedDocumentId = hmId('alice', {path: ['parent', 'child']}).id
    storeData['DocumentCardCleanupState-v001'] = {
      coordinatorState: 'idle',
      jobs: [
        {
          id: `${deletedDocumentId}|hm://alice/parent|alice`,
          deletedDocumentId,
          parentDocumentId: hmId('alice', {path: ['parent']}).id,
          signingAccountUid: 'alice',
          state: 'idle',
          attempts: 0,
          maxRetries: 3,
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
    }

    const {getDocumentCardCleanupSnapshotForTest} = await loadCleanupModule()

    expect(getDocumentCardCleanupSnapshotForTest().jobs).toHaveLength(1)
    expect(getDocumentCardCleanupSnapshotForTest().jobs[0]).toMatchObject({
      deletedDocumentId,
      parentDocumentId: hmId('alice', {path: ['parent']}).id,
      state: 'idle',
    })
  })

  it('runs one cleanup at a time and publishes child-preserving link embed removal changes', async () => {
    const {documentCardCleanupApi, getDocumentCardCleanupSnapshotForTest, runNextDocumentCardCleanupForTest} =
      await loadCleanupModule()
    const caller = documentCardCleanupApi.createCaller({})
    const firstDeletedId = hmId('alice', {path: ['parent', 'child']}).id
    const secondDeletedId = hmId('alice', {path: ['parent', 'other']}).id

    getDocumentMock.mockResolvedValue(
      makeParentDocument([
        {block: {id: 'intro', type: 'Paragraph', text: 'Intro', attributes: {}}, children: []},
        {
          block: {id: 'card', type: 'Embed', link: `${firstDeletedId}#target-block`, attributes: {view: 'Link'}},
          children: [{block: {id: 'nested', type: 'Paragraph', text: 'Nested', attributes: {}}, children: []}],
        },
        {block: {id: 'tail', type: 'Paragraph', text: 'Tail', attributes: {}}, children: []},
      ]),
    )

    await caller.enqueue({deletedDocumentId: firstDeletedId, signingAccountUid: 'alice'})
    await caller.enqueue({deletedDocumentId: secondDeletedId, signingAccountUid: 'alice'})

    await runNextDocumentCardCleanupForTest({now: () => 1_000})

    expect(publishDocumentMock).toHaveBeenCalledTimes(1)
    expect((publishDocumentMock.mock.calls[0] as any[])[0]).toMatchObject({
      account: 'alice',
      path: '/parent',
      baseVersion: 'parent-version',
      genesis: 'parent-genesis',
      generation: BigInt(11),
    })
    const changes = (publishDocumentMock.mock.calls[0] as any[])[0].changes
    expect(changes.map((change: any) => change.op.case)).toEqual(['moveBlock', 'deleteBlock'])
    expect(changes[0]!.op.value).toMatchObject({blockId: 'nested', parent: '', leftSibling: 'intro'})
    expect(changes[1]!.op.value).toBe('card')
    expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.ENTITY, hmId('alice', {path: ['parent']}).id])
    expect(appInvalidateQueriesMock).toHaveBeenCalledWith([
      queryKeys.RESOLVED_ENTITY,
      hmId('alice', {path: ['parent']}).id,
    ])

    const snapshot = getDocumentCardCleanupSnapshotForTest()
    expect(snapshot.jobs.find((job) => job.deletedDocumentId === firstDeletedId)?.state).toBe('done')
    expect(snapshot.jobs.find((job) => job.deletedDocumentId === secondDeletedId)?.state).toBe('idle')
  })

  it('removes matching embeds from a parent draft and preserves their children', async () => {
    const {documentCardCleanupApi, getDocumentCardCleanupSnapshotForTest, runNextDocumentCardCleanupForTest} =
      await loadCleanupModule()
    const caller = documentCardCleanupApi.createCaller({})
    const deletedDocumentId = hmId('alice', {path: ['parent', 'child']}).id

    getDocumentMock.mockResolvedValue(
      makeParentDocument([
        {
          block: {id: 'published-matching-embed', type: 'Embed', link: deletedDocumentId, attributes: {view: 'Card'}},
          children: [],
        },
      ]),
    )
    findDraftByEditMock.mockResolvedValue({id: 'draft-parent'})
    getDraftMock.mockResolvedValue({
      id: 'draft-parent',
      editUid: 'alice',
      editPath: ['parent'],
      metadata: {name: 'Parent draft'},
      deps: ['parent-version'],
      visibility: 'PUBLIC',
      content: [
        {
          id: 'before',
          type: 'paragraph',
          props: {},
          content: [{type: 'text', text: 'Before', styles: {}}],
          children: [],
        },
        {
          id: 'draft-link',
          type: 'embed',
          props: {url: `${deletedDocumentId}#target-block`, view: 'Link'},
          content: [],
          children: [
            {
              id: 'draft-child',
              type: 'paragraph',
              props: {},
              content: [{type: 'text', text: 'Child', styles: {}}],
              children: [],
            },
          ],
        },
        {
          id: 'draft-comments',
          type: 'embed',
          props: {url: deletedDocumentId, view: 'Comments'},
          content: [],
          children: [],
        },
        {id: 'after', type: 'paragraph', props: {}, content: [{type: 'text', text: 'After', styles: {}}], children: []},
      ],
    })

    await caller.enqueue({deletedDocumentId, signingAccountUid: 'alice'})
    await runNextDocumentCardCleanupForTest({now: () => 1_000})

    expect(publishDocumentMock).not.toHaveBeenCalled()
    expect(writeDraftMock).toHaveBeenCalledTimes(1)
    const draftWriteInput = writeDraftMock.mock.calls[0]?.[0] as any
    expect(draftWriteInput).toMatchObject({
      id: 'draft-parent',
      editUid: 'alice',
      editPath: ['parent'],
      metadata: {name: 'Parent draft'},
      deps: ['parent-version'],
      visibility: 'PUBLIC',
    })
    expect(draftWriteInput.content.map((block: any) => block.id)).toEqual(['before', 'draft-child', 'after'])
    expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.DRAFT, 'draft-parent'])
    expect(dispatchAllWindowsAppEventMock).toHaveBeenCalledWith({
      type: 'draft_externally_modified',
      draftId: 'draft-parent',
      source: 'document-card-cleanup',
      deletedDocumentId,
      removedBlockIds: ['draft-link', 'draft-comments'],
      autoReload: true,
    })
    expect(getDocumentMock).not.toHaveBeenCalled()
    expect(getDocumentCardCleanupSnapshotForTest().jobs[0]).toMatchObject({
      state: 'done',
      isDraft: true,
      parentDraftId: 'draft-parent',
    })
  })

  it('marks a cleanup as skippedTerminal when the parent has no matching document card', async () => {
    const {documentCardCleanupApi, getDocumentCardCleanupSnapshotForTest, runNextDocumentCardCleanupForTest} =
      await loadCleanupModule()
    const caller = documentCardCleanupApi.createCaller({})
    const deletedDocumentId = hmId('alice', {path: ['parent', 'child']}).id

    getDocumentMock.mockResolvedValue(
      makeParentDocument([{block: {id: 'not-card', type: 'Paragraph', text: 'x', attributes: {}}, children: []}]),
    )

    await caller.enqueue({deletedDocumentId, signingAccountUid: 'alice'})
    await runNextDocumentCardCleanupForTest({now: () => 1_000})

    expect(publishDocumentMock).not.toHaveBeenCalled()
    expect(getDocumentCardCleanupSnapshotForTest().jobs[0]?.state).toBe('skippedTerminal')
  })

  it('appends a moved or republished document card to a parent draft', async () => {
    const {documentCardCleanupApi, getDocumentCardCleanupSnapshotForTest, runNextDocumentCardCleanupForTest} =
      await loadCleanupModule()
    const caller = documentCardCleanupApi.createCaller({})
    const parentDocumentId = hmId('alice', {path: ['new-parent']}).id
    const targetDocumentId = hmId('alice', {path: ['new-parent', 'child']}).id

    findDraftByEditMock.mockResolvedValue({id: 'draft-parent'})
    getDraftMock.mockResolvedValue({
      id: 'draft-parent',
      editUid: 'alice',
      editPath: ['new-parent'],
      metadata: {name: 'New parent'},
      deps: ['parent-version'],
      visibility: 'PUBLIC',
      content: [
        {
          id: 'before',
          type: 'paragraph',
          props: {},
          content: [{type: 'text', text: 'Before', styles: {}}],
          children: [],
        },
      ],
    })

    await caller.enqueue({
      operation: 'add',
      parentDocumentId,
      targetDocumentId,
      signingAccountUid: 'alice',
    } as any)
    await runNextDocumentCardCleanupForTest({now: () => 1_000})

    expect(writeDraftMock).toHaveBeenCalledTimes(1)
    const draftWriteInput = writeDraftMock.mock.calls[0]?.[0] as any
    expect(draftWriteInput.content).toHaveLength(2)
    expect(draftWriteInput.content.at(-1)).toMatchObject({
      type: 'embed',
      props: {url: targetDocumentId, view: 'Card'},
    })
    expect(publishDocumentMock).not.toHaveBeenCalled()
    expect(getDocumentCardCleanupSnapshotForTest().jobs[0]).toMatchObject({
      operation: 'add',
      state: 'done',
      parentDocumentId,
      targetDocumentId,
    })
  })

  it('rewrites an existing card link in place for a same-parent move', async () => {
    const {documentCardCleanupApi, getDocumentCardCleanupSnapshotForTest, runNextDocumentCardCleanupForTest} =
      await loadCleanupModule()
    const caller = documentCardCleanupApi.createCaller({})
    const parentDocumentId = hmId('alice', {path: ['parent']}).id
    const sourceDocumentId = hmId('alice', {path: ['parent', 'old']}).id
    const targetDocumentId = hmId('alice', {path: ['parent', 'new']}).id

    getDocumentMock.mockResolvedValue(
      makeParentDocument([
        {
          block: {id: 'card', type: 'Embed', link: sourceDocumentId, attributes: {view: 'Card'}},
          children: [{block: {id: 'nested', type: 'Paragraph', text: 'Nested', attributes: {}}, children: []}],
        },
      ]),
    )

    await caller.enqueue({
      operation: 'rewrite',
      parentDocumentId,
      sourceDocumentId,
      targetDocumentId,
      signingAccountUid: 'alice',
    } as any)
    await runNextDocumentCardCleanupForTest({now: () => 1_000})

    expect(publishDocumentMock).toHaveBeenCalledTimes(1)
    const changes = (publishDocumentMock.mock.calls[0] as any[])[0].changes
    expect(changes.map((change: any) => change.op.case)).toEqual(['replaceBlock'])
    expect(changes[0]!.op.value.id).toBe('card')
    expect(changes[0]!.op.value.link).toBe(targetDocumentId)
    expect(getDocumentCardCleanupSnapshotForTest().jobs[0]).toMatchObject({
      operation: 'rewrite',
      state: 'done',
      parentDocumentId,
      sourceDocumentId,
      targetDocumentId,
    })
  })

  it('retries retryable publish failures three times before failing needs attention', async () => {
    const {documentCardCleanupApi, getDocumentCardCleanupSnapshotForTest, runNextDocumentCardCleanupForTest} =
      await loadCleanupModule()
    const caller = documentCardCleanupApi.createCaller({})
    const deletedDocumentId = hmId('alice', {path: ['parent', 'child']}).id
    let now = 1_000

    getDocumentMock.mockResolvedValue(
      makeParentDocument([
        {block: {id: 'card', type: 'Embed', link: deletedDocumentId, attributes: {view: 'Card'}}, children: []},
      ]),
    )
    publishDocumentMock.mockRejectedValue(new Error('temporary publish failure'))

    await caller.enqueue({deletedDocumentId, signingAccountUid: 'alice'})

    for (let run = 0; run < 4; run++) {
      await runNextDocumentCardCleanupForTest({now: () => now})
      const job = getDocumentCardCleanupSnapshotForTest().jobs[0]
      if (run < 3) {
        expect(job?.state).toBe('retryScheduled')
        expect(job?.attempts).toBe(run + 1)
        now = job?.nextRunAt || now
      }
    }

    const finalJob = getDocumentCardCleanupSnapshotForTest().jobs[0]
    expect(finalJob?.state).toBe('failedNeedsAttention')
    expect(finalJob?.attempts).toBe(4)
    expect(publishDocumentMock).toHaveBeenCalledTimes(4)
  })

  it('blocks later queued cleanups while an earlier cleanup is waiting to retry', async () => {
    const {documentCardCleanupApi, getDocumentCardCleanupSnapshotForTest, runNextDocumentCardCleanupForTest} =
      await loadCleanupModule()
    const caller = documentCardCleanupApi.createCaller({})
    const firstDeletedId = hmId('alice', {path: ['parent', 'child']}).id
    const secondDeletedId = hmId('alice', {path: ['parent', 'other']}).id
    let now = 1_000

    getDocumentMock.mockResolvedValue(
      makeParentDocument([
        {block: {id: 'card', type: 'Embed', link: firstDeletedId, attributes: {view: 'Card'}}, children: []},
        {block: {id: 'other-card', type: 'Embed', link: secondDeletedId, attributes: {view: 'Card'}}, children: []},
      ]),
    )
    publishDocumentMock.mockRejectedValueOnce(new Error('temporary publish failure'))

    await caller.enqueue({deletedDocumentId: firstDeletedId, signingAccountUid: 'alice'})
    await caller.enqueue({deletedDocumentId: secondDeletedId, signingAccountUid: 'alice'})

    await runNextDocumentCardCleanupForTest({now: () => now})

    let snapshot = getDocumentCardCleanupSnapshotForTest()
    const retryingJob = snapshot.jobs.find((job) => job.deletedDocumentId === firstDeletedId)
    expect(retryingJob?.state).toBe('retryScheduled')
    expect(snapshot.jobs.find((job) => job.deletedDocumentId === secondDeletedId)?.state).toBe('idle')

    await runNextDocumentCardCleanupForTest({now: () => now + 1})

    snapshot = getDocumentCardCleanupSnapshotForTest()
    expect(snapshot.jobs.find((job) => job.deletedDocumentId === firstDeletedId)?.state).toBe('retryScheduled')
    expect(snapshot.jobs.find((job) => job.deletedDocumentId === secondDeletedId)?.state).toBe('idle')
    expect(publishDocumentMock).toHaveBeenCalledTimes(1)

    now = retryingJob?.nextRunAt || now
    publishDocumentMock.mockResolvedValue(undefined)

    await runNextDocumentCardCleanupForTest({now: () => now})
    await runNextDocumentCardCleanupForTest({now: () => now})

    snapshot = getDocumentCardCleanupSnapshotForTest()
    expect(snapshot.jobs.find((job) => job.deletedDocumentId === firstDeletedId)?.state).toBe('done')
    expect(snapshot.jobs.find((job) => job.deletedDocumentId === secondDeletedId)?.state).toBe('done')
    expect(publishDocumentMock).toHaveBeenCalledTimes(3)
  })
})
