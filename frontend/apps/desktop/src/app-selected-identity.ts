import {appStore} from './app-store.mjs'
import {dispatchAllWindowsAppEvent} from './app-windows'
import {grpcClient} from './app-grpc'
import * as log from './logger'

// Global selected identity state
let globalSelectedIdentity: string | null = null

// Storage key
const SELECTED_IDENTITY_KEY = 'globalSelectedIdentity'

// Keep track of available keys
let availableKeys: string[] = []

// Initialize from storage on app start and verify it exists
export async function initializeSelectedIdentity() {
  const storedIdentity = (appStore.get(SELECTED_IDENTITY_KEY) as string) || null

  // Fetch available keys
  try {
    const keysResponse = await grpcClient.daemon.listKeys({})
    availableKeys = keysResponse.keys.map((key) => key.accountId)

    if (availableKeys.length === 0) {
      // No accounts available
      globalSelectedIdentity = null
      appStore.delete(SELECTED_IDENTITY_KEY)
      log.info('No accounts available, cleared selected identity')
    } else if (storedIdentity && availableKeys.includes(storedIdentity)) {
      // Stored identity is valid
      globalSelectedIdentity = storedIdentity
      log.info('Restored valid selected identity', {
        selectedIdentity: globalSelectedIdentity,
      })
    } else {
      // Stored identity is invalid or missing, select first available
      globalSelectedIdentity = availableKeys[0]
      appStore.set(SELECTED_IDENTITY_KEY, globalSelectedIdentity)
      log.info('Auto-selected first available identity', {
        selectedIdentity: globalSelectedIdentity,
        availableCount: availableKeys.length,
      })
    }
  } catch (error) {
    log.error('Failed to fetch keys during initialization', {error})
    globalSelectedIdentity = storedIdentity
  }
}

// Get the current selected identity
export function getGlobalSelectedIdentity(): string | null {
  return globalSelectedIdentity
}

// Set the selected identity and broadcast to all windows
export function setGlobalSelectedIdentity(newIdentity: string | null) {
  if (globalSelectedIdentity === newIdentity) {
    return // No change
  }

  globalSelectedIdentity = newIdentity

  // Persist to storage
  if (newIdentity) {
    appStore.set(SELECTED_IDENTITY_KEY, newIdentity)
  } else {
    appStore.delete(SELECTED_IDENTITY_KEY)
  }

  // Broadcast to all windows
  dispatchAllWindowsAppEvent({
    type: 'selectedIdentityChanged',
    selectedIdentity: newIdentity,
  })

  log.info('Updated global selected identity', {
    selectedIdentity: newIdentity,
  })
}

// Update available keys and auto-select if needed
export async function updateAvailableKeys(options?: {forceSelect?: string}) {
  try {
    const keysResponse = await grpcClient.daemon.listKeys({})
    const newKeys = keysResponse.keys.map((key) => key.accountId)

    // Check if keys have changed
    const keysChanged =
      newKeys.length !== availableKeys.length ||
      !newKeys.every((key) => availableKeys.includes(key))

    availableKeys = newKeys

    // If a specific account should be selected (e.g., from onboarding)
    if (options?.forceSelect && newKeys.includes(options.forceSelect)) {
      setGlobalSelectedIdentity(options.forceSelect)
      log.info('Force selected identity', {
        selectedIdentity: options.forceSelect,
      })
      return
    }

    if (keysChanged) {
      if (newKeys.length === 0) {
        // No accounts available anymore
        setGlobalSelectedIdentity(null)
      } else if (
        globalSelectedIdentity &&
        !newKeys.includes(globalSelectedIdentity)
      ) {
        // Current selection is no longer valid, select first available
        setGlobalSelectedIdentity(newKeys[0])
        log.info('Current identity no longer available, auto-selected first', {
          previousIdentity: globalSelectedIdentity,
          newIdentity: newKeys[0],
        })
      } else if (!globalSelectedIdentity && newKeys.length > 0) {
        // No selection but accounts are available, select first
        setGlobalSelectedIdentity(newKeys[0])
        log.info('No identity selected, auto-selected first available', {
          selectedIdentity: newKeys[0],
        })
      }
      // If the selected identity is still valid, keep it
    }
  } catch (error) {
    log.error('Failed to update available keys', {error})
  }
}
