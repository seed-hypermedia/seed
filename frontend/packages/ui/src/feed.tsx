import {HMContactItem} from '@shm/shared/account-utils'
import {useActivityFeed} from '@shm/shared/activity-service-provider'
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
} from '@shm/shared/utils/date'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {CircleAlert, Link, Trash2} from 'lucide-react'
import {memo, useEffect, useRef} from 'react'
import {toast} from 'sonner'
import {AccessoryContent} from './accessories'
import {Button} from './button'
import {CommentContent} from './comments'
import {SizableText} from './components/text'
import {copyTextToClipboard} from './copy-to-clipboard'
import {BlocksContent} from './document-content'
import {HMIcon} from './hm-icon'
import {ReplyArrow} from './icons'
import {DocumentCard} from './newspaper'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {ResourceToken} from './resource-token'
import {Separator} from './separator'
import {Spinner} from './spinner'
import {Tooltip} from './tooltip'
import {cn} from './utils'

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

function RouteEventRow({
  children,
  route,
}: {
  children: React.ReactNode
  route: NavRoute | null
}) {
  const linkProps = useRouteLink(route, {handler: 'onClick'})
  return (
    <div className="break-words" {...linkProps}>
      {children}
    </div>
  )
}

export function EventRowInline({
  children,
  route,
}: {
  children: React.ReactNode
  route: NavRoute | null
}) {
  return <RouteEventRow route={route}>{children}</RouteEventRow>
}

