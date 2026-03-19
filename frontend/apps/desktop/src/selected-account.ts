import {useUniversalAppContext} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {useStream} from '@shm/shared/use-stream'

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
