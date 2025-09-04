import {HMMetadata, UnpackedHypermediaId, useRouteLink} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {useImageUrl} from './get-file-url'
import {AlertCircle} from 'lucide-react'
import {memo} from 'react'
import {UIAvatar, UIAvatarProps} from './avatar'
import {Button} from './button'
import {Tooltip} from './tooltip'
import {cn} from './utils'

// TODO: support new drafts now
export const HMIcon = memo(_HMIcon)

function _HMIcon({
  id,
  metadata,
  size = 32,
  className,
  ...props
}: Omit<UIAvatarProps, 'id'> & {
  id: UnpackedHypermediaId
  metadata?: HMMetadata | null
  size?: number
  className?: string
}) {
  const imageUrl = useImageUrl()
  if (!id) return null

  return (
    <UIAvatar
      size={size}
      id={id.id}
      label={metadata?.name}
      url={metadata?.icon ? imageUrl(metadata.icon, 'S') : undefined}
      className={cn(
        'flex-none',
        id.path && id.path.length !== 0 ? 'rounded-md' : 'rounded-full',
        className,
      )}
      {...props}
    />
  )
}

function getMetadataName(metadata?: HMMetadata | null) {
  return metadata?.name
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
        variant="ghost"
        size="icon"
        className="no-window-drag relative min-h-5 min-w-5 p-0"
        {...linkProps}
        style={{height: size} as React.CSSProperties}
      >
        {content}
      </Button>
    </Tooltip>
  )
}

export function ErrorDot({error}: {error?: boolean}) {
  if (!error) return null

  return (
    <div className="bg-destructive absolute -top-2 -left-2 flex h-4 w-4 items-center justify-center rounded-full">
      <AlertCircle className="h-4 w-4 text-white" />
    </div>
  )
}

export function LoadedHMIcon({
  id,
  size,
}: {
  id: UnpackedHypermediaId
  size?: number
}) {
  const entity = useResource(id)
  const metadata =
    entity.data?.type === 'document'
      ? entity.data.document?.metadata
      : undefined
  return <HMIcon id={id} metadata={metadata} size={size} />
}
