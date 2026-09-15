import {decode as cborDecode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {describe, expect, it} from 'vitest'
import {createDocumentBlobs} from './create-document'
import type {HMSigner} from './signer'

/** Mock signer with a fixed libp2p-prefixed Ed25519-shaped key and a deterministic fake signature. */
function createMockSigner(seed = 1): HMSigner & {accountId: string} {
  const publicKey = new Uint8Array(34)
  publicKey[0] = 0xed
  publicKey[1] = 0x01
  for (let i = 2; i < 34; i++) publicKey[i] = (i * seed) & 0xff
  return {
    accountId: base58btc.encode(publicKey),
    getPublicKey: async () => publicKey,
    sign: async (data: Uint8Array) => {
      const sig = new Uint8Array(64)
      for (let i = 0; i < 64; i++) sig[i] = data[i % data.length]! ^ (i & 0xff)
      return sig
    },
  }
}

const ops = [{type: 'SetAttributes' as const, attrs: [{key: ['name'], value: 'A document'}]}]

function decodeAll(blobs: Array<{cid?: string; data: Uint8Array}>) {
  return blobs.map((b) => ({cid: b.cid ?? '', value: cborDecode(b.data) as Record<string, unknown>}))
}

describe('createDocumentBlobs', () => {
  it('a non-home document: its first content change is its genesis, and the Ref says so', async () => {
    const signer = createMockSigner()
    const created = await createDocumentBlobs(signer, {space: signer.accountId, path: '/notes/first', ops})

    expect(created.genesis).toBe(created.version)
    const [change, ref] = decodeAll(created.blobs)
    expect(created.blobs).toHaveLength(2)

    expect(change!.value['type']).toBe('Change')
    expect(change!.value['genesis']).toBeUndefined()
    expect(change!.value['deps']).toBeUndefined()
    expect(change!.value['depth']).toBeUndefined()
    expect(BigInt(change!.value['ts'] as bigint | number)).toBeGreaterThan(0n)
    expect(change!.cid).toBe(created.genesis)

    expect(ref!.value['type']).toBe('Ref')
    expect(ref!.value['path']).toBe('/notes/first')
    // Like the daemon's docmodel.Ref: genesis carried even when it is also the head.
    expect(String(ref!.value['genesisBlob'])).toBe(created.genesis)
    expect((ref!.value['heads'] as unknown[]).map(String)).toEqual([created.version])
    expect(Number(ref!.value['generation'])).toBe(Number(created.ts))
  })

  it('the home document of the signer: deterministic genesis, then the content change on top', async () => {
    const signer = createMockSigner()
    const created = await createDocumentBlobs(signer, {space: signer.accountId, path: '', ops})

    expect(created.blobs).toHaveLength(3)
    const [genesis, change, ref] = decodeAll(created.blobs)

    expect(Object.keys(genesis!.value).sort()).toEqual(['sig', 'signer', 'ts', 'type'])
    expect(BigInt(genesis!.value['ts'] as bigint | number)).toBe(0n)
    expect(genesis!.cid).toBe(created.genesis)

    expect(String(change!.value['genesis'])).toBe(created.genesis)
    expect((change!.value['deps'] as unknown[]).map(String)).toEqual([created.genesis])
    expect(change!.value['depth']).toBe(1)
    expect(change!.cid).toBe(created.version)

    expect(ref!.value['path']).toBeUndefined() // '' is omitted on the wire
    expect(String(ref!.value['genesisBlob'])).toBe(created.genesis)
    expect((ref!.value['heads'] as unknown[]).map(String)).toEqual([created.version])
  })

  it('the home genesis is the same for the same signer every time; ordinary documents never share one', async () => {
    const signer = createMockSigner()
    const homeA = await createDocumentBlobs(signer, {space: signer.accountId, path: '', ops})
    const homeB = await createDocumentBlobs(signer, {space: signer.accountId, path: '', ops})
    expect(homeA.genesis).toBe(homeB.genesis)

    const docA = await createDocumentBlobs(signer, {space: signer.accountId, path: '/a', ops})
    const docB = await createDocumentBlobs(signer, {
      space: signer.accountId,
      path: '/b',
      ops: [...ops, {type: 'SetAttributes', attrs: [{key: ['x'], value: 1}]}],
    })
    expect(docA.genesis).not.toBe(homeA.genesis)
    expect(docB.genesis).not.toBe(homeA.genesis)
    expect(docA.genesis).not.toBe(docB.genesis)
  })

  it("refuses to create another account's home, as the daemon does", async () => {
    const signer = createMockSigner(1)
    const other = createMockSigner(2)
    await expect(createDocumentBlobs(signer, {space: other.accountId, path: '', ops})).rejects.toThrow(
      /home document can only be created by its own account/,
    )
  })
})
