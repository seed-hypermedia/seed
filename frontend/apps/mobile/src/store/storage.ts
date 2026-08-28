import {Platform} from 'react-native'

// Minimal key-value storage interface backed by MMKV on native and
// localStorage on web (react-native-mmkv v4 is a native Nitro module and
// cannot load on web or in jsdom tests).
export type KVStorage = {
  getString(key: string): string | undefined
  set(key: string, value: string): void
  remove(key: string): void
}

const STORAGE_PREFIX = 'seed-mobile:'

function createWebStorage(): KVStorage {
  return {
    getString(key) {
      const value = globalThis.localStorage?.getItem(STORAGE_PREFIX + key)
      return value ?? undefined
    },
    set(key, value) {
      globalThis.localStorage?.setItem(STORAGE_PREFIX + key, value)
    },
    remove(key) {
      globalThis.localStorage?.removeItem(STORAGE_PREFIX + key)
    },
  }
}

function createNativeStorage(): KVStorage {
  const {createMMKV} = require('react-native-mmkv') as typeof import('react-native-mmkv')
  const mmkv = createMMKV({id: 'seed-mobile'})
  return {
    getString: (key) => mmkv.getString(key),
    set: (key, value) => mmkv.set(key, value),
    remove: (key) => mmkv.remove(key),
  }
}

// Main storage instance
export const storage: KVStorage = Platform.OS === 'web' ? createWebStorage() : createNativeStorage()

// Type-safe storage helpers
export const StorageKeys = {
  KNOWN_SERVERS: 'known_servers',
  CURRENT_SERVER: 'current_server',
  // Encrypted vault envelope (ciphertext only — safe outside the keychain).
  VAULT_ENVELOPE: 'vault_envelope',
  // Device-local selection of the active identity (not synced via the vault).
  CURRENT_IDENTITY: 'current_identity',
} as const

export function getStorageItem<T>(key: string): T | null {
  const value = storage.getString(key)
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function setStorageItem<T>(key: string, value: T): void {
  storage.set(key, JSON.stringify(value))
}

export function removeStorageItem(key: string): void {
  storage.remove(key)
}
