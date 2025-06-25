import {getAccountName} from '@shm/shared/content'
import {useEntity} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {SizableText} from '@shm/ui/text'
import {ComponentProps} from 'react'

export function DocumentName({
  accountId,
  ...props
}: ComponentProps<typeof SizableText> & {accountId?: string}) {
  const id = accountId ? hmId(accountId) : undefined
  const {data: account} = useEntity(id)
  if (!id) return null
  return (
    <SizableText {...props}>{getAccountName(account?.document)}</SizableText>
  )
}
