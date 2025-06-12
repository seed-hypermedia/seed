import {hmId, useUniversalAppContext} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {useStream} from '@shm/ui/use-stream'

export function useSelectedAccount() {
  const {selectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  const {data: account} = useEntity(
    selectedIdentityValue ? hmId('d', selectedIdentityValue) : null,
  )
  return account
}

export function useSelectedAccountId() {
  const {selectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  return selectedIdentityValue
}
