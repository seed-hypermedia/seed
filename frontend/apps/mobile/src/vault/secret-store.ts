/**
 * Secret storage for vault KEKs and remote credential secrets.
 *
 * Mirrors the Go SecretStore (backend/storage/vault/secret.go): secrets are
 * grouped into per-account JSON bundles keyed by credential ID. Logical
 * accounts are `'local'` (the local vault KEK, credential ID `''`) and
 * `` `${vaultUrl}|${userId}` `` for remote vaults. Secret values are stored as
 * padded standard base64, matching Go's []byte JSON marshaling.
 *
 * The physical key is `vault_secret_v2_` + base64url(utf8(account)) because
 * expo-secure-store keys only allow [A-Za-z0-9._-]; this is invisible to the
 * protocol.
 */

import {Platform} from 'react-native'
import {b64std, b64url, randomBytes, VAULT_SECRET_SIZE} from './crypto'

export type CredentialBundle = {
  /** Secrets keyed by credential ID, encoded as padded standard base64 (32 bytes). */
  credentials: Record<string, string>
}

export interface SecretStore {
  load(account: string): Promise<CredentialBundle | null>
  store(account: string, bundle: CredentialBundle): Promise<void>
  delete(account: string): Promise<void>
  listCredentialIds(account: string): Promise<string[]>
}

/** Logical account for the local vault KEK. */
export const LOCAL_VAULT_ACCOUNT = 'local'

/** Logical account for a remote vault's credential secrets (Go remoteVaultKEKName). */
export function remoteVaultAccount(vaultUrl: string, userId: string): string {
  const normalizedUrl = vaultUrl.trim()
  const normalizedUserId = userId.trim()
  if (!normalizedUrl) throw new Error('Remote vault URL is required.')
  if (!normalizedUserId) throw new Error('Remote vault user ID is required.')
  return `${normalizedUrl}|${normalizedUserId}`
}

const PHYSICAL_KEY_PREFIX = 'vault_secret_v2_'

function physicalKey(account: string): string {
  return PHYSICAL_KEY_PREFIX + b64url.encode(new TextEncoder().encode(account))
}

function parseBundle(json: string | null): CredentialBundle | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.credentials !== 'object' || !parsed.credentials) {
      return null
    }
    return {credentials: {...(parsed.credentials as Record<string, string>)}}
  } catch {
    return null
  }
}

// ─── Single-secret helpers over the bundle interface ─────────────────────────

export async function loadSecret(
  store: SecretStore,
  account: string,
  credentialId: string,
): Promise<Uint8Array | null> {
  const bundle = await store.load(account)
  const encoded = bundle?.credentials[credentialId.trim()]
  if (!encoded) return null
  const secret = b64std.decode(encoded)
  if (secret.length !== VAULT_SECRET_SIZE) {
    throw new Error(`Invalid vault secret length: got ${secret.length} bytes`)
  }
  return secret
}

export async function storeSecret(
  store: SecretStore,
  account: string,
  credentialId: string,
  secret: Uint8Array,
): Promise<void> {
  if (secret.length !== VAULT_SECRET_SIZE) {
    throw new Error(`Invalid vault secret length: got ${secret.length} bytes`)
  }
  const bundle = (await store.load(account)) ?? {credentials: {}}
  bundle.credentials[credentialId.trim()] = b64std.encode(secret)
  await store.store(account, bundle)
}

export async function deleteSecret(store: SecretStore, account: string, credentialId: string): Promise<void> {
  const bundle = await store.load(account)
  if (!bundle) return
  const key = credentialId.trim()
  if (!(key in bundle.credentials)) return
  delete bundle.credentials[key]
  if (Object.keys(bundle.credentials).length === 0) {
    await store.delete(account)
    return
  }
  await store.store(account, bundle)
}

/** Load the local vault KEK, generating and persisting one on first use. */
export async function ensureLocalKEK(store: SecretStore): Promise<Uint8Array> {
  const existing = await loadSecret(store, LOCAL_VAULT_ACCOUNT, '')
  if (existing) return existing
  const secret = randomBytes(VAULT_SECRET_SIZE)
  await storeSecret(store, LOCAL_VAULT_ACCOUNT, '', secret)
  return secret
}

// ─── Implementations ─────────────────────────────────────────────────────────

/** Device keychain/keystore-backed store (iOS/Android). */
export function createNativeSecretStore(): SecretStore {
  const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store')
  return {
    async load(account) {
      return parseBundle(await SecureStore.getItemAsync(physicalKey(account)))
    },
    async store(account, bundle) {
      await SecureStore.setItemAsync(physicalKey(account), JSON.stringify(bundle), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      })
    },
    async delete(account) {
      await SecureStore.deleteItemAsync(physicalKey(account))
    },
    async listCredentialIds(account) {
      const bundle = parseBundle(await SecureStore.getItemAsync(physicalKey(account)))
      return bundle ? Object.keys(bundle.credentials).sort() : []
    },
  }
}

/**
 * localStorage-backed store for the web build. Dev/test only: web has no OS
 * keychain, so secrets are NOT protected at rest (same trade-off as the
 * localStorage KV fallback in src/store/storage.ts).
 */
export function createWebSecretStore(): SecretStore {
  const prefix = 'seed-mobile-secret:'
  return {
    async load(account) {
      return parseBundle(globalThis.localStorage?.getItem(prefix + physicalKey(account)) ?? null)
    },
    async store(account, bundle) {
      globalThis.localStorage?.setItem(prefix + physicalKey(account), JSON.stringify(bundle))
    },
    async delete(account) {
      globalThis.localStorage?.removeItem(prefix + physicalKey(account))
    },
    async listCredentialIds(account) {
      const bundle = parseBundle(globalThis.localStorage?.getItem(prefix + physicalKey(account)) ?? null)
      return bundle ? Object.keys(bundle.credentials).sort() : []
    },
  }
}

/** In-memory store for unit tests. */
export function createMemorySecretStore(): SecretStore {
  const bundles = new Map<string, string>()
  return {
    async load(account) {
      return parseBundle(bundles.get(physicalKey(account)) ?? null)
    },
    async store(account, bundle) {
      bundles.set(physicalKey(account), JSON.stringify(bundle))
    },
    async delete(account) {
      bundles.delete(physicalKey(account))
    },
    async listCredentialIds(account) {
      const bundle = parseBundle(bundles.get(physicalKey(account)) ?? null)
      return bundle ? Object.keys(bundle.credentials).sort() : []
    },
  }
}

/** Platform-appropriate default store. */
export function createDefaultSecretStore(): SecretStore {
  return Platform.OS === 'web' ? createWebSecretStore() : createNativeSecretStore()
}
