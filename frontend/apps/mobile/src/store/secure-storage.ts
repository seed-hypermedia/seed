import {Platform} from 'react-native'

const MNEMONIC_KEY = 'seed_mnemonic'

// expo-secure-store is a native module and throws when loaded on web/jsdom, so
// web builds fall back to localStorage (dev/test only — same pattern as
// storage.ts).
const isWeb = Platform.OS === 'web'
const WEB_PREFIX = 'seed-mobile-secure:'

function requireSecureStore() {
  return require('expo-secure-store') as typeof import('expo-secure-store')
}

/**
 * Save mnemonic to secure storage
 * Uses device keychain/keystore for secure storage
 */
export async function saveMnemonic(mnemonic: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(WEB_PREFIX + MNEMONIC_KEY, mnemonic)
    return
  }
  const SecureStore = requireSecureStore()
  await SecureStore.setItemAsync(MNEMONIC_KEY, mnemonic, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
}

/**
 * Get saved mnemonic from secure storage
 */
export async function getMnemonic(): Promise<string | null> {
  if (isWeb) {
    return globalThis.localStorage?.getItem(WEB_PREFIX + MNEMONIC_KEY) ?? null
  }
  return await requireSecureStore().getItemAsync(MNEMONIC_KEY)
}

/**
 * Delete saved mnemonic from secure storage
 */
export async function deleteMnemonic(): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.removeItem(WEB_PREFIX + MNEMONIC_KEY)
    return
  }
  await requireSecureStore().deleteItemAsync(MNEMONIC_KEY)
}

/**
 * Check if a mnemonic is saved
 */
export async function hasSavedMnemonic(): Promise<boolean> {
  const mnemonic = await getMnemonic()
  return mnemonic !== null
}
