/**
 * Load Hypermedia identities from a local daemon/desktop vault (`vault.json`).
 *
 * Node/Bun only — reads the filesystem and the OS keychain. This is the
 * one-call entry point for tools (CLI, scripts) that need read-only access to
 * the accounts a Seed daemon or desktop app manages:
 *
 *   const accounts = await loadLocalVaultAccounts({})
 *
 * Discovery order for the vault file:
 *   1. explicit `path` option (e.g. from a --vault flag or config file)
 *   2. `SEED_VAULT_PATH` environment variable
 *   3. well-known locations: the desktop app's data dir
 *      (`~/.config/Seed[-dev]/daemon/vault.json` on Linux,
 *      `~/Library/Application Support/Seed[-dev]/daemon/vault.json` on macOS),
 *      then the bare daemon default `~/.mtt/vault.json`.
 *
 * The unlock secret (KEK) comes from the OS keychain (the same record the
 * daemon uses), or from the `SEED_VAULT_KEK` environment variable (base64)
 * on headless machines without a keychain.
 */

import {ed25519} from '@noble/curves/ed25519.js'
import {existsSync, readFileSync} from 'node:fs'
import {homedir, platform} from 'node:os'
import {join} from 'node:path'
import './base64'
import {readOSSecret, stripGoKeyringPrefix} from './os-keychain'
import {
  decryptVaultState,
  getAccountName,
  parseVaultEnvelope,
  principalFromPublicKey,
  principalToString,
  unwrapDEK,
  type VaultEnvelope,
} from './vault'

// Keychain records written by backend/storage/vault/secret.go.
const VAULT_KEK_SERVICE = 'seed-hypermedia-vault-secret-v2'
const LEGACY_VAULT_KEK_SERVICE = 'seed-hypermedia-vault-secret'
const LOCAL_KEK_ACCOUNT = 'local'
const VAULT_SECRET_SIZE = 32

/** The vault file could not be found at an explicitly requested path. */
export class VaultFileNotFoundError extends Error {
  constructor(path: string) {
    super(`Vault file not found at "${path}".`)
    this.name = 'VaultFileNotFoundError'
  }
}

/** The vault unlock secret (KEK) is not available in the OS keychain. */
export class VaultSecretMissingError extends Error {
  constructor(detail: string) {
    super(
      `The vault unlock secret was not found in the OS keychain (${detail}). ` +
        'Run the Seed desktop app or daemon once on this machine, or set the SEED_VAULT_KEK environment variable (base64).',
    )
    this.name = 'VaultSecretMissingError'
  }
}

/** An identity loaded from the vault, with derived key material. */
export type VaultLocalAccount = {
  name: string
  /** Raw 32-byte Ed25519 seed (the account private key). */
  seed: Uint8Array
  publicKey: Uint8Array
  /** Public key with the Ed25519 multicodec prefix (the principal). */
  publicKeyWithPrefix: Uint8Array
  /** base58btc principal string, e.g. "z6Mk...". */
  accountId: string
  createTime: number
}

export type LoadLocalVaultOptions = {
  /** Explicit path to vault.json. Missing file is an error when set. */
  path?: string
  /** Look in the dev desktop app's data dir (Seed-dev) instead of the production one. */
  dev?: boolean
}

/**
 * Resolves the vault.json path.
 * Returns `{path, explicit: true}` for a path the caller (or env) named, even
 * if the file does not exist, and `{path, explicit: false}` for the first
 * existing well-known location. Returns null when nothing is found.
 */
export function resolveVaultPath(opts: LoadLocalVaultOptions = {}): {path: string; explicit: boolean} | null {
  if (opts.path) {
    return {path: opts.path, explicit: true}
  }

  const envPath = process.env.SEED_VAULT_PATH
  if (envPath) {
    return {path: envPath, explicit: true}
  }

  for (const candidate of wellKnownVaultPaths(opts.dev ?? false)) {
    if (existsSync(candidate)) {
      return {path: candidate, explicit: false}
    }
  }

  return null
}

/**
 * Well-known vault.json locations, most specific first.
 */
export function wellKnownVaultPaths(dev: boolean): string[] {
  const os = platform()
  const appDataDir =
    os === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || join(homedir(), '.config')

  const desktopDir = dev ? 'Seed-dev' : 'Seed'
  const paths = [join(appDataDir, desktopDir, 'daemon', 'vault.json')]
  if (!dev) {
    paths.push(join(homedir(), '.mtt', 'vault.json'))
  }
  return paths
}

/**
 * Reads the wrapping key (KEK) for a vault envelope.
 *
 * `SEED_VAULT_KEK` (base64, 32 bytes) bypasses the keychain entirely —
 * intended for headless machines. Otherwise the secret comes from the OS
 * keychain record the daemon maintains: account "local" for local vaults, or
 * "<vaultUrl>|<userId>" for remote-connected vaults, resolved by credential ID.
 */
