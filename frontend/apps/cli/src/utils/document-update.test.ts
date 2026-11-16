import {describe, test, expect} from 'bun:test'
import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {
  createChange,
  createChangeOps,
  SeedClientError,
  type DocumentOperation,
  type DocumentState,
} from '@seed-hypermedia/client'
import {attributesServerCannotPrepare, buildDocumentUpdate} from './document-update'
import {deriveKeyPairFromMnemonic} from './key-derivation'
import {createSignerFromKey} from './signer'

const key = deriveKeyPairFromMnemonic(
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  '',
)
const signer = createSignerFromKey(key)

/** A one-change document to build on. */
async function documentState(): Promise<DocumentState> {
  const {unsignedBytes} = createChangeOps({ops: [], ts: 1_000n})
  const genesis = (await createChange(unsignedBytes, signer)).cid.toString()
  return {genesis, heads: [genesis], headDepth: 0, version: genesis}
}

/** The unsigned Change a server would answer with: `ops` on top of the request's base version. */
function preparedChange(state: DocumentState, ops: unknown[], ts = 5_000): Uint8Array {
  return cborEncode({
    type: 'Change',
    body: {ops, opCount: ops.length},
    genesis: CID.parse(state.genesis),
    deps: state.heads.map((head) => CID.parse(head)),
    depth: 1,
    signer: null,
    ts,
    sig: null,
  })
}

type Call = {key: string; input: any}

function fakeClient(respond: (input: any) => Uint8Array) {
  const calls: Call[] = []
  const client = {
    request: async (key: string, input: any) => {
      calls.push({key, input})
      if (key !== 'PrepareDocumentChange') throw new Error(`unexpected request ${key}`)
      return {unsignedChange: respond(input)}
    },
  }
  return {client: client as any, calls}
}

const paragraph: DocumentOperation = {
  type: 'ReplaceBlock',
  block: {id: 'b1', type: 'Paragraph', text: 'Hello', annotations: []},
}
const setName: DocumentOperation = {type: 'SetAttributes', attrs: [{key: ['name'], value: 'Title'}]}

function decodeBlob(data: Uint8Array): any {
  return cborDecode(data)
}

describe('attributesServerCannotPrepare', () => {
  test('strings, whole numbers, booleans, null and nested key paths are fine', () => {
    expect(
      attributesServerCannotPrepare([
        {
          type: 'SetAttributes',
          attrs: [
            {key: ['name'], value: 'x'},
            {key: ['count'], value: 3},
            {key: ['done'], value: true},
            {key: ['gone'], value: null},
            {key: ['theme', 'headerLayout'], value: 'Center'},
          ],
        },
        paragraph,
      ]),
    ).toEqual([])
  })

  test('a fractional number and a dotted key are named', () => {
    const found = attributesServerCannotPrepare([
      {
        type: 'SetAttributes',
        attrs: [
          {key: ['rating'], value: 4.5},
          {key: ['a.b'], value: 'x'},
          {key: ['name'], value: 'ok'},
        ],
      },
    ])
    expect(found).toHaveLength(2)
    expect(found[0]).toContain('"rating"')
    expect(found[0]).toContain('4.5')
    expect(found[1]).toContain('"a.b"')
  })
})

