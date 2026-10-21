import type {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useRouteLink, useUniversalAppContext} from '@shm/shared'
import {getContactMetadata} from '@shm/shared/content'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useResource} from '@shm/shared/models/entity'
import type {MouseEventHandler} from 'react'
import {HMIcon} from './hm-icon'
import {HoverCard, HoverCardContent, HoverCardTrigger} from './hover-card'
import {Spinner} from './spinner'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/** A linked account avatar with identity details on hover and keyboard focus. */
export function AccountAvatar({
  id,
  name,
  icon,
  size = 32,
  className,
  siteUid,
  onClick,
}: {
  id: UnpackedHypermediaId
  name?: HMMetadata['name'] | null
  icon?: HMMetadata['icon'] | null
  size?: number
  className?: string
  siteUid?: string | null
  onClick?: MouseEventHandler<HTMLAnchorElement>
}) {
  const accountId = hmId(id.uid)
  const route = siteUid
    ? {
        key: 'site-profile' as const,
        id: hmId(siteUid),
        accountUid: id.uid !== siteUid ? id.uid : undefined,
        tab: 'profile' as const,
      }
    : {key: 'profile' as const, id: accountId}
  const linkProps = useRouteLink(route)
  const {contacts} = useUniversalAppContext()
  const displayName = getContactMetadata(id.uid, {name: name || abbreviateUid(id.uid)}, contacts).name

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <a
          {...linkProps}
          aria-label={`Open ${displayName} profile`}
          className="no-window-drag inline-flex shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={(event) => {
            onClick?.(event)
            linkProps.onClick?.(event)
          }}
        >
          <HMIcon id={accountId} name={name} icon={icon} size={size} className={className} />
        </a>
      </HoverCardTrigger>
      <HoverCardContent align="start" collisionPadding={12} className="w-64 max-w-[calc(100vw-1.5rem)]">
        <div className="flex items-center gap-3">
          <HMIcon id={accountId} name={name} icon={icon} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">
              <AccountIdentityName name={displayName} />
            </div>
            <a {...linkProps} className="text-muted-foreground text-sm underline underline-offset-4">
              View profile
            </a>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

/** An account avatar that loads its current profile metadata. */
export function LoadedAccountAvatar({id, size}: {id: UnpackedHypermediaId; size?: number}) {
  const account = useResource(hmId(id.uid))
  const metadata = account.data?.type === 'document' ? account.data.document.metadata : undefined
  return <AccountAvatar id={id} name={metadata?.name} icon={metadata?.icon} size={size} />
}

/** Formats identity labels without splitting Unicode code points or duplicating mention prefixes. */
export function formatAccountIdentityName(
  name: string,
  {mention = false, maxLength}: {mention?: boolean; maxLength?: number} = {},
) {
  const label = mention && !name.startsWith('@') ? `@${name}` : name
  const characters = Array.from(label)
  return maxLength !== undefined && characters.length > maxLength
    ? characters.slice(0, maxLength).join('') + '…'
    : label
}

/** Shared account label; inline mentions retain their full name and inherit text styling. */
export function AccountIdentityName({
  name,
  mention = false,
  maxLength,
}: {
  name: string
  mention?: boolean
  maxLength?: number
}) {
  const label = formatAccountIdentityName(name, {mention, maxLength})
  if (maxLength === undefined) return <>{label}</>
  return (
    <Tooltip content={name} asChild>
      <span tabIndex={0} aria-label={name}>
        {label}
      </span>
    </Tooltip>
  )
}

/** Nonlinked account identity for embed headers and source links, with contact names and full-name access. */
export function AccountIdentity({
  id,
  name,
  icon,
  variant = 'regular',
  loading = false,
  className,
}: {
  id: UnpackedHypermediaId
  name?: HMMetadata['name'] | null
  icon?: HMMetadata['icon'] | null
  variant?: 'compact' | 'regular'
  loading?: boolean
  className?: string
}) {
  const {contacts} = useUniversalAppContext()
  const metadata = getContactMetadata(id.uid, {name: name || undefined}, contacts)
  const compact = variant === 'compact'
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center align-baseline font-sans font-medium',
        compact ? 'gap-0.5 text-xs' : 'gap-1 text-sm',
        className,
      )}
      aria-busy={loading || undefined}
    >
      <HMIcon id={hmId(id.uid)} name={metadata.name} icon={icon} size={compact ? 14 : 18} />
      <AccountIdentityName name={metadata.name} maxLength={20} />
      {loading ? <Spinner size="small" /> : null}
    </span>
  )
}
