import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {CID} from 'multiformats/cid'
import {describe, expect, it, vi} from 'vitest'
import {createDocumentUpdateBlobs} from './apps'
import type {DocumentOperation} from './change'
import type {HMSigner} from './hm-types'
import {HMPrepareDocumentChangeInputSchema, unpackHmId} from './hm-types'
import {
  documentOperationsToChanges,
  isEmptyPreparedChange,
  nativeBlockToProtoBlock,
  prepareDocumentUpdateBlobs,
  withoutLeadingMovesInPlace,
} from './prepare-change'

const ACCOUNT = 'z6MksV3sM8YJxFqv8kV4m4wQdD4sP2wJvB8c2kHh9Qx7LmNo'
const GENESIS = 'bafyreia3vk25z2f7st52fqteo2lrj4wari4x3pvd4baglayl22fftvrxse'
const HEAD = 'bafyreihlnsrncs74ilkjhpl5zbhiyix5rip2kntvkca72gsxr2pspms3sm'
const CAPABILITY = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'

function makeSigner(): HMSigner {
  return {
    getPublicKey: async () => new Uint8Array(base58btc.decode(ACCOUNT)),
    sign: vi.fn(async () => new Uint8Array(64).fill(7)),
  }
}

/** An unsigned Change as the daemon's PrepareChange returns it. */
function unsignedChange(ops: unknown[], ts = 1_700_000_000_000): Uint8Array {
  return cborEncode({
    type: 'Change',
    body: ops.length ? {ops, opCount: ops.length} : {},
    genesis: CID.parse(GENESIS),
    deps: [CID.parse(HEAD)],
    depth: 2,
    signer: null,
    ts,
    sig: null,
  })
}

describe('documentOperationsToChanges', () => {
  it('turns MoveBlocks into a chain of moves from the start of the parent', () => {
    expect(documentOperationsToChanges([{type: 'MoveBlocks', blocks: ['a', 'b', 'c'], parent: 'p'}])).toEqual([
      {op: {case: 'moveBlock', value: {blockId: 'a', parent: 'p', leftSibling: ''}}},
      {op: {case: 'moveBlock', value: {blockId: 'b', parent: 'p', leftSibling: 'a'}}},
      {op: {case: 'moveBlock', value: {blockId: 'c', parent: 'p', leftSibling: 'b'}}},
    ])
  })

  it('places a block listed twice in a row once, and keeps a later repeat as a move', () => {
    expect(documentOperationsToChanges([{type: 'MoveBlocks', blocks: ['a', 'a', 'b', 'a'], parent: ''}])).toEqual([
      {op: {case: 'moveBlock', value: {blockId: 'a', parent: '', leftSibling: ''}}},
      {op: {case: 'moveBlock', value: {blockId: 'b', parent: '', leftSibling: 'a'}}},
      {op: {case: 'moveBlock', value: {blockId: 'a', parent: '', leftSibling: 'b'}}},
    ])
    expect(documentOperationsToChanges([{type: 'MoveBlocks', blocks: [], parent: ''}])).toEqual([])
  })

  it('turns DeleteBlocks into one deleteBlock per block, in order with the other ops', () => {
    expect(
      documentOperationsToChanges([
        {type: 'ReplaceBlock', block: {id: 'n', type: 'Paragraph', text: 'new'}},
        {type: 'MoveBlocks', blocks: ['n'], parent: ''},
        {type: 'DeleteBlocks', blocks: ['x', 'y']},
      ]),
    ).toEqual([
      {op: {case: 'replaceBlock', value: {id: 'n', type: 'Paragraph', text: 'new'}}},
      {op: {case: 'moveBlock', value: {blockId: 'n', parent: '', leftSibling: ''}}},
      {op: {case: 'deleteBlock', value: 'x'}},
      {op: {case: 'deleteBlock', value: 'y'}},
    ])
  })

  it('maps every attribute value the daemon stores', () => {
    const changes = documentOperationsToChanges([
      {
        type: 'SetAttributes',
        attrs: [
          {key: ['name'], value: 'Title'},
          {key: ['theme', 'headerLayout'], value: 'Center'},
          {key: ['count'], value: 5},
          {key: ['published'], value: false},
          {key: ['cleared'], value: null},
        ],
      },
    ])
    expect(changes).toEqual([
      {op: {case: 'setMetadata', value: {key: 'name', value: 'Title'}}},
      {
        op: {
          case: 'setAttribute',
          value: {blockId: '', key: ['theme', 'headerLayout'], value: {case: 'stringValue', value: 'Center'}},
        },
      },
      {op: {case: 'setAttribute', value: {blockId: '', key: ['count'], value: {case: 'intValue', value: 5n}}}},
      {op: {case: 'setAttribute', value: {blockId: '', key: ['published'], value: {case: 'boolValue', value: false}}}},
      {op: {case: 'setAttribute', value: {blockId: '', key: ['cleared'], value: {case: 'nullValue', value: {}}}}},
    ])
    // What the converter emits is what the request schema accepts, unchanged.
    expect(HMPrepareDocumentChangeInputSchema.parse({account: ACCOUNT, changes}).changes).toEqual(changes)
  })

  it('refuses attribute values the daemon cannot store instead of changing them', () => {
    const set = (key: string[], value: unknown) =>
      documentOperationsToChanges([{type: 'SetAttributes', attrs: [{key, value}]} as DocumentOperation])
    expect(() => set(['ratio'], 1.5)).toThrow(/whole number/)
    expect(() => set(['big'], 2 ** 60)).toThrow(/whole number/)
    expect(() => set(['tags'], ['a'])).toThrow(/list value/)
    expect(() => set(['obj'], {a: 1})).toThrow(/object value/)
    expect(() => set([], 'x')).toThrow(/needs a key/)
    expect(() => set(['a.b'], 'x')).toThrow(/without dots/)
    expect(() => set([''], 'x')).toThrow(/non-empty/)
  })

  it('refuses an op it does not know', () => {
    expect(() => documentOperationsToChanges([{type: 'SetKey'} as unknown as DocumentOperation])).toThrow(/SetKey/)
  })
})

