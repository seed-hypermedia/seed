import {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {useResource} from '@shm/shared/models/entity'
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
  const linkProps = useRouteLink({key: 'document', id: id})
  const actions = useDocumentActions()
  const draft = actions.getDraft?.(id)
  const resource = useResource(id, {subscribed: true})
  const liveMetadata = resource.data?.type === 'document' ? resource.data.document.metadata : undefined
  const displayMetadata = draft?.metadata
    ? {...(metadata ?? {}), ...(liveMetadata ?? {}), ...draft.metadata}
    : liveMetadata ?? metadata
  const icon =
    !id.path?.length || displayMetadata?.icon ? (
      <HMIcon size={20} id={id} name={displayMetadata?.name} icon={displayMetadata?.icon} />
    ) : null

  const baseClassName =
    'inline text-sm whitespace-normal bg-gray-100 border hover:dark:text-white dark:bg-gray-800 hover:bg-gray-200'
  const previewTriggerClassName = 'inline-block align-middle whitespace-nowrap px-1 rounded-md'
  if (ResourcePreview) {
    return (
      <HoverCard>
        <HoverCardTrigger asChild>
          <a {...linkProps} className={cn(baseClassName, previewTriggerClassName)}>
            {icon ? <span className="mr-1 inline-block align-middle">{icon}</span> : null}
            <span className="text-foreground truncate overflow-hidden">
              {displayMetadata?.name || 'Untitled Resource'}
            </span>
          </a>
        </HoverCardTrigger>
        <HoverCardContent className="w-full max-w-100 p-0" align="end">
          <ResourcePreview metadata={displayMetadata} id={id} />
        </HoverCardContent>
      </HoverCard>
    )
  }
  return (
    <a {...linkProps} className={baseClassName}>
      {icon ? <span className="mr-1 inline-block align-middle">{icon}</span> : null}
      {displayMetadata?.name || 'Untitled Resource'}
    </a>
  )
}
