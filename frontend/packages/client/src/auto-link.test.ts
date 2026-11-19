import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {CID} from 'multiformats/cid'
import {describe, expect, it, vi} from 'vitest'
import {autoLinkChildToParent, createAutoLinkOps, documentHasSelfQuery, shouldAutoLinkParent} from './auto-link'
import {SeedClientError} from './errors'
import {unpackHmId} from './hm-types'

const documentId = unpackHmId('hm://alice/notes')!

function documentWithIncludes(includes?: unknown[]) {
  return {
    content: [
      {
        block: {
          id: 'query',
          type: 'Query',
          attributes: includes === undefined ? {} : {query: {includes}},
        },
        children: [],
      },
    ],
  } as any
}

describe('documentHasSelfQuery', () => {
  it('recognizes the implicit empty target used by new collections', () => {
    expect(documentHasSelfQuery(documentWithIncludes([{}]), documentId)).toBe(true)
    expect(documentHasSelfQuery(documentWithIncludes([]), documentId)).toBe(true)
    expect(documentHasSelfQuery(documentWithIncludes(), documentId)).toBe(true)
  })
})

describe('shouldAutoLinkParent', () => {
  it('leaves a typed collection alone: it lists its records itself', () => {
    const child = unpackHmId('hm://alice/notes/n1')!
    const plain = {content: [], metadata: {}} as any
    const typed = {content: [], metadata: {childAttributesSchema: 'hm://alice/types/note'}} as any
    expect(shouldAutoLinkParent(false, plain, child, documentId)).toBe(true)
    expect(shouldAutoLinkParent(false, typed, child, documentId)).toBe(false)
  })
})

function paragraph(id: string) {
  return {block: {id, type: 'Paragraph', text: id, annotations: [], attributes: {}}, children: []}
}

describe('createAutoLinkOps', () => {
  it('adds the card and lists every root block with it, so the level reads in order however it is stored', () => {
    const parent = {content: [paragraph('a'), {...paragraph('b'), children: [paragraph('b1')]}, paragraph('c')]} as any
    expect(createAutoLinkOps(parent, 'hm://alice/notes/n1', 'new')).toEqual([
      {
        type: 'ReplaceBlock',
        block: {id: 'new', type: 'Embed', link: 'hm://alice/notes/n1', attributes: {view: 'Card'}},
      },
      {type: 'MoveBlocks', blocks: ['a', 'b', 'c', 'new'], parent: ''},
    ])
  })

  it('places the card alone in an empty parent', () => {
    const ops = createAutoLinkOps({content: []} as any, 'hm://alice/notes/n1', 'new')
    expect(ops[1]).toEqual({type: 'MoveBlocks', blocks: ['new'], parent: ''})
  })
})

