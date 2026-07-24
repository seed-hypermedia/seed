/**
 * App-side crypto helpers.
 *
 * The vault key-derivation and XChaCha20-Poly1305 primitives live in the
 * shared client SDK (`@seed-hypermedia/client`) — re-exported here under the
 * app's historical import path. Only browser-specific helpers (WebAuthn, PRF,
 * password strength, random generation) are implemented locally.
 */

export {decrypt, encrypt} from '@seed-hypermedia/client/encryption'
export {deriveAuthKey, deriveEncryptionKey, deriveSecretCredentialAuthKey} from '@seed-hypermedia/client/vault'

/**
 * Generate a random password salt for Argon2id.
 */
export function generatePasswordSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
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
  if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return false

  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
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
