import {HMMetadata, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useRouteLink} from '@shm/shared/routing'
import {HMIcon} from './hm-icon'
import {HoverCard, HoverCardContent, HoverCardTrigger} from './hover-card'
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
  )
  const icon =
    !id.path?.length || metadata?.icon ? (
      <HMIcon size={20} id={id} name={metadata?.name} icon={metadata?.icon} />
    ) : null

  const baseClassName =
    'inline text-sm whitespace-normal bg-gray-100 border hover:dark:text-white dark:bg-gray-800 hover:bg-gray-200'
  const previewTriggerClassName =
    'inline-block align-middle whitespace-nowrap px-1 rounded-md'
  if (ResourcePreview) {
    return (
      <HoverCard>
        <HoverCardTrigger asChild>
          <a
            {...linkProps}
            className={cn(baseClassName, previewTriggerClassName)}
          >
            {icon ? (
              <span className="mr-1 inline-block align-middle">{icon}</span>
            ) : null}
            <span className="text-foreground truncate overflow-hidden">
              {metadata?.name || 'Untitled Resource'}
            </span>
          </a>
        </HoverCardTrigger>
        <HoverCardContent className="w-full max-w-100 p-0" align="end">
          <ResourcePreview metadata={metadata} id={id} />
        </HoverCardContent>
      </HoverCard>
    )
  }
  return (
    <a {...linkProps} className={baseClassName}>
      {icon ? (
        <span className="mr-1 inline-block align-middle">{icon}</span>
      ) : null}
      {metadata?.name || 'Untitled Resource'}
    </a>
  )
}