describe('autoLinkChildToParent', () => {
  const account = 'z6MksV3sM8YJxFqv8kV4m4wQdD4sP2wJvB8c2kHh9Qx7LmNo'
  const genesis = 'bafyreia3vk25z2f7st52fqteo2lrj4wari4x3pvd4baglayl22fftvrxse'
  const head = 'bafyreihlnsrncs74ilkjhpl5zbhiyix5rip2kntvkca72gsxr2pspms3sm'
  const signer = {
    getPublicKey: async () => new Uint8Array(base58btc.decode(account)),
    sign: async () => new Uint8Array(64).fill(7),
  }

  function client(parent: unknown, ops: unknown[], prepareError?: Error) {
    const request = vi.fn(async (key: string, _input: any) => {
      if (key === 'Resource') return parent
      if (key === 'ListChanges') {
        return {
          changes: [
            {id: genesis, deps: [], createTime: '2026-01-01T00:00:00Z'},
            {id: head, deps: [genesis], createTime: '2026-01-01T00:00:01.5Z'},
          ],
        }
      }
      if (key === 'PrepareDocumentChange') {
        if (prepareError) throw prepareError
        return {
          unsignedChange: cborEncode({
            type: 'Change',
            body: ops.length ? {ops, opCount: ops.length} : {},
            genesis: CID.parse(genesis),
            deps: [CID.parse(head)],
            depth: 2,
            signer: null,
            ts: 1234,
            sig: null,
          }),
        }
      }
      throw new Error(`unexpected request ${key}`)
    })
    const publish = vi.fn(async (_input: {blobs: {cid?: string; data: Uint8Array}[]}) => ({cids: []}))
    return {request, publish} as any
  }

  const parentDocument = {
    type: 'document',
    document: {
      version: head,
      genesis,
      generationInfo: {genesis, generation: 10n},
      metadata: {},
      content: [paragraph('a'), paragraph('b')],
    },
  }
  const options = {account, path: '/notes/n1', childHmUrl: `hm://${account}/notes/n1`, signer}

  it('asks the daemon for the change on the version it read, then publishes the Change and Ref', async () => {
    const seedClient = client(parentDocument, [{type: 'MoveBlocks', blocks: ['x']}])
    expect(await autoLinkChildToParent({client: seedClient, ...options})).toBe(true)

    const keys = seedClient.request.mock.calls.map((call: unknown[]) => call[0])
    // The parent, its heads, the change.
    expect(keys).toEqual(['Resource', 'ListChanges', 'PrepareDocumentChange'])
    const prepare = seedClient.request.mock.calls[2][1]
    expect(prepare).toMatchObject({account, path: '/notes', baseVersion: head})
    expect(prepare.changes).toHaveLength(2)
    expect(prepare.changes[0].op.value).toMatchObject({type: 'Embed', link: options.childHmUrl})
    const newBlockId = prepare.changes[0].op.value.id
    expect(prepare.changes[1]).toEqual({
      op: {case: 'moveBlock', value: {blockId: newBlockId, parent: '', leftSibling: 'b'}},
    })

    expect(seedClient.publish).toHaveBeenCalledTimes(1)
    const blobs = seedClient.publish.mock.calls[0][0].blobs
    expect(blobs).toHaveLength(2)
    const ref = cborDecode(blobs[1].data) as Record<string, any>
    expect(ref.path).toBe('/notes')
    expect(String(ref.heads[0])).toBe(blobs[0].cid)
    expect(String(ref.genesisBlob)).toBe(genesis)
  })

  it('builds the card here, on the heads and later than them, when the daemon refuses the request', async () => {
    const refusal = new SeedClientError('HTTP 500 from PrepareDocumentChange', 500, '{"error":"[unknown] boom"}')
    const seedClient = client(parentDocument, [], refusal)
    expect(await autoLinkChildToParent({client: seedClient, ...options})).toBe(true)
    const blobs = seedClient.publish.mock.calls[0][0].blobs
    const change = cborDecode(blobs[0].data) as Record<string, any>
    expect(change.body.ops[1]).toMatchObject({type: 'MoveBlocks', blocks: ['a', 'b', expect.any(String)]})
    expect(change.deps.map(String)).toEqual([head])
    expect(Number(change.ts)).toBeGreaterThan(Date.parse('2026-01-01T00:00:01.5Z'))
  })

  it('publishes nothing when the daemon finds nothing to change', async () => {
    const seedClient = client(parentDocument, [])
    expect(await autoLinkChildToParent({client: seedClient, ...options})).toBe(false)
    expect(seedClient.publish).not.toHaveBeenCalled()
  })

  it('does nothing when the parent already links the child or is not a document', async () => {
    const linked = {
      ...parentDocument,
      document: {
        ...parentDocument.document,
        content: [
          {block: {id: 'e', type: 'Embed', link: options.childHmUrl, attributes: {view: 'Card'}}, children: []},
        ],
      },
    }
    for (const parent of [linked, {type: 'not-found'}]) {
      const seedClient = client(parent, [{type: 'x'}])
      expect(await autoLinkChildToParent({client: seedClient, ...options})).toBe(false)
      expect(seedClient.request).toHaveBeenCalledTimes(1)
      expect(seedClient.publish).not.toHaveBeenCalled()
    }
  })
})
