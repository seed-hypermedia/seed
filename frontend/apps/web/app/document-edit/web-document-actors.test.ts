import 'fake-indexeddb/auto'
import {indexedDB} from 'fake-indexeddb'
import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import type {HMBlockNode, HMDocument, HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {ResourceVisibility} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import type {PublishInput} from '@shm/shared/models/document-machine'
import type {UniversalClient} from '@shm/shared/universal-client'
import * as Block from 'multiformats/block'
import {sha256} from 'multiformats/hashes/sha2'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {publishWebDocument, type CreateWebDocumentMachineDeps, type WebEditorAccessor} from './web-document-actors'
import {_resetWebDocDraftDBForTesting, putWebDocDraft, getWebDocDraft} from './web-draft-db'

const cborCodec = {
  code: 0x71 as const,
  encode: cborEncode,
  name: 'DAG-CBOR' as const,
}

/** Create a real CID from test data. */
async function makeTestCID(data: unknown) {
  const block = await Block.encode({value: data, codec: cborCodec, hasher: sha256})
  return block.cid
}

const DB_NAME = 'web-doc-drafts-01'

function dropDB(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
  })
}

function makeDocId(uid: string, path: string[] = []): UnpackedHypermediaId {
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

const OWNER = 'z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou'
const ALICE = 'z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH'

function makeBaselineDoc(content: HMBlockNode[] = [], overrides: Partial<HMDocument> = {}): HMDocument {
  return {
    account: OWNER,
    path: '',
    version: 'baseline-version',
    genesis: '',
    generationInfo: {generation: 42n},
    metadata: {},
    content,
    detachedBlocks: {navigation: null} as any,
    visibility: 'PUBLIC',
    ...overrides,
  } as unknown as HMDocument
}

function paragraph(id: string, text: string): HMBlockNode {
  return {
    block: {id, type: 'Paragraph', text} as any,
    children: undefined,
  } as HMBlockNode
}

function makeEditor(blocks: any[]): WebEditorAccessor {
  return {
    getTopLevelBlocks: () => blocks,
  }
}

/** Create a minimal valid unsigned Change CBOR for testing. */
function createTestUnsignedChangeBytes(): Uint8Array {
  return cborEncode({
    type: 'Change',
    signer: null,
    sig: null,
    ts: BigInt(Date.now()),
    body: {opCount: 0, ops: []},
  })
}

type AnyMock = ReturnType<typeof vi.fn>
function makeDeps(overrides: {
  publishDocument?: AnyMock
  request?: AnyMock
  baseline?: HMDocument
  after?: HMDocument
  editorBlocks?: any[]
  capabilityCid?: string
  docId?: UnpackedHypermediaId
}): CreateWebDocumentMachineDeps & {
  publishMock: AnyMock
  requestMock: AnyMock
} {
  const baseline = overrides.baseline ?? makeBaselineDoc([])
  const after = overrides.after ?? makeBaselineDoc([])
  const requestMock: AnyMock =
    overrides.request ??
    (vi.fn(async (key: string) => {
      if (key === 'Resource') {
        return {type: 'document', id: overrides.docId ?? makeDocId(OWNER), document: baseline} as any
      }
      throw new Error(`unexpected request: ${key}`)
    }) as AnyMock)
  // Sequence: first call returns baseline, second returns after-publish.
  let nextResource = baseline
  if (!overrides.request) {
    requestMock.mockImplementation(async (key: string) => {
      if (key === 'PrepareDocumentChange') {
        return {unsignedChange: createTestUnsignedChangeBytes()}
      }
      const doc = nextResource
      nextResource = after
      return {type: 'document', document: doc} as any
    })
  }
  const publishMock: AnyMock = overrides.publishDocument ?? (vi.fn(async () => undefined) as AnyMock)
  const client: UniversalClient = {
    request: requestMock as any,
    publish: vi.fn(async () => ({}) as any) as any,
    publishDocument: publishMock,
  } as UniversalClient

  return {
    docId: overrides.docId ?? makeDocId(OWNER),
    getEditor: () => makeEditor(overrides.editorBlocks ?? []),
    client,
    getSigner: (): HMSigner =>
      ({
        getPublicKey: async () => new Uint8Array([]),
        sign: async () => new Uint8Array([]),
      }) as HMSigner,
    getCapabilityCid: () => overrides.capabilityCid,
    publishMock,
    requestMock,
  }
}

const draftId = 'draft-pub-1'

const baseInput: PublishInput = {
  documentId: makeDocId(OWNER),
  draftId,
  deps: ['old-head'],
  metadata: {},
  navigation: undefined,
  publishAccountUid: OWNER,
  deletedChildDraftIds: [],
}

describe('publishWebDocument', () => {
  beforeEach(async () => {
    _resetWebDocDraftDBForTesting()
    await dropDB()
  })

  afterEach(async () => {
    _resetWebDocDraftDBForTesting()
    await dropDB()
  })

  it('throws when draft missing', async () => {
    const deps = makeDeps({})
    await expect(publishWebDocument(baseInput, deps)).rejects.toThrow(/draft.*not found/)
  })

  it('owner publish: sends single replaceBlock for new paragraph + deletes draft', async () => {
    await putWebDocDraft({
      draftId,
      docId: makeDocId(OWNER).id,
      signingAccountId: OWNER,
      content: [paragraph('b1', 'hello')],
      metadata: {},
      deps: ['old-head'],
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: null,
      editPath: null,
      cursorPosition: null,
    })

    const deps = makeDeps({
      editorBlocks: [
        {
          id: 'b1',
          type: 'paragraph',
          props: {childrenType: 'Group'},
          content: [{type: 'text', text: 'hello'}],
          children: [],
        },
      ],
    })

    const doc = await publishWebDocument(baseInput, deps)
    expect(doc).toBeDefined()

    const prepareCall = deps.requestMock.mock.calls.find((c: any) => c[0] === 'PrepareDocumentChange')!
    const args = prepareCall[1]
    expect(args.account).toBe(OWNER)
    expect(args.baseVersion).toBe('baseline-version')
    expect(args.capability).toBe('')

    const opCases = (args.changes as any[]).map((c) => c.op?.case)
    expect(opCases).toContain('moveBlock')
    expect(opCases).toContain('replaceBlock')

    expect(await getWebDocDraft(draftId)).toBeNull()
  })



  it('publish deletes removed child drafts after successful parent publish', async () => {
    await putWebDocDraft({
      draftId,
      docId: makeDocId(OWNER).id,
      signingAccountId: OWNER,
      content: [paragraph('b1', 'hello')],
      metadata: {},
      deps: ['old-head'],
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: null,
      editPath: null,
      cursorPosition: null,
    })
    await putWebDocDraft({
      draftId: 'child-removed',
      docId: 'hm://child-removed',
      signingAccountId: OWNER,
      content: [],
      metadata: {},
      deps: [],
      navigation: null,
      locationUid: OWNER,
      locationPath: ['doc'],
      editUid: OWNER,
      editPath: ['doc', '-child-removed'],
      cursorPosition: null,
    })

    const deps = makeDeps({})
    await publishWebDocument({...baseInput, deletedChildDraftIds: ['child-removed']}, deps)

    expect(await getWebDocDraft(draftId)).toBeNull()
    expect(await getWebDocDraft('child-removed')).toBeNull()
  })

  it('private document publish keeps PrepareDocumentChange and Ref visibility private', async () => {
    const docId = makeDocId(OWNER, ['secret'])
    const genesis = (await makeTestCID({v: 'private-genesis'})).toString()

    await putWebDocDraft({
      draftId,
      docId: docId.id,
      signingAccountId: OWNER,
      content: [paragraph('b1', 'private hello')],
      metadata: {},
      deps: ['old-head'],
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: null,
      editPath: null,
      cursorPosition: null,
    })

    const deps = makeDeps({
      docId,
      baseline: makeBaselineDoc([], {path: '/secret', genesis, visibility: 'PRIVATE'}),
      editorBlocks: [
        {
          id: 'b1',
          type: 'paragraph',
          props: {childrenType: 'Group'},
          content: [{type: 'text', text: 'private hello'}],
          children: [],
        },
      ],
    })

    await publishWebDocument({...baseInput, documentId: docId}, deps)

    const prepareCall = deps.requestMock.mock.calls.find((c: any) => c[0] === 'PrepareDocumentChange')!
    expect(prepareCall[1].visibility).toBe(ResourceVisibility.PRIVATE)

    const publishCall = (deps.client.publish as AnyMock).mock.calls[0]!
    const refData = cborDecode(publishCall[0].blobs[1]!.data) as Record<string, unknown>
    expect(refData.type).toBe('Ref')
    expect(refData.visibility).toBe('Private')
  })

  it('non-owner publish includes capability CID', async () => {
    const capCid = (await makeTestCID({v: 'cap'})).toString()

    await putWebDocDraft({
      draftId,
      docId: makeDocId(OWNER).id,
      signingAccountId: ALICE,
      content: [paragraph('b1', 'hi')],
      metadata: {},
      deps: ['old-head'],
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: null,
      editPath: null,
      cursorPosition: null,
    })

    const deps = makeDeps({
      capabilityCid: capCid,
      editorBlocks: [
        {
          id: 'b1',
          type: 'paragraph',
          props: {childrenType: 'Group'},
          content: [{type: 'text', text: 'hi'}],
          children: [],
        },
      ],
    })

    await publishWebDocument({...baseInput, publishAccountUid: ALICE}, deps)
    const prepareCall = deps.requestMock.mock.calls.find((c: any) => c[0] === 'PrepareDocumentChange')!
    const args = prepareCall[1]
    expect(args.capability).toBe(capCid)
  })

  it('metadata-only change emits setAttribute', async () => {
    await putWebDocDraft({
      draftId,
      docId: makeDocId(OWNER).id,
      signingAccountId: OWNER,
      content: [],
      metadata: {name: 'NewName'},
      deps: ['old-head'],
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: null,
      editPath: null,
      cursorPosition: null,
    })

    const deps = makeDeps({editorBlocks: []})
    await publishWebDocument(baseInput, deps)

    const prepareCall = deps.requestMock.mock.calls.find((c: any) => c[0] === 'PrepareDocumentChange')!
    const args = prepareCall[1]
    const setAttrChanges = (args.changes as any[]).filter((c) => c.op?.case === 'setAttribute')
    expect(setAttrChanges.length).toBeGreaterThanOrEqual(1)
    const nameAttr = setAttrChanges.find((c) => c.op.value.key?.[0] === 'name')
    expect(nameAttr.op.value.value.value).toBe('NewName')
  })

  it('throws when publishDocument unavailable on universal client', async () => {
    await putWebDocDraft({
      draftId,
      docId: makeDocId(OWNER).id,
      signingAccountId: OWNER,
      content: [],
      metadata: {},
      deps: [],
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: null,
      editPath: null,
      cursorPosition: null,
    })

    const deps = makeDeps({})
    ;(deps.client as any).publishDocument = undefined
    await expect(publishWebDocument(baseInput, deps)).rejects.toThrow(/does not provide publishDocument/)
  })
})
