import {describe, expect, test} from 'vitest'
import {preparePublicKey, signWithKeyPair} from './auth-utils'
import {validateSignature} from './validate-signature'

describe('validateSignature', () => {
  test('validates signature with compressed public key', async () => {
    // Generate a test key pair
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true, // extractable
      ['sign', 'verify'],
    )

    // Create test data
    const testData = new TextEncoder().encode('Hello, World!')

    // Sign the data
    const signature = await crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: {name: 'SHA-256'},
      },
      keyPair.privateKey,
      testData,
    )

    // Compress the public key using preparePublicKey
    const compressedKey = await preparePublicKey(keyPair.publicKey)

    // Validate the signature
    const isValid = await validateSignature(compressedKey, new Uint8Array(signature), testData)

    expect(isValid).toBe(true)
  })

  test('rejects invalid signature', async () => {
    // Generate a test key pair
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true,
      ['sign', 'verify'],
    )

    // Create test data
    const testData = new TextEncoder().encode('Hello, World!')
    const wrongData = new TextEncoder().encode('Wrong Data!')

    // Sign the wrong data
    const signature = await crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: {name: 'SHA-256'},
      },
      keyPair.privateKey,
      wrongData,
    )

    // Compress the public key using preparePublicKey
    const compressedKey = await preparePublicKey(keyPair.publicKey)

    // Validate the signature against the original data (should fail)
    const isValid = await validateSignature(compressedKey, new Uint8Array(signature), testData)

    expect(isValid).toBe(false)
  })

  test('validates Ed25519 signatures for delegated web sessions', async () => {
    const keyPair = (await crypto.subtle.generateKey('Ed25519' as unknown as AlgorithmIdentifier, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair

    const testData = new TextEncoder().encode('delegated-notification-request')
    const signature = await signWithKeyPair(keyPair, testData)
    const compressedKey = await preparePublicKey(keyPair.publicKey)

    const isValid = await validateSignature(compressedKey, signature, testData)

    expect(isValid).toBe(true)
  })
})
