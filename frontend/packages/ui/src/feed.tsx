import {useActivityFeed} from '@shm/shared/activity-service-provider'
import {HMContactItem, HMResourceItem} from '@shm/shared/feed-types'
import {
  HMBlockNode,
  HMTimestamp,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {
  HMListEventsRequest,
  LoadedCommentEvent,
  LoadedEvent,
} from '@shm/shared/models/activity-service'
import {useResource} from '@shm/shared/models/entity'
import {NavRoute} from '@shm/shared/routes'
import {useRouteLink} from '@shm/shared/routing'
import {useTx, useTxString} from '@shm/shared/translation'
import {useResourceUrl} from '@shm/shared/url'
import {
  AnyTimestamp,
  formattedDateShort,
  normalizeDate,
} from '@shm/shared/utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Link, Trash2} from 'lucide-react'
import {memo, useEffect, useRef} from 'react'
import {toast} from 'sonner'
import {AccessoryContent} from './accessories'
import {Button} from './button'
import {CommentContent} from './comments'
import {ContactToken} from './contact-token'
import {copyTextToClipboard} from './copy-to-clipboard'
import {BlocksContent} from './document-content'
import {HMIcon} from './hm-icon'
import {ReplyArrow} from './icons'
import {DocumentCard} from './newspaper'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {ResourceToken} from './resource-token'
import {Separator} from './separator'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
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

// Helper function to find a block by ID in the content tree
function findContentBlock(
  content: HMBlockNode[],
  blockRef: string,
): HMBlockNode | null {
  let block: HMBlockNode | null = null
  content.find((node) => {
    if (node.block.id === blockRef) {
      block = node
      return true
    } else if (node.children) {
      block = findContentBlock(node.children, blockRef)
      return !!block
    }
    return false
  })
  return block
}

// Component to render a source block for document citations
function CitationSourceBlock({sourceId}: {sourceId: UnpackedHypermediaId}) {
  const resource = useResource(sourceId)

  if (resource.isLoading) {
    return <div className="text-muted-foreground text-xs">Loading block...</div>
  }

  if (resource.error || !resource.data) {
    return null
  }

  const content =
    resource.data.type === 'document'
      ? resource.data.document?.content
      : resource.data.type === 'comment'
      ? resource.data.comment?.content
      : undefined

  if (!content || !sourceId.blockRef) {
    return null
  }

  const blockNode = findContentBlock(content, sourceId.blockRef)

  if (!blockNode) {
    return null
  }

  return <BlocksContent blocks={[blockNode]} parentBlockId={null} />
}

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

export const EventTimestamp = memo(function EventTimestamp({
  time,
}: {
  time: HMTimestamp | undefined
}) {
  if (!time) return null

  const date = normalizeDate(time)

  if (!date) return null

  return (
    <SizableText size="xs" className="text-muted-foreground self-end px-1 py-1">
      <EventTimestampWithTooltip time={time} />
    </SizableText>
  )
})

const EventTimestampWithTooltip = memo(function EventTimestampWithTooltip({
  time,
}: {
  time: AnyTimestamp
}) {
  if (!time) return null

  const date = normalizeDate(time)

  if (!date) return null

  return (
    <Tooltip side="top" delay={400} content={formatUTC(date)}>
      {formattedDateShort(time)}
    </Tooltip>
  )
})

function formatUTC(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')

  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1) // Months are 0-based.
  const day = pad(date.getUTCDate())
  const hours = pad(date.getUTCHours())
  const minutes = pad(date.getUTCMinutes())

  return `${year}-${month}-${day} ${hours}:${minutes} (UTC)`
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
    // Navigate to the document at the version from the ref event
    // Reconstruct the ID properly using hmId to ensure the id field is the base ID
    if (!event.docId?.uid) return null

    const route = {
      key: 'document' as const,
      id: hmId(event.docId.uid, {
        path: event.docId.path,
        version: event.document.version,
      }),
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

  if (event.type == 'citation') {
    // Navigate to the target document (the document being cited)
    if (!event.source?.id) return null

    // For comment citations, open the comment
    if (event.citationType === 'c' && event.comment) {
      const route = {
        key: 'document' as const,
        id: event.source.id,
        accessory: {
          key: 'activity' as const,
          openComment: event.comment.id,
        },
      }
      return route
    }

    // For document citations, navigate to the target document
    // If there's a target fragment (block ID), include it in the URL
    const route = {
      key: 'document' as const,
      id: event.source.id,
      ...(event.targetFragment && {
        fragment: event.targetFragment,
      }),
    }

    return route
  }

  return null
}

function EventItem({
  event,
  route,
  onCommentDelete,
  currentAccount,
  targetDomain,
}: {
  event: LoadedEvent
  route: NavRoute | null
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  currentAccount?: string
  targetDomain?: string
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
        <EventHeaderContent
          event={event}
          onCommentDelete={onCommentDelete}
          currentAccount={currentAccount}
          targetDomain={targetDomain}
        />
      </div>
      <div className="relative flex gap-2">
        <div className={cn('w-[24px]')} />
        <div className="flex flex-1 flex-col gap-3">
          <EventContent event={event} />
          {event.type == 'comment' ||
          (event.type == 'citation' && event.comment) ? (
            <div className="-ml-3">
              <Button
                size="xs"
                className="text-muted-foreground hover:text-muted-foreground active:text-muted-foreground"
              >
                <ReplyArrow className="size-3" />
                {tx('Reply')}
                {(event.type == 'comment' && event.replyCount > 0) ||
                (event.type == 'citation' &&
                  event.replyCount !== undefined &&
                  event.replyCount > 0)
                  ? ` (${event.replyCount})`
                  : ''}
              </Button>
            </div>
          ) : null}
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
  commentEditor,
  onCommentDelete,
  targetDomain,
}: {
  commentEditor: any
  filterResource: HMListEventsRequest['filterResource']
  filterAuthors?: HMListEventsRequest['filterAuthors']
  filterEventType?: HMListEventsRequest['filterEventType']
  currentAccount?: string
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  targetDomain?: string
}) {
  const observerRef = useRef<IntersectionObserver>()
  const lastElementNodeRef = useRef<HTMLDivElement>(null)

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

  // Setup and cleanup observer whenever dependencies change
  useEffect(() => {
    // Disconnect previous observer
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = undefined
    }

    const node = lastElementNodeRef.current

    // Early return if no node or still loading
    if (!node || isLoading) {
      return
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      {
        rootMargin: '100px',
      },
    )

    observerRef.current.observe(node)

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = undefined
      }
    }
  }, [isLoading, hasNextPage, isFetchingNextPage, fetchNextPage])

  // Flatten all pages into a single array of events
  const allEvents = data?.pages.flatMap((page) => page.events) || []

  if (error) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <p>Feed error. try again</p>
      </div>
    )
  }
  if (isLoading) {
    return <div>Loading...</div>
  }

  if (error) {
    return <div>Error loading feed</div>
  }

  return (
    <AccessoryContent header={commentEditor}>
      <div className="mt-4 flex flex-col gap-8">
        {allEvents.map((e) => {
          const route = getEventRoute(e)

          if (e.type == 'comment' && e.replyingComment) {
            return (
              <>
                <div key={`${e.type}-${e.id}-${e.time}`}>
                  <EventCommentWithReply
                    event={e}
                    route={route}
                    onCommentDelete={onCommentDelete}
                    currentAccount={currentAccount}
                    targetDomain={targetDomain}
                  />
                </div>
                <Separator />
              </>
            )
          }

          return (
            <>
              <EventItem
                key={`${e.type}-${e.id}-${e.time}`}
                event={e}
                route={route}
                onCommentDelete={onCommentDelete}
                currentAccount={currentAccount}
                targetDomain={targetDomain}
              />
              <Separator />
            </>
          )
        })}
        {!isLoading && <div className="h-20" ref={lastElementNodeRef} />}
      </div>
      {isFetchingNextPage && (
        <div className="text-muted-foreground py-3 text-center">
          Loading more...
        </div>
      )}
      {!hasNextPage && allEvents.length > 0 && (
        <div className="text-muted-foreground py-3 text-center">
          No more events
        </div>
      )}
    </AccessoryContent>
  )
}

