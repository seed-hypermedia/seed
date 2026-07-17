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

import {
  deleteAllDocumentDrafts,
  publishWebDocument,
  resolveWriteDraftContent,
  type CreateWebDocumentMachineDeps,
  type WebEditorAccessor,
} from './web-document-actors'
import {
  _resetWebDocDraftDBForTesting,
  putWebDocDraft,
  getWebDocDraft,
  listWebDocDraftsForDoc,
} from './web-draft-db'

const enqueueWebDocumentCardCleanupMock = vi.hoisted(() => vi.fn(async () => ({enqueued: true})))

vi.mock('./web-document-card-cleanup', () => ({
  enqueueWebDocumentCardCleanup: enqueueWebDocumentCardCleanupMock,
}))

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
    enqueueWebDocumentCardCleanupMock.mockClear()
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

  it('resolves (does not throw) when the daemon has not yet indexed the new version after publish', async () => {
    // Reproduces "the Publish button stays green after publishing on web": the
    // blob publishes fine, but the immediate re-fetch of the new version lags on
    // the remote daemon. The actor must retry and resolve — throwing would send
    // the state machine back to `editing`, leaving the draft staged so the
    // Publish button stays green/visible even though the publish succeeded.
    await putWebDocDraft({
      draftId,
      docId: makeDocId(OWNER).id,
      signingAccountId: OWNER,
      content: [paragraph('b1', 'hello')],
      metadata: {name: 'Edited'},
      deps: ['old-head'],
      navigation: null,
      locationUid: null,
      locationPath: null,
      editUid: null,
      editPath: null,
      cursorPosition: null,
    })

    const baseline = makeBaselineDoc([paragraph('b1', 'hello')])
    const after = makeBaselineDoc([paragraph('b1', 'hello')], {version: 'bafynew', metadata: {name: 'Edited'}})
    let resourceCalls = 0
    const requestMock = vi.fn(async (key: string) => {
      if (key === 'PrepareDocumentChange') return {unsignedChange: createTestUnsignedChangeBytes()}
      if (key === 'Resource') {
        resourceCalls += 1
        // 1: load editDocument. 2: post-publish fetch, not indexed yet. 3+: indexed.
        if (resourceCalls === 1) return {type: 'document', document: baseline} as any
        if (resourceCalls === 2) return {type: 'not-found'} as any
        return {type: 'document', document: after} as any
      }
      throw new Error(`unexpected request: ${key}`)
    }) as AnyMock

    const deps = makeDeps({
      request: requestMock,
      baseline,
      after,
      editorBlocks: [
        {id: 'b1', type: 'paragraph', props: {childrenType: 'Group'}, content: [{type: 'text', text: 'hello'}], children: []},
      ],
    })

    const result = await publishWebDocument(baseInput, deps)
    expect(result.version).toBe('bafynew')
    // It retried past the transient not-found rather than throwing.
    expect(resourceCalls).toBeGreaterThanOrEqual(3)
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
    expect(args.baseVersion).toBe('old-head')
    expect(args.capability).toBe('')

    const opCases = (args.changes as any[]).map((c) => c.op?.case)
    expect(opCases).toContain('moveBlock')
    expect(opCases).toContain('replaceBlock')

    expect(await getWebDocDraft(draftId)).toBeNull()
  })

  it('publish removes stray orphan drafts for the same doc, not just the published one', async () => {
    // Reproduces "after publishing, the Content tab is blank with an active
    // Publish button": an empty orphan draft (e.g. from an earlier autosave
    // race) that the machine no longer tracks must not survive the publish and
    // reload as a blank draft.
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
      draftId: 'empty-orphan',
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

    const deps = makeDeps({
      editorBlocks: [
        {id: 'b1', type: 'paragraph', props: {childrenType: 'Group'}, content: [{type: 'text', text: 'hello'}], children: []},
      ],
    })

    await publishWebDocument(baseInput, deps)

    expect(await getWebDocDraft(draftId)).toBeNull()
    expect(await getWebDocDraft('empty-orphan')).toBeNull()
    expect(await listWebDocDraftsForDoc(makeDocId(OWNER).id)).toEqual([])
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

  it('first-publish public placeholder path is replaced with a slug from the title', async () => {
    const docId = makeDocId(OWNER, [`-${draftId}`])
    const after = makeBaselineDoc([], {path: '/hello-web'})

    await putWebDocDraft({
      draftId,
      docId: docId.id,
      signingAccountId: OWNER,
      content: [paragraph('b1', 'hello')],
      metadata: {name: 'Hello Web'},
      deps: [],
      navigation: null,
      locationUid: OWNER,
      locationPath: [],
      editUid: OWNER,
      editPath: [`-${draftId}`],
      visibility: 'PUBLIC',
      cursorPosition: null,
    })

    let resourceCalls = 0
    const requestMock = vi.fn(async (key: string) => {
      if (key === 'PrepareDocumentChange') {
        return {unsignedChange: createTestUnsignedChangeBytes()}
      }
      if (key === 'Resource') {
        resourceCalls += 1
        return resourceCalls === 1 ? ({type: 'not-found'} as any) : ({type: 'document', document: after} as any)
      }
      throw new Error(`unexpected request: ${key}`)
    }) as AnyMock

    const deps = makeDeps({
      docId,
      request: requestMock,
      after,
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

    await publishWebDocument({...baseInput, documentId: docId}, deps)

    const prepareCall = deps.requestMock.mock.calls.find((c: any) => c[0] === 'PrepareDocumentChange')!
    expect(prepareCall[1].path).toBe('/hello-web')

    const finalResourceCall = deps.requestMock.mock.calls.filter((c: any) => c[0] === 'Resource').at(-1)!
    expect(finalResourceCall[1].path).toEqual(['hello-web'])
  })

  it('first-publish public child document enqueues parent card creation after publish succeeds', async () => {
    const docId = makeDocId(OWNER, ['parent', `-${draftId}`])
    const after = makeBaselineDoc([], {path: '/parent/hello-web'})

    await putWebDocDraft({
      draftId,
      docId: docId.id,
      signingAccountId: OWNER,
      content: [paragraph('b1', 'hello')],
      metadata: {name: 'Hello Web'},
      deps: [],
      navigation: null,
      locationUid: OWNER,
      locationPath: ['parent'],
      editUid: OWNER,
      editPath: ['parent', `-${draftId}`],
      visibility: 'PUBLIC',
      cursorPosition: null,
    })

    let resourceCalls = 0
    const requestMock = vi.fn(async (key: string) => {
      if (key === 'PrepareDocumentChange') {
        return {unsignedChange: createTestUnsignedChangeBytes()}
      }
      if (key === 'Resource') {
        resourceCalls += 1
        return resourceCalls === 1 ? ({type: 'not-found'} as any) : ({type: 'document', document: after} as any)
      }
      throw new Error(`unexpected request: ${key}`)
    }) as AnyMock

    const deps = makeDeps({docId, request: requestMock, after})

    await publishWebDocument({...baseInput, documentId: docId}, deps)

    expect(enqueueWebDocumentCardCleanupMock).toHaveBeenCalledWith(
      {
        operation: 'add',
        parentDocumentId: `hm://${OWNER}/parent`,
        targetDocumentId: `hm://${OWNER}/parent/hello-web`,
        signingAccountUid: OWNER,
        capabilityId: undefined,
      },
      {client: deps.client},
    )
  })

  it('first-publish public child document retargets self query blocks to the published path', async () => {
    const docId = makeDocId(OWNER, ['parent', `-${draftId}`])
    const after = makeBaselineDoc([], {path: '/parent/hello-web'})

    await putWebDocDraft({
      draftId,
      docId: docId.id,
      signingAccountId: OWNER,
      content: [],
      metadata: {name: 'Hello Web'},
      deps: [],
      navigation: null,
      locationUid: OWNER,
      locationPath: ['parent'],
      editUid: OWNER,
      editPath: ['parent', `-${draftId}`],
      visibility: 'PUBLIC',
      cursorPosition: null,
    })

    let resourceCalls = 0
    const requestMock = vi.fn(async (key: string) => {
      if (key === 'PrepareDocumentChange') {
        return {unsignedChange: createTestUnsignedChangeBytes()}
      }
      if (key === 'Resource') {
        resourceCalls += 1
        return resourceCalls === 1 ? ({type: 'not-found'} as any) : ({type: 'document', document: after} as any)
      }
      throw new Error(`unexpected request: ${key}`)
    }) as AnyMock

    const deps = makeDeps({
      docId,
      request: requestMock,
      after,
      editorBlocks: [
        {
          id: 'q1',
          type: 'query',
          props: {
            style: 'Card',
            columnCount: '3',
            queryIncludes: JSON.stringify([{space: OWNER, path: `parent/-${draftId}`, mode: 'Children'}]),
            querySort: '[{"term":"UpdateTime","reverse":false}]',
          },
          content: [],
          children: [],
        },
      ],
    })

    await publishWebDocument({...baseInput, documentId: docId}, deps)

    const prepareCall = deps.requestMock.mock.calls.find((c: any) => c[0] === 'PrepareDocumentChange')!
    const replaceBlock = (prepareCall[1].changes as any[]).find(
      (change) => change.op?.case === 'replaceBlock' && change.op.value.id === 'q1',
    )

    const attrs = replaceBlock.op.value.attributes.toJson()
    expect(attrs.query.includes[0]).toMatchObject({
      space: OWNER,
      path: 'parent/hello-web',
      mode: 'Children',
    })
  })

  it('first-publish private draft keeps generated path and private visibility', async () => {
    const docId = makeDocId(OWNER, ['secret-generated-path'])
    const after = makeBaselineDoc([], {path: '/secret-generated-path', visibility: 'PRIVATE'})

    await putWebDocDraft({
      draftId,
      docId: docId.id,
      signingAccountId: OWNER,
      content: [],
      metadata: {name: 'Secret'},
      deps: [],
      navigation: null,
      locationUid: OWNER,
      locationPath: ['secret-generated-path'],
      editUid: OWNER,
      editPath: ['secret-generated-path'],
      visibility: 'PRIVATE',
      cursorPosition: null,
    })

    let resourceCalls = 0
    const requestMock = vi.fn(async (key: string) => {
      if (key === 'PrepareDocumentChange') {
        return {unsignedChange: createTestUnsignedChangeBytes()}
      }
      if (key === 'Resource') {
        resourceCalls += 1
        return resourceCalls === 1 ? ({type: 'not-found'} as any) : ({type: 'document', document: after} as any)
      }
      throw new Error(`unexpected request: ${key}`)
    }) as AnyMock

    const deps = makeDeps({docId, request: requestMock, after, editorBlocks: []})

    await publishWebDocument({...baseInput, documentId: docId, pathOverride: ['public-slug']}, deps)

    const prepareCall = deps.requestMock.mock.calls.find((c: any) => c[0] === 'PrepareDocumentChange')!
    expect(prepareCall[1].path).toBe('/secret-generated-path')
    expect(prepareCall[1].visibility).toBe(ResourceVisibility.PRIVATE)

    const finalResourceCall = deps.requestMock.mock.calls.filter((c: any) => c[0] === 'Resource').at(-1)!
    expect(finalResourceCall[1].path).toEqual(['secret-generated-path'])
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

  it('non-owner publish falls back to draft capability CID', async () => {
    const capCid = (await makeTestCID({v: 'draft-cap'})).toString()

    await putWebDocDraft({
      draftId,
      docId: makeDocId(OWNER).id,
      signingAccountId: ALICE,
      capabilityCid: capCid,
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
    expect(prepareCall[1].capability).toBe(capCid)
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

describe('resolveWriteDraftContent', () => {
  const editorParagraph = (text: string) => ({
    id: 'b1',
    type: 'paragraph',
    props: {},
    content: [{type: 'text', text, styles: {}}],
    children: [],
  })
  const hmParagraph = (text: string): HMBlockNode =>
    ({
      block: {id: 'b1', type: 'Paragraph', text, annotations: [], attributes: {}},
      children: [],
    }) as unknown as HMBlockNode

  it('uses editor blocks when the content editor has blocks', () => {
    const result = resolveWriteDraftContent([editorParagraph('Body') as any], null, [hmParagraph('Published')])
    expect(result.length).toBe(1)
    expect((result[0] as any).block.text).toBe('Body')
  })

  it('falls back to the published body when no content editor is mounted (attributes-only edit)', () => {
    // Regression: the :attributes view mounts no body editor, so the accessor
    // reports zero blocks. Persisting that empty body blanked the Content tab
    // and wiped content on publish. It must fall back to the published body.
    const published = [hmParagraph('Published body')]
    expect(resolveWriteDraftContent([], null, published)).toBe(published)
    expect(resolveWriteDraftContent(null, null, published)).toBe(published)
  })

  it('prefers the draft existing body over the published body when present', () => {
    const existing = [hmParagraph('Draft body')]
    const published = [hmParagraph('Published body')]
    expect(resolveWriteDraftContent(null, existing, published)).toBe(existing)
  })

  it('returns an empty array only when there is genuinely nothing to preserve', () => {
    expect(resolveWriteDraftContent(null, null, null)).toEqual([])
  })
})

describe('deleteAllDocumentDrafts', () => {
  const DOC = 'hm://acct/foo1'
  const baseDraft = (draftId: string, updatedAt: number) => ({
    draftId,
    docId: DOC,
    signingAccountId: 'acct',
    content: [] as HMBlockNode[],
    metadata: {a: draftId},
    deps: [],
    navigation: null,
    locationUid: null,
    locationPath: null,
    editUid: null,
    editPath: null,
    cursorPosition: null,
    updatedAt,
  })

  beforeEach(async () => {
    _resetWebDocDraftDBForTesting()
    await dropDB()
  })
  afterEach(async () => {
    _resetWebDocDraftDBForTesting()
    await dropDB()
  })

  it('deletes EVERY draft record for the document, not just the tracked one', async () => {
    // Reproduces "discarded changes reappear after refresh": duplicate draft
    // records accumulate for one doc; discarding only the tracked id leaves an
    // orphan that the next load resurrects.
    await putWebDocDraft(baseDraft('orphanA', 1000))
    await putWebDocDraft(baseDraft('orphanB', 2000))

    // Discard the tracked draft (orphanB) — orphanA must also be removed.
    await deleteAllDocumentDrafts(DOC, 'orphanB')

    const remaining = await listWebDocDraftsForDoc(DOC)
    expect(remaining).toEqual([])
    expect(await getWebDocDraft('orphanA')).toBeNull()
    expect(await getWebDocDraft('orphanB')).toBeNull()
  })

  it('does not touch drafts belonging to other documents', async () => {
    await putWebDocDraft(baseDraft('mine', 1000))
    await putWebDocDraft({...baseDraft('other', 1000), docId: 'hm://acct/bar'})

    await deleteAllDocumentDrafts(DOC, 'mine')

    expect(await getWebDocDraft('mine')).toBeNull()
    expect(await getWebDocDraft('other')).not.toBeNull()
  })
})
