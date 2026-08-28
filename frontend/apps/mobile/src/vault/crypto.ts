/**
 * Crypto primitives for the mobile vault, backed by pure-JS noble libraries so
 * they work identically on Hermes, react-native-web, and jsdom.
 *
 * IMPORTANT: none of this may call `crypto.subtle` — Hermes has no WebCrypto
 * (src/vault/platform.ts polyfills only `subtle.digest` for multiformats).
 */

// Side effect: Uint8Array.fromBase64 / toBase64 polyfill (core-js).
import '@seed-hypermedia/client/base64'

import {hkdf} from '@noble/hashes/hkdf'
import {sha256 as nobleSha256} from '@noble/hashes/sha256'

// XChaCha20-Poly1305, nonce-prefixed — byte-compatible with the Go vault.
export {decrypt, encrypt} from '@seed-hypermedia/client/encryption'

/** HKDF info string for secret-credential auth keys (Go secret.go remoteAuthKeyInfo). */
export const SECRET_AUTH_KEY_INFO = 'seed-hypermedia-vault-secret-authentication'

/** Size of vault secrets/KEKs (Go vaultSecretSize). */
export const VAULT_SECRET_SIZE = 32

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data)
}

/**
 * Derive the bearer authentication key for a secret credential.
 * RFC 5869 HKDF-SHA256 with default (zero-filled) salt — equal to WebCrypto's
 * HKDF with an empty salt, and to Go's `hkdf.New(sha256.New, secret, nil, info)`.
 */
export function deriveSecretCredentialAuthKey(secret: Uint8Array): Uint8Array {
  if (secret.length !== VAULT_SECRET_SIZE) {
    throw new Error(`Invalid vault secret length: got ${secret.length} bytes`)
  }
  return hkdf(nobleSha256, secret, undefined, new TextEncoder().encode(SECRET_AUTH_KEY_INFO), 32)
}

/** base64url without padding (Go base64.RawURLEncoding). */
export const b64url = {
  encode(data: Uint8Array): string {
    return data.toBase64({alphabet: 'base64url', omitPadding: true})
  },
  decode(data: string): Uint8Array {
    return Uint8Array.fromBase64(data.trim(), {alphabet: 'base64url'})
  },
}

/** Standard base64 WITH padding (Go []byte JSON marshaling). */
export const b64std = {
  encode(data: Uint8Array): string {
    return data.toBase64({alphabet: 'base64'})
  },
  decode(data: string): Uint8Array {
    return Uint8Array.fromBase64(data.trim(), {alphabet: 'base64'})
  },
}