describe('buildDocumentUpdate', () => {
  test('no ops is not a change and asks the server nothing', async () => {
    const state = await documentState()
    const {client, calls} = fakeClient(() => preparedChange(state, []))
    const result = await buildDocumentUpdate({
      client,
      signer,
      account: key.accountId,
      path: '/doc',
      state,
      ops: [],
      content: [],
    })
    expect(result).toEqual({changed: false, blobs: [], version: state.version})
    expect(calls).toHaveLength(0)
  })

  test('asks the server for the change at the requested path, on the given heads, and signs what comes back', async () => {
    const state = await documentState()
    const serverOps = [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'Title'}]}]
    const {client, calls} = fakeClient(() => preparedChange(state, serverOps))
    const result = await buildDocumentUpdate({
      client,
      signer,
      account: key.accountId,
      path: '/doc',
      state,
      ops: [setName, paragraph],
      content: [],
      capability: undefined,
      minGeneration: 9_000,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.input.account).toBe(key.accountId)
    expect(calls[0]!.input.path).toBe('/doc')
    expect(calls[0]!.input.baseVersion).toBe(state.version)
    expect(calls[0]!.input.changes.map((c: any) => c.op.case)).toEqual(['setMetadata', 'replaceBlock'])

    if (!result.changed) throw new Error('expected a change')
    expect(result.builtBy).toBe('server')
    expect(result.blobs).toHaveLength(2)
    const change = decodeBlob(result.blobs[0]!.data)
    // The server's ops are stored, not the ones requested.
    expect(change.body.ops).toEqual(serverOps)
    expect(change.sig).toBeInstanceOf(Uint8Array)
    const ref = decodeBlob(result.blobs[1]!.data)
    expect(ref.type).toBe('Ref')
    expect(ref.path).toBe('/doc')
    expect(ref.heads.map(String)).toEqual([result.version])
    expect(ref.genesisBlob.toString()).toBe(state.genesis)
    // The Ref never goes below the generation the path holds (here above the change's 5000).
    expect(Number(ref.generation)).toBe(9_000)
  })

  test('a change the server finds empty is not a change', async () => {
    const state = await documentState()
    const {client, calls} = fakeClient(() => preparedChange(state, []))
    const result = await buildDocumentUpdate({
      client,
      signer,
      account: key.accountId,
      path: '/doc',
      state,
      ops: [setName],
      content: [],
    })
    expect(calls).toHaveLength(1)
    expect(result).toEqual({changed: false, blobs: [], version: state.version})
  })

  test('a fractional attribute is built locally, as written, without asking the server', async () => {
    const state = await documentState()
    const {client, calls} = fakeClient(() => preparedChange(state, []))
    const ops: DocumentOperation[] = [{type: 'SetAttributes', attrs: [{key: ['rating'], value: 4.5}]}, paragraph]
    const result = await buildDocumentUpdate({
      client,
      signer,
      account: key.accountId,
      path: '/doc',
      state,
      ops,
      content: [],
    })
    expect(calls).toHaveLength(0)
    if (!result.changed) throw new Error('expected a change')
    expect(result.builtBy).toBe('local')
    expect(result.localReason).toContain('"rating"')
    const change = decodeBlob(result.blobs[0]!.data)
    expect(change.body.ops).toEqual(ops)
    expect(change.genesis.toString()).toBe(state.genesis)
    expect(change.deps.map(String)).toEqual(state.heads)
    expect(change.depth).toBe(1)
    const ref = decodeBlob(result.blobs[1]!.data)
    expect(ref.path).toBe('/doc')
    expect(ref.heads.map(String)).toEqual([result.version])
  })

  test('a reorder the server cannot take is built locally, without asking it', async () => {
    const state = await documentState()
    const {client, calls} = fakeClient(() => preparedChange(state, []))
    const ops: DocumentOperation[] = [{type: 'MoveBlocks', blocks: ['c', 'd', 'a', 'b'], parent: ''}]
    const result = await buildDocumentUpdate({
      client,
      signer,
      account: key.accountId,
      path: '/doc',
      state,
      ops,
      content: ['a', 'b', 'c', 'd'].map((id) => ({block: {id}, children: []})),
    })
    expect(calls).toHaveLength(0)
    if (!result.changed) throw new Error('expected a change')
    expect(result.builtBy).toBe('local')
    expect(decodeBlob(result.blobs[0]!.data).body.ops).toEqual(ops)
  })

  test('a request refused as too large (413) is built locally', async () => {
    const state = await documentState()
    const client = {
      request: async () => {
        throw new SeedClientError('HTTP 413 from PrepareDocumentChange: Payload Too Large', 413)
      },
    } as any
    const result = await buildDocumentUpdate({
      client,
      signer,
      account: key.accountId,
      path: '/doc',
      state,
      ops: [paragraph],
      content: [],
      minGeneration: Number.MAX_SAFE_INTEGER,
    })
    if (!result.changed) throw new Error('expected a change')
    expect(result.builtBy).toBe('local')
    expect(result.localReason).toContain('413')
    expect(decodeBlob(result.blobs[0]!.data).body.ops).toEqual([paragraph])
    // The generation floor holds on the local path too.
    expect(Number(decodeBlob(result.blobs[1]!.data).generation)).toBe(Number.MAX_SAFE_INTEGER)
  })

  test('a server clock behind the latest change is explained, not built locally', async () => {
    const state = await documentState()
    const client = {
      request: async () => {
        throw new SeedClientError(
          'HTTP 500 from PrepareDocumentChange: Internal Server Error: ts of change bafyx must be greater than ts of its dependency bafyy',
          500,
        )
      },
    } as any
    await expect(
      buildDocumentUpdate({client, signer, account: key.accountId, path: '/doc', state, ops: [paragraph], content: []}),
    ).rejects.toThrow(/server's clock is behind/)
  })

  test('other server errors pass through', async () => {
    const state = await documentState()
    const client = {
      request: async () => {
        throw new SeedClientError('HTTP 403 from PrepareDocumentChange: Forbidden', 403)
      },
    } as any
    await expect(
      buildDocumentUpdate({client, signer, account: key.accountId, path: '/doc', state, ops: [paragraph], content: []}),
    ).rejects.toThrow(/403/)
  })
})
