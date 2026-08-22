import * as SecureStore from 'expo-secure-store'

const MNEMONIC_KEY = 'seed_mnemonic'

/**
 * Save mnemonic to secure storage
 * Uses device keychain/keystore for secure storage
 */
export async function saveMnemonic(mnemonic: string): Promise<void> {
  await SecureStore.setItemAsync(MNEMONIC_KEY, mnemonic, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
}

/**
 * Get saved mnemonic from secure storage
 */
export async function getMnemonic(): Promise<string | null> {
  return await SecureStore.getItemAsync(MNEMONIC_KEY)
}

/**
 * Delete saved mnemonic from secure storage
 */
export async function deleteMnemonic(): Promise<void> {
  await SecureStore.deleteItemAsync(MNEMONIC_KEY)
}

/**
 * Check if a mnemonic is saved
 */
export async function hasSavedMnemonic(): Promise<boolean> {
  const mnemonic = await getMnemonic()
  return mnemonic !== null
}
