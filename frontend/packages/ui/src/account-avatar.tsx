import type {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useRouteLink} from '@shm/shared'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useResource} from '@shm/shared/models/entity'
import type {MouseEventHandler} from 'react'
import {HMIcon} from './hm-icon'
import {HoverCard, HoverCardContent, HoverCardTrigger} from './hover-card'

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
  const displayName = name || abbreviateUid(id.uid)

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
            <div className="truncate font-semibold">{displayName}</div>
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
