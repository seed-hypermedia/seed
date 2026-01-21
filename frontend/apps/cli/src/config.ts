/**
 * Configuration and key storage
 */

import {homedir} from 'os'
import {join} from 'path'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs'

const CONFIG_DIR = join(homedir(), '.seed')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
const KEYS_FILE = join(CONFIG_DIR, 'keys.json')

export type Config = {
  server?: string
  defaultAccount?: string
}

export type StoredKey = {
  name: string
  accountId: string
  mnemonic: string  // encrypted in future
  passphrase: string
  createdAt: string
}

export type KeysStore = {
  keys: StoredKey[]
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, {recursive: true, mode: 0o700})
  }
}

// Config management

export function loadConfig(): Config {
  ensureConfigDir()
  if (!existsSync(CONFIG_FILE)) {
    return {}
  }
  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

export function saveConfig(config: Config) {
  ensureConfigDir()
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {mode: 0o600})
}

export function getConfigValue<K extends keyof Config>(key: K): Config[K] {
  const config = loadConfig()
  return config[key]
}

export function setConfigValue<K extends keyof Config>(key: K, value: Config[K]) {
  const config = loadConfig()
  config[key] = value
  saveConfig(config)
}

// Key storage

export function loadKeys(): KeysStore {
  ensureConfigDir()
  if (!existsSync(KEYS_FILE)) {
    return {keys: []}
  }
  try {
    const content = readFileSync(KEYS_FILE, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {keys: []}
  }
}

export function saveKeys(store: KeysStore) {
  ensureConfigDir()
  writeFileSync(KEYS_FILE, JSON.stringify(store, null, 2), {mode: 0o600})
}

export function addKey(key: Omit<StoredKey, 'createdAt'>): StoredKey {
  const store = loadKeys()

  // Check for duplicate name
  if (store.keys.some((k) => k.name === key.name)) {
    throw new Error(`Key with name "${key.name}" already exists`)
  }

  const storedKey: StoredKey = {
    ...key,
    createdAt: new Date().toISOString(),
  }

  store.keys.push(storedKey)
  saveKeys(store)
  return storedKey
}

export function getKey(nameOrAccountId: string): StoredKey | undefined {
  const store = loadKeys()
  return store.keys.find(
    (k) => k.name === nameOrAccountId || k.accountId === nameOrAccountId
  )
}

export function listKeys(): StoredKey[] {
  const store = loadKeys()
  return store.keys
}

export function removeKey(nameOrAccountId: string): boolean {
  const store = loadKeys()
  const index = store.keys.findIndex(
    (k) => k.name === nameOrAccountId || k.accountId === nameOrAccountId
  )
  if (index === -1) return false
  store.keys.splice(index, 1)
  saveKeys(store)
  return true
}

export function getDefaultKey(): StoredKey | undefined {
  const config = loadConfig()
  if (config.defaultAccount) {
    return getKey(config.defaultAccount)
  }
  const keys = listKeys()
  return keys[0]
}