describe('withoutLeadingMovesInPlace', () => {
  const node = (id: string, children: unknown[] = []) => ({block: {id}, children})
  const content = [node('a'), node('b', [node('b1'), node('b2')]), node('c')]
  const move = (blockId: string, parent: string, leftSibling: string) => ({
    op: {case: 'moveBlock' as const, value: {blockId, parent, leftSibling}},
  })
  const moves = (blocks: string[], parent = '') => documentOperationsToChanges([{type: 'MoveBlocks', blocks, parent}])

  it('removes the moves of the leading blocks that are where the document has them', () => {
    // A block inserted after the first one: the first block is not re-placed, and the new block
    // is anchored on it.
    expect(withoutLeadingMovesInPlace(moves(['a', 'new', 'b', 'c']), content)).toEqual([
      move('new', '', 'a'),
      move('b', '', 'new'),
      move('c', '', 'b'),
    ])
    // A block appended: only its own move is left.
    expect(withoutLeadingMovesInPlace(moves(['a', 'b', 'c', 'new']), content)).toEqual([move('new', '', 'c')])
    // A level re-listed unchanged leaves nothing.
    expect(withoutLeadingMovesInPlace(moves(['b1', 'b2'], 'b'), content)).toEqual([])
  })

  it('keeps every move from the first one that differs', () => {
    // `c` is where it was relative to `b`, but `b` is not: nothing after the break is removed.
    expect(withoutLeadingMovesInPlace(moves(['b', 'a', 'c']), content)).toEqual(moves(['b', 'a', 'c']))
    expect(withoutLeadingMovesInPlace(moves(['a', 'c', 'b']), content)).toEqual([
      move('c', '', 'a'),
      move('b', '', 'c'),
    ])
    // A block that changes parent is a move, even to the same left sibling.
    expect(withoutLeadingMovesInPlace(moves(['b1'], ''), content)).toEqual([move('b1', '', '')])
  })

  it('leaves a move alone when it does not start a chain or its parent was already written to', () => {
    // An anchored move with no chain before it says where the block goes; it is kept as written.
    expect(withoutLeadingMovesInPlace([move('b', '', 'a')], content)).toEqual([move('b', '', 'a')])
    // Something was placed at the start of the level first, so "a at the start" is now a real move.
    const changes = [move('new', '', ''), move('a', '', '')]
    expect(withoutLeadingMovesInPlace(changes, content)).toEqual(changes)
  })

  it('keeps other changes in place and needs a document to compare with', () => {
    const changes = [
      {op: {case: 'replaceBlock' as const, value: {id: 'a', type: 'Paragraph', text: 'A'}}},
      ...moves(['a', 'b', 'c']),
      {op: {case: 'deleteBlock' as const, value: 'b1'}},
    ]
    expect(withoutLeadingMovesInPlace(changes, content)).toEqual([changes[0], changes[4]])
    expect(withoutLeadingMovesInPlace(changes, undefined)).toEqual(changes)
    expect(withoutLeadingMovesInPlace(changes, [])).toEqual(changes)
  })
})

