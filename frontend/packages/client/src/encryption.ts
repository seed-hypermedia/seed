import {xchacha20poly1305} from '@noble/ciphers/chacha.js'
import {argon2id} from 'hash-wasm'

/**
 * Default Argon2id parameters for password-based key derivation.
 */
export const DEFAULT_PARAMS = {
  memoryCost: 65536,
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
 * Derives a 256-bit key from a password using Argon2id.
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  params: Argon2Params = DEFAULT_PARAMS,
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
 * Encrypts bytes with XChaCha20-Poly1305 using the first 32 bytes of the provided key.
 * Returns the nonce prefixed to the ciphertext.
 */
export async function encrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  nonce = crypto.getRandomValues(new Uint8Array(24)),
): Promise<Uint8Array> {
  const xc = xchacha20poly1305(key.subarray(0, 32), nonce)
  const ciphertext = xc.encrypt(plaintext)
  const output = new Uint8Array(nonce.length + ciphertext.length)
  output.set(nonce)
  output.set(ciphertext, nonce.length)
  return output
}

/**
 * Decrypts nonce-prefixed XChaCha20-Poly1305 ciphertext using the first 32 bytes of the provided key.
 */
export async function decrypt(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const nonce = data.subarray(0, 24)
  const ciphertext = data.subarray(24)
  const xc = xchacha20poly1305(key.subarray(0, 32), nonce)
  return xc.decrypt(ciphertext)
}
