import {HMMetadata, UnpackedHypermediaId} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {useImageUrl} from '@shm/ui/get-file-url'
import {Button} from '@tamagui/button'
import {AlertCircle} from '@tamagui/lucide-icons'
import {YStack} from '@tamagui/stacks'
import {memo} from 'react'
import {UIAvatar, UIAvatarProps} from './avatar'
import {Tooltip} from './tooltip'

// TODO: support new drafts now
export const HMIcon = memo(_HMIcon)

function _HMIcon({
  id,
  metadata,
  size = 32,
  ...props
}: Omit<UIAvatarProps, 'id'> & {
  id: UnpackedHypermediaId
  metadata?: HMMetadata | null
  size?: number
}) {
  const imageUrl = useImageUrl()
  if (!id) return null

  return (
    <UIAvatar
      size={size}
      // id={id.path?.at(-1) || id.uid.slice(2)}
      id={id.id}
      label={metadata?.name}
      url={metadata?.icon ? imageUrl(metadata.icon, 'S') : undefined}
      borderRadius={id.path && id.path.length != 0 ? size / 8 : undefined}
      flexShrink={0}
      flexGrow={0}
      {...props}
    />
  )
}

export function LinkIcon({
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
  const linkProps = useRouteLink({key: 'document', id})
  let content = (
    <>
      <HMIcon id={id} size={size} metadata={metadata} />
      <ErrorDot error={error} />
    </>
  )

  return (
    <Tooltip
      content={
        getMetadataName(metadata) ||
        `${id.uid.slice(0, 5)}...${id.uid.slice(-5)}`
      }
    >
      <Button
        className="no-window-drag"
        size="$1"
        backgroundColor="transparent"
        hoverStyle={{backgroundColor: 'transparent'}}
        minWidth={20}
        minHeight={20}
        padding={0}
        {...linkProps}
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

export function LoadedHMIcon({
  id,
  size,
}: {
  id: UnpackedHypermediaId
  size?: number
}) {
  const entity = useEntity(id)
  return (
    <HMIcon id={id} metadata={entity?.data?.document?.metadata} size={size} />
  )
}
