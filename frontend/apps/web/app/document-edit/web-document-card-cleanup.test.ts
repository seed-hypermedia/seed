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
  })

  it('removes matching cards from an existing parent web draft before publishing', async () => {
    const parentId = makeId('alice', ['parent'])
    const deletedId = makeId('alice', ['parent', 'child'])
    await putWebDocDraft({
      draftId: 'parent-draft',
      docId: parentId.id,
      signingAccountId: 'alice',
      content: [paragraph('before'), embed('card', deletedId.id, [paragraph('nested')]), paragraph('after')],
      metadata: {name: 'Parent'},
      deps: ['parent-version'],
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: 'alice',
      editPath: ['parent'],
      cursorPosition: 5,
    })

    const client = {
      request: vi.fn(),
      publishDocument: vi.fn(),
    }
    const mod = await import('./web-document-card-cleanup')

    await mod.enqueueWebDocumentCardCleanup({deletedDocumentId: deletedId.id, signingAccountUid: 'alice'}, {
      client,
    } as any)
    await mod.runNextWebDocumentCardCleanupForTest({now: () => 1_000})

    const draft = await getWebDocDraft('parent-draft')
    expect(draft?.content.map((node) => node.block.id)).toEqual(['before', 'nested', 'after'])
    expect(client.request).not.toHaveBeenCalled()
    expect(client.publishDocument).not.toHaveBeenCalled()
    expect(mod.getWebDocumentCardCleanupSnapshotForTest().jobs[0]).toMatchObject({
      state: 'done',
      isDraft: true,
      parentDraftId: 'parent-draft',
    })
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
      publishDocument: vi.fn(async () => undefined),
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

  it('updates the cached published parent content after cleanup publishes', async () => {
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
    expect(cached.document.content.map((node: HMBlockNode) => node.block.id)).toEqual(['before', 'nested', 'after'])
  })
})
