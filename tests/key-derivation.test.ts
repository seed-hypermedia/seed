/**
 * Test that JavaScript key derivation matches Go implementation
 */

import {describe, it, expect} from 'vitest'
import {deriveAccountIdFromMnemonic, deriveKeyPairFromMnemonic} from './key-derivation'

// Test mnemonic and expected account ID from the Go implementation
const TEST_MNEMONIC = "parrot midnight lion defense ski senior trouble slice chase spot history awkward"
const EXPECTED_ACCOUNT_ID = "z6Mkm3c7LJn7vJ7XZQZHKNufnG6v9mCsVwLoG6v8ngY7aXq8"

describe('Key Derivation', () => {
  it('should derive the same account ID as Go implementation', () => {
    const accountId = deriveAccountIdFromMnemonic(TEST_MNEMONIC, '')
    expect(accountId).toBe(EXPECTED_ACCOUNT_ID)
  })

  it('should work with mnemonic as array', () => {
    const mnemonicArray = TEST_MNEMONIC.split(' ')
    const accountId = deriveAccountIdFromMnemonic(mnemonicArray, '')
    expect(accountId).toBe(EXPECTED_ACCOUNT_ID)
  })

  it('should derive full keypair with correct account ID', () => {
    const keypair = deriveKeyPairFromMnemonic(TEST_MNEMONIC, '')

    expect(keypair.accountId).toBe(EXPECTED_ACCOUNT_ID)
    expect(keypair.privateKey).toHaveLength(32)
    expect(keypair.publicKey).toHaveLength(32)
  })

  it('should produce different account IDs with different passphrases', () => {
    const accountId1 = deriveAccountIdFromMnemonic(TEST_MNEMONIC, '')
    const accountId2 = deriveAccountIdFromMnemonic(TEST_MNEMONIC, 'password123')

    expect(accountId1).not.toBe(accountId2)
    expect(accountId1).toBe(EXPECTED_ACCOUNT_ID)
  })

  it('should be deterministic - same input produces same output', () => {
    const accountId1 = deriveAccountIdFromMnemonic(TEST_MNEMONIC, '')
    const accountId2 = deriveAccountIdFromMnemonic(TEST_MNEMONIC, '')
    const accountId3 = deriveAccountIdFromMnemonic(TEST_MNEMONIC, '')

    expect(accountId1).toBe(accountId2)
    expect(accountId2).toBe(accountId3)
    expect(accountId1).toBe(EXPECTED_ACCOUNT_ID)
  })

  it('should produce account IDs starting with z (base58btc multibase)', () => {
    const accountId = deriveAccountIdFromMnemonic(TEST_MNEMONIC, '')
    expect(accountId).toMatch(/^z/)
  })

  // Test with additional known mnemonics to ensure consistency
  describe('Additional test vectors', () => {
    const testVectors = [
      {
        mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        passphrase: "",
        // This will be verified against Go implementation if we run it
      },
    ]

    testVectors.forEach((vector, index) => {
      it(`should derive consistent account ID for test vector ${index + 1}`, () => {
        const accountId = deriveAccountIdFromMnemonic(vector.mnemonic, vector.passphrase)

        // Account ID should be deterministic
        const accountId2 = deriveAccountIdFromMnemonic(vector.mnemonic, vector.passphrase)
        expect(accountId).toBe(accountId2)

        // Should start with z (base58btc)
        expect(accountId).toMatch(/^z6Mk/)
      })
    })
  })
})
