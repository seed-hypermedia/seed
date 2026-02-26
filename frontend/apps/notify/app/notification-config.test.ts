import {encode as cborEncode} from '@ipld/dag-cbor'
import {mkdtempSync, rmSync} from 'fs'
import {base58btc} from 'multiformats/bases/base58'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {preparePublicKey} from './auth-utils'
import {cleanup, getNotificationConfig, initDatabase, setNotificationConfig} from './db'
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

describe('notification-config signing flow', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = mkdtempSync('seed-notif-test-')
    process.env.DATA_DIR = tmpDir
    await initDatabase()
  })

  afterEach(() => {
    cleanup()
    rmSync(tmpDir, {recursive: true, force: true})
  })

  it('should produce valid signed payload for get-notification-config', async () => {
    const signer = await generateTestSigner()
    const payload = {
      action: 'get-notification-config' as const,
      signer: signer.compressedKey,
      time: Date.now(),
    }
    const encoded = cborEncode(payload)
    const sig = await signer.sign(new Uint8Array(encoded))
    const isValid = await validateSignature(signer.compressedKey, sig, new Uint8Array(encoded))
    expect(isValid).toBe(true)
  })

  it('should produce valid signed payload for set-notification-config', async () => {
    const signer = await generateTestSigner()
    const payload = {
      action: 'set-notification-config' as const,
      signer: signer.compressedKey,
      time: Date.now(),
      email: 'test@example.com',
    }
    const encoded = cborEncode(payload)
    const sig = await signer.sign(new Uint8Array(encoded))
    const isValid = await validateSignature(signer.compressedKey, sig, new Uint8Array(encoded))
    expect(isValid).toBe(true)
  })

  it('should produce valid signed payload for resend-notification-config-verification', async () => {
    const signer = await generateTestSigner()
    const payload = {
      action: 'resend-notification-config-verification' as const,
      signer: signer.compressedKey,
      time: Date.now(),
    }
    const encoded = cborEncode(payload)
    const sig = await signer.sign(new Uint8Array(encoded))
    const isValid = await validateSignature(signer.compressedKey, sig, new Uint8Array(encoded))
    expect(isValid).toBe(true)
  })

  it('should produce valid signed payload for remove-notification-config', async () => {
    const signer = await generateTestSigner()
    const payload = {
      action: 'remove-notification-config' as const,
      signer: signer.compressedKey,
      time: Date.now(),
    }
    const encoded = cborEncode(payload)
    const sig = await signer.sign(new Uint8Array(encoded))
    const isValid = await validateSignature(signer.compressedKey, sig, new Uint8Array(encoded))
    expect(isValid).toBe(true)
  })

  it('should reject signature with wrong data', async () => {
    const signer = await generateTestSigner()
    const payload = {
      action: 'get-notification-config' as const,
      signer: signer.compressedKey,
      time: Date.now(),
    }
    const encoded = cborEncode(payload)
    const sig = await signer.sign(new Uint8Array(encoded))
    const tampered = cborEncode({...payload, time: Date.now() + 1000})
    const isValid = await validateSignature(signer.compressedKey, sig, new Uint8Array(tampered))
    expect(isValid).toBe(false)
  })

  it('should reject signature from different key', async () => {
    const signer1 = await generateTestSigner()
    const signer2 = await generateTestSigner()
    const payload = {
      action: 'get-notification-config' as const,
      signer: signer1.compressedKey,
      time: Date.now(),
    }
    const encoded = cborEncode(payload)
    const sig = await signer2.sign(new Uint8Array(encoded))
    const isValid = await validateSignature(signer1.compressedKey, sig, new Uint8Array(encoded))
    expect(isValid).toBe(false)
  })

  it('should derive consistent accountId from compressed key', async () => {
    const signer = await generateTestSigner()
    const accountId1 = base58btc.encode(signer.compressedKey)
    const accountId2 = base58btc.encode(signer.compressedKey)
    expect(accountId1).toBe(accountId2)
    expect(accountId1).toBe(signer.accountId)
  })

  it('full round-trip: sign, verify, store, retrieve config', async () => {
    const signer = await generateTestSigner()

    // Simulate set-notification-config
    const setPayload = {
      action: 'set-notification-config' as const,
      signer: signer.compressedKey,
      time: Date.now(),
      email: 'user@test.com',
    }
    const setEncoded = cborEncode(setPayload)
    const setSig = await signer.sign(new Uint8Array(setEncoded))
    const setValid = await validateSignature(signer.compressedKey, setSig, new Uint8Array(setEncoded))
    expect(setValid).toBe(true)

    // Store in DB
    const accountId = base58btc.encode(signer.compressedKey)
    setNotificationConfig(accountId, setPayload.email)

    // Simulate get-notification-config
    const getPayload = {
      action: 'get-notification-config' as const,
      signer: signer.compressedKey,
      time: Date.now(),
    }
    const getEncoded = cborEncode(getPayload)
    const getSig = await signer.sign(new Uint8Array(getEncoded))
    const getValid = await validateSignature(signer.compressedKey, getSig, new Uint8Array(getEncoded))
    expect(getValid).toBe(true)

    // Retrieve from DB
    const config = getNotificationConfig(accountId)
    expect(config).not.toBeNull()
    expect(config!.email).toBe('user@test.com')
    expect(config!.accountId).toBe(accountId)
  })

  it('should verify CBOR-encoded payload matches sign-then-strip-sig pattern', async () => {
    const signer = await generateTestSigner()
    const unsigned = {
      action: 'set-notification-config' as const,
      signer: signer.compressedKey,
      time: Date.now(),
      email: 'pattern@test.com',
    }
    const encoded = cborEncode(unsigned)
    const sig = await signer.sign(new Uint8Array(encoded))

    // This is how the server re-encodes: strip sig from signed payload, re-encode rest
    const signedPayload = {...unsigned, sig}
    const {sig: extractedSig, ...restPayload} = signedPayload
    const reEncoded = cborEncode(restPayload)

    // Verify that re-encoding produces the same bytes
    expect(new Uint8Array(reEncoded)).toEqual(new Uint8Array(encoded))

    // And signature is still valid
    const isValid = await validateSignature(signer.compressedKey, extractedSig, new Uint8Array(reEncoded))
    expect(isValid).toBe(true)
  })
})