export function readVaultWrappingKey(envelope: VaultEnvelope): Uint8Array {
  const envKek = process.env.SEED_VAULT_KEK
  if (envKek) {
    const secret = decodeBase64Secret(envKek.trim())
    if (!secret) {
      throw new Error('SEED_VAULT_KEK must be a base64-encoded 32-byte secret.')
    }
    return secret
  }

  if (envelope.remote == null) {
    return loadKeychainSecret(LOCAL_KEK_ACCOUNT, '')
  }

  const account = `${envelope.remote.vaultUrl.trim()}|${envelope.remote.userId.trim()}`
  return loadKeychainSecret(account, envelope.remote.credentialId.trim())
}

/**
 * Loads a vault secret from the OS keychain, mirroring the bundle rules in
 * backend/storage/vault/secret.go: the v2 record holds a JSON credential
 * bundle `{"credentials": {"<id>": "<base64 32B>"}}` (a raw base64 value is a
 * legacy record equivalent to credential ID ""); when the v2 record is absent,
 * the legacy v1 service record (raw base64) is consulted.
 */
function loadKeychainSecret(account: string, credentialId: string): Uint8Array {
  const raw = readOSSecret(VAULT_KEK_SERVICE, account)
  if (raw !== null) {
    const bundle = decodeSecretBundle(stripGoKeyringPrefix(raw))
    const secret = bundle[credentialId]
    if (!secret) {
      throw new VaultSecretMissingError(
        `service "${VAULT_KEK_SERVICE}", account "${account}", credential "${credentialId}"`,
      )
    }
    return secret
  }

  const legacyRaw = readOSSecret(LEGACY_VAULT_KEK_SERVICE, account)
  if (legacyRaw !== null) {
    if (credentialId !== '') {
      throw new VaultSecretMissingError(
        `legacy record at service "${LEGACY_VAULT_KEK_SERVICE}" cannot hold credential "${credentialId}"`,
      )
    }
    const secret = decodeBase64Secret(stripGoKeyringPrefix(legacyRaw).trim())
    if (!secret) {
      throw new Error('The legacy vault keychain record is corrupted (expected a base64 32-byte secret).')
    }
    return secret
  }

  throw new VaultSecretMissingError(`service "${VAULT_KEK_SERVICE}", account "${account}"`)
}

function decodeSecretBundle(encoded: string): Record<string, Uint8Array> {
  let parsed: unknown
  try {
    parsed = JSON.parse(encoded)
  } catch {
    parsed = null
  }

  const credentials = (parsed as {credentials?: Record<string, string>} | null)?.credentials
  if (credentials && typeof credentials === 'object') {
    const bundle: Record<string, Uint8Array> = {}
    for (const [credentialId, value] of Object.entries(credentials)) {
      const secret = decodeBase64Secret(value)
      if (!secret) {
        throw new Error('The vault keychain credential bundle is corrupted (invalid secret length or encoding).')
      }
      bundle[credentialId] = secret
    }
    return bundle
  }

  // Legacy record format: the whole value is one raw base64 secret.
  const secret = decodeBase64Secret(encoded.trim())
  if (!secret) {
    throw new Error('The vault keychain record is corrupted (expected a credential bundle or a base64 secret).')
  }
  return {'': secret}
}

function decodeBase64Secret(value: string): Uint8Array | null {
  for (const alphabet of ['base64', 'base64url'] as const) {
    try {
      const decoded = Uint8Array.fromBase64(value, {alphabet})
      if (decoded.length === VAULT_SECRET_SIZE) return decoded
    } catch {
      continue
    }
  }
  return null
}

/**
 * Loads and decrypts all identities from the local vault.
 * Returns null when no vault file exists at any known location (and none was
 * explicitly requested). Throws descriptive errors for everything else.
 */
export async function loadLocalVaultAccounts(opts: LoadLocalVaultOptions = {}): Promise<VaultLocalAccount[] | null> {
  const resolved = resolveVaultPath(opts)
  if (!resolved) return null

  if (!existsSync(resolved.path)) {
    if (resolved.explicit) {
      throw new VaultFileNotFoundError(resolved.path)
    }
    return null
  }

  const envelope = parseVaultEnvelope(readFileSync(resolved.path, 'utf-8'))
  const wrappingKey = readVaultWrappingKey(envelope)
  const dek = await unwrapDEK(envelope, wrappingKey)
  const state = await decryptVaultState(envelope, dek)

  return state.accounts.map((account) => {
    const publicKey = new Uint8Array(ed25519.getPublicKey(account.seed))
    const publicKeyWithPrefix = principalFromPublicKey(publicKey)
    return {
      name: getAccountName(account),
      seed: account.seed,
      publicKey,
      publicKeyWithPrefix,
      accountId: principalToString(publicKeyWithPrefix),
      createTime: account.createTime,
    }
  })
}
