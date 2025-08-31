import {hmId, useUniversalAppContext} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {useStream} from '@shm/shared/use-stream'

export function useSelectedAccount() {
  const {selectedIdentity} = useUniversalAppContext()
  // selectedIdentity is now a StateStream provided by NavigationContainer
  const selectedIdentityValue = useStream(selectedIdentity)
  const {data: account} = useResource(
    selectedIdentityValue ? hmId(selectedIdentityValue) : null,
  )
  if (account?.type !== 'document') return undefined
  return account
}

export function useSelectedAccountId() {
  const {selectedIdentity} = useUniversalAppContext()
  // selectedIdentity is now a StateStream provided by NavigationContainer
  const selectedIdentityValue = useStream(selectedIdentity)
  return selectedIdentityValue
}