describe('nativeBlockToProtoBlock', () => {
  it('moves inline attributes into the attributes map and keeps content fields', () => {
    expect(
      nativeBlockToProtoBlock({
        id: 'b1',
        type: 'Paragraph',
        text: 'hello world',
        link: '',
        childrenType: 'Ordered',
        width: 300,
        ratio: 1.5,
        isHeader: true,
        nothing: null,
        query: {
          includes: [{space: 'a', path: 'b', mode: 'Children'}],
          limit: 10,
          sort: [{term: 'Path', reverse: false}],
        },
        annotations: [
          {type: 'Bold', starts: [0], ends: [5]},
          {type: 'Link', link: 'https://example.com', starts: [6], ends: [11]},
        ],
      }),
    ).toEqual({
      id: 'b1',
      type: 'Paragraph',
      text: 'hello world',
      attributes: {
        childrenType: 'Ordered',
        width: 300,
        ratio: 1.5,
        isHeader: true,
        nothing: null,
        query: {
          includes: [{space: 'a', path: 'b', mode: 'Children'}],
          limit: 10,
          sort: [{term: 'Path', reverse: false}],
        },
      },
      annotations: [
        {type: 'Bold', starts: [0], ends: [5]},
        {type: 'Link', link: 'https://example.com', starts: [6], ends: [11]},
      ],
    })
  })

  it('reads the older nested attributes form the same way, for blocks and annotations', () => {
    expect(
      nativeBlockToProtoBlock({
        iD: 'old',
        type: 'Embed',
        link: 'hm://abc',
        attributes: {view: 'Card'},
        revision: 'bafyrevision',
        annotations: [{type: 'Embed', link: 'hm://x', attributes: {style: 'inline'}, starts: [0], ends: [1]}],
      }),
    ).toEqual({
      id: 'old',
      type: 'Embed',
      link: 'hm://abc',
      attributes: {view: 'Card'},
      annotations: [{type: 'Embed', link: 'hm://x', attributes: {style: 'inline'}, starts: [0], ends: [1]}],
    })
    expect(nativeBlockToProtoBlock({id: 'a', type: 'Paragraph', attributes: {}, childrenType: 'Group'})).toEqual({
      id: 'a',
      type: 'Paragraph',
      attributes: {childrenType: 'Group'},
    })
  })

  it('leaves out empty text, link, attributes and annotations, as the stored block does', () => {
    expect(nativeBlockToProtoBlock({id: 'e', type: 'Paragraph', text: '', annotations: [], attributes: {}})).toEqual({
      id: 'e',
      type: 'Paragraph',
    })
  })

  it('refuses a block with attributes in both forms', () => {
    expect(() =>
      nativeBlockToProtoBlock({id: 'x', type: 'Embed', view: 'Card', attributes: {view: 'Content'}}),
    ).toThrow(/both an "attributes" map and attributes beside it \(view\)/)
  })

  it('refuses anything that is not plain JSON, a protobuf Struct in particular', () => {
    class Struct {
      fields = {view: {kind: {case: 'stringValue', value: 'Card'}}}
      toJson() {
        return {view: 'Card'}
      }
    }
    expect(() => nativeBlockToProtoBlock({id: 'x', type: 'Embed', attributes: new Struct()})).toThrow(/not plain JSON/)
    expect(() => nativeBlockToProtoBlock({id: 'x', type: 'Image', data: new Uint8Array([1])})).toThrow(/not plain JSON/)
    expect(() => nativeBlockToProtoBlock({id: 'x', type: 'Image', when: new Date(0)})).toThrow(/not plain JSON/)
    expect(() => nativeBlockToProtoBlock({id: 'x', type: 'Image', width: NaN})).toThrow(/cannot hold/)
    expect(() => nativeBlockToProtoBlock({id: 'x', type: 'Image', nested: {fn: () => 1}})).toThrow(/x: nested\.fn/)
  })

  it('refuses a block without an id or with malformed fields', () => {
    expect(() => nativeBlockToProtoBlock({type: 'Paragraph'})).toThrow(/needs an id/)
    expect(() => nativeBlockToProtoBlock(null)).toThrow(/must be an object/)
    expect(() => nativeBlockToProtoBlock({id: 'x', text: 5})).toThrow(/text must be a string/)
    expect(() => nativeBlockToProtoBlock({id: 'x', annotations: [{starts: [0], ends: [1]}]})).toThrow(/needs a type/)
    expect(() => nativeBlockToProtoBlock({id: 'x', annotations: [{type: 'Bold', starts: [0], ends: []}]})).toThrow(
      /same length/,
    )
    expect(() => nativeBlockToProtoBlock({id: 'x', annotations: [{type: 'Bold', starts: [0.5], ends: [1]}]})).toThrow(
      /whole, non-negative/,
    )
  })

  it('drops undefined values, which CBOR cannot carry', () => {
    expect(nativeBlockToProtoBlock({id: 'u', type: 'Code', language: undefined, link: undefined})).toEqual({
      id: 'u',
      type: 'Code',
    })
  })
})

