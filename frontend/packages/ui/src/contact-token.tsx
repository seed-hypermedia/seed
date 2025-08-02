import {HMMetadata, UnpackedHypermediaId} from '@shm/shared'
import {useRouteLink} from '@shm/shared/routing'
import {HMIcon} from './hm-icon'
import {HoverCard, HoverCardContent, HoverCardTrigger} from './hover-card'
import {SizableText} from './text'
import {cn} from './utils'

export function ContactToken({
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
  const className = 'inline-flex gap-1 items-center'
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
        <HoverCardContent className="p-0 w-full max-w-100" align="end">
          <ResourcePreview metadata={metadata} id={id} />
        </HoverCardContent>
      </HoverCard>
    )
  }
  return (
    <a className="inline-flex gap-1 items-center" {...linkProps}>
      {icon}
      <SizableText weight="bold">{metadata?.name}</SizableText>
    </a>
  )
}
