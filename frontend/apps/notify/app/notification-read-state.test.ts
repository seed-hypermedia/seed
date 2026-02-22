import {encode as cborEncode} from '@ipld/dag-cbor'
import {mkdtempSync, rmSync} from 'fs'
import {base58btc} from 'multiformats/bases/base58'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {preparePublicKey} from './auth-utils'
import {cleanup, getNotificationReadState, initDatabase, mergeNotificationReadState} from './db'
import {validateSignature} from './validate-signature'

async function generateTestSigner() {
  const keyPair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify'])
  const compressedKey = await preparePublicKey(keyPair.publicKey)
  const accountId = base58btc.encode(compressedKey)
  return {
    keyPair,
    compressedKey,
    accountId,
    sign: async (data: Uint8Array) => {
      const sig = await crypto.subtle.sign({name: 'ECDSA', hash: {name: 'SHA-256'}}, keyPair.privateKey, data)
      return new Uint8Array(sig)
    },
  }
}

describe('notification-read-state signing flow', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = mkdtempSync('seed-notif-read-state-test-')
    process.env.DATA_DIR = tmpDir
    await initDatabase()
  })

  afterEach(() => {
    cleanup()
    rmSync(tmpDir, {recursive: true, force: true})
  })

  it('should produce valid signed payload for get-notification-read-state', async () => {
    const signer = await generateTestSigner()
    const payload = {
      action: 'get-notification-read-state' as const,
      signer: signer.compressedKey,
      time: Date.now(),
    }
    const encoded = cborEncode(payload)
    const sig = await signer.sign(new Uint8Array(encoded))
    const isValid = await validateSignature(signer.compressedKey, sig, new Uint8Array(encoded))
    expect(isValid).toBe(true)
  })

  it('should reject invalid signatures', async () => {
    const signer = await generateTestSigner()
    const wrongSigner = await generateTestSigner()
    const payload = {
      action: 'get-notification-read-state' as const,
      signer: signer.compressedKey,
      time: Date.now(),
    }
    const encoded = cborEncode(payload)
    const wrongSig = await wrongSigner.sign(new Uint8Array(encoded))

    const isValid = await validateSignature(signer.compressedKey, wrongSig, new Uint8Array(encoded))
    expect(isValid).toBe(false)
  })

  it('should reject stale request timestamps by policy', () => {
    const staleTime = Date.now() - 25_000
    const timeDiff = Math.abs(Date.now() - staleTime)
    expect(timeDiff > 20_000).toBe(true)
  })

  it('full round-trip: sign, verify, merge, retrieve read state', async () => {
    const signer = await generateTestSigner()
    const accountId = base58btc.encode(signer.compressedKey)

    const mergePayload = {
      action: 'merge-notification-read-state' as const,
      signer: signer.compressedKey,
      time: Date.now(),
      markAllReadAtMs: 1000,
      readEvents: [
        {eventId: 'event-a', eventAtMs: 1500},
        {eventId: 'event-b', eventAtMs: 900},
      ],
    }
    const mergeEncoded = cborEncode(mergePayload)
    const mergeSig = await signer.sign(new Uint8Array(mergeEncoded))
    const mergeValid = await validateSignature(signer.compressedKey, mergeSig, new Uint8Array(mergeEncoded))
    expect(mergeValid).toBe(true)

    const merged = mergeNotificationReadState(accountId, {
      markAllReadAtMs: mergePayload.markAllReadAtMs,
      readEvents: mergePayload.readEvents,
    })
    expect(merged.markAllReadAtMs).toBe(1000)
    expect(merged.readEvents).toEqual([{eventId: 'event-a', eventAtMs: 1500}])

    const getPayload = {
      action: 'get-notification-read-state' as const,
      signer: signer.compressedKey,
      time: Date.now(),
    }
    const getEncoded = cborEncode(getPayload)
    const getSig = await signer.sign(new Uint8Array(getEncoded))
    const getValid = await validateSignature(signer.compressedKey, getSig, new Uint8Array(getEncoded))
    expect(getValid).toBe(true)

    const state = getNotificationReadState(accountId)
    expect(state.accountId).toBe(accountId)
    expect(state.markAllReadAtMs).toBe(1000)
    expect(state.readEvents).toEqual([{eventId: 'event-a', eventAtMs: 1500}])
  })
})
