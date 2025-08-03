import {useRouteLink} from '@shm/shared'
import {HMMetadata, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {HoverCard, HoverCardContent, HoverCardTrigger} from './/hover-card'
import {HMIcon} from './hm-icon'
import {cn} from './utils'

export function ResourceToken({
  id,
  metadata,
  ResourcePreview,
}: {
  id: UnpackedHypermediaId
  metadata?: HMMetadata | null
  ResourcePreview?: React.ComponentType<{
    metadata?: HMMetadata | null
    id: UnpackedHypermediaId
  }>
}) {
  const linkProps = useRouteLink(
    {key: 'document', id: id},
    {handler: 'onClick'},
  )
  const icon =
    !id.path?.length || metadata?.icon ? (
      <HMIcon size={20} id={id} metadata={metadata} />
    ) : null

  const className =
    'dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200! hover:dark:border-gray-600 hover:dark:text-white text-sm bg-gray-200 border border-gray-300 px-1 py-0 rounded mt-1.5 whitespace-wrap break-all inline-flex items-center gap-1'
  if (ResourcePreview) {
    return (
      <HoverCard>
        <HoverCardTrigger asChild>
          <a
            {...linkProps}
            className={cn(
              className,

              // 'dark:bg-brand-12 dark:border-brand-11 dark:text-gray-200',
              'text-secondary-foreground',
            )}
          >
            {icon}
            {metadata?.name}
          </a>
        </HoverCardTrigger>
        <HoverCardContent className="w-full max-w-100 p-0" align="end">
          <ResourcePreview metadata={metadata} id={id} />
        </HoverCardContent>
      </HoverCard>
    )
  }
  return (
    <a {...linkProps} className={className}>
      {icon}
      {metadata?.name}
    </a>
  )
}
