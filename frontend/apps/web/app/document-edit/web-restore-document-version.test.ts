import 'fake-indexeddb/auto'
import {indexedDB} from 'fake-indexeddb'
import type {HMBlockNode, HMDocument, HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {restoreWebDocumentVersion} from './web-restore-document-version'
import {_resetWebDocDraftDBForTesting, getWebDocDraft, putWebDocDraft} from './web-draft-db'

vi.mock('@seed-hypermedia/client', async () => {
  const actual = await vi.importActual<typeof import('@seed-hypermedia/client')>('@seed-hypermedia/client')
  return {
    ...actual,
    signDocumentChange: vi.fn(async () => ({
      changeCid: {toString: () => 'restored-version'},
      publishInput: {blobs: []},
    })),
  }
})

const DB_NAME = 'web-doc-drafts-01'

function dropDB(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
  })
}

function id(): UnpackedHypermediaId {
  return {
    uid: 'z1',
    path: ['doc'],
    id: 'hm://z1/doc',
    version: null,
    latest: false,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: 'hm',
  } as UnpackedHypermediaId
}

function node(blockId: string, text: string): HMBlockNode {
  return {block: {id: blockId, type: 'Paragraph', text} as any, children: []}
}

function doc(overrides: Partial<HMDocument>): HMDocument {
  return {
    account: 'z1',
    path: '/doc',
    version: 'latest-version',
    authors: [],
    content: [],
    metadata: {},
    visibility: 'PUBLIC',
    createTime: '',
    updateTime: '',
    genesis: 'genesis',
    generationInfo: {generation: 5n},
    ...overrides,
  } as HMDocument
}

describe('restoreWebDocumentVersion', () => {
  beforeEach(async () => {
    _resetWebDocDraftDBForTesting()
    await dropDB()
    _resetWebDocDraftDBForTesting()
  })

  it('publishes selected content on top of latest and removes the current web draft', async () => {
    const targetId = id()
    await putWebDocDraft({
      draftId: 'draft-1',
      docId: targetId.id,
      signingAccountId: 'z1',
      content: [],
      metadata: {},
      deps: ['latest-version'],
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: 'z1',
      editPath: ['doc'],
      cursorPosition: null,
    })

    const latest = doc({content: [node('a', 'latest'), node('b', 'delete')], metadata: {name: 'Latest'}})
    const selected = doc({version: 'old-version', content: [node('a', 'old')], metadata: {name: 'Old'}})
    const restored = doc({version: 'restored-version', content: selected.content, metadata: selected.metadata})
    const request = vi.fn(async (key: string, input: any) => {
      if (key === 'Resource') {
        return input.version === 'restored-version'
          ? {type: 'document', document: restored, id: targetId}
          : {type: 'document', document: latest, id: targetId}
      }
      if (key === 'PrepareDocumentChange') return {unsignedChange: new Uint8Array([1])}
      throw new Error(`unexpected request ${key}`)
    })
    const publish = vi.fn(async () => ({}))

    const result = await restoreWebDocumentVersion(
      {targetId, selectedVersion: selected, signerAccountUid: 'z1'},
      {
        client: {request, publish} as any,
        getSigner: () => ({getPublicKey: vi.fn(), sign: vi.fn()}) as unknown as HMSigner,
      },
    )

    expect(result.version).toBe('restored-version')
    expect(publish).toHaveBeenCalledTimes(1)
    const prepareCall = request.mock.calls.find(([key]) => key === 'PrepareDocumentChange')
    expect(prepareCall?.[1].baseVersion).toBe('latest-version')
    expect(prepareCall?.[1].changes.map((change: any) => change.op.case)).toEqual([
      'setAttribute',
      'replaceBlock',
      'deleteBlock',
    ])
    await expect(getWebDocDraft('draft-1')).resolves.toBeNull()
  })
})
