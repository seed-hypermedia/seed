import {UnpackedHypermediaId} from '@shm/shared'
import {useActivityFeed} from '@shm/shared/activity-service-provider'
import {HMContactItem, HMResourceItem} from '@shm/shared/feed-types'
import {HMTimestamp} from '@shm/shared/hm-types'
import {
  ListEventsRequest,
  LoadedEvent,
} from '@shm/shared/models/activity-service'
import {NavRoute} from '@shm/shared/routes'
import {useRouteLink} from '@shm/shared/routing'
import {formattedDateShort} from '@shm/shared/utils'
import {useCallback, useEffect, useRef} from 'react'
import {ScrollArea} from './components/scroll-area'
import {ContactToken} from './contact-token'
import {HMIcon} from './hm-icon'
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
  const observerRef = useRef<IntersectionObserver>()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useActivityFeed({
    docId,

    filterResource,
    currentAccount,
  })

  const lastElementRef = useCallback(
    (node: HTMLDivElement) => {
      // Disconnect previous observer
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = undefined
      }

      // Early return if no node or still loading
      if (!node || isLoading) {
        return
      }

      const scrollContainer = scrollContainerRef.current

      // Use the ref container or fallback to default viewport
      const observerOptions = scrollContainer
        ? {
            root: scrollContainer,
            rootMargin: '100px',
          }
        : {
            rootMargin: '100px',
          }

      observerRef.current = new IntersectionObserver((entries) => {
        const entry = entries[0]
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      }, observerOptions)

      observerRef.current.observe(node)
    },
    [isLoading, hasNextPage, isFetchingNextPage, fetchNextPage],
  )

  // Cleanup observer on component unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = undefined
      }
    }
  }, [])

  // Flatten all pages into a single array of events
  const allEvents = data?.pages.flatMap((page) => page.events) || []

  if (error) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <p>Feed error. try again</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ScrollArea>
        {allEvents.map((e, index) => {
          const isLast = index === allEvents.length - 1
          return (
            <div
              key={e.id}
              ref={isLast ? lastElementRef : undefined}
              className="hover:bg-background border-border m-2 rounded border"
            >
              <div className="flex items-start gap-2 p-2">
                {e.author.id ? (
                  <HMIcon
                    size={24}
                    id={e.author.id}
                    name={e.author.metadata?.name}
                    icon={e.author.metadata?.icon}
                  />
                ) : null}
                <EventHeaderContent event={e} />
              </div>
              <EventContent event={e} />
            </div>
          )
        })}
      </ScrollArea>
    </div>
  )
}

function EventHeaderContent({event}: {event: LoadedEvent}) {
  if (event.type == 'comment') {
    return (
      <p>
        <span className="text-sm font-bold">
          {event.author?.metadata?.name}
        </span>{' '}
        <span className="text-muted-foreground text-sm">commented on</span>{' '}
        <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
          {event.target?.metadata?.name}
        </a>{' '}
        <span className="text-muted-foreground ml-2 flex-none text-xs">
          {formattedDateShort(event.time)}
        </span>
      </p>
    )
  }

  if (event.type == 'capability') {
    return (
      <p>
        <span className="text-sm font-bold">
          {event.author?.metadata?.name}
        </span>{' '}
        <span className="text-muted-foreground text-sm">added</span>{' '}
        {event.delegates[0]?.id ? (
          <HMIcon
            className="mx-1 mb-1 inline-block align-middle"
            id={event.delegates[0]?.id}
            size={18}
            icon={event.delegates[0]?.metadata?.icon}
            name={event.delegates[0]?.metadata?.name}
          />
        ) : null}
        <a className="text-sm font-bold">
          {event.delegates[0]?.metadata?.name ||
            event.delegates[0]?.id?.uid.substring(0, 8)}
        </a>{' '}
        <span className="text-muted-foreground text-sm">as Writer in</span>{' '}
        <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
          {event.target?.metadata?.name}
        </a>{' '}
        <span className="text-muted-foreground ml-2 flex-none text-xs">
          {formattedDateShort(event.time)}
        </span>
      </p>
    )
  }

  if (event.type == 'doc-update') {
    return (
      <p>
        <span className="text-sm font-bold">
          {event.author?.metadata?.name}
        </span>{' '}
        <span className="text-muted-foreground text-sm">
          {/* TODO: check if this is the correct way of getting the first ref update of a document */}
          {event.document.version == event.document.genesis
            ? 'created'
            : 'updated'}
        </span>{' '}
        <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
          {event.document.metadata.name}
        </a>{' '}
        <span className="text-muted-foreground ml-2 flex-none text-xs">
          {formattedDateShort(event.time)}
        </span>
      </p>
    )
  }

  if (event.type == 'contact') {
    console.log('CONTACT', event)
    return (
      <p>
        <span className="text-sm font-bold">
          {event.author?.metadata?.name}
        </span>{' '}
        <span className="text-muted-foreground text-sm">added</span>{' '}
        <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
          {event.contact.metadata?.name}
        </a>{' '}
        <span className="text-muted-foreground text-sm">as a Contact</span>{' '}
        <span className="text-muted-foreground ml-2 flex-none text-xs">
          {formattedDateShort(event.time)}
        </span>
      </p>
    )
  }

  console.error(
    'EventHeaderContent: We must have ifs for all the event types:',
    event,
  )

  return null
}

function EventContent({event}: {event: LoadedEvent}) {
  if (event.type == 'comment') {
    // TODO: show comment content and also reply parent if present
    return null
  }

  if (event.type == 'capability') return null

  if (event.type == 'doc-update') {
    // TODO: return card
    return null
  }

  if (event.type == 'contact') {
    // TODO: show contact card?
    return null
  }
  return null
}
