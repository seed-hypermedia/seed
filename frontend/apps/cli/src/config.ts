/**
 * Configuration management.
 *
 * Keys are now stored in the OS keyring (see utils/keyring.ts).
 * This module only handles CLI configuration (server URL, default account, etc.).
 */

import {homedir} from 'os'
import {join} from 'path'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs'

const CONFIG_DIR = join(homedir(), '.seed')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

export type Config = {
  server?: string
  defaultAccount?: string
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, {recursive: true, mode: 0o700})
  }
}

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

export function setConfigValue<K extends keyof Config>(
  key: K,
  value: Config[K],
) {
  const config = loadConfig()
  config[key] = value
  saveConfig(config)
}
