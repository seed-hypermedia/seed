/**
 * The home document's genesis is a wire-format contract shared with the daemon.
 *
 * The daemon's ensureProfileGenesis and the SDK's createHomeGenesisChange must produce the
 * same bytes for the same key: an empty Change {ts: 0, sig, type, signer}, signed over the
 * encoding with a zeroed signature. The daemon addresses blobs by blake2b-256 and the SDK by
 * sha256, so the same bytes carry two CIDs; both are pinned here, and the daemon side pins
 * the same values in backend/blob/home_genesis_test.go. Change one without the other and an
 * account's home document forks between devices.
 *
 * Key: the shared test fixture account (test-fixtures/account.json).
 */
import {ed25519} from '@noble/curves/ed25519.js'
import {blake2b} from '@noble/hashes/blake2.js'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import {describe, expect, it} from 'vitest'
import {createGenesisChange, createHomeGenesisChange} from './change'

const FIXTURE_ACCOUNT_ID = 'z6MkhMSRCyK9KkAzTmzTKSfuNMaEuYZUJacWmbqiHYkCQgSW'
const FIXTURE_PRIVATE_KEY = hex('563463435d9a4595f604d677ebca9d9f2dbfd067e1ad39371681a18cf9875a63')
const FIXTURE_PUBLIC_KEY_WITH_PREFIX = hex('ed012b154dea9ea72d6c636ec820845c615f99469bb15d2091048a79c4416c5ffc2b')

// What backend/blob.NewChange(kp, cid.Undef, nil, 0, ChangeBody{}, ZeroUnixTime()) emits for
// this key (see backend/blob/home_genesis_test.go).
export const HOME_GENESIS_GOLDEN = {
  bytes:
    'a462747300637369675840c07500a616d134a9e1f65828df3d106b5d36a88db2bb8d90f958c23b3eb009c455298a9fe4b878621fd4791f46603bf632e1bd6ef76dc614a30dae30d93fd50a6474797065664368616e6765667369676e65725822ed012b154dea9ea72d6c636ec820845c615f99469bb15d2091048a79c4416c5ffc2b',
  sdkCid: 'bafyreibhn2gdntqwdbxbc57nkoyi67zhsmiu4sgwxenfcfucqe2mljn5w4',
  daemonCid: 'bafy2bzaceatflan6p5gb3polaggn6znslbr2mfre77anuni6ukxcnzuziy4g2',
}

function hex(s: string): Uint8Array {
  return Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)))
}

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

const fixtureSigner = {
  getPublicKey: async () => FIXTURE_PUBLIC_KEY_WITH_PREFIX,
  sign: async (data: Uint8Array) => ed25519.sign(data, FIXTURE_PRIVATE_KEY),
}

describe('home document genesis (daemon contract)', () => {
  it('is the exact bytes the daemon produces for the same key', async () => {
    const genesis = await createHomeGenesisChange(fixtureSigner)
    expect(toHex(genesis.bytes)).toBe(HOME_GENESIS_GOLDEN.bytes)
    expect(genesis.cid.toString()).toBe(HOME_GENESIS_GOLDEN.sdkCid)
  })

  it('is an empty change: exactly ts 0, sig, type and signer', async () => {
    const genesis = await createHomeGenesisChange(fixtureSigner)
    const decoded = cborDecode(genesis.bytes) as Record<string, unknown>
    expect(Object.keys(decoded).sort()).toEqual(['sig', 'signer', 'ts', 'type'])
    expect(decoded['type']).toBe('Change')
    expect(BigInt(decoded['ts'] as number | bigint)).toBe(0n)
    expect(toHex(decoded['signer'] as Uint8Array)).toBe(toHex(FIXTURE_PUBLIC_KEY_WITH_PREFIX))
    expect((decoded['sig'] as Uint8Array).length).toBe(64)
  })

  it('carries the daemon CID under blake2b-256, the address desktop-created homes use', async () => {
    const genesis = await createHomeGenesisChange(fixtureSigner)
    const digest = Digest.create(0xb220, blake2b(genesis.bytes, {dkLen: 32}))
    expect(CID.createV1(0x71, digest).toString()).toBe(HOME_GENESIS_GOLDEN.daemonCid)
  })

  it('is deterministic per key, and the deprecated alias is the same thing', async () => {
    const a = await createHomeGenesisChange(fixtureSigner)
    const b = await createGenesisChange(fixtureSigner)
    expect(a.cid.toString()).toBe(b.cid.toString())
    expect(FIXTURE_ACCOUNT_ID.startsWith('z6Mk')).toBe(true)
  })
})
