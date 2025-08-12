import {getAccountName} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {SizableText} from '@shm/ui/text'
import {ComponentProps} from 'react'

export function DocumentName({
  accountId,
  ...props
}: ComponentProps<typeof SizableText> & {accountId?: string}) {
  const id = accountId ? hmId(accountId) : undefined
  const {data: account} = useResource(id)
  if (!id) return null
  return (
    // @ts-expect-error
    <SizableText {...props}>{getAccountName(account?.document)}</SizableText>
  )
}
