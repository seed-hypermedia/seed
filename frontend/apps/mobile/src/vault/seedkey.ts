/**
 * Desktop-compatible `.seedkey` export/import for vault identities.
 *
 * Format (backend/api/daemon/v1alpha/daemon.go createExportedKeyFile):
 * JSON `{createTime, publicKey, keyB64}` where `createTime` is RFC3339,
 * `publicKey` is the base58btc principal string, and `keyB64` is the raw
 * 32-byte ed25519 seed as base64url WITHOUT padding (Go RawURLEncoding).
 *
 * Only the UNENCRYPTED variant is supported: the password-protected variant
 * needs Argon2id (WASM), which Hermes cannot run — same reason the mobile app
 * has no master password.
 */

import {b64url} from './crypto'
import {accountIdFromSeed} from './state-codec'

const SEED_SIZE = 32

export type SeedKeyMaterial = {
  /** Raw 32-byte ed25519 seed. */
  seed: Uint8Array
  /** base58btc principal string derived from the seed. */
  publicKey: string
}

export const ENCRYPTED_SEEDKEY_ERROR = 'Password-protected key exports are not supported yet.'

/** Serialize an identity seed as a desktop-format `.seedkey` JSON string. */
export function buildSeedKeyExport(input: {seed: Uint8Array; createTime?: number}): string {
  if (input.seed.length !== SEED_SIZE) {
    throw new Error(`Invalid seed length: expected ${SEED_SIZE} bytes, got ${input.seed.length}.`)
  }
  const payload = {
    createTime: new Date(input.createTime ?? Date.now()).toISOString(),
    publicKey: accountIdFromSeed(input.seed),
    keyB64: b64url.encode(input.seed),
  }
  // Desktop writes json.MarshalIndent(payload, "", "  ") plus a newline.
  return `${JSON.stringify(payload, null, 2)}\n`
}

/**
 * Parse and validate a pasted `.seedkey` JSON payload.
 *
 * Rejects password-protected exports (an `encryption` field), non-32-byte
 * seeds, and payloads whose `publicKey` does not match the seed-derived
 * principal.
 */
export function parseSeedKeyImport(json: string): SeedKeyMaterial {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new Error('Invalid key file: not valid JSON.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid key file: expected a JSON object.')
  }
  const payload = value as {keyB64?: unknown; publicKey?: unknown; encryption?: unknown}

  if (payload.encryption != null) {
    throw new Error(ENCRYPTED_SEEDKEY_ERROR)
  }
  if (typeof payload.keyB64 !== 'string' || !payload.keyB64.trim()) {
    throw new Error('Invalid key file: missing keyB64.')
  }

  let seed: Uint8Array
  try {
    seed = b64url.decode(payload.keyB64)
  } catch {
    throw new Error('Invalid key file: keyB64 is not valid base64url.')
  }
  if (seed.length !== SEED_SIZE) {
    throw new Error(`Invalid key file: expected a ${SEED_SIZE}-byte key, got ${seed.length} bytes.`)
  }

  const derived = accountIdFromSeed(seed)
  if (typeof payload.publicKey === 'string' && payload.publicKey && payload.publicKey !== derived) {
    throw new Error('Invalid key file: publicKey does not match the private key.')
  }

  return {seed, publicKey: derived}
}
