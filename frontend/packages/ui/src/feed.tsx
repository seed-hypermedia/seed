import {UnpackedHypermediaId} from '@shm/shared'
import {useActivityFeed} from '@shm/shared/activity-service-provider'
import {HMContactItem, HMResourceItem} from '@shm/shared/feed-types'
import {HMTimestamp} from '@shm/shared/hm-types'
import {NavRoute} from '@shm/shared/routes'
import {useRouteLink} from '@shm/shared/routing'
import {formattedDateShort} from '@shm/shared/utils'
import {ContactToken} from './contact-token'
import {ResourceToken} from './resource-token'
import {SizableText} from './text'
import {cn} from './utils'

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
        'hover:bg-background m-2 rounded-md p-2 break-words transition-colors hover:dark:bg-black',
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
      {children}
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
    <SizableText size="xs" className="truncate overflow-hidden px-1">
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

export function Feed2({docId}: {docId: UnpackedHypermediaId}) {
  const data = useActivityFeed({docId})

  console.log(`== ~ Feed2 ~ data:`, data)

  return null
}
