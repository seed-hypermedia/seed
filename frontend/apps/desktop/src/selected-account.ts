import {hmId, useUniversalAppContext} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {useStream} from '@shm/ui/use-stream'

export function useSelectedAccount() {
  const {selectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  const {data: account} = useResource(
    selectedIdentityValue ? hmId(selectedIdentityValue) : null,
  )
  if (account?.type !== 'document') return undefined
  return account
}

export function useSelectedAccountId() {
  const {selectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  return selectedIdentityValue
}