describe('isEmptyPreparedChange', () => {
  it('tells a Change with no operations from one with some', () => {
    expect(isEmptyPreparedChange(unsignedChange([]))).toBe(true)
    expect(isEmptyPreparedChange(cborEncode({type: 'Change', body: {ops: [], opCount: 0}, ts: 1}))).toBe(true)
    expect(isEmptyPreparedChange(cborEncode({type: 'Change', ts: 1}))).toBe(true)
    expect(isEmptyPreparedChange(unsignedChange([{type: 'DeleteBlocks', blocks: ['a']}]))).toBe(false)
  })
})

describe('prepareDocumentUpdateBlobs', () => {
  const ops: DocumentOperation[] = [
    {type: 'ReplaceBlock', block: {id: 'b1', type: 'Paragraph', text: 'Hi', annotations: []}},
    {type: 'MoveBlocks', blocks: ['b1'], parent: ''},
  ]

  it('prepares on the daemon, signs, and returns the Change and Ref blobs without publishing', async () => {
    const request = vi.fn(async (_key: string, _input: unknown) => ({
      unsignedChange: unsignedChange([{type: 'MoveBlocks', blocks: ['b1']}], 1234),
    }))
    const result = await prepareDocumentUpdateBlobs({
      client: {request} as any,
      signer: makeSigner(),
      account: ACCOUNT,
      path: '/notes/first',
      baseVersion: HEAD,
      ops,
      capability: CAPABILITY,
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('PrepareDocumentChange', {
      account: ACCOUNT,
      path: '/notes/first',
      baseVersion: HEAD,
      changes: documentOperationsToChanges(ops),
      capability: CAPABILITY,
      visibility: undefined,
    })
    if (!result.changed) throw new Error('expected a change')
    expect(result.blobs).toHaveLength(2)
    expect(result.blobs[0]!.cid).toBe(result.version)
    expect(result.genesis).toBe(GENESIS)
    expect(result.generation).toBe(1234)
    const change = cborDecode(result.blobs[0]!.data) as Record<string, any>
    expect(change.body.ops).toEqual([{type: 'MoveBlocks', blocks: ['b1']}])
    expect(change.sig).toEqual(new Uint8Array(64).fill(7))
    const ref = cborDecode(result.blobs[1]!.data) as Record<string, any>
    expect(ref.type).toBe('Ref')
    expect(ref.path).toBe('/notes/first')
    expect(String(ref.heads[0])).toBe(result.version)
    expect(String(ref.genesisBlob)).toBe(GENESIS)
    expect(ref.generation).toBe(1234)
    expect(String(ref.capability)).toBe(CAPABILITY)
  })

  it('reports no change, and signs nothing, when the daemon leaves no operations', async () => {
    const signer = makeSigner()
    const request = vi.fn(async () => ({unsignedChange: unsignedChange([])}))
    const result = await prepareDocumentUpdateBlobs({
      client: {request} as any,
      signer,
      account: ACCOUNT,
      path: '/notes/first',
      baseVersion: HEAD,
      ops,
    })
    expect(result).toEqual({changed: false, blobs: [], version: HEAD})
    expect(signer.sign).not.toHaveBeenCalled()
  })

  it('reports no change for an empty list of ops without asking the daemon', async () => {
    const request = vi.fn()
    const result = await prepareDocumentUpdateBlobs({
      client: {request} as any,
      signer: makeSigner(),
      account: ACCOUNT,
      baseVersion: HEAD,
      ops: [],
    })
    expect(result).toEqual({changed: false, blobs: [], version: HEAD})
    expect(request).not.toHaveBeenCalled()
  })

  it('takes changes already in the request form', async () => {
    const request = vi.fn(async (_key: string, _input: any) => ({unsignedChange: unsignedChange([{type: 'x'}])}))
    const changes = [{op: {case: 'moveBlock' as const, value: {blockId: 'n', parent: '', leftSibling: 'last'}}}]
    await prepareDocumentUpdateBlobs({
      client: {request} as any,
      signer: makeSigner(),
      account: ACCOUNT,
      baseVersion: HEAD,
      changes,
    })
    expect(request.mock.calls[0]![1].changes).toBe(changes)
    expect(request.mock.calls[0]![1].path).toBe('')
  })

  it('uses the given generation as it is, and never goes below the current one otherwise', async () => {
    const request = vi.fn(async () => ({unsignedChange: unsignedChange([{type: 'x'}], 1000)}))
    const base = {client: {request} as any, signer: makeSigner(), account: ACCOUNT, baseVersion: HEAD, ops}
    const generationOf = async (extra: object) => {
      const result = await prepareDocumentUpdateBlobs({...base, ...extra})
      return result.changed ? result.generation : null
    }
    expect(await generationOf({})).toBe(1000) // the Change's timestamp
    expect(await generationOf({currentGeneration: 500n})).toBe(1000)
    expect(await generationOf({currentGeneration: '2000'})).toBe(2000) // a writer whose clock ran ahead
    expect(await generationOf({generation: 7, currentGeneration: 2000})).toBe(7)
  })

  it('requires a base version and one source of changes', async () => {
    const base = {client: {request: vi.fn()} as any, signer: makeSigner(), account: ACCOUNT}
    await expect(prepareDocumentUpdateBlobs({...base, baseVersion: '', ops})).rejects.toThrow(/baseVersion is required/)
    await expect(prepareDocumentUpdateBlobs({...base, baseVersion: HEAD, ops, changes: []})).rejects.toThrow(
      /either ops or changes/,
    )
  })
})

describe('createDocumentUpdateBlobs', () => {
  const id = unpackHmId(`hm://${ACCOUNT}/apps/weather`)!
  const ops: DocumentOperation[] = [{type: 'MoveBlocks', blocks: ['b1'], parent: ''}]
  const extraBlobs = [{cid: 'bafyextra', data: new Uint8Array([1])}]

  function client(prepared: Uint8Array) {
    const request = vi.fn(async (key: string, _input: any) => {
      if (key === 'Resource') {
        return {
          type: 'document',
          document: {version: HEAD, genesis: GENESIS, content: [], generationInfo: {genesis: GENESIS, generation: 5n}},
        }
      }
      if (key === 'ListChanges') {
        return {
          changes: [
            {id: GENESIS, deps: []},
            {id: HEAD, deps: [GENESIS]},
          ],
        }
      }
      if (key === 'PrepareDocumentChange') return {unsignedChange: prepared}
      throw new Error(`unexpected request ${key}`)
    })
    return {request} as any
  }

  it('builds on the current heads through PrepareDocumentChange and appends the extra blobs', async () => {
    const seedClient = client(unsignedChange([{type: 'MoveBlocks', blocks: ['b1']}], 4321))
    const update = await createDocumentUpdateBlobs({client: seedClient, signer: makeSigner(), id, ops, extraBlobs})
    expect(update.changed).toBe(true)
    expect(update.targetId).toEqual(id)
    expect(update.blobs).toHaveLength(3)
    expect(update.blobs[2]).toBe(extraBlobs[0])
    const prepare = seedClient.request.mock.calls.find((call: unknown[]) => call[0] === 'PrepareDocumentChange')
    expect(prepare[1]).toMatchObject({account: ACCOUNT, path: '/apps/weather', baseVersion: HEAD})
    const ref = cborDecode(update.blobs[1]!.data) as Record<string, any>
    expect(ref.generation).toBe(4321) // the Change's timestamp, as before
    expect(String(ref.genesisBlob)).toBe(GENESIS)
  })

  it('returns only the extra blobs when the daemon finds nothing to change', async () => {
    const seedClient = client(unsignedChange([]))
    const update = await createDocumentUpdateBlobs({client: seedClient, signer: makeSigner(), id, ops, extraBlobs})
    expect(update).toEqual({changed: false, blobs: extraBlobs, targetId: id})
    expect((await createDocumentUpdateBlobs({client: seedClient, signer: makeSigner(), id, ops})).blobs).toEqual([])
  })

  it('still refuses an empty list of ops', async () => {
    await expect(
      createDocumentUpdateBlobs({client: client(unsignedChange([])), signer: makeSigner(), id, ops: []}),
    ).rejects.toThrow('No document changes to publish')
  })
})
