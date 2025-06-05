import {useNavigate} from '@/utils/useNavigate'
import {getAccountName} from '@shm/shared/content'
import {useEntity} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {SizableText} from '@shm/ui/text'
import {ButtonProps, ButtonText} from 'tamagui'

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

export function LinkNameComponent({
  accountId,
  ...props
}: ButtonProps & {accountId?: string}) {
  const id = accountId ? hmId('d', accountId) : undefined
  const entity = useEntity(id)
  const navigate = useNavigate('push')
  if (!id) return null
  return (
    <ButtonText
      borderColor="$colorTransparent"
      outlineColor="$colorTransparent"
      hoverStyle={{
        borderColor: '$colorTransparent',
        textDecorationLine: 'underline',
        textDecorationColor: 'currentColor',
      }}
      size="$2"
      {...props}
      fontWeight="bold"
      onPress={() => {
        navigate({key: 'document', id})
      }}
    >
      {getAccountName(entity.data?.document)}
    </ButtonText>
  )
}
