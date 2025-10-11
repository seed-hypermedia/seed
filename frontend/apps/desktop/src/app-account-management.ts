import {grpcClient} from './app-grpc'
import {getAllWindows, getWindowsState, updateWindowState} from './app-windows'
import * as log from './logger'

export async function deleteAccount(accountId: string) {
  try {
    log.info('Starting account deletion process', {accountId})

    // First, get the key to delete
    const keys = await grpcClient.daemon.listKeys({})
    const keyToDelete = keys.keys.find((key) => accountId === key.publicKey)
    if (!keyToDelete) {
      log.error('Key not found for deletion', {
        accountId,
        availableKeys: keys.keys.map((k) => k.publicKey),
      })
      throw new Error('Key not found')
    }

    log.info('Found key to delete', {
      keyName: keyToDelete.name,
      accountId: keyToDelete.accountId,
    })
    const deletedAccountId = keyToDelete.accountId || keyToDelete.publicKey

    // Delete the key from daemon
    const deletedKey = await grpcClient.daemon.deleteKey({
      name: keyToDelete.name,
    })

    // Delete from secure storage
    const {secureStorageApi} = await import('./app-secure-storage')
    // We need to create a TRPC caller to use the secure storage API
    const secureStorageCaller = secureStorageApi.createCaller({})
    await secureStorageCaller.delete(keyToDelete.name)

    // Get remaining available keys after deletion
    const updatedKeysResponse = await grpcClient.daemon.listKeys({})
    const availableKeys = updatedKeysResponse.keys.map((key) => key.accountId)

    log.info('Handling account deletion', {
      deletedAccountId,
      availableKeysCount: availableKeys.length,
    })

    // Get all current window states and update affected windows
    const windowsState = getWindowsState()

    for (const [windowId, windowState] of Object.entries(windowsState)) {
      if (windowState?.selectedIdentity === deletedAccountId) {
        let newSelectedIdentity: string | null = null

        if (availableKeys.length > 0) {
          // Select the first available account
          newSelectedIdentity = availableKeys[0]
          log.info('Auto-selecting new identity for window', {
            windowId,
            previousIdentity: deletedAccountId,
            newIdentity: newSelectedIdentity,
          })
        } else {
          // No accounts left, set to null
          log.info('No accounts available, clearing identity for window', {
            windowId,
            previousIdentity: deletedAccountId,
          })
        }

        // Directly update the window state using the proper method
        updateWindowState(windowId, (window) => ({
          ...window,
          selectedIdentity: newSelectedIdentity,
        }))

        // Notify the window that its selectedIdentity has changed
        const window = getAllWindows().get(windowId)
        if (window) {
          window.webContents.send('appWindowEvent', {
            type: 'selectedIdentityChanged',
            selectedIdentity: newSelectedIdentity,
          })
        }
      }
    }

    return {deletedKey, deletedAccountId}
  } catch (error) {
    log.error('Failed to delete account and update windows', {error, accountId})
    throw error
  }
}
