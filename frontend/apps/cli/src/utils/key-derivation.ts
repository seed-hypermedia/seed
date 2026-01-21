/**
 * Key derivation matching Go daemon implementation (backend/core/mnemonic.go)
 *
 * Derivation flow:
 * 1. Mnemonic + passphrase -> BIP39 seed (64 bytes)
 * 2. SLIP-10 derivation with path m/44'/104109'/0'
 * 3. Ed25519 key generation from derived seed
 * 4. Encode public key with multicodec prefix (0xed 0x01) + multibase base58btc
 *
 * The derivation path 104109 is Unicode code points for 'hm' (Hypermedia)
 */

import * as bip39 from 'bip39'
import SLIP10 from '@exodus/slip10'
import {base58btc} from 'multiformats/bases/base58'
import * as ed25519 from '@noble/ed25519'
import {sha512} from '@noble/hashes/sha512'

// Configure ed25519 to use sha512
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m))
ed25519.etc.sha512Async = async (...m) =>
  sha512(ed25519.etc.concatBytes(...m))

// Derivation path from backend/core/mnemonic.go
// 104109 = 'h' (104) + 'm' (109) - stands for Hypermedia
const KEY_DERIVATION_PATH = "m/44'/104109'/0'"

// Ed25519 multicodec prefix (0xed = 237, varint encoded as [0xed, 0x01])
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01])

export type KeyPair = {
  privateKey: Uint8Array
  publicKey: Uint8Array
  publicKeyWithPrefix: Uint8Array
  accountId: string
}

/**
 * Derives account ID from BIP39 mnemonic
 */
export function deriveAccountIdFromMnemonic(
  mnemonic: string | string[],
  passphrase = ''
): string {
  const keyPair = deriveKeyPairFromMnemonic(mnemonic, passphrase)
  return keyPair.accountId
}

/**
 * Derives full keypair from BIP39 mnemonic
 */
export function deriveKeyPairFromMnemonic(
  mnemonic: string | string[],
  passphrase = ''
): KeyPair {
  // Normalize mnemonic to string
  const mnemonicString = Array.isArray(mnemonic)
    ? mnemonic.join(' ')
    : mnemonic

  // 1. Convert mnemonic to BIP39 seed
  const seed = bip39.mnemonicToSeedSync(mnemonicString, passphrase)

  // 2. Derive key using SLIP-10
  const masterKey = SLIP10.fromSeed(seed)
  const derivedKey = masterKey.derive(KEY_DERIVATION_PATH)

  // 3. Get Ed25519 keys
  const privateKey = derivedKey.key
  const publicKey = ed25519.getPublicKey(privateKey)

  // 4. Encode public key with multicodec prefix
  const publicKeyWithPrefix = new Uint8Array([
    ...ED25519_MULTICODEC_PREFIX,
    ...publicKey,
  ])

  // 5. Encode as multibase base58btc (starts with 'z')
  const accountId = base58btc.encode(publicKeyWithPrefix)

  return {
    privateKey,
    publicKey,
    publicKeyWithPrefix,
    accountId,
  }
}

/**
 * Generates a new BIP39 mnemonic
 */
export function generateMnemonic(wordCount: 12 | 24 = 12): string {
  const strength = wordCount === 24 ? 256 : 128
  return bip39.generateMnemonic(strength)
}

/**
 * Validates a BIP39 mnemonic
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic)
}
