import {useHackyAuthorsSubscriptions} from '@shm/shared/comments-service-provider'
import {
  HMBlockNode,
  HMTimestamp,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {
  HMListEventsParams,
  LoadedCommentEvent,
  LoadedEvent,
} from '@shm/shared/models/activity-service'
import {useResource} from '@shm/shared/models/entity'
import {DocumentRoute, NavRoute} from '@shm/shared/routes'
import {useRouteLink} from '@shm/shared/routing'
import {useTx, useTxString} from '@shm/shared/translation'
import {useResourceUrl} from '@shm/shared/url'
import {useActivityFeed} from '@shm/shared/use-activity-feed'
import {
  AnyTimestamp,
  formattedDateShort,
  normalizeDate,
} from '@shm/shared/utils/date'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import _ from 'lodash'
import {CircleAlert, Link, Trash2} from 'lucide-react'
import {memo, useEffect, useMemo, useRef} from 'react'
import {toast} from 'sonner'
import {SelectionContent} from './accessories'
import {BlocksContent, BlocksContentProvider} from './blocks-content'
import {Button} from './button'
import {CommentContent} from './comments'
import {SizableText} from './components/text'
import {copyTextToClipboard} from './copy-to-clipboard'
import {HMIcon} from './hm-icon'
import {ReplyArrow} from './icons'
import {
  AuthorNameLink,
  DocumentNameLink,
  InlineDescriptor,
  Timestamp,
} from './inline-descriptor'
import {DocumentCard} from './newspaper'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {ResourceToken} from './resource-token'
import {Separator} from './separator'
import {Spinner} from './spinner'
import {Tooltip} from './tooltip'
import {cn} from './utils'

export function Feed({
  filterResource,
  filterAuthors,
  filterEventType,
  currentAccount = '',
  commentEditor,
  onCommentDelete,
  targetDomain,
  size = 'md',
  scrollRef,
  navigationContext,
  centered,
}: {
  size?: 'sm' | 'md'
  commentEditor: any
  filterResource: HMListEventsParams['filterResource']
  filterAuthors?: HMListEventsParams['filterAuthors']
  filterEventType?: HMListEventsParams['filterEventType']
  currentAccount?: string
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  targetDomain?: string
  scrollRef?: React.Ref<HTMLDivElement>
  /** Navigation context for comment clicks: 'page' navigates to full discussions page, 'panel' uses document panel */
  navigationContext?: 'page' | 'panel'
  /** When true, constrains content width and centers it */
  centered?: boolean
}) {
  const observerRef = useRef<IntersectionObserver>()
  const lastElementNodeRef = useRef<HTMLDivElement>(null)
  const currentRoute = useNavRoute()

  // Determine navigation context: 'page' means navigate to full discussions page
  // 'panel' means navigate to document with discussions panel open
  const useFullPageNavigation = useMemo(() => {
    if (navigationContext) return navigationContext === 'page'
    // Auto-detect: if we're on activity or discussions page, use full page navigation
    return currentRoute.key === 'activity' || currentRoute.key === 'discussions'
  }, [navigationContext, currentRoute.key])

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

  // Extract unique author IDs from events and subscribe to them for discovery
  const authorIds = useMemo(() => {
    const ids = new Set<string>()
    allEvents.forEach((event) => {
      if (event.author?.id?.uid) {
        ids.add(event.author.id.uid)
      }
    })
    return Array.from(ids)
  }, [allEvents])

  // Subscribe to author accounts for discovery (desktop only, no-op on web)
  useHackyAuthorsSubscriptions(authorIds)

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
    <SelectionContent
      header={commentEditor}
      scrollRef={scrollRef}
      centered={centered}
    >
      <div>
        {allEvents.map((e) => {
          const route = getEventRoute(e, useFullPageNavigation)

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
                    size={size}
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
                size={size}
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
    </SelectionContent>
  )
}

function EventHeaderContent({
  event,
  onCommentDelete,
  currentAccount,
  targetDomain,
  isSingleResource,
  route,
}: {
  event: LoadedEvent
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  currentAccount?: string
  targetDomain?: string
  isSingleResource?: boolean
  route?: NavRoute | null
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
      <div className="group flex w-full items-center justify-between gap-2">
        <InlineDescriptor>
          <AuthorNameLink author={event.author} />{' '}
          {!isSingleResource && event.target ? (
            <>
              <span>commented on</span>{' '}
              <DocumentNameLink
                metadata={event.target?.metadata}
                id={event.target.id}
              />
            </>
          ) : null}
          <Timestamp time={event.time} route={route} />
        </InlineDescriptor>
        {event.comment && (
          <div className="flex items-center gap-2">
            <Tooltip content={tx('Copy Comment Link')}>
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground hover-hover:opacity-0 hover-hover:group-hover:opacity-100 transition-opacity duration-200 ease-in-out"
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
              <OptionsDropdown
                side="bottom"
                align="end"
                className="hover-hover:opacity-0 hover-hover:group-hover:opacity-100 transition-opacity duration-200 ease-in-out"
                menuItems={options}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  if (event.type == 'capability') {
    return (
      <InlineDescriptor>
        <AuthorNameLink author={event.author} /> <span>added</span>{' '}
        {event.delegates[0]?.id ? (
          <HMIcon
            className="mx-1 mb-1 inline-block align-middle"
            id={event.delegates[0]?.id}
            size={18}
            icon={event.delegates[0]?.metadata?.icon}
            name={event.delegates[0]?.metadata?.name}
          />
        ) : null}
        <AuthorNameLink author={event.delegates[0]!} />{' '}
        {!isSingleResource && event.target?.id ? (
          <>
            <span>as a {event.capability.role} in</span>{' '}
            <DocumentNameLink
              metadata={event.target?.metadata}
              id={event.target?.id}
            />{' '}
          </>
        ) : (
          <>
            <span>as a {event.capability.role}</span>{' '}
          </>
        )}
        <Timestamp time={event.time} route={route} />
      </InlineDescriptor>
    )
  }

  if (event.type == 'doc-update') {
    return (
      <InlineDescriptor>
        <AuthorNameLink author={event.author} />{' '}
        {!isSingleResource ? (
          <>
            <span>
              {/* TODO: check if this is the correct way of getting the first ref update of a document */}
              {event.document.version == event.document.genesis
                ? 'created'
                : 'updated'}
            </span>{' '}
            <DocumentNameLink
              metadata={event.document.metadata}
              id={event.docId}
            />{' '}
          </>
        ) : (
          <>
            <span>
              {/* TODO: check if this is the correct way of getting the first ref update of a document */}
              {event.document.version == event.document.genesis
                ? 'created the document'
                : 'updated the document'}
            </span>{' '}
          </>
        )}
        <Timestamp time={event.time} route={route} />
      </InlineDescriptor>
    )
  }

  if (event.type == 'contact') {
    return (
      <InlineDescriptor>
        <AuthorNameLink author={event.author} /> <span>added</span>{' '}
        {event.contact.subject?.id && event.contact.subject.metadata?.icon ? (
          <HMIcon
            className="mx-1 mb-1 inline-block align-middle"
            id={event.contact.subject.id}
            size={18}
            icon={event.contact.subject.metadata.icon}
            name={event.contact.subject.metadata.name}
          />
        ) : null}
        <AuthorNameLink author={event.contact.subject} /> <span>as</span>{' '}
        <span className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
          {event.contact.name}
        </span>{' '}
        <Timestamp time={event.time} route={route} />
      </InlineDescriptor>
    )
  }

  if (event.type == 'citation') {
    return (
      <InlineDescriptor>
        <AuthorNameLink author={event.author} />{' '}
        <span>{event.citationType === 'c' ? 'mentioned' : 'cited'}</span>{' '}
        {!isSingleResource ? (
          <>
            <DocumentNameLink
              metadata={event.target?.metadata}
              id={event.target?.id}
              fallback="this document"
            />{' '}
          </>
        ) : (
          <>
            <span>this document</span>{' '}
          </>
        )}
        <span>{event.citationType === 'c' ? 'in a comment on' : 'in'}</span>{' '}
        <DocumentNameLink
          metadata={event.source?.metadata}
          id={event.source?.id}
          fallback="a document"
        />{' '}
        <Timestamp time={event.time} route={route} />
      </InlineDescriptor>
    )
  }

  console.error(
    'EventHeaderContent: We must have ifs for all the event types:',
    event,
  )

  return null
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
  size,
}: {
  event: LoadedCommentEvent
  route: NavRoute | null
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  currentAccount?: string
  targetDomain?: string
  isSingleResource?: boolean
  size?: 'sm' | 'md'
}) {
  const linkProps = useRouteLink(route)
  const tx = useTx()

  return (
    <div
      key={`${event.type}-${event.id}-${event.time}`}
      className={cn(
        'hover:bg-background group p-2 transition-colors dark:hover:bg-black/10',
      )}
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
          <div className="group flex w-full items-center justify-between gap-2">
            <p className="min-h-[20px] flex-1 overflow-hidden leading-[14px]">
              <AuthorNameLink author={event.replyParentAuthor} />{' '}
              <span className="text-muted-foreground ml-0.5 flex-none text-[11px]">
                <Timestamp time={event.replyingComment?.updateTime} />
              </span>
            </p>
          </div>
        </div>
        <div className="relative flex gap-2">
          <div className={cn('w-[50px]')} />

          <div className="flex-1 pb-6">
            <EventContent
              size={'sm'}
              event={{
                ...event,
                comment: event.replyingComment,
              }}
            />
          </div>
        </div>
      </div>

      <div className="group flex items-start gap-2">
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
          route={route}
        />
      </div>
      <div className="relative flex gap-2">
        <div className={cn('w-[24px]')} />
        <div className="flex flex-1 flex-col gap-3">
          <EventContent size={size} event={event} />
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

  return (
    <BlocksContentProvider textUnit={14} layoutUnit={16} resourceId={sourceId}>
      <BlocksContent blocks={[blockNode]} />
    </BlocksContentProvider>
  )
}

function RouteEventRow({
  children,
  route,
}: {
  children: React.ReactNode
  route: NavRoute | null
}) {
  const linkProps = useRouteLink(route)
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

function getEventRoute(
  event: LoadedEvent,
  useFullPageNavigation: boolean = false,
): NavRoute | null {
  if (event.type == 'comment') {
    // Navigate to the target document with discussions open and the comment focused
    if (!event.target?.id || !event.comment) return null

    if (useFullPageNavigation) {
      // Navigate to full discussions page
      return {
        key: 'discussions' as const,
        id: event.target.id,
        openComment: event.comment.id,
      }
    }

    // Navigate to document with discussions panel
    return {
      key: 'document' as const,
      id: event.target.id,
      panel: {
        key: 'discussions' as const,
        id: event.target.id,
        openComment: event.comment.id,
      },
    }
  }

  if (event.type == 'doc-update') {
    // Navigate to the document at the version from the ref event
    // Reconstruct the ID properly using hmId to ensure the id field is the base ID
    if (!event.docId?.uid) return null

    const route: DocumentRoute = {
      key: 'document' as const,
      id: hmId(event.docId.uid, {
        path: event.docId.path,
        version: event.document.version,
        latest: false,
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

    // For comment citations, open the comment in discussions
    if (event.citationType === 'c' && event.comment) {
      if (useFullPageNavigation) {
        return {
          key: 'discussions' as const,
          id: event.source.id,
          openComment: event.comment.id,
        }
      }
      return {
        key: 'document' as const,
        id: event.source.id,
        panel: {
          key: 'discussions' as const,
          id: event.source.id,
          openComment: event.comment.id,
        },
      }
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
  size,
}: {
  event: LoadedEvent
  route: NavRoute | null
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  currentAccount?: string
  targetDomain?: string
  isSingleResource?: boolean
  size?: 'sm' | 'md'
}) {
  const currentRoute = useNavRoute()
  const linkProps = useRouteLink(
    route ? _.merge({}, currentRoute, route) : currentRoute,
    {
      onClick: () => {
        console.log('== link props clicked!!')
      },
    },
  )

  const tx = useTx()
  return (
    <div
      className={cn(
        'hover:bg-background group flex flex-col gap-2 p-2 py-4 transition-colors dark:hover:bg-black/10',
        currentRoute.key == 'document' &&
          event.type == 'doc-update' &&
          event.docId.version == currentRoute.id.version &&
          'bg-accent hover:bg-accent dark:hover:bg-accent',
      )}
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
            <EventContent
              size={size}
              isSingleResource={isSingleResource}
              event={event}
            />
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
