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
      <HMIcon size={20} id={id} name={metadata?.name} icon={metadata?.icon} />
    ) : null
  const className =
    'h-5 truncate rounded px-1 text-sm font-bold inline-flex gap-1 items-center'
  if (ResourcePreview) {
    return (
      <HoverCard>
        <HoverCardTrigger asChild>
          <a {...linkProps} className={cn(className)}>
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
    <a
      className="inline-flex items-center gap-1 overflow-hidden"
      {...linkProps}
    >
      {icon}
      <SizableText
        size="xs"
        weight="bold"
        className="h-5 truncate rounded text-sm font-bold"
      >
        {metadata?.name}
      </SizableText>
    </a>
  )
}
