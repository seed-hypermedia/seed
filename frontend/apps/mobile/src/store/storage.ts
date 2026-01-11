import {createMMKV, MMKV} from 'react-native-mmkv'

// Main storage instance
export const storage: MMKV = createMMKV({id: 'seed-mobile'})

// Type-safe storage helpers
export const StorageKeys = {
  KNOWN_SERVERS: 'known_servers',
  CURRENT_SERVER: 'current_server',
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
