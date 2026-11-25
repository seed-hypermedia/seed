import {useUniversalAppContext} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {useStream} from '@shm/shared/use-stream'
import {useEffect, useState} from 'react'

/**
 * Returns the currently selected account's metadata, or undefined if none is selected.
 * Uses profile-based account query which works for all accounts,
 * including those without home documents.
 */
export function useSelectedAccount() {
  const {selectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  const {data: account} = useAccount(selectedIdentityValue)
  return account ?? undefined
}

/** Returns the UID string of the currently selected account. */
export function useSelectedAccountId() {
  const {selectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  return selectedIdentityValue
}

const accountHistoryKey = 'seed.account-selection-history'

function readAccountHistory(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(accountHistoryKey) || '[]')
    return Array.isArray(stored)
      ? Array.from(new Set(stored.filter((uid): uid is string => typeof uid === 'string')))
      : []
  } catch {
    return []
  }
}

/** Account selection order on this device, newest first, shared between desktop windows. */
export function useRecentAccountIds() {
  const selectedId = useSelectedAccountId()
  const [recentIds, setRecentIds] = useState(readAccountHistory)
  useEffect(() => {
    if (!selectedId) return
    const history = readAccountHistory()
    const next = [selectedId, ...history.filter((uid) => uid !== selectedId)]
    setRecentIds(next)
    try {
      localStorage.setItem(accountHistoryKey, JSON.stringify(next))
    } catch {
      // Account switching must still work when local preference storage is unavailable.
    }
  }, [selectedId])
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === accountHistoryKey || event.key === null) setRecentIds(readAccountHistory())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return recentIds
}
