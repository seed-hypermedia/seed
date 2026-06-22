import {HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useDeleteComment, useHackyAuthorsSubscriptions} from '@shm/shared/comments-service-provider'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {HMListEventsParams, LoadedCommentEvent, LoadedEvent} from '@shm/shared/models/activity-service'
import {type DocumentMachineEvent} from '@shm/shared/models/document-machine'
import {useResource, useSelectedAccountId} from '@shm/shared/models/entity'
import {useDocumentSend} from '@shm/shared/models/use-document-machine'
import {useReadOnlyViewer} from '@shm/shared/readonly-viewer-context'
import {DocumentRoute, NavRoute} from '@shm/shared/routes'
import {useRouteLink, useUniversalAppContext} from '@shm/shared/routing'
import {useTx, useTxString} from '@shm/shared/translation'
import {useActivityFeed} from '@shm/shared/use-activity-feed'
import {commentIdToHmId, getCommentTargetId, getVersionHeads, hmId, latestId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import merge from 'lodash/merge'
import {CircleAlert, FilePen, Link, Merge, RotateCcw, Trash2, X} from 'lucide-react'
import {Fragment, useEffect, useMemo, useRef, useState} from 'react'
import {SelectionContent} from './accessories'
import {Button} from './button'
import {CommentContent, useDeleteCommentDialog} from './comments'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/alert-dialog'
import {HMIcon} from './hm-icon'
import {ReplyArrow} from './icons'
import {AuthorNameLink, DocumentNameLink, InlineDescriptor, Timestamp} from './inline-descriptor'
import {DocumentCard} from './newspaper'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {ResourceToken} from './resource-token'
import {Separator} from './separator'
import {Spinner} from './spinner'
import {Tooltip} from './tooltip'
import {useCopyHmLink} from './use-copy-hm-link'
import {cn} from './utils'

export type DraftVersionEntry = {
  docId: UnpackedHypermediaId
  draftId: string
  deps?: string[]
  metadata?: {name?: string}
  onDiscardConfirm?: (draftId: string, send: (event: DocumentMachineEvent) => void) => void
}

export function shouldShowDraftVersionEntry(
  filterEventType: HMListEventsParams['filterEventType'] | undefined,
  draftVersionEntry: DraftVersionEntry | undefined,
) {
  return !!draftVersionEntry && !!filterEventType?.includes('Ref')
}

export function getDraftVersionInsertIndex(events: LoadedEvent[], draft: DraftVersionEntry | undefined) {
  if (!draft?.deps?.length) return 0
  const baseVersions = new Set(draft.deps)
  const baseIndex = events.findIndex((event) => event.type === 'doc-update' && baseVersions.has(event.document.version))
  return baseIndex === -1 ? 0 : baseIndex
}

/** Returns the newest document update version from an activity feed ordered newest-first. */
export function getLatestDocUpdateVersion(events: LoadedEvent[]) {
  return events.find((event) => event.type === 'doc-update')?.document.version ?? null
}

export function isSelectedDocUpdateVersion(
  eventVersion: string | undefined,
  routeVersion: string | null | undefined,
  routeLatest: boolean | null | undefined,
  latestVersion: string | null | undefined,
) {
  if (!eventVersion) return false
  if (routeVersion) return eventVersion === routeVersion
  return !!routeLatest && !!latestVersion && eventVersion === latestVersion
}

export function canShowRestoreVersionButton(input: {
  isSingleResource?: boolean
  selectedAccountUid?: string
  latestVersion?: string | null
  eventVersion?: string
  hasRestoreAction?: boolean
}) {
  return !!(
    input.isSingleResource &&
    input.selectedAccountUid &&
    input.latestVersion &&
    input.eventVersion &&
    input.hasRestoreAction &&
    input.latestVersion !== input.eventVersion
  )
}

export function Feed({
  filterResource,
  filterAuthors,
  filterEventType,
  targetDomain,
  size = 'md',
  draftVersionEntry,
}: {
  size?: 'sm' | 'md'
  filterResource: HMListEventsParams['filterResource']
  filterAuthors?: HMListEventsParams['filterAuthors']
  filterEventType?: HMListEventsParams['filterEventType']
  targetDomain?: string
  draftVersionEntry?: DraftVersionEntry
}) {
  const observerRef = useRef<IntersectionObserver>()
  const lastElementNodeRef = useRef<HTMLDivElement>(null)

  const {data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error, refetch} = useActivityFeed({
    filterResource,
    filterAuthors,
    filterEventType,
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

  // Flatten all pages into a single array of events.
  // Agent capability grants are implementation details for devices and should
  // not appear in user-facing feeds (notably profile feeds).
  const allEvents = (data?.pages.flatMap((page) => page.events) || []).filter((event) => {
    if (event.type !== 'capability') return true
    return event.capability.role?.toLowerCase() !== 'agent'
  })

  // Extract unique account IDs from events and subscribe for discovery.
  // Includes authors, reply parents, contact subjects, and capability delegates
  // so their profiles are discovered before we render them.
  const authorIds = useMemo(() => {
    const ids = new Set<string>()
    allEvents.forEach((event) => {
      if (event.author?.id?.uid) {
        ids.add(event.author.id.uid)
      }
      if (event.type === 'comment' && event.replyParentAuthor?.id?.uid) {
        ids.add(event.replyParentAuthor.id.uid)
      }
      if (event.type === 'contact' && event.contact.subject?.id?.uid) {
        ids.add(event.contact.subject.id.uid)
      }
      if (event.type === 'capability') {
        event.delegates.forEach((delegate) => {
          if (delegate?.id?.uid) {
            ids.add(delegate.id.uid)
          }
        })
      }
    })
    return Array.from(ids)
  }, [allEvents])

  // Subscribe to author accounts for discovery (desktop only, no-op on web)
  useHackyAuthorsSubscriptions(authorIds)

  const isSingleResource = filterResource && !filterResource.endsWith('*') ? true : false
  const shouldRenderDraftVersion = shouldShowDraftVersionEntry(filterEventType, draftVersionEntry)
  const draftInsertIndex = shouldRenderDraftVersion ? getDraftVersionInsertIndex(allEvents, draftVersionEntry) : -1
  const latestDocUpdateVersion = isSingleResource ? getLatestDocUpdateVersion(allEvents) : null

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
        <Button size="sm" variant="default" onClick={() => refetch()} className="mt-2">
          retry
        </Button>
      </div>
    )
  }

  return (
    <SelectionContent>
      <div>
        {allEvents.map((e, index) => {
          const route = getEventRoute(e)

          if (e.type == 'comment' && e.replyingComment) {
            return (
              <Fragment key={`row-${e.type}-${e.id}-${e.time}`}>
                {index === draftInsertIndex && draftVersionEntry ? (
                  <DraftVersionItem draft={draftVersionEntry} hasNewerPublishedVersion={draftInsertIndex > 0} />
                ) : null}
                <div>
                  <EventCommentWithReply
                    isSingleResource={isSingleResource}
                    event={e}
                    route={route}
                    targetDomain={targetDomain}
                    size={size}
                    latestDocUpdateVersion={latestDocUpdateVersion}
                  />
                  <Separator />
                </div>
              </Fragment>
            )
          }

          return (
            <Fragment key={`row-${e.type}-${e.id}-${e.time}`}>
              {index === draftInsertIndex && draftVersionEntry ? (
                <DraftVersionItem draft={draftVersionEntry} hasNewerPublishedVersion={draftInsertIndex > 0} />
              ) : null}
              <div>
                <EventItem
                  isSingleResource={isSingleResource}
                  event={e}
                  route={route}
                  targetDomain={targetDomain}
                  size={size}
                  latestDocUpdateVersion={latestDocUpdateVersion}
                />
                <Separator />
              </div>
            </Fragment>
          )
        })}
        {draftInsertIndex === allEvents.length && draftVersionEntry ? (
          <DraftVersionItem draft={draftVersionEntry} hasNewerPublishedVersion={draftInsertIndex > 0} />
        ) : null}
        {!isLoading && <div className="h-20" ref={lastElementNodeRef} />}
      </div>
      {isFetchingNextPage && <div className="text-muted-foreground py-3 text-center">Loading more…</div>}
      {!hasNextPage && allEvents.length > 0 && (
        <div className="text-muted-foreground py-3 text-center">No more events</div>
      )}
    </SelectionContent>
  )
}

function DraftVersionItem({
  draft,
  hasNewerPublishedVersion,
}: {
  draft: DraftVersionEntry
  hasNewerPublishedVersion: boolean
}) {
  const currentRoute = useNavRoute()
  const send = useDocumentSend()
  const draftRoute = {
    key: 'document' as const,
    id: hmId(draft.docId.uid, {
      path: draft.docId.path,
    }),
  }
  const draftLinkProps = useRouteLink(merge({}, currentRoute, draftRoute))
  const isCurrentDraftRoute =
    currentRoute.key === 'document' &&
    currentRoute.id.uid === draft.docId.uid &&
    currentRoute.id.version === null &&
    JSON.stringify(currentRoute.id.path ?? []) === JSON.stringify(draft.docId.path ?? [])

  return (
    <div
      className={cn(
        'bg-accent hover:bg-accent group dark:hover:bg-accent flex items-start gap-2 px-4 py-4 transition-colors',
        isCurrentDraftRoute && 'ring-border ring-1 ring-inset',
      )}
      {...draftLinkProps}
    >
      <div className="bg-muted flex size-[24px] shrink-0 items-center justify-center rounded-full">
        <FilePen className="text-muted-foreground size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-foreground text-sm font-medium">Unpublished Changes</span>
          {hasNewerPublishedVersion ? (
            <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              Newer version above
            </span>
          ) : null}
        </div>
      </div>
      <Tooltip content="Discard changes">
        <Button
          size="icon"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive -m-1 size-7 shrink-0 opacity-70 hover:opacity-100"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (draft.onDiscardConfirm) {
              draft.onDiscardConfirm(draft.draftId, send)
            } else if (window.confirm('Discard draft changes?')) {
              send({type: 'edit.discard'})
            }
          }}
        >
          <X className="size-3.5" />
        </Button>
      </Tooltip>
    </div>
  )
}

