import {useActivityFeed} from '@shm/shared/activity-service-provider'
import {HMContactItem, HMResourceItem} from '@shm/shared/feed-types'
import {HMTimestamp} from '@shm/shared/hm-types'
import {
  ListEventsRequest,
  LoadedCommentEvent,
  LoadedEvent,
} from '@shm/shared/models/activity-service'
import {NavRoute} from '@shm/shared/routes'
import {useRouteLink} from '@shm/shared/routing'
import {useTx} from '@shm/shared/translation'
import {formattedDateShort} from '@shm/shared/utils'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {useCallback, useEffect, useRef} from 'react'
import {Button} from './button'
import {CommentContent} from './comments'
import {ScrollArea} from './components/scroll-area'
import {ContactToken} from './contact-token'
import {HMIcon} from './hm-icon'
import {ReplyArrow} from './icons'
import {DocumentCard} from './newspaper'
import {ResourceToken} from './resource-token'
import {Separator} from './separator'
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
  const linkProps = useRouteLink(route, {handler: 'onClick'})
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

function getEventRoute(event: LoadedEvent): NavRoute | null {
  if (event.type == 'comment') {
    // Navigate to the target document with activity open and the comment focused
    if (!event.target?.id || !event.comment) return null

    const route = {
      key: 'document' as const,
      id: event.target.id,
      accessory: {
        key: 'activity' as const,
        openComment: event.comment.id,
      },
    }

    return route
  }

  if (event.type == 'doc-update') {
    // Navigate to the document
    const route = {
      key: 'document' as const,
      id: {
        ...event.docId,
        version: event.document.version,
      },
    }

    return route
  }

  if (event.type == 'capability') {
    // Navigate to the target document if available
    if (!event.target?.id) return null

    const route = {
      key: 'document' as const,
      id: event.target.id,
    }

    return route
  }

  if (event.type == 'contact') {
    // Navigate to the contact page
    if (!event.contact.id) return null

    const route = {
      key: 'contact' as const,
      id: event.contact.id,
    }

    return route
  }

  return null
}

function EventItem({
  event,
  route,
}: {
  event: LoadedEvent
  route: NavRoute | null
}) {
  const linkProps = useRouteLink(route, {handler: 'onClick'})
  const tx = useTx()
  return (
    <div
      className={cn('flex flex-col gap-2 rounded-lg p-2 transition-colors')}
      {...(route ? linkProps : {})}
    >
      <div className="flex items-start gap-2">
        <div className="size-[24px]">
          {event.author?.id ? (
            <HMIcon
              size={24}
              id={event.author.id}
              name={event.author.metadata?.name}
              icon={event.author.metadata?.icon}
            />
          ) : null}
        </div>
        <EventHeaderContent event={event} />
      </div>
      <div className="relative flex gap-2">
        <div className={cn('w-[24px]')} />
        <div className="flex flex-1 flex-col gap-3">
          <EventContent event={event} />
          <div className="-ml-3">
            <Button
              size="xs"
              className="text-muted-foreground hover:text-muted-foreground active:text-muted-foreground"
            >
              <ReplyArrow className="size-3" />
              {tx('Reply')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Feed2({
  filterResource,
  filterAuthors,
  filterEventType,
  currentAccount = '',
}: {
  filterResource: ListEventsRequest['filterResource']
  filterAuthors?: ListEventsRequest['filterAuthors']
  filterEventType?: ListEventsRequest['filterEventType']
  currentAccount?: string
}) {
  const observerRef = useRef<IntersectionObserver>()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const route = useNavRoute()

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useActivityFeed({
    filterResource,
    filterAuthors,
    filterEventType,
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
        if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
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
    <div className="flex flex-1 flex-col overflow-hidden px-3">
      <p>
        accessory:{' '}
        {route.key == 'document' && route.accessory
          ? JSON.stringify({accessory: route.accessory})
          : 'NO ACCESSORY'}
      </p>
      <p>filterEventType: {JSON.stringify(filterEventType)}</p>
      <ScrollArea>
        <div className="flex flex-col gap-8">
          {allEvents.map((e, index) => {
            const isLast = index === allEvents.length - 1
            const route = getEventRoute(e)

            if (e.type == 'comment' && e.replyingComment) {
              return (
                <>
                  <div key={`${e.type}-${e.id}-${e.time}`}>
                    <EventCommentWithReply event={e} route={route} />
                  </div>
                  <Separator />
                  {isLast && <div ref={lastElementRef} />}
                </>
              )
            }

            return (
              <>
                <EventItem
                  key={`${e.type}-${e.id}-${e.time}`}
                  event={e}
                  route={route}
                />
                <Separator />
                {isLast && <div ref={lastElementRef} />}
              </>
            )
          })}
        </div>
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
    return event.comment ? (
      <div className="-ml-4">
        <CommentContent comment={event.comment} />
      </div>
    ) : null
  }

  if (event.type == 'capability') return null
  // return (
  //   <div>
  //     <p>capability</p>
  //     <p className="text-muted-foreground text-xs">{JSON.stringify(event)}</p>
  //   </div>
  // )

  if (event.type == 'doc-update') {
    // TODO: return card
    return (
      <DocumentCard
        docId={event.docId}
        entity={{id: event.docId, document: event.document}}
        accountsMetadata={event.author ? ([event.author] as any) : []}
      />
    )
  }

  if (event.type == 'contact') {
    // TODO: show contact card?
    return null
    // return (
    //   <div>
    //     <p>contact</p>
    //     <p className="text-muted-foreground text-xs">{JSON.stringify(event)}</p>
    //   </div>
    // )
  }
  return null
}

function EventCommentWithReply({
  event,
  route,
}: {
  event: LoadedCommentEvent
  route: NavRoute | null
}) {
  const linkProps = useRouteLink(route, {handler: 'onClick'})
  const tx = useTx()

  return (
    <div
      key={`${event.type}-${event.id}-${event.time}`}
      className={cn('rounded-lg p-2 transition-colors')}
      {...(route ? linkProps : {})}
    >
      {/* replying comment */}
      <div className={cn('flex flex-col')}>
        <div className="flex items-start gap-2">
          <div className="size-[24px]">
            {event.replyingAuthor?.id ? (
              <HMIcon
                size={24}
                id={event.replyingAuthor.id}
                name={event.replyingAuthor.metadata?.name}
                icon={event.replyingAuthor.metadata?.icon}
              />
            ) : null}
          </div>
          <EventHeaderContent
            event={{
              ...event,
              author: event.replyingAuthor!,
            }}
          />
        </div>
        <div className="relative flex gap-2">
          <div className={cn('w-[24px]')}>
            <div
              className={cn(
                'absolute inset-y-0 left-0 w-[24px]',

                "before:bg-border before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:content-['']",
              )}
            />
          </div>
          <div className="flex-1 pb-6">
            <EventContent
              event={{
                ...event,
                comment: event.replyingComment,
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <div className="size-[24px]">
          {event.author?.id ? (
            <HMIcon
              size={24}
              id={event.author.id}
              name={event.author.metadata?.name}
              icon={event.author.metadata?.icon}
            />
          ) : null}
        </div>
        <EventHeaderContent event={event} />
      </div>
      <div className="relative flex gap-2">
        <div className={cn('w-[24px]')} />
        <div className="flex flex-1 flex-col gap-3">
          <EventContent event={event} />
          <div className="-ml-3">
            <Button
              size="xs"
              className="text-muted-foreground hover:text-muted-foreground active:text-muted-foreground"
            >
              <ReplyArrow className="size-3" />
              {tx('Reply')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
