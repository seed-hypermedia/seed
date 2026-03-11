/**
 * Unit tests for the crypto module.
 * Tests key derivation, encryption/decryption, and encoding utilities.
 */
import {describe, expect, test} from 'bun:test'
import * as base64 from '@shm/shared/base64'
import * as crypto from './crypto'

describe('crypto utilities', () => {
  test('generatePasswordSalt produces random 16-byte salts', () => {
    const salt1 = crypto.generatePasswordSalt()
    const salt2 = crypto.generatePasswordSalt()
    expect(salt1).toBeInstanceOf(Uint8Array)
    expect(salt1.length).toBe(16)
    expect(salt2.length).toBe(16)
    expect(salt1).not.toEqual(salt2)
  })

  test('generateNonce returns 24 bytes', () => {
    const nonce = crypto.generateNonce()
    expect(nonce).toBeInstanceOf(Uint8Array)
    expect(nonce.length).toBe(24)
  })

  test('generateDEK returns 64 bytes', () => {
    const dek = crypto.generateDEK()
    expect(dek).toBeInstanceOf(Uint8Array)
    expect(dek.length).toBe(64)
  })
})

describe('base64url encoding', () => {
  test('encode and decode roundtrip', () => {
    const original = new Uint8Array([0, 1, 2, 255, 254, 253])
    const encoded = base64.encode(original)
    const decoded = base64.decode(encoded)
    expect(decoded).toEqual(original)
  })

  test('handles empty array', () => {
    const empty = new Uint8Array([])
    const encoded = base64.encode(empty)
    const decoded = base64.decode(encoded)
    expect(decoded).toEqual(empty)
  })

  test('produces URL-safe characters', () => {
    // Test data that would produce + and / in standard base64.
    const data = new Uint8Array([251, 255, 254])
    const encoded = base64.encode(data)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
  })
})

describe('key derivation', () => {
  test('deriveKeyFromPassword returns 32 bytes', async () => {
    const salt = crypto.generatePasswordSalt()
    const key = await crypto.deriveKeyFromPassword('testpassword', salt, crypto.DEFAULT_ARGON2_PARAMS)
    expect(key).toBeInstanceOf(Uint8Array)
    expect(key.length).toBe(32)
  })

  test('same password and salt produce same key', async () => {
    const salt = crypto.generatePasswordSalt()
    const key1 = await crypto.deriveKeyFromPassword('mypassword', salt, crypto.DEFAULT_ARGON2_PARAMS)
    const key2 = await crypto.deriveKeyFromPassword('mypassword', salt, crypto.DEFAULT_ARGON2_PARAMS)
    expect(key1).toEqual(key2)
  })

  test('different passwords produce different keys', async () => {
    const salt = crypto.generatePasswordSalt()
    const key1 = await crypto.deriveKeyFromPassword('password1', salt, crypto.DEFAULT_ARGON2_PARAMS)
    const key2 = await crypto.deriveKeyFromPassword('password2', salt, crypto.DEFAULT_ARGON2_PARAMS)
    expect(key1).not.toEqual(key2)
  })

  test('different salts produce different keys', async () => {
    const salt1 = crypto.generatePasswordSalt()
    const salt2 = crypto.generatePasswordSalt()
    const key1 = await crypto.deriveKeyFromPassword('samepassword', salt1, crypto.DEFAULT_ARGON2_PARAMS)
    const key2 = await crypto.deriveKeyFromPassword('samepassword', salt2, crypto.DEFAULT_ARGON2_PARAMS)
    expect(key1).not.toEqual(key2)
  })

  test('deriveEncryptionKey returns 32 bytes', async () => {
    const masterKey = new Uint8Array(32).fill(42)
    const encryptionKey = await crypto.deriveEncryptionKey(masterKey)
    expect(encryptionKey).toBeInstanceOf(Uint8Array)
    expect(encryptionKey.length).toBe(32)
  })

  test('HKDF derivations are deterministic and distinct', async () => {
    const masterKey = new Uint8Array(32).fill(123)
    const encryptionKey1 = await crypto.deriveEncryptionKey(masterKey)
    const encryptionKey2 = await crypto.deriveEncryptionKey(masterKey)
    const authKey1 = await crypto.deriveAuthKey(masterKey)
    const authKey2 = await crypto.deriveAuthKey(masterKey)

    expect(encryptionKey1).toEqual(encryptionKey2)
    expect(authKey1).toEqual(authKey2)
    expect(encryptionKey1).not.toEqual(authKey1)
  })
})

describe('encryption and decryption', () => {
  test('encrypt and decrypt roundtrip', async () => {
    const plaintext = new TextEncoder().encode('Hello, World!')
    const key = new Uint8Array(64).fill(42)

    const encrypted = await crypto.encrypt(plaintext, key)
    const decrypted = await crypto.decrypt(encrypted, key)

    expect(decrypted).toEqual(plaintext)
  })

  test('ciphertext is different from plaintext', async () => {
    const plaintext = new TextEncoder().encode('Secret message')
    const key = new Uint8Array(64).fill(99)

    const encrypted = await crypto.encrypt(plaintext, key)
    expect(encrypted).not.toEqual(plaintext)
  })

  test('different nonces produce different ciphertexts', async () => {
    const plaintext = new TextEncoder().encode('Same message')
    const key = new Uint8Array(64).fill(77)

    const result1 = await crypto.encrypt(plaintext, key)
    const result2 = await crypto.encrypt(plaintext, key)

    // The whole blob should be different because nonce is different.
    expect(result1).not.toEqual(result2)
  })

  test('decryption with wrong key fails', async () => {
    const plaintext = new TextEncoder().encode('Secret')
    const correctKey = new Uint8Array(64).fill(1)
    const wrongKey = new Uint8Array(64).fill(2)

    const encrypted = await crypto.encrypt(plaintext, correctKey)

    // Depending on polyfill or native implementation, this might throw or return garbage.
    // XChaCha20-Poly1305 usually throws on tag mismatch.
    await expect(crypto.decrypt(encrypted, wrongKey)).rejects.toThrow()
  })

  test('decryption with tampered data fails', async () => {
    const plaintext = new TextEncoder().encode('Secret')
    const key = new Uint8Array(64).fill(1)

    const encrypted = await crypto.encrypt(plaintext, key)

    // Tamper with the last byte (auth tag or ciphertext).
    encrypted[encrypted.length - 1]! ^= 1

    expect(crypto.decrypt(encrypted, key)).rejects.toThrow()
  })
})

describe('full key derivation flow', () => {
  test('password flow derives distinct auth and encryption keys', async () => {
    const password = 'MySecurePassword123!'
    const salt = crypto.generatePasswordSalt()

    // Derive master key.
    const masterKey = await crypto.deriveKeyFromPassword(password, salt, crypto.DEFAULT_ARGON2_PARAMS)
    expect(masterKey.length).toBe(32)

    const encryptionKey = await crypto.deriveEncryptionKey(masterKey)
    const authKey = await crypto.deriveAuthKey(masterKey)
    expect(encryptionKey.length).toBe(32)
    expect(authKey.length).toBe(32)
    expect(encryptionKey).not.toEqual(authKey)

    // Encrypt DEK with derived encryption key.
    const dek = crypto.generateDEK()
    const encryptedDEK = await crypto.encrypt(dek, encryptionKey)

    // Decrypt DEK.
    const decryptedDEK = await crypto.decrypt(encryptedDEK, encryptionKey)
    expect(decryptedDEK).toEqual(dek)
  })
})
