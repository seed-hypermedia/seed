import {describe, it, expect} from 'vitest'
import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import * as Block from 'multiformats/block'
import {sha256} from 'multiformats/hashes/sha2'
import {createChange, createChangeOps, signPreparedChange, signDocumentChange} from './change'
import type {HMSigner} from '@shm/shared/hm-types'

// A valid base58btc-encoded account UID (multibase 'z' prefix)
const TEST_ACCOUNT_UID = 'z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou'

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
async function createMockUnsignedChange({includeGenesis = true}: {includeGenesis?: boolean} = {}): Promise<Uint8Array> {
  const genesisCID = await makeTestCID({type: 'Change', ts: 0n})
  const change: Record<string, unknown> = {
    type: 'Change',
    signer: null,
    sig: null,
    ts: BigInt(Date.now()),
    ...(includeGenesis ? {genesis: genesisCID, deps: [genesisCID]} : {deps: []}),
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

describe('createChange', () => {
  it('fills signer, signs, and returns valid CID', async () => {
    const unsignedBytes = await createMockUnsignedChange()
    const signer = createMockSigner()

    const result = await createChange(unsignedBytes, signer)

    expect(result.bytes).toBeInstanceOf(Uint8Array)
    expect(result.bytes.length).toBeGreaterThan(0)
    expect(result.cid).toBeDefined()
    expect(result.cid.toString()).toMatch(/^bafy/)

    // Decode the signed bytes and verify fields
    const decoded = cborDecode(result.bytes) as Record<string, unknown>
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

    const result1 = await createChange(unsignedBytes, signer)
    const result2 = await createChange(unsignedBytes, signer)

    expect(result1.cid.toString()).toBe(result2.cid.toString())
    expect(Array.from(result1.bytes)).toEqual(Array.from(result2.bytes))
  })

  it('uses SHA256 CID (DAG-CBOR codec)', async () => {
    const unsignedBytes = await createMockUnsignedChange()
    const signer = createMockSigner()

    const result = await createChange(unsignedBytes, signer)

    // DAG-CBOR codec = 0x71
    expect(result.cid.code).toBe(0x71)
    // SHA256 = 0x12
    expect(result.cid.multihash.code).toBe(0x12)
  })
})

describe('createChangeOps', () => {
  it('produces unsigned bytes that createChange can sign', async () => {
    const genesisCID = await makeTestCID({type: 'Change', ts: 0n})
    const signer = createMockSigner()

    const {unsignedBytes, ts} = createChangeOps({
      ops: [{type: 'SetAttributes', attrs: [{key: ['title'], value: 'Test'}]}],
      genesisCid: genesisCID,
      deps: [genesisCID],
      depth: 1,
    })

    expect(ts).toBeGreaterThan(0n)

    const result = await createChange(unsignedBytes, signer)
    expect(result.cid.toString()).toMatch(/^bafy/)

    const decoded = cborDecode(result.bytes) as Record<string, unknown>
    expect(decoded['type']).toBe('Change')
    expect(decoded['depth']).toBe(1)
    expect(decoded['genesis']).toBeDefined()
    expect(result.genesis?.toString()).toBe(genesisCID.toString())
  })
})

describe('signPreparedChange (compat)', () => {
  it('returns signedBytes alias for bytes', async () => {
    const unsignedBytes = await createMockUnsignedChange()
    const signer = createMockSigner()

    const result = await signPreparedChange(unsignedBytes, signer)
    expect(result.signedBytes).toBeInstanceOf(Uint8Array)
    expect(result.cid.toString()).toMatch(/^bafy/)
  })
})

describe('signDocumentChange', () => {
  it('returns change blob + ref blob', async () => {
    const unsignedBytes = await createMockUnsignedChange()
    const signer = createMockSigner()

    const {changeCid, publishInput} = await signDocumentChange(
      {account: TEST_ACCOUNT_UID, unsignedChange: unsignedBytes},
      signer,
    )

    expect(changeCid).toBeDefined()
    expect(changeCid.toString()).toMatch(/^bafy/)
    // One change blob + one ref blob
    expect(publishInput.blobs).toHaveLength(2)
    expect(publishInput.blobs[0]!.cid).toBe(changeCid.toString())
    expect(publishInput.blobs[0]!.data).toBeInstanceOf(Uint8Array)
    expect(publishInput.blobs[1]!.data).toBeInstanceOf(Uint8Array)
  })

  it('uses changeCid as genesis when the unsigned change has no embedded genesis', async () => {
    const unsignedBytes = await createMockUnsignedChange({includeGenesis: false})
    const signer = createMockSigner()

    const {changeCid, publishInput} = await signDocumentChange(
      {account: TEST_ACCOUNT_UID, unsignedChange: unsignedBytes},
      signer,
    )

    // The ref blob should encode the genesis as the changeCid
    const refData = cborDecode(publishInput.blobs[1]!.data) as Record<string, unknown>
    expect(refData['type']).toBe('Ref')
    expect(refData['genesisBlob']?.toString()).toBe(changeCid.toString())
  })

  it('uses the genesis embedded in the unsigned change when present', async () => {
    const unsignedBytes = await createMockUnsignedChange()
    const signer = createMockSigner()
    const decodedUnsigned = cborDecode(unsignedBytes) as Record<string, unknown>

    const {publishInput} = await signDocumentChange({account: TEST_ACCOUNT_UID, unsignedChange: unsignedBytes}, signer)

    const refData = cborDecode(publishInput.blobs[1]!.data) as Record<string, unknown>
    expect(refData['type']).toBe('Ref')
    expect(refData['genesisBlob']?.toString()).toBe(decodedUnsigned['genesis']?.toString())
  })

  it('uses provided genesis when given', async () => {
    const unsignedBytes = await createMockUnsignedChange()
    const signer = createMockSigner()
    const knownGenesis = await makeTestCID({genesis: 'existing-doc'})

    const {publishInput} = await signDocumentChange(
      {
        account: TEST_ACCOUNT_UID,
        unsignedChange: unsignedBytes,
        genesis: knownGenesis.toString(),
        generation: 42,
      },
      signer,
    )

    expect(publishInput.blobs).toHaveLength(2)
    const refData = cborDecode(publishInput.blobs[1]!.data) as Record<string, unknown>
    expect(refData['genesisBlob']?.toString()).toBe(knownGenesis.toString())
  })

  it('produces consistent CIDs for the same input', async () => {
    const unsignedBytes = await createMockUnsignedChange()
    const signer = createMockSigner()

    const result1 = await signDocumentChange(
      {account: TEST_ACCOUNT_UID, unsignedChange: unsignedBytes, generation: 1000},
      signer,
    )
    const result2 = await signDocumentChange(
      {account: TEST_ACCOUNT_UID, unsignedChange: unsignedBytes, generation: 1000},
      signer,
    )

    expect(result1.changeCid.toString()).toBe(result2.changeCid.toString())
  })
})
