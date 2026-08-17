import {encode as dagEncode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {describe, expect, test} from 'vitest'
import * as blobs from './blobs'
import {createCapability} from './capability'
import * as cbor from './cbor'
import type {HMSigner} from './hm-types'
import {toHMSigner, toPrincipalSigner} from './signer'

const seed = new Uint8Array(32).fill(7)
const delegateSeed = new Uint8Array(32).fill(9)

function principalSigner() {
  return blobs.nobleKeyPairFromSeed(seed)
}

function hmSigner(): HMSigner {
  const kp = blobs.nobleKeyPairFromSeed(seed)
  return {
    getPublicKey: async () => kp.principal,
    sign: (data) => kp.sign(data),
  }
}

describe('signer normalization', () => {
  test('toHMSigner and toPrincipalSigner agree on the principal', async () => {
    const fromPrincipal = await toPrincipalSigner(principalSigner())
    const fromHM = await toPrincipalSigner(hmSigner())
    expect(blobs.principalEqual(fromPrincipal.principal, fromHM.principal)).toBe(true)

    expect(await toHMSigner(principalSigner()).getPublicKey()).toEqual(await hmSigner().getPublicKey())
  })

  test('normalization round-trips without changing signatures', async () => {
    const data = new TextEncoder().encode('payload')
    const direct = await principalSigner().sign(data)
    const viaHM = await toHMSigner(principalSigner()).sign(data)
    const viaPrincipal = await (await toPrincipalSigner(hmSigner())).sign(data)

    expect(viaHM).toEqual(direct)
    expect(viaPrincipal).toEqual(direct)
  })

  test('passing through an already-normalized signer is a no-op', async () => {
    const original = principalSigner()
    expect(await toPrincipalSigner(original)).toBe(original)
    const hm = hmSigner()
    expect(toHMSigner(hm)).toBe(hm)
  })
})

describe('blob builders accept either signer shape', () => {
  test('createCapability produces identical bytes from both shapes', async () => {
    const delegate = blobs.nobleKeyPairFromSeed(delegateSeed).principal
    const ts = 1_700_000_000_000

    const fromPrincipal = await blobs.createCapability(principalSigner(), delegate, 'AGENT', ts, {label: 'x'})
    const fromHM = await blobs.createCapability(hmSigner(), delegate, 'AGENT', ts, {label: 'x'})

    expect(fromHM.data).toEqual(fromPrincipal.data)
    expect(fromHM.cid.toString()).toBe(fromPrincipal.cid.toString())
    expect(blobs.verify(fromHM.decoded)).toBe(true)
  })

  test('createProfile produces identical bytes from both shapes', async () => {
    const ts = 1_700_000_000_000
    const fromPrincipal = await blobs.createProfile(principalSigner(), {name: 'Test'}, ts)
    const fromHM = await blobs.createProfile(hmSigner(), {name: 'Test'}, ts)

    expect(fromHM.data).toEqual(fromPrincipal.data)
    expect(blobs.verify(fromHM.decoded)).toBe(true)
  })
})

describe('capability.createCapability delegates without changing the wire format', () => {
  test('matches a hand-rolled blob of the pre-dedupe shape', async () => {
    const kp = blobs.nobleKeyPairFromSeed(seed)
    const delegate = blobs.nobleKeyPairFromSeed(delegateSeed).principal
    const delegateUid = blobs.principalToString(delegate)

    const result = await createCapability({delegateUid, role: 'AGENT', label: 'x', path: '/p'}, kp)
    const actual = result.blobs[0]!.data

    // Reconstruct exactly what the old implementation emitted: bigint ts, raw
    // dag-cbor, keys omitted rather than nulled.
    const decoded = cbor.decode<Record<string, unknown>>(actual)
    const unsigned: Record<string, unknown> = {
      type: 'Capability',
      signer: kp.principal,
      sig: new Uint8Array(64),
      ts: BigInt(decoded.ts as number),
      delegate: new Uint8Array(base58btc.decode(delegateUid)),
      role: 'AGENT',
      path: '/p',
      label: 'x',
    }
    unsigned.sig = await kp.sign(dagEncode(unsigned))
    const expected = dagEncode(unsigned)

    expect(new Uint8Array(actual)).toEqual(new Uint8Array(expected))
  })

  test('omits absent path and label rather than encoding null', async () => {
    const kp = blobs.nobleKeyPairFromSeed(seed)
    const delegateUid = blobs.principalToString(blobs.nobleKeyPairFromSeed(delegateSeed).principal)

    const result = await createCapability({delegateUid, role: 'WRITER'}, kp)
    const decoded = cbor.decode<Record<string, unknown>>(result.blobs[0]!.data)

    expect('path' in decoded).toBe(false)
    expect('label' in decoded).toBe(false)
  })

  test('accepts an HMSigner too', async () => {
    const delegateUid = blobs.principalToString(blobs.nobleKeyPairFromSeed(delegateSeed).principal)
    const result = await createCapability({delegateUid, role: 'AGENT'}, hmSigner())
    expect(blobs.verify(cbor.decode(result.blobs[0]!.data))).toBe(true)
  })
})
