import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {CID} from 'multiformats/cid'
import {describe, expect, it, vi} from 'vitest'
import {createDocumentUpdateBlobs} from './apps'
import type {DocumentOperation} from './change'
import {SeedClientError, SeedNetworkError} from './errors'
import type {HMSigner} from './hm-types'
import {HMPrepareDocumentChangeInputSchema, unpackHmId} from './hm-types'
import {
  documentOperationsToChanges,
  documentUpdateBlobs,
  implausiblePreparedChange,
  isEmptyPreparedChange,
  nativeBlockToProtoBlock,
  clientBuiltDocumentUpdateBlobs,
  preparableDocumentChanges,
  prepareDocumentUpdateBlobs,
  UnpreparableDocumentUpdateError,
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

describe('preparableDocumentChanges', () => {
  const content = (...ids: string[]) => ids.map((id) => ({block: {id}, children: []}))
  const reorder = (blocks: string[], parent = ''): DocumentOperation => ({type: 'MoveBlocks', blocks, parent})
  /** The moves requested, as `block>leftSibling`. */
  const moves = (result: ReturnType<typeof preparableDocumentChanges>) => {
    if ('unpreparable' in result) throw new Error(result.unpreparable)
    return result.changes
      .filter((change) => change.op.case === 'moveBlock')
      .map((change: any) => `${change.op.value.blockId}>${change.op.value.leftSibling}`)
  }

  it('sends a block inserted after the first block as the only move, anchored on it', () => {
    expect(moves(preparableDocumentChanges([reorder(['a', 'x', 'b', 'c'])], content('a', 'b', 'c')))).toEqual(['x>a'])
  })

  it('sends a block appended, and a block put first', () => {
    expect(moves(preparableDocumentChanges([reorder(['a', 'b', 'x'])], content('a', 'b')))).toEqual(['x>b'])
    expect(moves(preparableDocumentChanges([reorder(['x', 'a', 'b'])], content('a', 'b')))).toEqual(['x>'])
  })

  it('sends nothing for a level re-listed as it is', () => {
    expect(moves(preparableDocumentChanges([reorder(['a', 'b', 'c'])], content('a', 'b', 'c')))).toEqual([])
  })

  it('sends one block moved to the end as one move, not a re-listing of the level', () => {
    expect(moves(preparableDocumentChanges([reorder(['a', 'c', 'd', 'b'])], content('a', 'b', 'c', 'd')))).toEqual([
      'b>d',
    ])
    expect(moves(preparableDocumentChanges([reorder(['b', 'c', 'd', 'a'])], content('a', 'b', 'c', 'd')))).toEqual([
      'a>d',
    ])
  })

  it('asks for no move when a deleted block sat between two that stay', () => {
    expect(
      moves(
        preparableDocumentChanges([reorder(['a', 'c']), {type: 'DeleteBlocks', blocks: ['b']}], content('a', 'b', 'c')),
      ),
    ).toEqual([])
  })

  it('puts a partial list at the start, ahead of the blocks it leaves out', () => {
    expect(moves(preparableDocumentChanges([reorder(['x', 'y'])], content('a', 'b')))).toEqual(['x>', 'y>x'])
    // [b, a, c]: either b goes first or a goes behind b; one move either way.
    expect(moves(preparableDocumentChanges([reorder(['b'])], content('a', 'b', 'c')))).toEqual(['a>b'])
    // An empty document: every block is new, placed in order.
    expect(moves(preparableDocumentChanges([reorder(['x', 'y'])], []))).toEqual(['x>', 'y>x'])
    expect(moves(preparableDocumentChanges([reorder(['x', 'y'])], undefined))).toEqual(['x>', 'y>x'])
  })

  it('places a block arriving from another level; the level it left needs nothing', () => {
    const tree = [{block: {id: 'a'}, children: content('k', 'l')}, ...content('b')]
    expect(moves(preparableDocumentChanges([reorder(['l'], 'a'), reorder(['a', 'k', 'b'])], tree))).toEqual(['k>a'])
    // A first child that becomes the first block of the root is a move, to the same (empty) left.
    expect(moves(preparableDocumentChanges([reorder(['k', 'a', 'b'])], tree))).toEqual(['k>'])
  })

  it('reports neighbours that move together, and ops that place something twice, as unpreparable', () => {
    const together = preparableDocumentChanges([reorder(['c', 'd', 'a', 'b'])], content('a', 'b', 'c', 'd'))
    expect('unpreparable' in together && together.unpreparable).toContain('moves together with the block before it')
    const twice = preparableDocumentChanges([reorder(['a']), reorder(['b'])], content('a', 'b'))
    expect('unpreparable' in twice && twice.unpreparable).toContain('twice')
    const listedTwice = preparableDocumentChanges([reorder(['a', 'a'])], content('a', 'b'))
    expect('unpreparable' in listedTwice && listedTwice.unpreparable).toContain('twice')
  })

  it('passes replaces, deletes and attributes through in order', () => {
    const result = preparableDocumentChanges(
      [
        {type: 'SetAttributes', attrs: [{key: ['name'], value: 'Title'}]},
        {type: 'ReplaceBlock', block: {id: 'z', type: 'Paragraph', text: 'Z', annotations: []}},
        {type: 'DeleteBlocks', blocks: ['y']},
      ],
      content('y', 'z'),
    )
    if ('unpreparable' in result) throw new Error(result.unpreparable)
    expect(result.changes.map((change) => change.op.case)).toEqual(['replaceBlock', 'setMetadata', 'deleteBlock'])
  })

  it('sends every replaceBlock before the first moveBlock or deleteBlock', () => {
    // [a, b] to [a[x1], b, P[c]], as a diff writes it: each level's blocks, then the level's order.
    const block = (id: string): DocumentOperation => ({type: 'ReplaceBlock', block: {id, type: 'Paragraph', text: id}})
    const result = preparableDocumentChanges(
      [
        block('x1'),
        reorder(['x1'], 'a'),
        {type: 'DeleteBlocks', blocks: ['gone']},
        block('c'),
        reorder(['c'], 'P'),
        block('P'),
        reorder(['a', 'b', 'P']),
      ],
      content('a', 'gone', 'b'),
    )
    if ('unpreparable' in result) throw new Error(result.unpreparable)
    const cases = result.changes.map((change) => change.op.case)
    const lastReplace = cases.lastIndexOf('replaceBlock')
    const firstTreeChange = cases.findIndex((name) => name === 'moveBlock' || name === 'deleteBlock')
    expect(lastReplace).toBe(2)
    expect(firstTreeChange).toBe(3)
    // The moves keep the order of the ops: they are not sorted parents-first.
    expect(moves(result)).toEqual(['x1>', 'c>', 'P>b'])
  })

  it('reports a block that is both deleted and placed as unpreparable, in either order', () => {
    const del: DocumentOperation = {type: 'DeleteBlocks', blocks: ['b']}
    for (const ops of [
      [del, reorder(['a', 'b', 'c'])],
      [reorder(['a', 'b', 'c']), del],
    ]) {
      const result = preparableDocumentChanges(ops, content('a', 'b', 'c'))
      expect('unpreparable' in result && result.unpreparable).toContain('deletes block b and places it')
    }
  })

  it('reports a block put under one of its own descendants as unpreparable', () => {
    const nested = [{block: {id: 'a'}, children: [{block: {id: 'b'}, children: [{block: {id: 'c'}, children: []}]}]}]
    // A parent and its child swap places: [a[b[c]]] to [b[a], ...].
    const swap = preparableDocumentChanges([reorder(['a'], 'b'), reorder(['b'])], nested)
    expect('unpreparable' in swap && swap.unpreparable).toContain('under a block that is, or was, inside it')
    // The same through a grandchild, and through a new block in between.
    const deep = preparableDocumentChanges([reorder(['c']), reorder(['a'], 'c')], nested)
    expect('unpreparable' in deep).toBe(true)
    const viaNew = preparableDocumentChanges([reorder(['n'], 'c'), reorder(['a'], 'n'), reorder(['b'])], nested)
    expect('unpreparable' in viaNew).toBe(true)
    const self = preparableDocumentChanges([reorder(['a'], 'a')], nested)
    expect('unpreparable' in self).toBe(true)
    // Moving out and sideways is fine: outdent c, then put b under c's old grandparent's sibling.
    expect(moves(preparableDocumentChanges([reorder(['a', 'c'])], nested))).toEqual(['c>a'])
    const sideways = preparableDocumentChanges([reorder(['b'], 'z')], [...nested, {block: {id: 'z'}, children: []}])
    expect(moves(sideways)).toEqual(['b>'])
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
      content: [],
      capability: CAPABILITY,
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      'PrepareDocumentChange',
      {
        account: ACCOUNT,
        path: '/notes/first',
        baseVersion: HEAD,
        changes: documentOperationsToChanges(ops),
        capability: CAPABILITY,
        visibility: undefined,
      },
      {signal: undefined},
    )
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
      content: [],
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
    const base = {client: {request} as any, signer: makeSigner(), account: ACCOUNT, baseVersion: HEAD, ops, content: []}
    const generationOf = async (extra: object) => {
      const result = await prepareDocumentUpdateBlobs({...base, ...extra})
      return result.changed ? result.generation : null
    }
    expect(await generationOf({})).toBe(1000) // the Change's timestamp
    expect(await generationOf({currentGeneration: 500n})).toBe(1000)
    expect(await generationOf({currentGeneration: '2000'})).toBe(2000) // a writer whose clock ran ahead
    expect(await generationOf({generation: 7, currentGeneration: 2000})).toBe(7)
  })

  it('converts ops against the document content, and refuses ops it cannot send safely', async () => {
    const request = vi.fn(async (_key: string, _input: any) => ({unsignedChange: unsignedChange([{type: 'x'}])}))
    const base = {client: {request} as any, signer: makeSigner(), account: ACCOUNT, baseVersion: HEAD}
    const content = ['a', 'b', 'c', 'd'].map((id) => ({block: {id}, children: []}))
    const reorder = (blocks: string[]): DocumentOperation[] => [{type: 'MoveBlocks', blocks, parent: ''}]

    // A block inserted after the first: one move, anchored on the block before it.
    await prepareDocumentUpdateBlobs({...base, ops: reorder(['a', 'x', 'b', 'c', 'd']), content})
    expect(request.mock.calls[0]![1].changes).toEqual([
      {op: {case: 'moveBlock', value: {blockId: 'x', parent: '', leftSibling: 'a'}}},
    ])
    // A level re-listed as it is asks the daemon nothing.
    request.mockClear()
    expect(await prepareDocumentUpdateBlobs({...base, ops: reorder(['a', 'b', 'c', 'd']), content})).toEqual({
      changed: false,
      blobs: [],
      version: HEAD,
    })
    expect(request).not.toHaveBeenCalled()
    // Neighbours moving together: a typed error, and no request.
    await expect(
      prepareDocumentUpdateBlobs({...base, ops: reorder(['c', 'd', 'a', 'b']), content}),
    ).rejects.toBeInstanceOf(UnpreparableDocumentUpdateError)
    // Ops that move blocks cannot be converted without the content.
    await expect(prepareDocumentUpdateBlobs({...base, ops: reorder(['a'])})).rejects.toThrow(/content is required/)
    expect(request).not.toHaveBeenCalled()
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
    expect(update.builtBy).toBe('server')
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

  it('builds a reorder the daemon would misapply here, as listed, with the same result shape', async () => {
    const seedClient = client(unsignedChange([]))
    const document = {
      version: HEAD,
      genesis: GENESIS,
      content: ['a', 'b', 'c', 'd'].map((blockId) => ({block: {id: blockId}, children: []})),
      generationInfo: {genesis: GENESIS, generation: 5n},
    }
    seedClient.request.mockImplementation(async (key: string) => {
      if (key === 'Resource') return {type: 'document', document}
      if (key === 'ListChanges') {
        return {
          changes: [
            {id: GENESIS, deps: []},
            {id: HEAD, deps: [GENESIS]},
          ],
        }
      }
      throw new Error(`unexpected request ${key}`)
    })
    const together: DocumentOperation[] = [{type: 'MoveBlocks', blocks: ['c', 'd', 'a', 'b'], parent: ''}]
    const update = await createDocumentUpdateBlobs({
      client: seedClient,
      signer: makeSigner(),
      id,
      ops: together,
      extraBlobs,
    })
    expect(update.changed).toBe(true)
    expect(update.builtBy).toBe('local')
    expect(update.localReason).toContain('moves together with the block before it')
    expect(update.targetId).toEqual(id)
    expect(update.blobs).toHaveLength(3)
    expect(update.blobs[2]).toBe(extraBlobs[0])
    const change = cborDecode(update.blobs[0]!.data) as Record<string, any>
    expect(change.body.ops).toEqual(together)
    expect(String(change.genesis)).toBe(GENESIS)
    expect(change.deps.map(String)).toEqual([HEAD])
    expect(change.depth).toBe(2)
    const ref = cborDecode(update.blobs[1]!.data) as Record<string, any>
    expect(ref.path).toBe('/apps/weather')
    expect(String(ref.heads[0])).toBe(update.blobs[0]!.cid)
    expect(String(ref.genesisBlob)).toBe(GENESIS)
  })

  it('still refuses an empty list of ops', async () => {
    await expect(
      createDocumentUpdateBlobs({client: client(unsignedChange([])), signer: makeSigner(), id, ops: []}),
    ).rejects.toThrow('No document changes to publish')
  })
})

describe('clientBuiltDocumentUpdateBlobs', () => {
  it('stores the ops as given on the given heads, and keeps the generation floor', async () => {
    const ops: DocumentOperation[] = [{type: 'MoveBlocks', blocks: ['c', 'd', 'a', 'b'], parent: ''}]
    const result = await clientBuiltDocumentUpdateBlobs({
      signer: makeSigner(),
      account: ACCOUNT,
      path: '/notes/first',
      state: {genesis: GENESIS, heads: [HEAD], headDepth: 1},
      ops,
      capability: CAPABILITY,
      currentGeneration: Number.MAX_SAFE_INTEGER,
    })
    expect(result.changed).toBe(true)
    expect(result.genesis).toBe(GENESIS)
    expect(result.generation).toBe(Number.MAX_SAFE_INTEGER)
    expect(result.blobs[0]!.cid).toBe(result.version)
    const change = cborDecode(result.blobs[0]!.data) as Record<string, any>
    expect(change.body.ops).toEqual(ops)
    expect(change.deps.map(String)).toEqual([HEAD])
    expect(change.depth).toBe(2)
    const ref = cborDecode(result.blobs[1]!.data) as Record<string, any>
    expect(ref.path).toBe('/notes/first')
    expect(String(ref.capability)).toBe(CAPABILITY)
    expect(Number(ref.generation)).toBe(Number.MAX_SAFE_INTEGER)

    const unfloored = await clientBuiltDocumentUpdateBlobs({
      signer: makeSigner(),
      account: ACCOUNT,
      state: {genesis: GENESIS, heads: [HEAD], headDepth: 1},
      ops,
    })
    expect(Math.abs(unfloored.generation - Date.now())).toBeLessThan(60_000)
  })

  it('stamps the Change with the clock, or one millisecond after the latest head when the clock is not past it', async () => {
    const ops: DocumentOperation[] = [{type: 'DeleteBlocks', blocks: ['a']}]
    const built = async (now: number, headTs?: number) => {
      const result = await clientBuiltDocumentUpdateBlobs({
        signer: makeSigner(),
        account: ACCOUNT,
        state: {genesis: GENESIS, heads: [HEAD], headDepth: 1, headTs},
        ops,
        now: () => now,
      })
      const change = cborDecode(result.blobs[0]!.data) as Record<string, any>
      expect(Number(change.ts)).toBe(result.ts)
      expect(result.depth).toBe(2)
      return result.ts
    }
    expect(await built(5_000, 3_000)).toBe(5_000) // the clock is ahead of the head
    expect(await built(5_000, 5_000)).toBe(5_001) // equal is not later
    expect(await built(5_000, 7_000)).toBe(7_001) // the clock lags the head (it carries the site's clock)
    expect(await built(5_000)).toBe(5_000) // the head's time is not known
  })
})

describe('implausiblePreparedChange', () => {
  const ops: DocumentOperation[] = [
    {type: 'ReplaceBlock', block: {id: 'x', type: 'Paragraph', text: 'x'}},
    {type: 'ReplaceBlock', block: {id: 'y', type: 'Paragraph', text: 'y'}},
    {type: 'MoveBlocks', blocks: ['x', 'y', 'z'], parent: 'p'},
    {type: 'DeleteBlocks', blocks: ['d']},
  ]
  const changes = documentOperationsToChanges(ops)

  it('accepts a subset of what was asked, however the daemon groups the moves', () => {
    // One MoveBlocks for a run of neighbours, and another for a block placed elsewhere in the level.
    const batched = unsignedChange([
      {type: 'MoveBlocks', blocks: ['x', 'y'], parent: 'p', ref: [1, 2, 3]},
      {type: 'MoveBlocks', blocks: ['z'], parent: 'p', ref: [1, 2, 4]},
      {type: 'DeleteBlocks', blocks: ['d']},
      {type: 'ReplaceBlock', block: {id: 'x', type: 'Paragraph', text: 'x'}},
      {type: 'SetAttributes', attrs: [{key: ['name'], value: 'n'}]},
    ])
    expect(implausiblePreparedChange(batched, changes)).toBeNull()
    expect(implausiblePreparedChange(unsignedChange([]), changes)).toBeNull()
  })

  it('refuses repeated moves, more moves than asked, other blocks replaced or deleted, and an oversized Change', () => {
    const repeated = unsignedChange([
      {type: 'MoveBlocks', blocks: ['x', 'y', 'z'], parent: 'p'},
      {type: 'MoveBlocks', blocks: ['x'], parent: 'p'},
    ])
    expect(implausiblePreparedChange(repeated, changes)).toContain('places block x 2 times, the request once')
    // The daemon may reach the same order by moving a sibling the request left in place.
    const sibling = unsignedChange([{type: 'MoveBlocks', blocks: ['q'], parent: 'p'}])
    expect(implausiblePreparedChange(sibling, changes)).toBeNull()
    const tooMany = unsignedChange([{type: 'MoveBlocks', blocks: ['q', 'r', 's', 't'], parent: 'p'}])
    expect(implausiblePreparedChange(tooMany, changes)).toContain('places blocks 4 times for 3 requested')
    const deletes = unsignedChange([{type: 'DeleteBlocks', blocks: ['x']}])
    expect(implausiblePreparedChange(deletes, changes)).toContain('deletes block x')
    const replaces = unsignedChange([{type: 'ReplaceBlock', block: {id: 'z', type: 'Paragraph'}}])
    expect(implausiblePreparedChange(replaces, changes)).toContain('replaces block z')
    const twice = unsignedChange([
      {type: 'ReplaceBlock', block: {id: 'x', type: 'Paragraph'}},
      {type: 'ReplaceBlock', block: {id: 'x', type: 'Paragraph'}},
      {type: 'ReplaceBlock', block: {id: 'y', type: 'Paragraph'}},
    ])
    expect(implausiblePreparedChange(twice, changes)).toContain('replaces blocks 3 times for 2 requested')
    const small = unsignedChange([{type: 'MoveBlocks', blocks: ['x'], parent: 'p'}])
    expect(implausiblePreparedChange(small, changes, 64)).toContain('bytes, over the 64')
  })
})

describe('documentUpdateBlobs', () => {
  const LATEST = 1_800_000_000_000
  let documents = 0
  /** A document of [a, b, c] with one Change after its genesis, and a fake site around it. */
  function setup(prepare: (input: any, options?: {signal?: AbortSignal}) => Promise<{unsignedChange: Uint8Array}>) {
    const request = vi.fn(async (key: string, input: any, options?: {signal?: AbortSignal}) => {
      if (key === 'GetCID') return {value: {ts: LATEST}}
      if (key === 'PrepareDocumentChange') return prepare(input, options)
      throw new Error(`unexpected request ${key}`)
    })
    const input = {
      client: {request} as any,
      signer: makeSigner(),
      account: ACCOUNT,
      // The helper remembers a document that went unanswered: every test gets its own.
      path: `/doc-${++documents}`,
      state: {
        genesis: GENESIS,
        heads: [HEAD],
        headDepth: 1,
        version: HEAD,
        headTs: LATEST,
      },
      content: ['a', 'b', 'c'].map((id) => ({block: {id}, children: []})),
      documentVersion: HEAD,
      now: () => LATEST - 2_000, // this machine's clock lags the document's latest Change
    }
    const asked = () => request.mock.calls.filter((call) => call[0] === 'PrepareDocumentChange').length
    return {request, input, asked}
  }
  const append: DocumentOperation[] = [
    {type: 'ReplaceBlock', block: {id: 'n', type: 'Paragraph', text: 'new'}},
    {type: 'MoveBlocks', blocks: ['a', 'b', 'c', 'n'], parent: ''},
  ]
  const prepared = async () => ({
    unsignedChange: unsignedChange(
      [
        {type: 'MoveBlocks', blocks: ['n'], ref: [1, 2, 3]},
        {type: 'ReplaceBlock', block: {id: 'n', type: 'Paragraph', text: 'new'}},
      ],
      LATEST + 5,
    ),
  })
  const failing = (status: number, message: string) => async () => {
    throw new SeedClientError(`HTTP ${status} from PrepareDocumentChange`, status, JSON.stringify({error: message}))
  }
  /** The ops and timestamp of the Change in a result. */
  const changeOf = (result: {blobs: {data: Uint8Array}[]}) => cborDecode(result.blobs[0]!.data) as Record<string, any>

  it('signs the Change the daemon prepared', async () => {
    const {input, request, asked} = setup(prepared)
    const result = await documentUpdateBlobs({...input, ops: append})
    if (!result.changed) throw new Error('expected a change')
    expect(result.builtBy).toBe('server')
    expect(result.localReason).toBeUndefined()
    expect(result.ts).toBe(LATEST + 5)
    expect(result.depth).toBe(2)
    expect(changeOf(result).body.ops).toHaveLength(2)
    expect(asked()).toBe(1)
    const call = request.mock.calls.find((c) => c[0] === 'PrepareDocumentChange')!
    expect(call[1]).toMatchObject({path: input.path, baseVersion: HEAD})
    expect(call[1].changes.map((change: any) => change.op.case)).toEqual(['replaceBlock', 'moveBlock'])
    expect(call[2]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('reports no change when the daemon leaves nothing, and for no ops at all', async () => {
    const {input, asked} = setup(async () => ({unsignedChange: unsignedChange([])}))
    expect(await documentUpdateBlobs({...input, ops: append})).toEqual({changed: false, blobs: [], version: HEAD})
    expect(await documentUpdateBlobs({...input, ops: []})).toEqual({changed: false, blobs: [], version: HEAD})
    expect(asked()).toBe(1)
  })

  it.each([
    ['a request the site finds too large', 413, 'Payload Too Large', 'too large (HTTP 413)'],
    ['a site without the API', 404, 'Unknown action key: PrepareDocumentChange', 'no PrepareDocumentChange'],
    ['a parent the daemon lost', 500, '[unknown] desired parent block P is not in the tree', 'is not in the tree'],
    ['a cycle the daemon refuses', 500, '[unknown] cycle detected: block a is ancestor of b', 'cycle detected'],
    ['any other failure to apply', 500, '[internal] something else broke', 'something else broke'],
    [
      'a site clock behind the latest change',
      500,
      '[unknown] ts of change bafy1 must be greater than ts of its dependency bafy2',
      "clock is not past the time of the document's latest change",
    ],
  ])('builds the Change here after %s', async (_name, status, message, reason) => {
    const {input, asked} = setup(failing(status as number, message as string))
    const result = await documentUpdateBlobs({...input, ops: append})
    if (!result.changed) throw new Error('expected a change')
    expect(result.builtBy).toBe('local')
    expect(result.localReason).toContain(reason)
    expect(asked()).toBe(1)
    const change = changeOf(result)
    expect(change.body.ops).toEqual(append) // as written
    expect(change.deps.map(String)).toEqual([HEAD])
    // Later than the head it builds on, though this machine's clock is two seconds behind it.
    expect(Number(change.ts)).toBe(LATEST + 1)
  })

  it.each([
    ['a refusal for lack of permission', 500, '[permission_denied] key z6Mk is not allowed to write to space'],
    ['an unauthenticated caller', 500, '[unauthenticated] sign in'],
    ['a request the daemon calls invalid', 500, '[invalid_argument] failed to decode account'],
    ['a failed precondition', 500, '[failed_precondition] private document creation is disabled'],
    ['a 4xx about the request', 400, 'Invalid request input'],
    ['a 403', 403, 'Forbidden'],
  ])('does not build the Change here after %s', async (_name, status, message) => {
    const {input} = setup(failing(status as number, message as string))
    await expect(documentUpdateBlobs({...input, ops: append})).rejects.toBeInstanceOf(SeedClientError)
  })

  it('does not build the Change here when the site cannot be reached', async () => {
    const {input} = setup(async () => {
      throw new SeedNetworkError('Network error fetching PrepareDocumentChange: ECONNREFUSED')
    })
    await expect(documentUpdateBlobs({...input, ops: append})).rejects.toBeInstanceOf(SeedNetworkError)
  })

  it('stops waiting for a daemon that does not answer, builds the Change here, and does not ask again', async () => {
    let signal: AbortSignal | undefined
    const {input, asked} = setup((_input, options) => {
      signal = options?.signal
      return new Promise(() => {}) // never answers, and ignores the abort
    })
    const started = Date.now()
    const result = await documentUpdateBlobs({...input, ops: append, prepareTimeoutMs: 30})
    expect(Date.now() - started).toBeLessThan(2_000)
    if (!result.changed) throw new Error('expected a change')
    expect(result.builtBy).toBe('local')
    expect(result.localReason).toContain('did not answer within')
    expect(signal?.aborted).toBe(true)
    expect(changeOf(result).body.ops).toEqual(append)

    const again = await documentUpdateBlobs({...input, ops: append, prepareTimeoutMs: 30})
    expect(again.changed && again.localReason).toContain('did not answer an earlier request')
    expect(asked()).toBe(1)
  })

  it('does not sign a Change that repeats moves, moves more blocks than asked, or is too large', async () => {
    const repeated = setup(async () => ({
      unsignedChange: unsignedChange([
        {type: 'MoveBlocks', blocks: ['n']},
        {type: 'MoveBlocks', blocks: ['n']},
      ]),
    }))
    const first = await documentUpdateBlobs({...repeated.input, ops: append})
    expect(first.changed && first.builtBy).toBe('local')
    expect(first.changed && first.localReason).toContain('places block n 2 times, the request once')
    expect(changeOf(first).body.ops).toEqual(append)

    const stranger = setup(async () => ({unsignedChange: unsignedChange([{type: 'MoveBlocks', blocks: ['a', 'n']}])}))
    const second = await documentUpdateBlobs({...stranger.input, ops: append})
    expect(second.changed && second.localReason).toContain('places blocks 2 times for 1 requested')

    const large = setup(prepared)
    const third = await documentUpdateBlobs({...large.input, ops: append, maxPreparedChangeBytes: 32})
    expect(third.changed && third.localReason).toContain('bytes, over the 32')
  })

  it('builds the Change here, without asking, for content that is not the content at the heads', async () => {
    const {input, asked} = setup(prepared)
    const result = await documentUpdateBlobs({...input, ops: append, documentVersion: GENESIS})
    expect(result.changed && result.localReason).toBe('the document changed while it was being read')
    expect(asked()).toBe(0)
  })

  it('builds the Change here for ops the request cannot carry, storing localOps when given', async () => {
    const {input, asked} = setup(prepared)
    const fraction: DocumentOperation[] = [{type: 'SetAttributes', attrs: [{key: ['rating'], value: 4.5}]}]
    const result = await documentUpdateBlobs({...input, ops: fraction})
    expect(result.changed && result.localReason).toContain('must be a whole number')
    expect(changeOf(result).body.ops).toEqual(fraction)

    const replaced: DocumentOperation[] = [
      {type: 'DeleteBlocks', blocks: ['a']},
      {type: 'MoveBlocks', blocks: ['a', 'b', 'c'], parent: ''},
    ]
    const whole: DocumentOperation[] = [...fraction, ...replaced]
    const withLocal = await documentUpdateBlobs({...input, ops: replaced, localOps: whole})
    expect(withLocal.changed && withLocal.localReason).toContain('deletes block a and places it')
    expect(changeOf(withLocal).body.ops).toEqual(whole)
    expect(asked()).toBe(0)
  })

  it('stores a level after the level of its parent, so a parent and child that swap places do swap', async () => {
    const {input} = setup(prepared)
    const nested = [{block: {id: 'a'}, children: [{block: {id: 'b'}, children: [{block: {id: 'c'}, children: []}]}]}]
    // [a[b[c]]] to [b[a, c]] as a diff lists it: the inner level first.
    const swap: DocumentOperation[] = [
      {type: 'ReplaceBlock', block: {id: 'c', type: 'Paragraph', text: 'edited'}},
      {type: 'MoveBlocks', blocks: ['a', 'c'], parent: 'b'},
      {type: 'DeleteBlocks', blocks: ['gone']},
      {type: 'MoveBlocks', blocks: ['b'], parent: ''},
    ]
    const result = await documentUpdateBlobs({...input, content: nested, ops: swap})
    expect(result.changed && result.localReason).toContain('under a block that is, or was, inside it')
    expect(changeOf(result).body.ops).toEqual([swap[0], swap[3], swap[2], swap[1]])
  })

  it('reads the head Changes for their time when the state does not carry it', async () => {
    const {input} = setup(failing(413, 'Payload Too Large'))
    const result = await documentUpdateBlobs({...input, state: {...input.state, headTs: undefined}, ops: append})
    expect(Number(changeOf(result).ts)).toBe(LATEST + 1)
  })
})
