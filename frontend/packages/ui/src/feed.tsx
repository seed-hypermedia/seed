import {UnpackedHypermediaId} from '@shm/shared'
import {useActivityFeed} from '@shm/shared/activity-service-provider'
import {HMContactItem, HMResourceItem} from '@shm/shared/feed-types'
import {HMTimestamp} from '@shm/shared/hm-types'
import {ListEventsRequest} from '@shm/shared/models/activity-service'
import {NavRoute} from '@shm/shared/routes'
import {useRouteLink} from '@shm/shared/routing'
import {formattedDateShort} from '@shm/shared/utils'
import {ContactToken} from './contact-token'
import {ResourceToken} from './resource-token'
import {SizableText} from './text'
import {cn} from './utils'

/*

<div className="hover:bg-background m-2 rounded">
  <div className="flex items-start gap-2 p-2">
    <UIAvatar size={20} label="foo" className="my-1 flex-none" />
    <p>
      <span className="text-sm font-bold">horacio</span>{' '}
      <span className="text-muted-foreground text-sm">
        commented on
      </span>{' '}
      <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
        this document with a super long name because I want to see how
        it overflows
      </a>{' '}
      <span className="text-muted-foreground ml-2 flex-none text-xs">
        aug 24
      </span>
    </p>
  </div>
</div>
*/

export function FeedItemWrapper({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'hover:bg-background m-2 rounded transition-colors hover:dark:bg-black',
        className,
      )}
      {...props}
    />
  )
}

export function FeedItemHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-start gap-2 p-2', className)} {...props} />
  )
}

// =======================================

export function EventRow({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'hover:bg-background m-2 rounded transition-colors hover:dark:bg-black',
        className,
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export function RouteEventRow({
  children,
  route,
  className,
}: {
  children: React.ReactNode
  route: NavRoute | null
  className?: string
}) {
  const linkProps = useRouteLink(route)
  return (
    <div
      className={cn(
        'hover:bg-background m-2 flex items-center rounded-md p-2 break-words hover:dark:bg-black',
        className,
      )}
      {...linkProps}
    >
      {children}
    </div>
  )
}

export function EventRowInline({
  children,
  route,
  className,
}: {
  children: React.ReactNode
  route: NavRoute | null
  className?: string
}) {
  return (
    <RouteEventRow className={className} route={route}>
      <div className="flex items-start gap-2 p-2">{children}</div>
    </RouteEventRow>
  )
}

export function EventContact({contact}: {contact?: HMContactItem}) {
  if (!contact) return null
  return <ContactToken id={contact.id} metadata={contact.metadata} />
}

export function EventResource({resource}: {resource: HMResourceItem}) {
  return <ResourceToken id={resource.id} metadata={resource.metadata} />
}

export function EventContacts({contacts}: {contacts: HMContactItem[]}) {
  return (
    <div>
      {contacts.map((contact) => {
        return <ContactToken id={contact.id} metadata={contact.metadata} />
      })}
    </div>
  )
}

export function EventDescriptionText({children}: {children: React.ReactNode}) {
  return children ? (
    <SizableText size="sm" className="truncate overflow-hidden px-1">
      {children}
    </SizableText>
  ) : null
}

export function EventTimestamp({time}: {time: HMTimestamp | undefined}) {
  if (!time) return null
  return (
    <SizableText size="xs" className="text-muted-foreground self-end px-1 py-1">
      {formattedDateShort(time)}
    </SizableText>
  )
}

export function Feed2({
  docId,
  filterResource,
  currentAccount,
}: {
  docId: UnpackedHypermediaId
  filterResource: ListEventsRequest['filterResource']
  currentAccount: string
}) {
  const {data} = useActivityFeed({
    docId,
    filterResource,
    currentAccount,
    pageSize: 40,
  })

  // Flatten all pages into a single array of events
  const allEvents = data?.pages.flatMap((page) => page.events) || []

  return (
    <div>
      {allEvents.map((e) => {
        return (
          <p key={e.id}>
            {JSON.stringify({
              type: e.type,
              id: e.id,
            })}
          </p>
        )
      })}
    </div>
  )
}