export function EventDescriptionText({children}: {children: React.ReactNode}) {
  return (
    <SizableText size="sm" className="px-2">
      {children}
    </SizableText>
  )
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
    // Navigate to the target document with discussions open and the comment focused
    if (!event.target?.id || !event.comment) return null

    const route = {
      key: 'document' as const,
      id: event.target.id,
      accessory: {
        key: 'discussions' as const,
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

    // For comment citations, open the comment in discussions panel
    if (event.citationType === 'c' && event.comment) {
      const route = {
        key: 'document' as const,
        id: event.source.id,
        accessory: {
          key: 'discussions' as const,
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
  isSingleResource,
}: {
  event: LoadedEvent
  route: NavRoute | null
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  currentAccount?: string
  targetDomain?: string
  isSingleResource?: boolean
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
          isSingleResource={isSingleResource}
        />
      </div>
      {isSingleResource && event.type == 'doc-update' ? null : (
        <div className="relative flex gap-2">
          <div className={cn('w-[24px]')} />
          <div className="flex flex-1 flex-col gap-3">
            <EventContent isSingleResource={isSingleResource} event={event} />
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
      )}
    </div>
  )
}

export function Feed({
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
    refetch,
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

  const isSingleResource =
    filterResource && !filterResource.endsWith('*') ? true : false

  if (error) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <p>Feed error. try again</p>
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-3">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="m-4 flex flex-col items-center justify-center gap-2 p-3">
        <CircleAlert className="text-muted-foreground size-7" />
        <p className="text-muted-foreground text-sm">Error Loading Feed</p>
        <Button
          size="sm"
          variant="default"
          onClick={() => refetch()}
          className="mt-2"
        >
          retry
        </Button>
      </div>
    )
  }

  return (
    <AccessoryContent header={commentEditor}>
      <div className="mt-4 flex flex-col gap-5">
        {allEvents.map((e) => {
          const route = getEventRoute(e)

          if (e.type == 'comment' && e.replyingComment) {
            return (
              <>
                <div key={`${e.type}-${e.id}-${e.time}`}>
                  <EventCommentWithReply
                    isSingleResource={isSingleResource}
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
                isSingleResource={isSingleResource}
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
  isSingleResource,
}: {
  event: LoadedEvent
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  currentAccount?: string
  targetDomain?: string
  isSingleResource?: boolean
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
          <EventAuthorName author={event.author} />{' '}
          {!isSingleResource ? (
            <>
              <span className="text-muted-foreground text-sm">
                commented on
              </span>{' '}
              <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
                {event.target?.metadata?.name}
              </a>{' '}
            </>
          ) : null}
          <span className="text-muted-foreground ml-0.5 flex-none text-xs">
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
        <EventAuthorName author={event.author} />{' '}
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
        {!isSingleResource ? (
          <>
            <span className="text-muted-foreground text-sm">as Writer in</span>{' '}
            <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
              {event.target?.metadata?.name}
            </a>{' '}
          </>
        ) : (
          <>
            <span className="text-muted-foreground text-sm">as a Writer</span>{' '}
          </>
        )}
        <span className="text-muted-foreground ml-0.5 flex-none text-xs">
          <EventTimestampWithTooltip time={event.time} />
        </span>
      </p>
    )
  }

  if (event.type == 'doc-update') {
    return (
      <p>
        <EventAuthorName author={event.author} />{' '}
        {!isSingleResource ? (
          <>
            <span className="text-muted-foreground text-sm">
              {/* TODO: check if this is the correct way of getting the first ref update of a document */}
              {event.document.version == event.document.genesis
                ? 'created'
                : 'updated'}
            </span>{' '}
            <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
              {event.document.metadata.name}
            </a>{' '}
          </>
        ) : (
          <>
            <span className="text-muted-foreground text-sm">
              {/* TODO: check if this is the correct way of getting the first ref update of a document */}
              {event.document.version == event.document.genesis
                ? 'created the document'
                : 'updated the document'}
            </span>{' '}
          </>
        )}
        <span className="text-muted-foreground ml-0.5 flex-none text-xs">
          <EventTimestampWithTooltip time={event.time} />
        </span>
      </p>
    )
  }

  if (event.type == 'contact') {
    return (
      <p>
        <EventAuthorName author={event.author} />{' '}
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
        <span className="text-muted-foreground ml-0.5 flex-none text-xs">
          <EventTimestampWithTooltip time={event.time} />
        </span>
      </p>
    )
  }

  if (event.type == 'citation') {
    const targetName = event.target?.metadata?.name || 'this document'
    const sourceName = event.source?.metadata?.name || 'a document'

    return (
      <p>
        <EventAuthorName author={event.author} />{' '}
        <span className="text-muted-foreground text-sm">
          {event.citationType === 'c' ? 'mentioned' : 'cited'}
        </span>{' '}
        {!isSingleResource ? (
          <>
            <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
              {targetName}
            </a>{' '}
          </>
        ) : (
          <>
            <span className="text-muted-foreground text-sm">this document</span>{' '}
          </>
        )}
        <span className="text-muted-foreground text-sm">
          {event.citationType === 'c' ? 'in a comment on' : 'in'}
        </span>{' '}
        <a className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
          {sourceName}
        </a>{' '}
        <span className="text-muted-foreground ml-0.5 flex-none text-xs">
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

function EventAuthorName({author}: {author: HMContactItem | null}) {
  const authorName = author?.metadata?.name || 'Someone'
  const linkProps = useRouteLink(
    author?.id ? {key: 'profile', id: author.id} : null,
    {handler: 'onClick'},
  )
  return (
    <a className="inline text-sm font-bold" {...linkProps}>
      {authorName}
    </a>
  )
}

function EventContent({
  event,
  size = 'md',
  isSingleResource = false,
}: {
  event: LoadedEvent
  size?: 'sm' | 'md'
  isSingleResource?: boolean
}) {
  if (event.type == 'comment') {
    return event.comment ? (
      <div className="-ml-4">
        <CommentContent comment={event.comment} size={size} />
      </div>
    ) : null
  }

  if (event.type == 'citation') {
    // Render comment content for comment citations
    if (event.citationType === 'c' && event.comment) {
      return (
        <div className="-ml-4">
          <CommentContent comment={event.comment} size={size} />
        </div>
      )
    }

    // For document citations, show source block or document info
    if (event.citationType === 'd' && event.source.id && event.target.id) {
      // If we have a blockRef, render the actual block content
      if (event.source.id.blockRef) {
        return (
          <div className="-ml-3 flex flex-col gap-2">
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
  //     <p className="text-xs text-muted-foreground">{JSON.stringify(event)}</p>
  //   </div>
  // )

  if (event.type == 'doc-update') {
    if (isSingleResource) return null
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
    //     <p className="text-xs text-muted-foreground">{JSON.stringify(event)}</p>
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
  isSingleResource,
}: {
  event: LoadedCommentEvent
  route: NavRoute | null
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  currentAccount?: string
  targetDomain?: string
  isSingleResource?: boolean
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
      <div
        className={cn(
          'flex flex-col',
          'before:border-border relative before:absolute before:top-[9px] before:left-[12px] before:h-[calc(100%-10px)] before:w-[16px] before:rounded-tl-lg before:border-t-1 before:border-l-1',
        )}
      >
        <div className="flex items-start gap-2">
          <div className={cn('h-[18px] w-[24px]')} />
          <div className="size-[18px]">
            {event.replyParentAuthor?.id ? (
              <HMIcon
                size={18}
                id={event.replyParentAuthor.id}
                name={event.replyParentAuthor.metadata?.name}
                icon={event.replyParentAuthor.metadata?.icon}
              />
            ) : null}
          </div>
          <div className="group flex w-full items-start justify-between gap-2">
            <p className="min-h-[20px] flex-1 overflow-hidden leading-[14px]">
              <EventAuthorName author={event.replyParentAuthor} />{' '}
              <span className="text-muted-foreground ml-0.5 flex-none text-[11px]">
                <EventTimestampWithTooltip time={event.time} />
              </span>
            </p>
          </div>
        </div>
        <div className="relative flex gap-2">
          <div className={cn('w-[50px]')} />

          <div className="flex-1 pb-6">
            <EventContent
              size="sm"
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
          isSingleResource={isSingleResource}
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
