import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {getMetadataName} from '@shm/shared/content'
import {isExploreSpaceId} from '@shm/shared/explore'
import {useSelectedAccountCapability} from '@shm/shared/models/capabilities'
import {useAccountsMetadata} from '@shm/shared/models/entity'
import type {ExploreAccount} from '@shm/shared/models/explore'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {useRouteLink} from '@shm/shared/routing'
import {formattedDate, formattedDateMedium} from '@shm/shared/utils/date'
import {activitySlugToFilter, hmId} from '@shm/shared/utils/entity-id-url'
import {GitBranch, MessageSquare} from 'lucide-react'
import {FacePile} from './face-pile'
import {HMIcon} from './hm-icon'
import {PrivateBadge} from './private-badge'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
import {cn} from './utils'

// Card shell shared by the explorer landing sections.
const exploreCardClassName =
  'border-border hover:border-primary/40 flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:bg-black'

/** Names a capability role the way the space's people tab does. */
function exploreRoleLabel(role: string | undefined) {
  if (role === 'writer') return 'Writer'
  if (role === 'agent') return 'Device'
  if (role === 'owner') return 'Owner'
  if (role === 'member') return 'Member'
  return role
}

// Card of a recently updated document on the explorer landing page.
export function ExploreDocumentCard({document, spaceName}: {document: HMDocumentInfo; spaceName?: string}) {
  const id = document.id
  const linkProps = useRouteLink({key: 'document', id})
  const commentsLink = useRouteLink({key: 'comments', id})
  const citationsLink = useRouteLink({key: 'activity', id, filterEventType: activitySlugToFilter('citations')})
  const interactions = useInteractionSummary(id)
  const authorUids = document.authors ?? []
  const accountsMetadata = useAccountsMetadata(authorUids)
  const authorName = authorUids.length
    ? getMetadataName(accountsMetadata.data?.[authorUids[0]!]?.metadata) || undefined
    : undefined
  const tag =
    spaceName ||
    document.breadcrumbs?.[0]?.name ||
    (isExploreSpaceId(id) ? getMetadataName(document.metadata) : undefined) ||
    id.uid.slice(0, 8)
  const trail = (document.breadcrumbs ?? [])
    .slice(1, -1)
    .map((crumb) => crumb.name)
    .filter(Boolean)
  const updated = document.updateTime
  const citations = interactions.data?.citations ?? 0
  const comments = interactions.data?.comments ?? 0
  return (
    <div className={cn(exploreCardClassName, 'relative')}>
      <div className="flex items-start justify-between gap-3">
        <span className="bg-brand-12 text-brand-3 dark:bg-brand-3/25 dark:text-brand-8 min-w-0 truncate rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
          {tag}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {trail.length ? `${trail.join(' / ')} · ` : ''}
          {updated ? formattedDate(updated) : ''}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <a {...linkProps} className="min-w-0 flex-1 after:absolute after:inset-0 after:content-['']">
          {/* block, because truncate cannot clip the inline span SizableText renders. */}
          <SizableText weight="bold" className="block truncate font-sans">
            {getMetadataName(document.metadata) || id.path?.at(-1) || 'Untitled'}
          </SizableText>
        </a>
        {document.visibility === 'PRIVATE' ? <PrivateBadge size="sm" /> : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        {authorUids.length ? (
          <span className="flex min-w-0 items-center gap-2">
            <FacePile accounts={authorUids} accountsMetadata={accountsMetadata.data ?? {}} />
            {authorName ? (
              <SizableText size="sm" className="truncate font-sans">
                {authorName}
              </SizableText>
            ) : null}
          </span>
        ) : (
          <span />
        )}
        {citations || comments ? (
          <span className="border-border relative z-10 flex shrink-0 items-center overflow-hidden rounded-md border">
            {citations ? (
              <Tooltip content="Citations">
                <a
                  {...citationsLink}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1 px-2.5 py-1 text-xs transition-colors"
                >
                  <GitBranch className="size-3.5" aria-hidden />
                  {citations}
                </a>
              </Tooltip>
            ) : null}
            {comments ? (
              <Tooltip content="Conversations">
                <a
                  {...commentsLink}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground border-border flex items-center gap-1 px-2.5 py-1 text-xs transition-colors [&:not(:first-child)]:border-l"
                >
                  <MessageSquare className="size-3.5" aria-hidden />
                  {comments}
                </a>
              </Tooltip>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  )
}

// Card of a joined space
export function ExploreSpaceCard({space}: {space: HMDocumentInfo}) {
  const id = hmId(space.id.uid)
  const capability = useSelectedAccountCapability(id)
  // Every card is a space the current identity joined,
  // so show member role if no capability.
  const role = exploreRoleLabel(capability?.role) ?? 'Member'
  const linkProps = useRouteLink({key: 'document', id})
  const name = getMetadataName(space.metadata) || space.id.uid.slice(0, 8)
  const updated = space.updateTime
  return (
    <a {...linkProps} className={exploreCardClassName}>
      <div className="flex items-center gap-2">
        <HMIcon size={24} id={id} name={name} icon={space.metadata?.icon} />
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
        <span className="bg-muted text-muted-foreground shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
          {role}
        </span>
      </div>
      {updated ? <span className="text-muted-foreground text-xs">Updated {formattedDateMedium(updated)}</span> : null}
    </a>
  )
}

/** One account in the explorer's people list, with its role when the list is scoped to a space. */
export function ExplorePersonCard({account}: {account: ExploreAccount & {role?: string}}) {
  const id = hmId(account.uid)
  const linkProps = useRouteLink({key: 'profile', id})
  const metadata = useAccountsMetadata([account.uid])
  const name = account.name || getMetadataName(metadata.data?.[account.uid]?.metadata) || account.uid.slice(0, 8)
  const role = exploreRoleLabel(account.role)
  return (
    <a {...linkProps} className={cn(exploreCardClassName, 'gap-2')}>
      <span className="flex min-w-0 items-center gap-2">
        <HMIcon size={24} id={id} name={name} icon={account.icon} />
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
        {role ? (
          <span className="bg-muted text-muted-foreground shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
            {role}
          </span>
        ) : null}
      </span>
    </a>
  )
}
