import {useEntity} from '@/models/entities'
import {useNavigate} from '@/utils/useNavigate'
import {getAccountName, hmId} from '@shm/shared'
import {Button, ButtonProps, SizableText, SizableTextProps} from '@shm/ui'

export function NameComponent({
  accountId,
  ...props
}: SizableTextProps & {accountId?: string}) {
  const id = accountId ? hmId('d', accountId) : undefined
  const entity = useEntity(id)
  if (!id) return null
  return (
    <SizableText {...props}>
      {getAccountName(entity.data?.document)}
    </SizableText>
  )
}

export function LinkNameComponent({
  accountId,
  ...props
}: ButtonProps & {accountId?: string}) {
  const id = accountId ? hmId('d', accountId) : undefined
  const entity = useEntity(id)
  const navigate = useNavigate('push')
  if (!id) return null
  return (
    <Button
      borderColor="$colorTransparent"
      outlineColor="$colorTransparent"
      hoverStyle={{
        borderColor: '$colorTransparent',
      }}
      size="$2"
      {...props}
      fontWeight="bold"
      onPress={() => {
        navigate({key: 'document', id})
      }}
    >
      {getAccountName(entity.data?.document)}
    </Button>
  )
}
