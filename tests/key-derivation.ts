/**
 * Key derivation module matching the Go implementation in backend/core/mnemonic.go
 *
 * Derivation flow:
 * 1. Mnemonic + passphrase → BIP39 seed (64 bytes)
 * 2. SLIP-10 derivation with path m/44'/104109'/0'
 * 3. Ed25519 key generation from derived seed
 * 4. Encode public key with multicodec prefix (0xed 0x01) + multibase base58btc
 *
 * The derivation path 104109 is the concatenation of Unicode code points for 'hm' (Hypermedia)
 */

import * as bip39 from 'bip39'
import SLIP10 from '@exodus/slip10'
import {base58btc} from 'multiformats/bases/base58'
import * as ed25519 from '@noble/ed25519'
import {sha512} from '@noble/hashes/sha2.js'

// Set SHA-512 for ed25519 library (v3.0 syntax)
ed25519.hashes.sha512 = sha512
ed25519.hashes.sha512Async = (m) => Promise.resolve(sha512(m))

// Derivation path from backend/core/mnemonic.go:28
// 104109 is the concatenation of Unicode code point values for 'hm' - stands for Hypermedia
const KEY_DERIVATION_PATH = "m/44'/104109'/0'"

// Ed25519 multicodec prefix from backend/core/crypto.go:50-51
// multicodec.Ed25519Pub = 0xed (237 in decimal)
// The varint encoding of 237 is [0xed, 0x01]
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01])

/**
 * Derives a keypair from a BIP39 mnemonic using the same logic as Go implementation
 * @param mnemonic - BIP39 mnemonic words (space-separated string or array)
 * @param passphrase - Optional passphrase (empty string if not used)
 * @returns Account ID (multibase base58btc encoded public key)
 */
export function deriveAccountIdFromMnemonic(
  mnemonic: string | string[],
  passphrase: string = '',
): string {
  // 1. Convert mnemonic to BIP39 seed
  const mnemonicString = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic
  const seed = bip39.mnemonicToSeedSync(mnemonicString, passphrase)

  // 2. Derive key using SLIP-10 with our custom path
  const masterKey = SLIP10.fromSeed(seed)
  const derivedKey = masterKey.derive(KEY_DERIVATION_PATH)

  // 3. Get the derived private key
  const privateKeyBytes = derivedKey.key
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes)

  // 4. Encode public key: multicodec prefix + public key bytes, then base58btc encode
  const publicKeyWithPrefix = new Uint8Array([
    ...ED25519_MULTICODEC_PREFIX,
    ...publicKeyBytes,
  ])

  // Encode with multibase base58btc (starts with 'z')
  const accountId = base58btc.encode(publicKeyWithPrefix)

  return accountId
}

/**
 * Derives full keypair details from a BIP39 mnemonic
 * @param mnemonic - BIP39 mnemonic words
 * @param passphrase - Optional passphrase
 * @returns Object containing private key, public key, and account ID
 */
export function deriveKeyPairFromMnemonic(
  mnemonic: string | string[],
  passphrase: string = '',
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
