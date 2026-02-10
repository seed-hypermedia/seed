import {
  abbreviateUid,
  HMMetadata,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {AlertCircle} from 'lucide-react'
import {memo} from 'react'
import {UIAvatar, UIAvatarProps} from './avatar'
import {useImageUrl} from './get-file-url'
import {Tooltip} from './tooltip'
import {cn} from './utils'

export const HMIcon = memo(_HMIcon, (prevProps, nextProps) => {
  // Custom comparison function for memo
  // Deep comparison for id object
  if (prevProps.id?.id !== nextProps.id?.id) return false
  if (prevProps.id?.version !== nextProps.id?.version) return false
  if (prevProps.id?.blockRef !== nextProps.id?.blockRef) return false

  if (prevProps.size !== nextProps.size) return false
  if (prevProps.className !== nextProps.className) return false

  // Direct comparison for name and icon props
  if (prevProps.name !== nextProps.name) return false
  if (prevProps.icon !== nextProps.icon) return false

  return true
})

function _HMIcon({
  id,
  name,
  icon,
  size = 32,
  className,
  ...props
}: Omit<UIAvatarProps, 'id'> & {
  id?: UnpackedHypermediaId
  name?: HMMetadata['name'] | null
  icon?: HMMetadata['icon'] | null
  size?: number
  className?: string
}) {
  const imageUrl = useImageUrl()
  if (!id) return null

  const isHomeDocument = id.path && id.path.length === 0

  // We decided that for non-home documents we don't want to show any icons, unless it's specified in the metadata.
  if (!isHomeDocument && !icon) {
    return null
  }

  return (
    <UIAvatar
      size={size}
      id={id.id}
      label={name || ''}
      url={icon ? imageUrl(icon, 'S') : undefined}
      className={cn(
        'flex-none bg-white',
        // We want home documents and profiles to have round icons,
        // and normal documents to have square icons.
        // This should help differentiate between "people" and "documents".
        isHomeDocument ? 'rounded-full' : 'rounded-sm',
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
      <HMIcon id={id} size={size} name={metadata?.name} icon={metadata?.icon} />
      <ErrorDot error={error} />
    </>
  )

  return (
    <Tooltip content={getMetadataName(metadata) || abbreviateUid(id.uid)}>
      <a
        className="no-window-drag relative min-h-5 min-w-5 p-0"
        {...linkProps}
        style={{height: size} as React.CSSProperties}
      >
        {content}
      </a>
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
  return (
    <HMIcon id={id} name={metadata?.name} icon={metadata?.icon} size={size} />
  )
}
