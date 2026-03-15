import * as base64 from '@shm/shared/base64'
import * as blobs from '@shm/shared/blobs'
import {xchacha20poly1305} from '@noble/ciphers/chacha.js'
import {deriveKeyFromPassword, DEFAULT_ARGON2_PARAMS} from './crypto'
import type * as vault from './vault'

/**
 * Profile metadata included in exported key files for human readability.
 */
export interface AccountKeyExportProfile {
  name?: string
  description?: string
}

/**
 * Argon2id parameters used to derive encryption keys for exported key files.
 */
export interface AccountKeyExportArgon2 {
  memoryCost: number
  timeCost: number
  parallelism: number
  saltB64: string
}

/**
 * Encryption metadata for encrypted account key export files.
 */
export interface AccountKeyExportEncryption {
  kdf: 'argon2id'
  argon2: AccountKeyExportArgon2
  cipher: 'xchacha20poly1305'
  nonceB64: string
}

/**
 * Exported account key payload written to .hmkey.json files.
 */
export interface AccountKeyExportPayload {
  createTime: string
  publicKey: string
  keyB64: string
  encryption?: AccountKeyExportEncryption
  profile?: AccountKeyExportProfile
}

/**
 * Result metadata describing how an account key export was saved.
 */
export interface AccountKeyExportResult {
  fileName: string
  method: 'download'
}

/**
 * Input data required to build an account key export payload.
 */
export interface BuildAccountKeyExportInput {
  publicKey: string
  account: vault.Account
  password?: string
  profile?: AccountKeyExportProfile
}

/**
 * Builds the account key export payload. Encryption is enabled when password is provided.
 */
export async function buildAccountKeyExport(input: BuildAccountKeyExportInput): Promise<AccountKeyExportPayload> {
  const {publicKey, account, password, profile} = input
  const keyPair = blobs.nobleKeyPairFromSeed(account.seed)
  const includedProfile = profile && (profile.name || profile.description) ? profile : undefined
  const createTime = new Date().toISOString()

  if (!password) {
    return {
      createTime,
      publicKey,
      keyB64: base64.encode(keyPair.seed),
      ...(includedProfile ? {profile: includedProfile} : {}),
    }
  }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const nonce = crypto.getRandomValues(new Uint8Array(24))
  const argon2Params = {
    memoryCost: DEFAULT_ARGON2_PARAMS.memoryCost,
    timeCost: DEFAULT_ARGON2_PARAMS.timeCost,
    parallelism: DEFAULT_ARGON2_PARAMS.parallelism,
  }
  const derivedKey = await deriveKeyFromPassword(password, salt, argon2Params)
  const xc = xchacha20poly1305(derivedKey.subarray(0, 32), nonce)
  const ciphertext = xc.encrypt(keyPair.seed)

  return {
    createTime,
    publicKey,
    keyB64: base64.encode(ciphertext),
    encryption: {
      kdf: 'argon2id',
      argon2: {
        memoryCost: argon2Params.memoryCost,
        timeCost: argon2Params.timeCost,
        parallelism: argon2Params.parallelism,
        saltB64: base64.encode(salt),
      },
      cipher: 'xchacha20poly1305',
      nonceB64: base64.encode(nonce),
    },
    ...(includedProfile ? {profile: includedProfile} : {}),
  }
}

/**
 * Saves an exported account key using a regular browser download.
 */
export async function saveAccountKeyFile(input: BuildAccountKeyExportInput): Promise<AccountKeyExportResult> {
  const payload = await buildAccountKeyExport(input)
  const fileName = `${input.publicKey}.hmkey.json`
  const contents = `${JSON.stringify(payload, null, 2)}\n`

  const blob = new Blob([contents], {type: 'application/json'})
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)

  return {fileName, method: 'download'}
}
