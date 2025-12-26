/**
 * Key derivation module matching the Go implementation in backend/core/mnemonic.go
 *
 * Derivation flow:
 * 1. Mnemonic + passphrase → BIP39 seed (64 bytes)
 * 2. SLIP-10 derivation with path m/44'/104109'/0'
 * 3. Ed25519 key generation from derived seed
 * 4. Encode public key with multicodec prefix (0xed 0x01) + multibase base58btc
 */

import * as bip39 from 'bip39'
import SLIP10 from '@exodus/slip10'
import { base58btc } from 'multiformats/bases/base58'
import * as ed25519 from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'

// Set SHA-512 for ed25519 library
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m))

// Derivation path from backend/core/mnemonic.go:28
// 104109 is the concatenation of Unicode code point values for 'hm' - stands for Hypermedia
const KEY_DERIVATION_PATH = "m/44'/104109'/0'"

// Ed25519 multicodec prefix
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01])

/**
 * Validates a BIP39 mnemonic
 */
export function validateMnemonic(mnemonic: string): boolean {
  // Explicitly pass the English wordlist - Metro bundler may not set the default correctly
  return bip39.validateMnemonic(mnemonic, bip39.wordlists.english)
}

/**
 * Derives account ID from a BIP39 mnemonic
 */
export function deriveAccountIdFromMnemonic(
  mnemonic: string | string[],
  passphrase: string = ''
): string {
  const mnemonicString = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic
  const seed = bip39.mnemonicToSeedSync(mnemonicString, passphrase)

  const masterKey = SLIP10.fromSeed(seed)
  const derivedKey = masterKey.derive(KEY_DERIVATION_PATH)

  const privateKeyBytes = derivedKey.key
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes)

  const publicKeyWithPrefix = new Uint8Array([
    ...ED25519_MULTICODEC_PREFIX,
    ...publicKeyBytes,
  ])

  return base58btc.encode(publicKeyWithPrefix)
}

/**
 * Derives full keypair from a BIP39 mnemonic
 */
export function deriveKeyPairFromMnemonic(
  mnemonic: string | string[],
  passphrase: string = ''
): {
  privateKey: Uint8Array
  publicKey: Uint8Array
  accountId: string
} {
  const mnemonicString = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic
  const seed = bip39.mnemonicToSeedSync(mnemonicString, passphrase)

  const masterKey = SLIP10.fromSeed(seed)
  const derivedKey = masterKey.derive(KEY_DERIVATION_PATH)

  const privateKeyBytes = derivedKey.key
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes)

  const publicKeyWithPrefix = new Uint8Array([
    ...ED25519_MULTICODEC_PREFIX,
    ...publicKeyBytes,
  ])

  const accountId = base58btc.encode(publicKeyWithPrefix)

  return {
    privateKey: privateKeyBytes,
    publicKey: publicKeyBytes,
    accountId,
  }
}
