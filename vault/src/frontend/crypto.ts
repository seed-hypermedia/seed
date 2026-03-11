import {xchacha20poly1305} from '@noble/ciphers/chacha.js'
import {argon2id} from 'hash-wasm'

/**
 * Default Argon2id params (Bitwarden defaults).
 */
export const DEFAULT_ARGON2_PARAMS = {
  memoryCost: 65536, // 64 MiB in KiB.
  timeCost: 3,
  parallelism: 4,
}

/**
 * Argon2id parameters for key derivation.
 */
export interface Argon2Params {
  memoryCost: number
  timeCost: number
  parallelism: number
}

/**
 * Derive a 256-bit key from password using Argon2id.
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<Uint8Array> {
  const hash = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.timeCost,
    memorySize: params.memoryCost,
    hashLength: 32,
    outputType: 'binary',
  })
  return new Uint8Array(hash)
}

/**
 * Generate a random password salt for Argon2id.
 */
export function generatePasswordSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

/**
 * Derive a 256-bit key from the master key using HKDF-SHA256.
 */
async function deriveHKDFKey(masterKey: Uint8Array, info: string): Promise<Uint8Array> {
  const rawMasterKey = masterKey.slice()
  const baseKey = await crypto.subtle.importKey('raw', rawMasterKey.buffer as ArrayBuffer, {name: 'HKDF'}, false, [
    'deriveBits',
  ])

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    baseKey,
    256,
  )

  return new Uint8Array(derived)
}

/**
 * Derive the vault encryption key from the master key.
 */
export async function deriveEncryptionKey(masterKey: Uint8Array): Promise<Uint8Array> {
  return deriveHKDFKey(masterKey, 'seed-hypermedia-vault-encryption')
}

/**
 * Derive the password authentication key from the master key.
 */
export async function deriveAuthKey(masterKey: Uint8Array): Promise<Uint8Array> {
  return deriveHKDFKey(masterKey, 'seed-hypermedia-vault-authentication')
}

/**
 * Generate a random Data Encryption Key (64 bytes).
 */
export function generateDEK(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(64))
}

/**
 * Generate a random nonce for XChaCha20-Poly1305 (24 bytes).
 */
export function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(24))
}

/**
 * Encrypt data using XChaCha20-Poly1305.
 * Uses the first 256 bits (32 bytes) of the key.
 * Returns nonce prepended to ciphertext.
 */
export async function encrypt(plaintext: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const nonce = generateNonce()
  const keySlice = key.subarray(0, 32)
  const xc = xchacha20poly1305(keySlice, nonce)
  const ciphertext = xc.encrypt(plaintext)

  const result = new Uint8Array(nonce.length + ciphertext.length)
  result.set(nonce)
  result.set(ciphertext, nonce.length)

  return result
}

/**
 * Decrypt data using XChaCha20-Poly1305.
 * Expects nonce to be prepended to the ciphertext (first 24 bytes).
 */
export async function decrypt(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const nonce = data.subarray(0, 24)
  const ciphertext = data.subarray(24)
  const keySlice = key.subarray(0, 32)
  const xc = xchacha20poly1305(keySlice, nonce)
  return xc.decrypt(ciphertext)
}

/**
 * Check password strength.
 * Returns: 0 = weak, 1 = medium, 2 = strong.
 */
export function checkPasswordStrength(password: string): number {
  if (password.length < 8) return 0

  let score = 0
  if (password.length >= 12) score++
  if (password.length >= 16) score++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++

  if (score <= 1) return 0
  if (score <= 3) return 1
  return 2
}

/**
 * Check if WebAuthn is supported.
 */
export function isWebAuthnSupported(): boolean {
  return !!(window.PublicKeyCredential && typeof window.PublicKeyCredential === 'function')
}

/**
 * Check if platform authenticator is available.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

/**
 * Fixed PRF salt for WebAuthn key derivation.
 * Since each credential has a unique internal secret, a fixed salt still produces
 * unique derived keys per credential. This simplifies the implementation by avoiding
 * per-credential salt storage on the server.
 */
export const PRF_SALT = new TextEncoder().encode('hypermedia-identity-vault-v1')

/**
 * PRF extension result type (not included in TypeScript's built-in types).
 */
export interface PRFOutput {
  results?: {
    first?: ArrayBuffer
    second?: ArrayBuffer
  }
  enabled?: boolean
}

/**
 * Extract the wrapKey from PRF extension results.
 * The PRF output is 32 bytes, which is used directly as the wrapKey.
 * Returns null if PRF is not supported or the result is missing.
 */
export function extractPRFKey(prfOutput: PRFOutput | undefined): Uint8Array | null {
  if (!prfOutput?.results?.first) {
    return null
  }
  return new Uint8Array(prfOutput.results.first)
}
