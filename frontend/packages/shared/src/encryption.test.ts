import {describe, expect, test} from 'vitest'
import * as encryption from './encryption'

describe('encryption', () => {
  test('deriveKeyFromPassword returns 32 bytes', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await encryption.deriveKeyFromPassword('testpassword', salt, encryption.DEFAULT_PARAMS)
    expect(key).toBeInstanceOf(Uint8Array)
    expect(key.length).toBe(32)
  })

  test('same password and salt produce the same key', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key1 = await encryption.deriveKeyFromPassword('mypassword', salt, encryption.DEFAULT_PARAMS)
    const key2 = await encryption.deriveKeyFromPassword('mypassword', salt, encryption.DEFAULT_PARAMS)
    expect(key1).toEqual(key2)
  })

  test('different salts produce different keys', async () => {
    const salt1 = crypto.getRandomValues(new Uint8Array(16))
    const salt2 = crypto.getRandomValues(new Uint8Array(16))
    const key1 = await encryption.deriveKeyFromPassword('samepassword', salt1, encryption.DEFAULT_PARAMS)
    const key2 = await encryption.deriveKeyFromPassword('samepassword', salt2, encryption.DEFAULT_PARAMS)
    expect(key1).not.toEqual(key2)
  })

  test('encrypt and decrypt roundtrip', async () => {
    const plaintext = new TextEncoder().encode('Hello, World!')
    const key = new Uint8Array(32).fill(42)
    const encrypted = await encryption.encrypt(plaintext, key)
    expect(encrypted.length).toBeGreaterThan(24)
    const decrypted = await encryption.decrypt(encrypted, key)
    expect(decrypted).toEqual(plaintext)
  })

  test('decrypt fails with the wrong key', async () => {
    const plaintext = new TextEncoder().encode('Secret')
    const encrypted = await encryption.encrypt(plaintext, new Uint8Array(32).fill(1))
    await expect(encryption.decrypt(encrypted, new Uint8Array(32).fill(2))).rejects.toThrow()
  })
})
