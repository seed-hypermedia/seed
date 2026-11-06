import {appStore} from './app-store.mts'

/**
 * The persisted settings record, kept apart from app-settings.ts so main-process modules that run
 * before any window exists (the agents server process, daemon startup) can read a setting without
 * pulling in the window, draft and error-reporting modules app-settings.ts needs for its tRPC
 * router. The desktop security e2e fixtures bundle a bare main process and break on those.
 */
const SETTINGS_STORE_KEY = 'Settings-v001'

type SettingsStore = Record<string, any>

let settingsStore: SettingsStore = (appStore.get(SETTINGS_STORE_KEY) as SettingsStore) || {}

export function readSettingsStore(): SettingsStore {
  return settingsStore
}

export function writeSettingsStore(newState: SettingsStore) {
  settingsStore = newState
  appStore.set(SETTINGS_STORE_KEY, newState)
}

/** Reads one persisted setting for main-process code that runs before tRPC is ready. */
export function getStoredSetting(key: string): unknown {
  return settingsStore[key] ?? null
}

/** Writes one persisted setting from main-process code. */
export function writeStoredSetting(key: string, value: unknown): void {
  writeSettingsStore({...settingsStore, [key]: value})
}
