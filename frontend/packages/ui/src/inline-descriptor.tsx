import {HMContactItem, HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {abbreviateUid, AnyTimestamp, formattedDateShort, hmId, NavRoute, normalizeDate, useRouteLink} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Spinner} from './spinner'
import {Tooltip} from './tooltip'

function formatUTC(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')

  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1) // Months are 0-based.
  const day = pad(date.getUTCDate())
  const hours = pad(date.getUTCHours())
  const minutes = pad(date.getUTCMinutes())

  return `${year}-${month}-${day} ${hours}:${minutes} (UTC)`
}

export function Timestamp({time, route}: {time: AnyTimestamp; route?: NavRoute | null}) {
  if (!time) return null

  const linkProps = route ? useRouteLink(route ?? null) : {}
  const date = normalizeDate(time)

  if (!date) return null

  return (
    <Tooltip side="top" delay={400} content={formatUTC(date)}>
      <a {...linkProps} className="ml-1 flex-none text-[11px] hover:underline">
        {formattedDateShort(time)}
      </a>
    </Tooltip>
  )
}

export function InlineDescriptor({children}: {children: React.ReactNode}) {
  return <p className="text-muted-foreground text-sm">{children}</p>
}

function getSiteContextUid(route: NavRoute | null): string | null {
  if (!route) return null

  switch (route.key) {
    case 'document':
    case 'feed':
    case 'activity':
    case 'comments':
    case 'directory':
    case 'collaborators':
    case 'site-profile':
    case 'profile':
    case 'contact':
      return route.id.uid
    default:
      return null
  }
}

/** Builds a profile route that prefers the current site context when one exists. */
export function getContextualProfileRoute(
  currentRoute: NavRoute | null,
  accountId: UnpackedHypermediaId | null,
  siteUid?: string | null,
): NavRoute | null {
  if (!accountId) return null

  const effectiveSiteUid = siteUid || getSiteContextUid(currentRoute)
  if (!effectiveSiteUid) {
    return {key: 'profile', id: accountId}
  }

  return {
    key: 'site-profile',
    id: hmId(effectiveSiteUid),
    accountUid: accountId.uid !== effectiveSiteUid ? accountId.uid : undefined,
    tab: 'profile',
  }
}

/** Inline link to an author's profile, with a spinner while the account is still loading. */
export function AuthorNameLink({author, siteUid}: {author: HMContactItem | null; siteUid?: string}) {
  const currentRoute = useNavRoute()
  // Use the account query to get fresh cache data and distinguish loading from settled.
  // When useHackyAuthorsSubscriptions discovers the account, this query gets invalidated
  // and re-renders with the resolved name.
  const account = useAccount(author?.id?.uid)
  const resolvedName = account.data?.metadata?.name || author?.metadata?.name
  const isLoading = account.isLoading
  const authorName = resolvedName || abbreviateUid(author?.id?.uid)
  const linkProps = useRouteLink(getContextualProfileRoute(currentRoute, author?.id || null, siteUid))
  return (
    <a className={`text-sm font-bold ${resolvedName ? 'text-foreground' : 'text-muted-foreground'}`} {...linkProps}>
      {authorName}
      {isLoading ? (
        <span className="ml-1">
          <Spinner size="small" />
        </span>
      ) : null}
    </a>
  )
}

export function DocumentNameLink({
  metadata,
  id,
  fallback = 'a document',
}: {
  metadata?: HMMetadata | null
  id: UnpackedHypermediaId
  fallback?: string
}) {
  const linkProps = useRouteLink({key: 'document', id})
  return (
    <a
      className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10"
      {...linkProps}
    >
      {metadata?.name || fallback}
    </a>
  )
}
