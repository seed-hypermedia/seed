import {useEffect, useReducer, useState} from 'react'
import {getVaultManager, type VaultIdentity, type VaultManager, type VaultStatus} from '../vault'

export type VaultHook = {
  manager: VaultManager | null
  status: VaultStatus | null
  identities: VaultIdentity[]
  loadError: string | null
}

/**
 * Load the app-wide VaultManager and re-render on every vault change.
 * The manager is a singleton — unmounting only unsubscribes, never destroys.
 */
export function useVault(): VaultHook {
  const [manager, setManager] = useState<VaultManager | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [, forceUpdate] = useReducer((tick: number) => tick + 1, 0)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    getVaultManager()
      .then((loaded) => {
        if (cancelled) return
        unsubscribe = loaded.subscribe(forceUpdate)
        setManager(loaded)
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return {
    manager,
    status: manager ? manager.getStatus() : null,
    identities: manager ? manager.listIdentities() : [],
    loadError,
  }
}

/** Shorten a base58 account ID for list rows. */
export function shortAccountId(accountId: string): string {
  if (accountId.length <= 20) return accountId
  return `${accountId.slice(0, 12)}…${accountId.slice(-6)}`
}
