import {getAccountName} from '@shm/shared/content'
import {useEntity} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {SizableText} from '@shm/ui/text'

export function NameComponent({
  accountId,
  ...props
}: {accountId?: string} & React.ComponentProps<typeof SizableText>) {
  const id = accountId ? hmId('d', accountId) : undefined
  const entity = useEntity(id)
  if (!id) return null
  return (
    <SizableText {...props}>
      {getAccountName(entity.data?.document)}
    </SizableText>
  )
}
