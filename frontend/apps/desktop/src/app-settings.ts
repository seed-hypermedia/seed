import {nativeTheme} from 'electron'
import z from 'zod'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'
import {broadcastUseDarkColors} from './app-windows'
import {DEFAULT_TESTNET_NAME, type DaemonNetworkConfig} from './daemon'

declare const __SEED_P2P_TESTNET_NAME__: string

const AutoUpdateTypes = z.literal('true').or(z.literal('false'))

export type AutoUpdateValues = z.infer<typeof AutoUpdateTypes>

export const APP_AUTO_UPDATE_PREFERENCE = 'AutoUpdatePreference'

const SETTINGS_STORE_KEY = 'Settings-v001'

type SettingsStore = Record<string, any>

let settingsStore: SettingsStore = (appStore.get(SETTINGS_STORE_KEY) as SettingsStore) || {}

function writeSettingsStore(newState: SettingsStore) {
  settingsStore = newState
  appStore.set(SETTINGS_STORE_KEY, newState)
}

var autoUpdatePreference: AutoUpdateValues = (appStore.get(APP_AUTO_UPDATE_PREFERENCE) as AutoUpdateValues) || 'true'

export const networkConfigSchema = z.object({
  mode: z.union([z.literal('mainnet'), z.literal('testnet'), z.literal('custom')]),
  customName: z.string().optional(),
})

const NETWORK_CONFIG_SETTINGS_KEY = 'daemonNetwork'

/** The network to use when the user has not picked one: the build-time testnet flag, or mainnet. */
function defaultNetworkConfig(): DaemonNetworkConfig {
  if (!__SEED_P2P_TESTNET_NAME__) return {mode: 'mainnet'}
  if (__SEED_P2P_TESTNET_NAME__ === DEFAULT_TESTNET_NAME) return {mode: 'testnet'}
  return {mode: 'custom', customName: __SEED_P2P_TESTNET_NAME__}
}

/**
 * Returns the stored network setting.
 * Used by main.ts to determine daemon startup flags before tRPC is ready.
 */
export function getStoredNetworkConfig(): DaemonNetworkConfig {
  const parsed = networkConfigSchema.safeParse(settingsStore[NETWORK_CONFIG_SETTINGS_KEY])
  if (parsed.success) return parsed.data
  return defaultNetworkConfig()
}

export function writeNetworkConfig(config: DaemonNetworkConfig) {
  writeSettingsStore({...settingsStore, [NETWORK_CONFIG_SETTINGS_KEY]: config})
}

export const appSettingsApi = t.router({
  getAutoUpdatePreference: t.procedure.query(async () => {
    return autoUpdatePreference
  }),
  setAutoUpdatePreference: t.procedure.input(AutoUpdateTypes).mutation(async ({input}) => {
    return writeAutoUpdateValue(input)
  }),
  getSetting: t.procedure.input(z.string()).query(async ({input}) => {
    return settingsStore[input] ?? null
  }),
  setSetting: t.procedure.input(z.object({key: z.string(), value: z.any()})).mutation(async ({input}) => {
    const newState = {...settingsStore, [input.key]: input.value}
    writeSettingsStore(newState)
    if (input.key === 'theme') {
      broadcastUseDarkColors()
    }
    return undefined
  }),
})

export function getAppTheme() {
  const theme = settingsStore['theme']
  return theme || 'system'
}

export function shouldUseDarkColors() {
  const theme = getAppTheme()
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors
  }
  return theme === 'dark'
}

function writeAutoUpdateValue(val: AutoUpdateValues) {
  autoUpdatePreference = val
  appStore.set(APP_AUTO_UPDATE_PREFERENCE, val)
}
