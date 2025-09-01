import {hmId, useUniversalAppContext} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'

export function useSelectedAccount() {
  const {selectedIdentity} = useUniversalAppContext()
  // selectedIdentity is now a plain value from NavigationContainer
  const {data: account} = useResource(
    selectedIdentity ? hmId(selectedIdentity) : null,
  )
  if (account?.type !== 'document') return undefined
  return account
}

export function useSelectedAccountId() {
  const {selectedIdentity} = useUniversalAppContext()
  // selectedIdentity is now a plain value from NavigationContainer
  return selectedIdentity
}
