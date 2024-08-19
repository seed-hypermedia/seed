import {getFileUrl} from '@/utils/account-url'
import {useNavigate} from '@/utils/useNavigate'
import {getMetadataName, HMMetadata, UnpackedHypermediaId} from '@shm/shared'
import {Tooltip, UIAvatar} from '@shm/ui'
import {AlertCircle} from '@tamagui/lucide-icons'
import {Button, YStack} from 'tamagui'

export function Thumbnail({
  id,
  metadata,
  size = 32,
}: {
  id: UnpackedHypermediaId
  metadata?: HMMetadata | null
  size?: number
}) {
  return (
    <UIAvatar
      size={size}
      id={id.path?.at(-1) || id.uid.slice(2)}
      label={metadata?.name}
      url={getFileUrl(metadata?.thumbnail)}
      borderRadius={id.path?.length != 0 ? size / 6 : undefined}
    />
  )
}

export function LinkThumbnail({
  id,
  metadata,
  size,
  error,
}: {
  id: UnpackedHypermediaId
  metadata?: HMMetadata | null
  size?: number
  error?: boolean
}) {
  const navigate = useNavigate()
  let content = (
    <>
      <Thumbnail id={id} size={size} metadata={metadata} />
      <ErrorDot error={error} />
    </>
  )

  return (
    <Tooltip content={getMetadataName(metadata)}>
      <Button
        className="no-window-drag"
        size="$1"
        backgroundColor="transparent"
        hoverStyle={{backgroundColor: 'transparent'}}
        minWidth={20}
        minHeight={20}
        padding={0}
        onPress={(e: MouseEvent) => {
          e.preventDefault()
          e.stopPropagation()
          navigate({key: 'document', id})
        }}
        position="relative"
        height={size}
      >
        {content}
      </Button>
    </Tooltip>
  )
}

export function ErrorDot({error}: {error?: boolean}) {
  return error ? (
    <YStack
      backgroundColor="$red11"
      display="flex"
      position="absolute"
      top={-8}
      left={-8}
      padding={0}
      paddingLeft={-4}
      width={16}
      height={16}
      borderRadius={8}
    >
      <AlertCircle size={16} />
    </YStack>
  ) : null
}