function EventHeaderContent({
  event,
  targetDomain,
  isSingleResource,
  route,
  latestDocUpdateVersion,
}: {
  event: LoadedEvent
  targetDomain?: string
  isSingleResource?: boolean
  route?: NavRoute | null
  latestDocUpdateVersion?: string | null
}) {
  const tx = useTxString()
  const currentRoute = useNavRoute()
  const currentAccount = useSelectedAccountId()
  const documentActions = useDocumentActions()
  const latestDocId = event.type === 'doc-update' ? latestId(event.docId) : null
  const latestResource = useResource(latestDocId)
  const latestDocument = latestResource.data?.type === 'document' ? latestResource.data.document : null
  const latestVersion = latestDocUpdateVersion ?? latestDocument?.version
  const deleteCommentMutation = useDeleteComment()
  const deleteCommentDialog = useDeleteCommentDialog()
  const copyHmLink = useCopyHmLink()
  const {origin: appOrigin, onPushReference} = useUniversalAppContext()
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  if (event.type == 'comment') {
    const options: MenuItemType[] = []
    if (event.comment && currentAccount && currentAccount == event.comment.author) {
      options.push({
        icon: <Trash2 className="size-4" />,
        label: 'Delete',
        onClick: () => {
          deleteCommentDialog.open({
            onConfirm: () => {
              deleteCommentMutation.mutate({
                comment: event.comment!,
                signingAccountId: currentAccount,
              })
            },
          })
        },
        key: 'delete',
      })
    }

    return (
      <>
        {deleteCommentDialog.content}
        <div className="group flex w-full items-center justify-between gap-2">
          <InlineDescriptor>
            <AuthorNameLink author={event.author} />{' '}
            {!isSingleResource && event.target ? (
              <>
                <span>commented on</span> <DocumentNameLink metadata={event.target?.metadata} id={event.target.id} />
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
                    const targetDocId = getCommentTargetId(event.comment!)
                    if (!targetDocId || !event.comment) return
                    const routeLatest =
                      currentRoute.key === 'document' ||
                      currentRoute.key === 'comments' ||
                      currentRoute.key === 'activity'
                        ? currentRoute.id.latest
                        : undefined
                    copyHmLink({
                      id: {
                        ...targetDocId,
                        hostname: targetDomain ?? null,
                        latest: routeLatest ?? null,
                      },
                      commentId: commentIdToHmId(event.comment.id),
                      gatewayUrl: appOrigin ?? undefined,
                    })
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
      </>
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
            <DocumentNameLink metadata={event.target?.metadata} id={event.target?.id} />{' '}
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
    const docUpdateHeadCount = getVersionHeads(event.document.version).length
    const canRestore = canShowRestoreVersionButton({
      isSingleResource,
      selectedAccountUid: documentActions.selectedAccountUid,
      latestVersion,
      eventVersion: event.document.version,
      hasRestoreAction: !!documentActions.onRestoreDocumentVersion,
    })
    const restoreButton = canRestore ? (
      <AlertDialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <Tooltip content="Restore">
          <Button
            aria-label="Restore"
            size="icon"
            variant="ghost"
            className="text-muted-foreground hover-hover:opacity-0 hover-hover:group-hover:opacity-100 transition-opacity duration-200 ease-in-out"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setRestoreDialogOpen(true)
            }}
          >
            <RotateCcw className="size-3" />
          </Button>
        </Tooltip>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new latest version using this version’s content and metadata. Any current draft for
              this document will be removed after the restore succeeds.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRestoring}
              onClick={async (e) => {
                e.preventDefault()
                e.stopPropagation()
                if (!documentActions.onRestoreDocumentVersion) return
                setIsRestoring(true)
                try {
                  await documentActions.onRestoreDocumentVersion(event.docId, event.document)
                  setRestoreDialogOpen(false)
                } catch {
                  // The platform restore action owns user-facing error toasts.
                } finally {
                  setIsRestoring(false)
                }
              }}
            >
              {isRestoring ? 'Restoring…' : 'Restore'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ) : null

    return (
      <div className="flex w-full items-start justify-between gap-2">
        <InlineDescriptor>
          <AuthorNameLink author={event.author} />{' '}
          {!isSingleResource ? (
            <>
              <span>
                {/* TODO: check if this is the correct way of getting the first ref update of a document */}
                {event.document.version == event.document.genesis ? 'created' : 'updated'}
              </span>{' '}
              <DocumentNameLink metadata={event.document.metadata} id={event.docId} />{' '}
            </>
          ) : (
            <>
              <span>
                {/* TODO: check if this is the correct way of getting the first ref update of a document */}
                {event.document.version == event.document.genesis ? 'created the document' : 'updated the document'}
              </span>{' '}
            </>
          )}
          <Timestamp time={event.time} route={route} />
          {docUpdateHeadCount > 1 ? (
            <Tooltip content={`Merged ${docUpdateHeadCount} concurrent versions`}>
              <span className="text-muted-foreground ml-1 inline-flex items-center gap-0.5 align-middle">
                <Merge size={12} strokeWidth={2} />
                <span className="text-xs">{docUpdateHeadCount}</span>
              </span>
            </Tooltip>
          ) : null}
        </InlineDescriptor>
        <div className="flex items-center gap-1">
          {restoreButton}
          <Tooltip content={tx('Copy Link to Version')}>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground hover-hover:opacity-0 hover-hover:group-hover:opacity-100 transition-opacity duration-200 ease-in-out"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (!event.docId?.uid) return
                const routeLatest =
                  currentRoute.key === 'document' || currentRoute.key === 'comments' || currentRoute.key === 'activity'
                    ? currentRoute.id.latest
                    : undefined
                const versionedId = hmId(event.docId.uid, {
                  path: event.docId.path,
                  version: event.document.version,
                  latest: routeLatest ?? false,
                  hostname: targetDomain ?? null,
                })
                copyHmLink({
                  id: versionedId,
                  gatewayUrl: appOrigin ?? undefined,
                })
                onPushReference?.(versionedId)
              }}
            >
              <Link className="size-3" />
            </Button>
          </Tooltip>
        </div>
      </div>
    )
  }

  if (event.type == 'contact') {
    const contactAction =
      event.contact.subscribe?.site && event.contact.subscribe?.profile
        ? 'followed and joined'
        : event.contact.subscribe?.profile
          ? 'followed'
          : event.contact.subscribe?.site
            ? 'joined'
            : 'added'
    const contactName = event.contact.name?.trim() || null

    return (
      <InlineDescriptor>
        <AuthorNameLink author={event.author} /> <span>{contactAction}</span>{' '}
        {event.contact.subject?.id && event.contact.subject.metadata?.icon ? (
          <HMIcon
            className="mx-1 mb-1 inline-block align-middle"
            id={event.contact.subject.id}
            size={18}
            icon={event.contact.subject.metadata.icon}
            name={event.contact.subject.metadata.name}
          />
        ) : null}
        <AuthorNameLink author={event.contact.subject} />
        {contactName ? (
          <>
            {' '}
            <span>as</span>{' '}
            <span className="self-inline ring-px ring-border bg-background text-foreground hover:text-foreground dark:hover:bg-muted rounded p-[2px] text-sm ring hover:bg-black/5 active:bg-black/5 dark:active:bg-white/10">
              {contactName}
            </span>
          </>
        ) : null}{' '}
        <Timestamp time={event.time} route={route} />
      </InlineDescriptor>
    )
  }

  if (event.type == 'citation') {
    return (
      <InlineDescriptor>
        <AuthorNameLink author={event.author} /> <span>{event.citationType === 'c' ? 'mentioned' : 'cited'}</span>{' '}
        {!isSingleResource ? (
          <>
            <DocumentNameLink metadata={event.target?.metadata} id={event.target?.id} fallback="this document" />{' '}
          </>
        ) : (
          <>
            <span>this document</span>{' '}
          </>
        )}
        <span>{event.citationType === 'c' ? 'in a comment on' : 'in'}</span>{' '}
        <DocumentNameLink metadata={event.source?.metadata} id={event.source?.id} fallback="a document" />{' '}
        <Timestamp time={event.time} route={route} />
      </InlineDescriptor>
    )
  }

  console.error('EventHeaderContent: We must have ifs for all the event types:', event)

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
            <span className="text-muted-foreground text-xs">Source Document:</span>
            <div className="text-sm">
              <ResourceToken id={event.source.id} metadata={event.source.metadata} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Target Document:</span>
            <div className="text-sm">
              <ResourceToken id={event.target.id} metadata={event.target.metadata} />
              {event.targetFragment && (
                <span className="text-muted-foreground ml-1 text-xs">(Block: {event.targetFragment})</span>
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
  targetDomain,
  isSingleResource,
  size,
  latestDocUpdateVersion,
}: {
  event: LoadedCommentEvent
  route: NavRoute | null
  targetDomain?: string
  isSingleResource?: boolean
  size?: 'sm' | 'md'
  latestDocUpdateVersion?: string | null
}) {
  const linkProps = useRouteLink(route)
  const tx = useTx()

  return (
    <div
      key={`${event.type}-${event.id}-${event.time}`}
      className={cn('hover:bg-background group px-4 py-2 transition-colors dark:hover:bg-black/10')}
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
          targetDomain={targetDomain}
          route={route}
          latestDocUpdateVersion={latestDocUpdateVersion}
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
function findContentBlock(content: HMBlockNode[], blockRef: string): HMBlockNode | null {
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
  const Viewer = useReadOnlyViewer()

  if (resource.isLoading) {
    return <div className="text-muted-foreground text-xs">Loading block…</div>
  }

  if (resource.error || !resource.data || !Viewer) {
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

  return <Viewer blocks={[blockNode]} resourceId={sourceId} textUnit={14} layoutUnit={16} />
}

function getEventRoute(event: LoadedEvent): NavRoute | null {
  if (event.type == 'comment') {
    // Navigate to the full comments page with the comment focused in the main panel
    if (!event.target?.id || !event.comment) return null

    return {
      key: 'comments' as const,
      id: event.target.id,
      openComment: event.comment.id,
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

    // For comment citations, open the comment in the full comments page
    if (event.citationType === 'c' && event.comment) {
      return {
        key: 'comments' as const,
        id: event.source.id,
        openComment: event.comment.id,
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
  targetDomain,
  isSingleResource,
  size,
  latestDocUpdateVersion,
}: {
  event: LoadedEvent
  route: NavRoute | null
  targetDomain?: string
  isSingleResource?: boolean
  size?: 'sm' | 'md'
  latestDocUpdateVersion?: string | null
}) {
  const currentRoute = useNavRoute()
  const linkProps = useRouteLink(route ? merge({}, currentRoute, route) : currentRoute)
  const latestDocId = event.type === 'doc-update' ? latestId(event.docId) : null
  const latestResource = useResource(latestDocId)
  const latestDocument = latestResource.data?.type === 'document' ? latestResource.data.document : null
  const latestVersion = latestDocUpdateVersion ?? latestDocument?.version
  const routeId = currentRoute.key === 'document' ? currentRoute.id : null
  const isSelectedVersion =
    event.type === 'doc-update' &&
    isSelectedDocUpdateVersion(event.document.version, routeId?.version, routeId?.latest, latestVersion)

  const tx = useTx()
  return (
    <div
      className={cn(
        'hover:bg-background group flex flex-col gap-2 px-4 py-4 transition-colors dark:hover:bg-black/10',
        isSelectedVersion && 'bg-accent hover:bg-accent dark:hover:bg-accent',
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
          targetDomain={targetDomain}
          isSingleResource={isSingleResource}
          latestDocUpdateVersion={latestDocUpdateVersion}
        />
      </div>
      {isSingleResource && event.type == 'doc-update' ? null : (
        <div className="relative flex gap-2">
          <div className={cn('w-[24px]')} />
          <div className="flex flex-1 flex-col gap-3">
            <EventContent size={size} isSingleResource={isSingleResource} event={event} />
            {event.type == 'comment' || (event.type == 'citation' && event.comment) ? (
              <div className="-ml-3">
                <Button
                  size="xs"
                  className="text-muted-foreground hover:text-muted-foreground active:text-muted-foreground"
                >
                  <ReplyArrow className="size-3" />
                  {tx('Reply')}
                  {(event.type == 'comment' && event.replyCount > 0) ||
                  (event.type == 'citation' && event.replyCount !== undefined && event.replyCount > 0)
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
