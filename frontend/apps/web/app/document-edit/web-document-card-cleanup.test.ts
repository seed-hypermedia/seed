import 'fake-indexeddb/auto'
import type {HMBlockNode, HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {QueryClient} from '@tanstack/react-query'
import {queryKeys} from '@shm/shared/models/query-keys'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {_resetWebDocDraftDBForTesting, getWebDocDraft, putWebDocDraft} from './web-draft-db'

function makeId(uid: string, path: string[]): UnpackedHypermediaId {
  return {
    uid,
    path,
    id: `hm://${uid}${path.length ? '/' + path.join('/') : ''}`,
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: 'hm',
    latest: false,
  } as UnpackedHypermediaId
}

function paragraph(id: string): HMBlockNode {
  return {
    block: {id, type: 'Paragraph', text: '', attributes: {}} as any,
    children: [],
  }
}

function embed(id: string, link: string, children: HMBlockNode[] = []): HMBlockNode {
  return {
    block: {id, type: 'Embed', link, attributes: {view: 'Card'}} as any,
    children,
  }
}

function makeDocument(id: UnpackedHypermediaId, content: HMBlockNode[] = []): HMDocument {
  return {
    id: id.id,
    account: id.uid,
    path: `/${(id.path || []).join('/')}`,
    version: 'parent-version',
    genesis: 'parent-genesis',
    generationInfo: {generation: 7n},
    metadata: {},
    content,
  } as unknown as HMDocument
}

describe('web document card cleanup', () => {
  beforeEach(async () => {
    vi.resetModules()
    _resetWebDocDraftDBForTesting()
  })

  afterEach(async () => {
    const mod = await import('./web-document-card-cleanup')
    mod.resetWebDocumentCardCleanupForTest()
    _resetWebDocDraftDBForTesting()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each([true, false])('recovers interrupted durable jobs or legacy snapshot jobs (%s)', async (durable) => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})
    const job = {
      id: 'recover',
      deletedDocumentId: 'hm://alice/parent/child',
      parentDocumentId: 'hm://alice/parent',
      signingAccountUid: 'alice',
      state: 'publishing',
      attempts: 1,
      maxRetries: 3,
      createdAt: 1000,
      updatedAt: 1000,
    }
    const storage = new Map<string, string>()
    storage.set(
      'WebDocumentCardCleanupMachineSnapshot-v001',
      JSON.stringify({status: 'active', value: 'running', context: {jobs: [job], activeJobId: job.id}, children: {}}),
    )
    if (durable)
      storage.set('WebDocumentCardCleanupState-v001', JSON.stringify({coordinatorState: 'running', jobs: [job]}))
    const setItem = vi.fn((key: string, value: string) => storage.set(key, value))
    vi.stubGlobal('localStorage', {getItem: (key: string) => storage.get(key), setItem})
    const mod = await import('./web-document-card-cleanup')
    mod.startWebDocumentCardCleanupCoordinator({client: {request: vi.fn(async () => ({type: 'not-found'}))}} as any)
    await mod.runNextWebDocumentCardCleanupForTest()
    expect(mod.getWebDocumentCardCleanupSnapshot().jobs[0]?.state).toBe('skippedTerminal')
    expect(setItem.mock.calls.every(([key]) => key !== 'WebDocumentCardCleanupMachineSnapshot-v001')).toBe(true)
  })

  it('acknowledges enqueue before parent execution and exposes retry and dismiss', async () => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})
    const mod = await import('./web-document-card-cleanup')
    const client = {
      request: vi.fn(async () => {
        throw new Error('offline')
      }),
    }
    const result = await mod.enqueueWebDocumentCardCleanup(
      {deletedDocumentId: 'hm://alice/parent/child', signingAccountUid: 'alice'},
      {client} as any,
    )
    expect(result.enqueued).toBe(true)
    expect(mod.getWebDocumentCardCleanupSnapshot().jobs[0]?.state).not.toBe('retryScheduled')
    await mod.runNextWebDocumentCardCleanupForTest()
    expect(mod.getWebDocumentCardCleanupSnapshot().jobs[0]?.state).toBe('retryScheduled')

    for (let attempt = 0; attempt < 3; attempt++) {
      const nextRunAt = mod.getWebDocumentCardCleanupSnapshot().jobs[0]!.nextRunAt!
      await mod.runNextWebDocumentCardCleanupForTest({now: () => nextRunAt})
    }
    expect(mod.getWebDocumentCardCleanupSnapshot().jobs[0]?.state).toBe('failedNeedsAttention')
    await mod.retryWebDocumentCardCleanup(result.jobId!)
    expect(mod.getWebDocumentCardCleanupSnapshot().jobs[0]).toMatchObject({attempts: 0})
    for (let attempt = 0; attempt < 4; attempt++) {
      const nextRunAt = mod.getWebDocumentCardCleanupSnapshot().jobs[0]!.nextRunAt || Date.now()
      await mod.runNextWebDocumentCardCleanupForTest({now: () => nextRunAt})
    }
    await mod.dismissWebDocumentCardCleanup(result.jobId!)
    expect(mod.getWebDocumentCardCleanupSnapshot().jobs).toHaveLength(1)
    expect(mod.getWebDocumentCardCleanupSnapshot().jobs[0]).toMatchObject({
      state: 'dismissed',
      dismissedAt: Date.now(),
      lastError: 'offline',
      attempts: 4,
    })
    await mod.clearDismissedWebDocumentCardCleanup()
    expect(mod.getWebDocumentCardCleanupSnapshot().jobs).toEqual([])
  })
  it('publishes the parent baseline then rebases its web draft', async () => {
    const parentId = makeId('alice', ['parent'])
    const deletedId = makeId('alice', ['parent', 'child'])
    await putWebDocDraft({
      draftId: 'parent-draft',
      docId: parentId.id,
      signingAccountId: 'alice',
      content: [paragraph('before'), embed('card', deletedId.id, [paragraph('nested')]), paragraph('after')],
      metadata: {name: 'Parent'},
      deps: ['parent-version'],
      baseBlocks: [paragraph('before'), embed('card', deletedId.id, [paragraph('nested')]), paragraph('after')],
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: 'alice',
      editPath: ['parent'],
      cursorPosition: 5,
    })

    const base = makeDocument(parentId, [
      paragraph('before'),
      embed('card', deletedId.id, [paragraph('nested')]),
      paragraph('after'),
    ])
    const published = {
      ...makeDocument(parentId, [paragraph('before'), paragraph('nested'), paragraph('after')]),
      version: 'new-version',
    }
    const client = {
      request: vi
        .fn()
        .mockResolvedValueOnce({type: 'document', document: base})
        .mockResolvedValue({type: 'document', document: published}),
      publishDocument: vi.fn(),
    }
    const mod = await import('./web-document-card-cleanup')

    await mod.enqueueWebDocumentCardCleanup({deletedDocumentId: deletedId.id, signingAccountUid: 'alice'}, {
      client,
    } as any)
    await mod.runNextWebDocumentCardCleanupForTest({now: () => 1_000})

    expect(mod.getWebDocumentCardCleanupSnapshot().jobs[0]?.lastError).toBeUndefined()
    const draft = await getWebDocDraft('parent-draft')
    expect(draft?.content.map((node) => node.block.id)).toEqual(['before', 'nested', 'after'])
    expect(client.request).toHaveBeenCalledTimes(2)
    expect(client.publishDocument).toHaveBeenCalledOnce()
    expect(draft?.deps).toEqual(['new-version'])
    expect(draft?.baseBlocks).toEqual(published.content)
    expect(mod.getWebDocumentCardCleanupSnapshotForTest().jobs[0]).toMatchObject({
      state: 'done',
      publishedVersion: 'new-version',
    })
  })

  it('publishes an add against the published parent before reapplying it to an existing draft', async () => {
    const parentId = makeId('alice', ['add-parent'])
    const childId = makeId('alice', ['add-parent', 'child'])
    await putWebDocDraft({
      draftId: 'parent-draft-add',
      docId: parentId.id,
      signingAccountId: 'alice',
      content: [paragraph('published'), paragraph('unpublished-text')],
      baseBlocks: [paragraph('published')],
      mineTouchedIds: ['unpublished-text'],
      metadata: {name: 'Parent draft'},
      deps: ['parent-version'],
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: 'alice',
      editPath: ['add-parent'],
      cursorPosition: 5,
    })
    let publishedCard: HMBlockNode | null = null
    const client = {
      request: vi.fn(async () => ({
        type: 'document',
        document: {
          ...makeDocument(parentId, [paragraph('published'), ...(publishedCard ? [publishedCard] : [])]),
          version: publishedCard ? 'included-version' : 'parent-version',
        },
      })),
      publishDocument: vi.fn(async (input: any) => {
        const block = input.changes.find((change: any) => change.op.case === 'replaceBlock')?.op.value
        publishedCard = block ? ({block, children: []} as any) : null
      }),
    }
    const mod = await import('./web-document-card-cleanup')

    await mod.enqueueWebDocumentCardCleanup(
      {operation: 'add', parentDocumentId: parentId.id, targetDocumentId: childId.id, signingAccountUid: 'alice'},
      {client} as any,
    )
    await mod.runNextWebDocumentCardCleanupForTest({now: () => 1_000})

    expect(client.publishDocument).toHaveBeenCalledTimes(1)
    const publishedBlockId = (client.publishDocument.mock.calls[0] as any)[0].changes[0].op.value.blockId
    const draft = await getWebDocDraft('parent-draft-add')
    expect(draft?.content.map((node) => node.block.id)).toEqual(['published', publishedBlockId, 'unpublished-text'])
    expect(draft?.content[1]?.block).toMatchObject({type: 'Embed', link: childId.id})
    expect(draft?.deps).toEqual(['included-version'])
    expect(draft?.baseBlocks?.map((node) => node.block.id)).toEqual(['published', publishedBlockId])
    expect(mod.getWebDocumentCardCleanupSnapshotForTest().jobs[0]).toMatchObject({
      state: 'done',
      publishedVersion: 'included-version',
      cardBlockId: publishedBlockId,
    })
  })

  it('includes a child even when an unrelated web link cannot be resolved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    )
    const parentId = makeId('alice', ['external-link-parent'])
    const childId = makeId('alice', ['external-link-parent', 'child'])
    let publishedCard: HMBlockNode | null = null
    const externalLink = embed('external', 'https://example.invalid/document')
    const client = {
      request: vi.fn(async () => ({
        type: 'document',
        document: {
          ...makeDocument(parentId, [externalLink, ...(publishedCard ? [publishedCard] : [])]),
          version: publishedCard ? 'included-version' : 'parent-version',
        },
      })),
      publishDocument: vi.fn(async (input: any) => {
        const block = input.changes.find((change: any) => change.op.case === 'replaceBlock')?.op.value
        publishedCard = block ? ({block, children: []} as HMBlockNode) : null
      }),
    }
    const mod = await import('./web-document-card-cleanup')

    await mod.enqueueWebDocumentCardCleanup(
      {operation: 'add', parentDocumentId: parentId.id, targetDocumentId: childId.id, signingAccountUid: 'alice'},
      {client} as any,
    )
    await mod.runNextWebDocumentCardCleanupForTest({now: () => 1_000})

    expect(client.publishDocument).toHaveBeenCalledOnce()
    expect(mod.getWebDocumentCardCleanupSnapshotForTest().jobs[0]).toMatchObject({state: 'done'})
  })

  it('publishes planned changes when the parent has no web draft', async () => {
    const parentId = makeId('bob', ['parent'])
    const deletedId = makeId('bob', ['parent', 'child'])
    const client = {
      request: vi.fn(async () => ({
        type: 'document',
        document: makeDocument(parentId, [
          paragraph('before'),
          embed('card', `${deletedId.id}#block`, [paragraph('nested')]),
          paragraph('after'),
        ]),
      })),
      publishDocument: vi.fn(async () => {
        client.request.mockResolvedValue({
          type: 'document',
          document: {
            ...makeDocument(parentId, [paragraph('before'), paragraph('nested'), paragraph('after')]),
            version: 'new-version',
          },
        })
      }),
    }
    const mod = await import('./web-document-card-cleanup')

    await mod.enqueueWebDocumentCardCleanup({deletedDocumentId: deletedId.id, signingAccountUid: 'bob'}, {
      client,
    } as any)
    await mod.runNextWebDocumentCardCleanupForTest({now: () => 1_000})

    expect(client.publishDocument).toHaveBeenCalledTimes(1)
    const publishInput = (client.publishDocument.mock.calls[0] as any[] | undefined)?.[0]
    expect(publishInput).toMatchObject({
      account: 'bob',
      signerAccountUid: 'bob',
      path: '/parent',
      baseVersion: 'parent-version',
      genesis: 'parent-genesis',
      capability: undefined,
    })
    const changes = publishInput.changes
    expect(changes.map((change: any) => change.op.case)).toEqual(['moveBlock', 'deleteBlock'])
    expect(mod.getWebDocumentCardCleanupSnapshotForTest().jobs[0]?.state).toBe('done')
  })

  it('refreshes inactive parent and draft queries before returning from a child', async () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {refetchOnMount: false, staleTime: Infinity}}})
    const {registerQueryClient} = await import('@shm/shared/models/query-client')
    registerQueryClient(queryClient)
    const parentId = makeId('alice', ['inactive-parent'])
    const childId = makeId('alice', ['inactive-parent', 'child'])
    const base = makeDocument(parentId, [paragraph('text')])
    const published = {...base, version: 'new-version', content: [...base.content!, embed('card', childId.id)]}
    await putWebDocDraft({
      draftId: 'inactive-parent-draft',
      docId: parentId.id,
      signingAccountId: 'alice',
      content: base.content!,
      metadata: {},
      deps: [base.version],
      baseBlocks: base.content,
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: 'alice',
      editPath: ['inactive-parent'],
      cursorPosition: null,
    })
    let current = base
    const entityKey = [queryKeys.ENTITY, parentId.id, undefined, false]
    const draftKey = ['web-doc-draft', parentId.id, 'alice', null]
    await queryClient.fetchQuery({queryKey: entityKey, queryFn: async () => current})
    await queryClient.fetchQuery({queryKey: draftKey, queryFn: () => getWebDocDraft('inactive-parent-draft')})
    const mod = await import('./web-document-card-cleanup')
    await mod.enqueueWebDocumentCardCleanup(
      {
        operation: 'add',
        parentDocumentId: parentId.id,
        targetDocumentId: childId.id,
        signingAccountUid: 'alice',
      },
      {
        client: {
          request: vi.fn(async () => ({type: 'document', document: current})),
          publishDocument: vi.fn(async () => {
            current = published
          }),
        },
      } as any,
    )
    await mod.runNextWebDocumentCardCleanupForTest()
    expect(mod.getWebDocumentCardCleanupSnapshot().jobs[0]?.state).toBe('done')
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(entityKey)).toEqual(published)
      const restoredDraft = queryClient.getQueryData<any>(draftKey)
      expect(restoredDraft?.deps).toEqual(['new-version'])
      expect(restoredDraft?.baseBlocks).toEqual(published.content)
      expect(restoredDraft?.content).toEqual(published.content)
    })
    queryClient.clear()
  })

  it('invalidates published cache instead of inventing an unverified version', async () => {
    const queryClient = new QueryClient()
    const {registerQueryClient} = await import('@shm/shared/models/query-client')
    registerQueryClient(queryClient)
    const parentId = makeId('bob', ['parent'])
    const deletedId = makeId('bob', ['parent', 'child'])
    const parentDocument = makeDocument(parentId, [
      paragraph('before'),
      embed('card', deletedId.id, [paragraph('nested')]),
      paragraph('after'),
    ])
    queryClient.setQueryData([queryKeys.ENTITY, parentId.id, undefined, false], {
      type: 'document',
      id: parentId,
      document: parentDocument,
    })
    const client = {
      request: vi.fn(async () => ({
        type: 'document',
        id: parentId,
        document: parentDocument,
      })),
      publishDocument: vi.fn(async () => undefined),
    }
    const mod = await import('./web-document-card-cleanup')

    await mod.enqueueWebDocumentCardCleanup({deletedDocumentId: deletedId.id, signingAccountUid: 'bob'}, {
      client,
    } as any)
    await mod.runNextWebDocumentCardCleanupForTest({now: () => 1_000})

    const cached = queryClient.getQueryData<any>([queryKeys.ENTITY, parentId.id, undefined, false])
    expect(cached.document).toEqual(parentDocument)
    expect(queryClient.getQueryState([queryKeys.ENTITY, parentId.id, undefined, false])?.isInvalidated).toBe(true)
    expect(mod.getWebDocumentCardCleanupSnapshot().jobs[0]?.state).toBe('retryScheduled')
  })
})
