import {describe, it, expect} from 'vitest'
import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import * as Block from 'multiformats/block'
import {sha256} from 'multiformats/hashes/sha2'
import {signPreparedChange} from './change'
import type {HMSigner} from '@shm/shared/hm-types'

const cborCodec = {
  code: 0x71 as const,
  encode: (input: unknown) => cborEncode(input),
  name: 'DAG-CBOR' as const,
}

/** Create a real CID from test data. */
async function makeTestCID(data: unknown) {
  const block = await Block.encode({value: data, codec: cborCodec, hasher: sha256})
  return block.cid
}

/**
 * Create a mock signer for testing (deterministic Ed25519-like behavior).
 * Uses a fixed "public key" and produces a deterministic "signature".
 */
function createMockSigner(): HMSigner & {publicKey: Uint8Array} {
  // 34-byte "public key" (2-byte prefix + 32-byte key, matching Ed25519 with libp2p prefix)
  const publicKey = new Uint8Array(34)
  publicKey[0] = 0x08 // Ed25519 key type prefix
  publicKey[1] = 0x01
  for (let i = 2; i < 34; i++) {
    publicKey[i] = i
  }

  return {
    publicKey,
    getPublicKey: async () => publicKey,
    sign: async (data: Uint8Array) => {
      // Produce a deterministic 64-byte "signature" (hash of input for determinism)
      const sig = new Uint8Array(64)
      for (let i = 0; i < 64; i++) {
        sig[i] = data[i % data.length]! ^ (i & 0xff)
      }
      return sig
    },
  }
}

/**
 * Create an unsigned CBOR blob that mimics what Go's NopSigner produces.
 * NopSigner sets signer=nil and sig=nil, but keeps other fields intact.
 */
async function createMockUnsignedChange(): Promise<Uint8Array> {
  const genesisCID = await makeTestCID({type: 'Change', ts: 0n})
  const change: Record<string, unknown> = {
    type: 'Change',
    signer: null,
    sig: null,
    ts: BigInt(Date.now()),
    genesis: genesisCID,
    deps: [genesisCID],
    depth: 1,
    body: {
      opCount: 1,
      ops: [
        {
          type: 'SetAttributes',
          attrs: [{key: ['title'], value: 'Test'}],
        },
      ],
    },
  }
  return cborEncode(change)
}

describe('signPreparedChange', () => {
  it('fills signer, signs, and returns valid CID', async () => {
    const unsignedBytes = await createMockUnsignedChange()
    const signer = createMockSigner()

    const result = await signPreparedChange(unsignedBytes, signer)

    expect(result.signedBytes).toBeInstanceOf(Uint8Array)
    expect(result.signedBytes.length).toBeGreaterThan(0)
    expect(result.cid).toBeDefined()
    expect(result.cid.toString()).toMatch(/^bafy/)

    // Decode the signed bytes and verify fields
    const decoded = cborDecode(result.signedBytes) as Record<string, unknown>
    expect(decoded['type']).toBe('Change')

    // Signer should be filled with the mock public key
    const decodedSigner = decoded['signer'] as Uint8Array
    expect(decodedSigner).toBeInstanceOf(Uint8Array)
    expect(decodedSigner.length).toBe(signer.publicKey.length)
    expect(Array.from(decodedSigner)).toEqual(Array.from(signer.publicKey))

    // Signature should be non-zero (not the zeroed placeholder)
    const decodedSig = decoded['sig'] as Uint8Array
    expect(decodedSig).toBeInstanceOf(Uint8Array)
    expect(decodedSig.length).toBe(64)
    // At least some bytes should be non-zero (a real signature)
    const hasNonZero = Array.from(decodedSig).some((b) => b !== 0)
    expect(hasNonZero).toBe(true)

    // Other fields should be preserved
    expect(decoded['depth']).toBe(1)
    expect(decoded['genesis']).toBeDefined()
    expect(decoded['deps']).toBeDefined()
    expect(decoded['body']).toBeDefined()
  })

  it('produces a deterministic CID for the same input', async () => {
    const unsignedBytes = await createMockUnsignedChange()
    const signer = createMockSigner()

    const result1 = await signPreparedChange(unsignedBytes, signer)
    const result2 = await signPreparedChange(unsignedBytes, signer)

    expect(result1.cid.toString()).toBe(result2.cid.toString())
    expect(Array.from(result1.signedBytes)).toEqual(Array.from(result2.signedBytes))
  })

  it('uses SHA256 CID (DAG-CBOR codec)', async () => {
    const unsignedBytes = await createMockUnsignedChange()
    const signer = createMockSigner()

    const result = await signPreparedChange(unsignedBytes, signer)

    // DAG-CBOR codec = 0x71
    expect(result.cid.code).toBe(0x71)
    // SHA256 = 0x12
    expect(result.cid.multihash.code).toBe(0x12)
  })
})
