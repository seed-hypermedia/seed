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

// ─── Profile-name hydration ──────────────────────────────────────────────────

/**
 * Module-level cache of account-uid → published profile name (null = looked
 * up, none published). Desktop shows profile metadata names, not the vault's
 * local key names — this brings mobile to parity via the connected server's
 * Account API.
 */
const profileNameCache = new Map<string, string | null>()
const profileNameFetches = new Map<string, Promise<void>>()

async function fetchProfileName(accountId: string): Promise<void> {
  const {getSeedClient} = await import('../client/seed-client')
  try {
    const result = await getSeedClient().request('Account', accountId)
    profileNameCache.set(accountId, (result.type === 'account' && result.metadata?.name?.trim()) || null)
  } catch {
    // Server unreachable or account unknown — try again next mount.
    profileNameFetches.delete(accountId)
  }
}

/**
 * Resolve published profile names for account ids. Returns a map of
 * uid → name; missing entries are still loading or have no published name.
 */
export function useAccountProfileNames(accountIds: string[]): Record<string, string | undefined> {
  const [, forceUpdate] = useReducer((tick: number) => tick + 1, 0)
  const key = accountIds.join(',')

  useEffect(() => {
    let cancelled = false
    const pending = accountIds
      .filter((id) => !profileNameCache.has(id))
      .map((id) => {
        let fetchPromise = profileNameFetches.get(id)
        if (!fetchPromise) {
          fetchPromise = fetchProfileName(id)
          profileNameFetches.set(id, fetchPromise)
        }
        return fetchPromise
      })
    if (pending.length > 0) {
      void Promise.allSettled(pending).then(() => {
        if (!cancelled) forceUpdate()
      })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const names: Record<string, string | undefined> = {}
  for (const id of accountIds) {
    const cached = profileNameCache.get(id)
    if (cached) names[id] = cached
  }
  return names
}

/** Display name for an identity: published profile name → local vault key name → shortened id. */
export function identityDisplayName(
  identity: {name: string; accountId: string},
  profileName: string | undefined,
): string {
  if (profileName) return profileName
  if (identity.name && identity.name !== identity.accountId) return identity.name
  return shortAccountId(identity.accountId)
}