function EventHeaderContent({
  event,
  onCommentDelete,
  currentAccount,
  targetDomain,
}: {
  event: LoadedEvent
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  currentAccount?: string
  targetDomain?: string
}) {
  const tx = useTxString()
  const getUrl = useResourceUrl(targetDomain)

  if (event.type == 'comment') {
    const options: MenuItemType[] = []
    if (
      onCommentDelete &&
      event.comment &&
      currentAccount == event.comment.author
    ) {
      options.push({
        icon: <Trash2 className="size-4" />,
        label: 'Delete',
        onClick: () => {
          onCommentDelete(event.comment!.id, currentAccount)
        },
        key: 'delete',
      })
    }

    return (
      <div className="group flex w-full items-start justify-between gap-2">
        <p className="flex-1 overflow-hidden">
          <span className="text-sm font-bold">
            {event.author?.metadata?.name}
          </span>{' '}
          <span className="text-muted-foreground text-sm">commented on</span>{' '}
          <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
            {event.target?.metadata?.name}
          </a>{' '}
          <span className="text-muted-foreground ml-2 flex-none text-xs">
            <EventTimestampWithTooltip time={event.time} />
          </span>
        </p>
        {event.comment && (
          <div className="flex items-center">
            <Tooltip content={tx('Copy Comment Link')}>
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const url = getUrl(hmId(event.comment!.id))
                  copyTextToClipboard(url)
                  toast.success('Copied Comment URL')
                }}
              >
                <Link className="size-3" />
              </Button>
            </Tooltip>
            {options.length > 0 && (
              <OptionsDropdown side="bottom" align="end" menuItems={options} />
            )}
          </div>
        )}
      </div>
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
          <EventTimestampWithTooltip time={event.time} />
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
          <EventTimestampWithTooltip time={event.time} />
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
        {event.contact.subject?.id && event.contact.subject.metadata?.icon ? (
          <HMIcon
            className="mx-1 mb-1 inline-block align-middle"
            id={event.contact.subject.id}
            size={18}
            icon={event.contact.subject.metadata.icon}
            name={event.contact.subject.metadata.name}
          />
        ) : null}
        <a className="text-sm font-bold">
          {event.contact.subject?.metadata?.name}
        </a>{' '}
        <span className="text-muted-foreground text-sm">as</span>{' '}
        <span className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
          {event.contact.name}
        </span>{' '}
        <span className="text-muted-foreground ml-2 flex-none text-xs">
          <EventTimestampWithTooltip time={event.time} />
        </span>
      </p>
    )
  }

  if (event.type == 'citation') {
    const authorName = event.author?.metadata?.name || 'Someone'
    const targetName = event.target?.metadata?.name || 'this document'
    const sourceName = event.source?.metadata?.name || 'a document'

    return (
      <p>
        <span className="text-sm font-bold">{authorName}</span>{' '}
        <span className="text-muted-foreground text-sm">
          {event.citationType === 'c' ? 'mentioned' : 'cited'}
        </span>{' '}
        <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
          {targetName}
        </a>{' '}
        <span className="text-muted-foreground text-sm">
          {event.citationType === 'c' ? 'in a comment on' : 'in'}
        </span>{' '}
        <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
          {sourceName}
        </a>{' '}
        <span className="text-muted-foreground ml-2 flex-none text-xs">
          <EventTimestampWithTooltip time={event.time} />
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

  if (event.type == 'citation') {
    // Render comment content for comment citations
    if (event.citationType === 'c' && event.comment) {
      return (
        <div className="-ml-4">
          <CommentContent comment={event.comment} />
        </div>
      )
    }

    // For document citations, show source block or document info
    if (event.citationType === 'd' && event.source.id && event.target.id) {
      // If we have a blockRef, render the actual block content
      if (event.source.id.blockRef) {
        return (
          <div className="flex flex-col gap-2">
            <CitationSourceBlock sourceId={event.source.id} />
          </div>
        )
      }

      // Otherwise, show source and target document info
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">
              Source Document:
            </span>
            <div className="text-sm">
              <ResourceToken
                id={event.source.id}
                metadata={event.source.metadata}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">
              Target Document:
            </span>
            <div className="text-sm">
              <ResourceToken
                id={event.target.id}
                metadata={event.target.metadata}
              />
              {event.targetFragment && (
                <span className="text-muted-foreground ml-1 text-xs">
                  (Block: {event.targetFragment})
                </span>
              )}
            </div>
          </div>
        </div>
      )
    }

    return null
  }
  if (event.type == 'capability') return null
  // return (
  //   <div>
  //     <p>capability</p>
  //     <p className="text-muted-foreground text-xs">{JSON.stringify(event)}</p>
  //   </div>
  // )

  if (event.type == 'doc-update') {
    // Use the versioned docId for proper navigation
    // Reconstruct the ID properly using hmId to ensure the id field is the base ID
    const versionedDocId = hmId(event.docId.uid, {
      path: event.docId.path,
      version: event.document.version,
    })
    return (
      <DocumentCard
        docId={versionedDocId}
        entity={{id: versionedDocId, document: event.document}}
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
  onCommentDelete,
  currentAccount,
  targetDomain,
}: {
  event: LoadedCommentEvent
  route: NavRoute | null
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  currentAccount?: string
  targetDomain?: string
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
            onCommentDelete={onCommentDelete}
            currentAccount={currentAccount}
            targetDomain={targetDomain}
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
        <EventHeaderContent
          event={event}
          onCommentDelete={onCommentDelete}
          currentAccount={currentAccount}
          targetDomain={targetDomain}
        />
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
              {event.replyCount > 0 ? ` (${event.replyCount})` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
