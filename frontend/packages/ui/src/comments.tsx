import {AlertDialogDescription, AlertDialogTitle} from '@radix-ui/react-alert-dialog'
import {
  BlockRange,
  HMBlockNode,
  HMComment,
  HMCommentGroup,
  HMDocument,
  HMExternalCommentGroup,
  HMMetadata,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {
  commentIdToHmId,
  formattedDateShort,
  getCommentTargetId,
  hmId,
  NavRoute,
  useRouteLink,
  useUniversalAppContext,
} from '@shm/shared'

import {HMListDiscussionsOutput} from '@seed-hypermedia/client/hm-types'
import {
  useCommentsServiceContext,
  useDeleteComment,
  useHackyAuthorsSubscriptions,
  useUpdateComment,
} from '@shm/shared/comments-service-provider'
import {getCommentThread, getSubmittedCommentGroups, sortCommentGroupsByCreation} from '@shm/shared/comments'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {commentToText} from '@shm/shared/content-to-text'
import {
  useBlockDiscussions,
  useCommentReplyCount,
  useCommentVersions,
  useDocumentComments,
  useDocumentDiscussions,
} from '@shm/shared/models/comments'
import {useIsCurrentUser, useResource} from '@shm/shared/models/entity'
import {useMentionNames} from '@shm/shared/models/inline-mentions'
import {extractRefs} from '@shm/shared/content'
import {useReadOnlyViewer} from '@shm/shared/readonly-viewer-context'
import {getRoutePanel} from '@shm/shared/routes'
import {useTxString} from '@shm/shared/translation'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {Bookmark, Link, MessageSquare, Pencil, Trash2, X} from 'lucide-react'
import {memo, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {SelectionContent} from './accessories'
import {getBlockNodeById} from './blocks-content-utils'
import {ContentEmbed} from './content-embed'
import {Button} from './button'
import {Popover, PopoverContent, PopoverTrigger} from './components/popover'
import {AccountAvatar} from './account-avatar'
import {AuthorNameLink, InlineDescriptor, Timestamp} from './inline-descriptor'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
import {useAppDialog} from './universal-dialog'
import {useCopyHmLink} from './use-copy-hm-link'
import {cn} from './utils'
import {useCommentsScroll} from './use-comments-scroll'

/** Return a normalized 50-character snapshot for a comment bookmark title. */
export function commentBookmarkTitle(content: HMBlockNode[], resolvedNames?: Readonly<Record<string, string>>): string {
  return commentToText({comment: {content}, resolvedNames, lineBreaks: false}).replace(/\s+/g, ' ').trim().slice(0, 50)
}

/** Shows a focused thread in the shared main-page and panel comments layout. */
export function CommentDiscussions({
  targetId,
  isEntirelyHighlighted = false,
  commentId,
  replyCommentId,
  targetDomain,
  selection,
}: {
  targetId: UnpackedHypermediaId
  commentId?: string
  replyCommentId?: string
  isEntirelyHighlighted?: boolean
  targetDomain?: string
  selection?: {
    blockId?: string
    blockRange?: BlockRange
  }
}) {
  const focusedCommentRef = useRef<HTMLDivElement>(null)

  // Fetch all comments for the document
  const commentsService = useDocumentComments(targetId)

  const thread = useMemo(
    () => getCommentThread(commentsService.data?.comments, commentId ?? ''),
    [commentsService.data?.comments, commentId],
  )
  const highlightedCommentId = replyCommentId || commentId
  const allAuthorIds = useMemo(
    () =>
      Array.from(
        new Set(
          [thread?.root, ...(thread?.replies ?? [])].flatMap((comment) => (comment?.author ? [comment.author] : [])),
        ),
      ),
    [thread],
  )

  useHackyAuthorsSubscriptions(allAuthorIds)

  const {showDeletedContent} = useCommentsServiceContext()

  const commentResource = useResource(commentId ? commentIdToHmId(commentId) : null, {subscribed: true})

  // Find the actual focused comment
  const focusedComment = useMemo(() => {
    const listedComment = commentsService.data?.comments?.find((c) => c.id === commentId)
    if (listedComment) return listedComment
    if (commentResource.data?.type === 'comment') return commentResource.data.comment
    return null
  }, [commentsService.data?.comments, commentId, commentResource.data])

  const isDeletedComment = !focusedComment && commentResource.data?.type === 'tombstone'

  // On desktop, fetch version history for deleted comments so we can show their content
  const deletedVersions = useCommentVersions(showDeletedContent && isDeletedComment ? commentId : null)
  const deletedLastVersion = deletedVersions.data?.versions?.[0]
  // Wait for the resource query to fully settle before deciding deleted/not-found, so we don't
  // flash "This comment was deleted." while peer sync is still in flight (issue #435).
  const isFocusedCommentLoading =
    !focusedComment &&
    (commentResource.isFetching ||
      commentResource.isLoading ||
      commentResource.isDiscovering ||
      (!commentResource.data && !commentResource.error))
  const isFocusedCommentDeleted = commentResource.data?.type === 'tombstone'
  const showDeletedPreview = !!showDeletedContent && isFocusedCommentDeleted && !!deletedLastVersion
  const showDeletedPreviewLoading = !!showDeletedContent && isFocusedCommentDeleted && deletedVersions.isLoading

  const selectedCommentLoaded =
    thread?.root.id === highlightedCommentId || thread?.replies.some((comment) => comment.id === highlightedCommentId)
  useLayoutEffect(() => {
    const focusedElement = focusedCommentRef.current
    if (!focusedElement) return
    const scrollToComment = () =>
      focusedElement.scrollIntoView({
        behavior: 'instant',
        block: highlightedCommentId === thread?.root.id ? 'start' : 'nearest',
      })
    scrollToComment()

    // The reply editor can grow after entry, reducing the thread's visible height.
    const viewport = focusedElement.closest('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    const observer = new ResizeObserver(scrollToComment)
    observer.observe(viewport)
    const stopFollowing = () => observer.disconnect()
    const interactionTarget = viewport.parentElement ?? viewport
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const event of events) interactionTarget.addEventListener(event, stopFollowing, {passive: true})
    return () => {
      observer.disconnect()
      for (const event of events) interactionTarget.removeEventListener(event, stopFollowing)
    }
  }, [highlightedCommentId, thread?.root.id, selectedCommentLoaded, !!focusedComment])

  if (!commentId) return null

  if (commentsService.error) {
    return (
      <SelectionContent>
        <div className="flex flex-col items-center gap-2 p-4">
          <SizableText color="muted" size="sm">
            Failed to load comment thread
          </SizableText>
        </div>
      </SelectionContent>
    )
  }

  if (commentsService.isLoading && !commentsService.data) {
    return (
      <SelectionContent>
        <div className="flex items-center justify-center p-4">
          <Spinner />
        </div>
      </SelectionContent>
    )
  }

  if (showDeletedPreview) {
    return (
      <SelectionContent>
        <div className="p-2">
          <DeletedCommentPreview comment={deletedLastVersion!} />
        </div>
      </SelectionContent>
    )
  }

  if (showDeletedPreviewLoading || isFocusedCommentLoading) {
    return (
      <SelectionContent>
        <div className="flex items-center justify-center p-4">
          <Spinner />
        </div>
      </SelectionContent>
    )
  }

  if (!focusedComment && commentsService.data) {
    if (isFocusedCommentDeleted) {
      return (
        <SelectionContent>
          <div className="flex flex-col items-center gap-2 p-4">
            <SizableText color="muted" size="sm">
              This comment was deleted.
            </SizableText>
          </div>
        </SelectionContent>
      )
    }
    return (
      <SelectionContent>
        <div className="flex flex-col items-center gap-2 p-4">
          <SizableText color="muted" size="sm">
            This comment could not be found.
          </SizableText>
        </div>
      </SelectionContent>
    )
  }

  return (
    <SelectionContent>
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        {[thread?.root ?? focusedComment, ...(thread?.replies ?? [])].map(
          (comment, index) =>
            comment && (
              <div
                key={comment.id}
                ref={comment.id === highlightedCommentId ? focusedCommentRef : undefined}
                className={index ? 'border-border ml-4 border-t' : 'scroll-mt-4 pb-3'}
              >
                <Comment
                  comment={comment}
                  authorId={comment.author}
                  authorMetadata={commentsService.data?.authors?.[comment.author]?.metadata}
                  targetDomain={targetDomain}
                  highlight={isEntirelyHighlighted && comment.id === highlightedCommentId}
                  selection={comment.id === highlightedCommentId ? selection : undefined}
                  threadView
                  threadRootId={thread?.root.id}
                  enableReplies={index > 0}
                />
              </div>
            ),
        )}
      </div>
    </SelectionContent>
  )
}

export const Discussions = memo(function Discussions({
  targetId,
  commentId,
  submittedRoots = [],
  onCommentDeleted,
  targetDomain,
  emptyState,
  scrollKey,
}: {
  targetId: UnpackedHypermediaId
  commentId?: string
  submittedRoots?: HMComment[]
  onCommentDeleted?: (commentId: string) => void
  targetDomain?: string
  /** Optional empty content for the document comments panel. */
  emptyState?: ReactNode
  /** Retain root reading position for this document and layout. */
  scrollKey?: string
}) {
  const discussionsService = useDocumentDiscussions(targetId, commentId)

  // Subscribe to all authors in discussions
  const allAuthorIds = useMemo(() => {
    const authors = new Set<string>()
    if (discussionsService.data?.discussions) {
      discussionsService.data.discussions.forEach((cg) => {
        cg.comments.forEach((c) => {
          if (c.author) authors.add(c.author)
        })
      })
    }
    if (discussionsService.data?.citingDiscussions) {
      discussionsService.data?.citingDiscussions.forEach((cg) => {
        cg.comments.forEach((c) => {
          if (c.author) authors.add(c.author)
        })
      })
    }
    return Array.from(authors)
  }, [discussionsService.data?.discussions, discussionsService.data?.citingDiscussions])

  useHackyAuthorsSubscriptions(allAuthorIds)

  const acknowledgedRoots = useRef(new Set<string>())
  useEffect(() => {
    const listedIds = new Set(
      discussionsService.data?.discussions.flatMap((group) => group.comments.map((comment) => comment.id)),
    )
    for (const root of submittedRoots) {
      if (listedIds.has(root.id)) acknowledgedRoots.current.add(root.id)
    }
  }, [discussionsService.data?.discussions, submittedRoots])
  const rootGroups = getSubmittedCommentGroups(
    discussionsService.data?.discussions,
    submittedRoots,
    acknowledgedRoots.current,
  )
  const groups = sortCommentGroupsByCreation([...rootGroups, ...(discussionsService.data?.citingDiscussions ?? [])])
  const {listRef, hasNewComments, scrollToBottom, heights} = useCommentsScroll(
    scrollKey ?? targetId.id,
    groups.map((group) => group.id),
    !!scrollKey && (!!discussionsService.data || !!submittedRoots.length),
    submittedRoots.at(-1)?.id,
  )
  const previousIds = useRef<Set<string>>()
  const [newCommentIds, setNewCommentIds] = useState<Set<string>>(new Set())
  const groupIds = groups.map((group) => group.id).join('\n')
  useEffect(() => {
    if (!discussionsService.data && !submittedRoots.length) return
    const ids = new Set(groups.map((group) => group.id))
    const added = Array.from(ids).filter((id) => previousIds.current && !previousIds.current.has(id))
    previousIds.current = ids
    if (added.length) setNewCommentIds((current) => new Set([...Array.from(current), ...added]))
  }, [groupIds, !!discussionsService.data])
  useEffect(() => {
    if (!newCommentIds.size) return
    const timer = setTimeout(() => setNewCommentIds(new Set()), 3000)
    return () => clearTimeout(timer)
  }, [newCommentIds])
  let panelContent = null
  if (!submittedRoots.length && discussionsService.isLoading && !discussionsService.data) {
    panelContent = (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  } else if (!submittedRoots.length && discussionsService.error) {
    panelContent = (
      <div className="flex flex-col items-center gap-2 p-4">
        <SizableText color="muted" size="sm" className="font-sans">
          Failed to load discussions
        </SizableText>
      </div>
    )
  } else if (discussionsService.data || submittedRoots.length) {
    const totalCount = rootGroups.length + (discussionsService.data?.citingDiscussions?.length ?? 0)
    panelContent =
      totalCount > 0 ? (
        <>
          {groups.map((group) => {
            const comment = group.comments[0]
            if (!comment) return null

            return (
              <LazyCommentGroup
                key={group.id}
                commentId={group.id}
                heights={heights}
                className={!commentId ? 'border-border bg-card rounded-lg border' : undefined}
              >
                {commentId ? (
                  <CommentGroup
                    commentGroup={group}
                    highlightedCommentId={newCommentIds.has(group.id) ? group.id : undefined}
                    onCommentDeleted={onCommentDeleted}
                    authors={discussionsService.data?.authors}
                    targetDomain={targetDomain}
                  />
                ) : (
                  <Comment
                    comment={comment}
                    authorId={comment.author}
                    authorMetadata={discussionsService.data?.authors?.[comment.author]?.metadata}
                    externalTarget={group.type === 'externalCommentGroup' ? group.target : undefined}
                    highlight={newCommentIds.has(group.id)}
                    onCommentDeleted={onCommentDeleted}
                    targetDomain={targetDomain}
                  />
                )}
              </LazyCommentGroup>
            )
          })}
        </>
      ) : (
        emptyState ?? <NoComments />
      )
  }

  return (
    <div ref={listRef} className={cn('flex flex-col gap-2', emptyState && 'flex-1')}>
      {panelContent}
      {hasNewComments && (
        <div className="sticky bottom-2 flex justify-center">
          <Button size="sm" onClick={scrollToBottom}>
            New comments
          </Button>
        </div>
      )}
    </div>
  )
})

export function BlockDiscussions({
  targetId,
  commentEditor,
  targetDomain,
  blockRange,
}: {
  targetId: UnpackedHypermediaId
  commentEditor?: ReactNode
  targetDomain?: string
  /** Optional codepoint range within `targetId.blockRef` to visually highlight inside the quoted block. */
  blockRange?: BlockRange
}) {
  const commentsService = useBlockDiscussions(targetId)
  const doc = useResource(targetId)

  // Subscribe to all authors in block discussions
  const allAuthorIds = useMemo(() => {
    const authors = new Set<string>()
    if (commentsService.data?.comments) {
      commentsService.data.comments.forEach((c) => {
        if (c.author) authors.add(c.author)
      })
    }
    return Array.from(authors)
  }, [commentsService.data?.comments])

  useHackyAuthorsSubscriptions(allAuthorIds)

  let quotedContent = null
  let panelContent = null

  if (!targetId) return null

  if (targetId.blockRef && doc.data?.type == 'document' && doc.data.document) {
    quotedContent = (
      <QuotedDocBlock docId={targetId} blockId={targetId.blockRef} doc={doc.data.document} blockRange={blockRange} />
    )
  } else if (doc.isInitialLoading) {
    quotedContent = (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (commentsService.isLoading && !commentsService.data) {
    panelContent = (
      <div className="flex items-center justify-center py-4">
        <Spinner />
      </div>
    )
  } else if (commentsService.error) {
    panelContent = (
      <div className="flex flex-col items-center gap-2 p-4">
        <SizableText color="muted" size="sm">
          Failed to load block discussions
        </SizableText>
      </div>
    )
  } else if (commentsService.data && commentsService.data.comments && commentsService.data.comments.length) {
    panelContent = (
      <>
        {commentsService.data.comments.map((comment) => {
          return (
            <div key={comment.id} className={cn('p-2')}>
              <Comment
                key={comment.id}
                comment={comment}
                authorId={comment.author}
                authorMetadata={commentsService.data.authors[comment.author]?.metadata}
                targetDomain={targetDomain}
              />
            </div>
          )
        })}
      </>
    )
  }

  return (
    <SelectionContent>
      {quotedContent}
      <div className="px-2 pr-4">{commentEditor}</div>
      <div className="mt-2 pt-2">{panelContent}</div>
    </SelectionContent>
  )
}

// this is a LINEARIZED set of comments, where one comment is directly replying to another. the commentGroup.moreCommentsCount should be the number of replies to the last comment in the group.
const LAZY_COMMENT_PLACEHOLDER_HEIGHT = 80

/**
 * Lazy-renders children only when near the viewport using IntersectionObserver.
 * Unmounts children when scrolled far away to keep memory low.
 * Preserves measured height as placeholder to prevent scroll jumps.
 */
function LazyCommentGroup({
  children,
  className,
  commentId,
  heights,
}: {
  children: ReactNode
  className?: string
  commentId: string
  heights: Map<string, number>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [isNearViewport, setIsNearViewport] = useState(false)
  const heightRef = useRef(heights.get(commentId) ?? LAZY_COMMENT_PLACEHOLDER_HEIGHT)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        if (entry.isIntersecting) {
          setIsNearViewport(true)
        } else {
          if (el.offsetHeight > 0) {
            heightRef.current = el.offsetHeight
            heights.set(commentId, el.offsetHeight)
          }
          setIsNearViewport(false)
        }
      },
      {rootMargin: '600px'},
    )
    observer.observe(el)
    const resize = new ResizeObserver(() => {
      if (el.offsetHeight > 0) {
        heightRef.current = el.offsetHeight
        heights.set(commentId, el.offsetHeight)
      }
    })
    resize.observe(el)
    return () => {
      observer.disconnect()
      resize.disconnect()
    }
  }, [commentId, heights])

  return (
    <div
      ref={ref}
      data-comment-id={commentId}
      className={className}
      style={isNearViewport ? undefined : {minHeight: heightRef.current}}
    >
      {isNearViewport ? children : null}
    </div>
  )
}

export const CommentGroup = memo(function CommentGroup({
  commentGroup,
  authors,
  enableReplies = true,
  highlightLastComment = false,
  highlightedCommentId,
  onCommentDeleted,
  targetDomain,
}: {
  commentGroup: HMCommentGroup | HMExternalCommentGroup
  authors?: HMListDiscussionsOutput['authors']
  enableReplies?: boolean
  highlightLastComment?: boolean
  highlightedCommentId?: string
  onCommentDeleted?: (commentId: string) => void
  targetDomain?: string
}) {
  const lastComment = commentGroup.comments.at(-1)
  const firstComment = commentGroup.comments[0]

  return (
    <div className="relative flex flex-col gap-2 p-2">
      {commentGroup.comments.map((comment) => {
        const isLastCommentInGroup = !!lastComment && comment === lastComment
        const isFirstCommentInGroup = !!lastComment && comment === firstComment
        return (
          <Comment
            externalTarget={
              isFirstCommentInGroup && commentGroup.type === 'externalCommentGroup' ? commentGroup.target : undefined
            }
            key={comment.id}
            comment={comment}
            onCommentDeleted={onCommentDeleted}
            authorMetadata={comment.author ? authors?.[comment.author]?.metadata : null}
            authorId={comment.author}
            enableReplies={enableReplies}
            highlight={
              highlightedCommentId ? comment.id === highlightedCommentId : highlightLastComment && isLastCommentInGroup
            }
            targetDomain={targetDomain}
          />
        )
      })}
    </div>
  )
})

export const Comment = memo(function Comment({
  comment,
  onCommentDeleted,
  authorMetadata,
  authorId,
  enableReplies = true,
  highlight = false,
  threadView = false,
  threadRootId,
  targetDomain,
  heading,
  externalTarget,
  selection,
}: {
  comment: HMComment
  onCommentDeleted?: (commentId: string) => void
  authorMetadata?: HMMetadata | null
  authorId?: string | null
  enableReplies?: boolean
  highlight?: boolean
  /** Show reply actions without reopening the current thread. */
  threadView?: boolean
  /** Resolved thread root, including replies that have not completed server sync. */
  threadRootId?: string
  targetDomain?: string
  heading?: ReactNode
  externalTarget?: HMMetadataPayload
  selection?: {
    blockId?: string
    blockRange?: BlockRange
  }
}) {
  const tx = useTxString()
  const [isEditing, setIsEditing] = useState(false)
  const [viewingVersion, setViewingVersion] = useState<HMComment | null>(null)
  const commentsContext = useCommentsServiceContext()
  const {data: replyCount} = useCommentReplyCount({id: comment.id})
  const isAuthor = useIsCurrentUser(comment.author)
  const deleteCommentMutation = useDeleteComment()
  const updateCommentMutation = useUpdateComment()
  const deleteCommentDialog = useDeleteCommentDialog()
  const currentRoute = useNavRoute()
  const documentActions = useDocumentActions()
  const {origin: appOrigin} = useUniversalAppContext()

  const bookmarkResolvedNames = useMentionNames(useMemo(() => extractRefs(comment.content), [comment.content]))

  const authorHmId = comment.author || authorId ? hmId(authorId || comment.author) : null
  const docId = getCommentTargetId(comment)
  const commentHmId = commentIdToHmId(comment.id)
  const bookmarkTitle = commentBookmarkTitle(comment.content, bookmarkResolvedNames)
  const bookmarkAuthorAccountId = comment.author || authorId
  const isBookmarked = documentActions.isBookmarked?.(commentHmId) ?? false
  const copyHmLink = useCopyHmLink()

  const externalTargetLink = useRouteLink(externalTarget ? {key: 'document', id: externalTarget.id} : null)

  const navigate = useNavigate('replace')

  // When this comment is the focused permalink comment (/:comments/UID/TSID),
  // the viewed version lives on the route (?v=) so it survives copy/paste and
  // reload. Other comments keep the version preview as local state.
  const isRouteControlledVersion = currentRoute.key === 'comments' && currentRoute.openComment === comment.id
  const routeCommentVersion =
    currentRoute.key === 'comments' && currentRoute.openComment === comment.id
      ? currentRoute.openCommentVersion
      : undefined
  const routeVersionToView =
    routeCommentVersion && routeCommentVersion !== comment.version ? routeCommentVersion : undefined
  const commentVersions = useCommentVersions(routeVersionToView ? comment.id : null)
  const routeViewingVersion = routeVersionToView
    ? commentVersions.data?.versions?.find((version) => version.version === routeVersionToView) ?? null
    : null
  const activeViewingVersion = isRouteControlledVersion ? routeViewingVersion : viewingVersion
  const selectViewingVersion = (version: HMComment | null) => {
    if (currentRoute.key === 'comments' && currentRoute.openComment === comment.id) {
      navigate({
        ...currentRoute,
        openCommentVersion: (version && version.version !== comment.version && version.version) || undefined,
      })
    } else {
      setViewingVersion(version)
    }
  }

  const options: MenuItemType[] = []
  if (isAuthor) {
    options.push({
      icon: <Pencil className="size-4" />,
      label: 'Edit',
      onClick: () => setIsEditing(true),
      key: 'edit',
    })
  }
  if (isAuthor) {
    options.push({
      icon: <Trash2 className="size-4" />,
      label: 'Delete',
      onClick: () => {
        deleteCommentDialog.open({
          onConfirm: () => {
            // Check if we're currently focused on this comment before deleting.
            // If so, navigate back to the comments list after deletion succeeds.
            const routePanel = getRoutePanel(currentRoute)
            const isFocusedComment =
              (currentRoute.key === 'comments' && currentRoute.openComment === comment.id) ||
              (routePanel?.key === 'comments' && routePanel.openComment === comment.id)

            deleteCommentMutation.mutate(
              {comment, signingAccountId: comment.author},
              {
                onSuccess: () => {
                  onCommentDeleted?.(comment.id)
                  if (!isFocusedComment) return
                  if (currentRoute.key === 'comments' && currentRoute.openComment) {
                    navigate({
                      ...currentRoute,
                      openComment: undefined,
                      openCommentVersion: undefined,
                      replyCommentId: undefined,
                    })
                  } else if ('panel' in currentRoute && routePanel?.key === 'comments' && routePanel.openComment) {
                    navigate({
                      ...currentRoute,
                      panel: {...routePanel, openComment: undefined, replyCommentId: undefined},
                    } as NavRoute)
                  }
                },
              },
            )
          },
        })
      },
      key: 'delete',
    })
  }
  const isEntirelyHighlighted = highlight && !selection
  return (
    <>
      {deleteCommentDialog.content}
      <div
        data-resourceid={commentHmId.id}
        className={cn(
          'highlight-transition group relative flex flex-col gap-1 rounded-lg px-3 py-3',
          isEntirelyHighlighted && 'bg-highlight',
        )}
      >
        <div className="flex min-w-0 items-center gap-1">
          {!heading && authorHmId ? (
            <div className="size-5 shrink-0">
              <AccountAvatar
                id={authorHmId}
                name={authorMetadata?.name}
                icon={authorMetadata?.icon}
                size={20}
                siteUid={docId?.uid}
              />
            </div>
          ) : null}
          <div className="group flex min-w-0 flex-1 items-center justify-between gap-2 overflow-hidden pr-2">
            {heading ? (
              <div className="inline">{heading}</div>
            ) : (
              <InlineDescriptor>
                {authorHmId ? (
                  <AuthorNameLink
                    author={{
                      id: authorHmId,
                      metadata: authorMetadata ?? undefined,
                    }}
                    siteUid={docId?.uid}
                  />
                ) : (
                  <span>Someone</span>
                )}{' '}
                {externalTarget ? (
                  <>
                    <span>on</span>{' '}
                    <button
                      {...externalTargetLink}
                      className="hover:bg-accent text-foreground h-5 truncate rounded px-1 text-sm font-bold transition-colors"
                    >
                      {externalTarget.metadata?.name}
                    </button>
                  </>
                ) : null}
                <CommentDate comment={comment} />
                {JSON.stringify(comment.createTime) !== JSON.stringify(comment.updateTime) ? (
                  <EditedIndicator commentId={comment.id} onSelectVersion={selectViewingVersion} />
                ) : null}
              </InlineDescriptor>
            )}
            <div className="flex items-center gap-2">
              {!isEditing && documentActions.onBookmarkToggle && docId && bookmarkTitle && bookmarkAuthorAccountId ? (
                <Tooltip content={tx(isBookmarked ? 'Remove from Bookmarks' : 'Add to Bookmarks')}>
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={isBookmarked ? 'Remove Comment from Bookmarks' : 'Add Comment to Bookmarks'}
                    className="text-muted-foreground hover-hover:opacity-0 hover-hover:group-hover:opacity-100 transition-opacity duration-200 ease-in-out"
                    onClick={() =>
                      documentActions.onBookmarkToggle?.(commentHmId, {
                        title: bookmarkTitle,
                        commentId: comment.id,
                        targetUrl: hmId(docId.uid, {path: docId.path}).id,
                        authorAccountId: bookmarkAuthorAccountId,
                      })
                    }
                  >
                    <Bookmark className={cn('size-3', isBookmarked && 'fill-current')} />
                  </Button>
                </Tooltip>
              ) : null}
              {!isEditing && (
                <Tooltip content={tx('Copy Comment Link')}>
                  <Button
                    // size="icon"
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground hover-hover:opacity-0 hover-hover:group-hover:opacity-100 transition-opacity duration-200 ease-in-out"
                    onClick={() => {
                      if (!docId) return
                      const rootId = comment.threadRoot || threadRootId || comment.id
                      const routeDocumentId =
                        currentRoute.key === 'document' ||
                        currentRoute.key === 'comments' ||
                        currentRoute.key === 'activity'
                          ? currentRoute.id
                          : undefined
                      copyHmLink({
                        id: {
                          ...docId,
                          hostname: targetDomain ?? null,
                          latest: routeDocumentId?.latest ?? null,
                          pageParams: routeDocumentId?.id === docId.id ? routeDocumentId.pageParams : undefined,
                        },
                        commentId: commentIdToHmId(rootId),
                        replyCommentId: rootId !== comment.id ? comment.id : undefined,
                        gatewayUrl: appOrigin ?? undefined,
                      })
                    }}
                  >
                    <Link className="size-3" />
                  </Button>
                </Tooltip>
              )}
              {!isEditing && options.length > 0 ? (
                <OptionsDropdown
                  side="bottom"
                  size="xs"
                  align="end"
                  className="hover-hover:opacity-0 hover-hover:group-hover:opacity-100 transition-opacity duration-200 ease-in-out"
                  menuItems={options}
                />
              ) : null}
            </div>
          </div>
        </div>

        {isEditing ? (
          <InlineCommentEditor
            comment={comment}
            onCancel={() => setIsEditing(false)}
            onSave={(newContent) => {
              updateCommentMutation.mutate(
                {comment, newContent, signingAccountId: comment.author},
                {onSuccess: () => setIsEditing(false)},
              )
            }}
            isSaving={updateCommentMutation.isPending}
          />
        ) : activeViewingVersion ? (
          <VersionPreview
            version={activeViewingVersion}
            selection={selection}
            onDismiss={() => selectViewingVersion(null)}
          />
        ) : (
          <CommentContent comment={comment} selection={selection} />
        )}

        {!isEntirelyHighlighted && !isEditing && enableReplies && (
          <div className="flex items-center gap-2 py-1">
            {commentsContext.onReplyClick ? (
              <Button
                variant="ghost"
                size="xs"
                className={cn(
                  'text-brand hover:text-brand active:text-brand px-0 text-sm font-semibold',
                  'plausible-event-name=Reply+Click',
                )}
                onClick={() => {
                  if (!threadView && replyCount && commentsContext.onReplyCountClick) {
                    commentsContext.onReplyCountClick(comment)
                  } else if (commentsContext.onReplyClick) {
                    commentsContext.onReplyClick(comment)
                  }
                }}
              >
                {!threadView && replyCount && replyCount > 0
                  ? `${replyCount} ${tx(replyCount === 1 ? 'reply' : 'replies')}`
                  : tx('Reply')}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </>
  )
})

export function CommentContent({
  comment,
  size,
  zoomBlockRef,
  selection,
  resourceId,
}: {
  comment: HMComment
  size?: 'sm' | 'md'
  zoomBlockRef?: string | null
  zoomBlockRange?: BlockRange | null
  selection?: {
    blockId?: string
    blockRange?: BlockRange
  }
  allowHighlight?: boolean
  openOnClick?: boolean
  onBlockSelect?: (blockId: string, blockRange: BlockRange | null) => void
  resourceId?: UnpackedHypermediaId
}) {
  const Viewer = useReadOnlyViewer()
  const currentRoute = useNavRoute()
  const targetHomeEntity = useResource(hmId(comment.targetAccount))
  const targetHomeDoc = targetHomeEntity.data?.type === 'document' ? targetHomeEntity.data.document : undefined
  const targetDocId = getCommentTargetId(comment)
  const siteUrl = targetHomeDoc?.metadata?.siteUrl as string | undefined
  const textUnit = size === 'sm' ? 12 : 14
  const layoutUnit = size === 'sm' ? 14 : 16

  const copyHmLink = useCopyHmLink()
  const {origin: appOrigin} = useUniversalAppContext()
  const copyBlockUrl = useCallback(
    (blockId: string, blockRange?: BlockRange | null) => {
      if (!targetDocId) return
      const routeDocumentId =
        currentRoute.key === 'document' || currentRoute.key === 'comments' || currentRoute.key === 'activity'
          ? currentRoute.id
          : undefined
      copyHmLink({
        id: {
          ...targetDocId,
          hostname: siteUrl ?? null,
          latest: routeDocumentId?.latest ?? null,
          pageParams: routeDocumentId?.id === targetDocId.id ? routeDocumentId.pageParams : undefined,
          blockRef: blockId,
          blockRange: blockRange ?? null,
        },
        commentId: commentIdToHmId(comment.id),
        gatewayUrl: appOrigin ?? undefined,
      })
    },
    [targetDocId, currentRoute, comment.id, siteUrl, copyHmLink, appOrigin],
  )

  const onCopyBlockLink = useCallback((blockId: string) => copyBlockUrl(blockId), [copyBlockUrl])

  const onCopyFragmentLink = useCallback(
    (blockId: string, rangeStart: number, rangeEnd: number) =>
      copyBlockUrl(blockId, {start: rangeStart, end: rangeEnd}),
    [copyBlockUrl],
  )

  const focusedId = {
    ...(resourceId || commentIdToHmId(comment.id, comment.version)),
    blockRef: selection?.blockId || null,
    blockRange: selection?.blockRange || null,
  }
  const zoomedBlock = zoomBlockRef ? getBlockNodeById(comment.content, zoomBlockRef) : null
  const zoomedContent = zoomedBlock ? [zoomedBlock] : comment.content

  if (!Viewer) return null

  return (
    <Viewer
      blocks={zoomedContent}
      resourceId={focusedId}
      resourceKind="comment"
      focusBlockId={selection?.blockId}
      blockRange={selection?.blockRange}
      commentStyle
      textUnit={textUnit}
      layoutUnit={layoutUnit}
      onCopyBlockLink={onCopyBlockLink}
      onCopyFragmentLink={onCopyFragmentLink}
    />
  )
}

function CommentDate({comment}: {comment: HMComment}) {
  const targetId = getCommentTargetId(comment)
  // Same destination as "Copy Comment Link": the target document's comments
  // panel focused on this comment, staying within the site context. The id
  // drops the comment's targetVersion so the URL matches the copied link.
  const destRoute: NavRoute | null = targetId
    ? {
        key: 'document',
        id: hmId(targetId.uid, {path: targetId.path}),
        panel: {key: 'comments', id: hmId(targetId.uid, {path: targetId.path}), openComment: comment.id},
      }
    : null
  return <Timestamp time={comment.createTime} route={destRoute} />
}

/** Shows the selected document fragment with optional source-block expansion. */
export function QuotedDocBlock({
  docId,
  blockId,
  doc,
  blockRange,
}: {
  docId: UnpackedHypermediaId
  blockId: string
  doc: HMDocument
  blockRange?: BlockRange
}) {
  return (
    <ContentEmbed
      id={{...docId, blockRef: blockId, blockRange: blockRange || null}}
      blocks={doc.content}
      route={{key: 'document', id: {...docId, blockRef: blockId, blockRange: blockRange || null}}}
    />
  )
}

export function useDeleteCommentDialog() {
  return useAppDialog(DeleteCommentDialog, {isAlert: true})
}

function DeleteCommentDialog({input, onClose}: {input: {onConfirm: () => void}; onClose: () => void}) {
  return (
    <>
      <AlertDialogTitle className="text-xl font-bold">Really Delete?</AlertDialogTitle>
      <AlertDialogDescription>
        You will publicly delete this comment, although other peers may have already archived it.
      </AlertDialogDescription>
      <Button
        variant="destructive"
        onClick={() => {
          input.onConfirm()
          onClose()
        }}
      >
        Delete Comment
      </Button>
    </>
  )
}

/** "(edited)" label with popover listing versions. Clicking a version calls onSelectVersion. */
function EditedIndicator({
  commentId,
  onSelectVersion,
}: {
  commentId: string
  onSelectVersion: (version: HMComment | null) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="text-muted-foreground ml-1 cursor-pointer text-[11px] hover:underline">(edited)</button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-72 p-0">
        {open ? (
          <CommentVersionList
            commentId={commentId}
            onSelect={(version) => {
              onSelectVersion(version)
              setOpen(false)
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/** Popover list of comment versions. Clicking a version triggers onSelect (null for the current version). */
function CommentVersionList({commentId, onSelect}: {commentId: string; onSelect: (version: HMComment | null) => void}) {
  const {data, isLoading, error} = useCommentVersions(commentId)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Spinner />
      </div>
    )
  }

  if (error || !data?.versions?.length) {
    return (
      <div className="p-4">
        <SizableText size="sm" color="muted">
          Could not load edit history
        </SizableText>
      </div>
    )
  }

  const editCount = data.versions.length - 1

  return (
    <div className="flex flex-col">
      <div className="border-border border-b px-3 py-2">
        <SizableText size="sm" className="font-semibold">
          Edited {editCount} {editCount === 1 ? 'time' : 'times'}
        </SizableText>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {data.versions.map((version, index) => {
          const versionNumber = data.versions.length - index
          const isCurrent = index === 0
          if (isCurrent) {
            return (
              <button
                key={version.version || index}
                className="hover:bg-accent border-border flex w-full items-center justify-between border-b px-3 py-2 text-left last:border-b-0"
                onClick={() => onSelect(null)}
              >
                <div className="flex items-center gap-2">
                  <SizableText size="xs">Version {versionNumber}</SizableText>
                  <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[10px] leading-none font-medium">
                    current
                  </span>
                </div>
                <SizableText size="xs" color="muted">
                  {version.updateTime ? formattedDateShort(version.updateTime) : ''}
                </SizableText>
              </button>
            )
          }
          return (
            <button
              key={version.version || index}
              className="hover:bg-accent border-border flex w-full items-center justify-between border-b px-3 py-2 text-left last:border-b-0"
              onClick={() => onSelect(version)}
            >
              <SizableText size="xs">Version {versionNumber}</SizableText>
              <SizableText size="xs" color="muted">
                {version.updateTime ? formattedDateShort(version.updateTime) : ''}
              </SizableText>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Red inline banner showing the content of a deleted comment (pre-deletion version from history). */
function DeletedCommentPreview({comment}: {comment: HMComment}) {
  return (
    <div className="rounded-md border border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950">
      <div className="flex items-center px-3 py-1.5">
        <SizableText size="xs" className="font-sans text-red-800 dark:text-red-200">
          This comment was deleted
          {comment.updateTime ? ` · ${formattedDateShort(comment.updateTime)}` : ''}
        </SizableText>
      </div>
      <div className="px-1 pb-2">
        <CommentContent
          comment={comment}
          size="sm"
          openOnClick={false}
          resourceId={commentIdToHmId(comment.id, comment.version)}
        />
      </div>
    </div>
  )
}

/** Yellow inline banner showing a previous version of the comment in place of the current content. */
function VersionPreview({
  version,
  selection,
  onDismiss,
}: {
  version: HMComment
  selection?: {blockId?: string; blockRange?: BlockRange}
  onDismiss: () => void
}) {
  return (
    <div className="rounded-md border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950">
      <div className="flex items-center justify-between px-3 py-1.5">
        <SizableText size="xs" className="font-sans text-yellow-800 dark:text-yellow-200">
          Viewing previous version {version.updateTime ? `\u00b7 ${formattedDateShort(version.updateTime)}` : ''}
        </SizableText>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-yellow-800 hover:bg-yellow-200 dark:text-yellow-200 dark:hover:bg-yellow-900"
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="px-1 pb-2">
        <CommentContent
          comment={version}
          selection={selection}
          size="sm"
          openOnClick={false}
          resourceId={commentIdToHmId(version.id, version.version)}
        />
      </div>
    </div>
  )
}

/** Inline editor for editing an existing comment in-place. Uses context-provided renderer. */
function InlineCommentEditor({
  comment,
  onCancel,
  onSave,
  isSaving,
}: {
  comment: HMComment
  onCancel: () => void
  onSave: (content: HMBlockNode[]) => void
  isSaving: boolean
}) {
  const {renderInlineEditor} = useCommentsServiceContext()

  if (!renderInlineEditor) {
    // Fallback: show cancel button if no editor renderer is provided
    return (
      <div className="flex flex-col gap-2">
        <SizableText size="sm" color="muted" className="font-sans">
          Inline editing is not available.
        </SizableText>
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    )
  }

  return renderInlineEditor({comment, onSave, onCancel, isSaving})
}

function NoComments({}: {}) {
  const tx = useTxString()
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <MessageSquare className="size-25 text-gray-200" size={48} />
      <SizableText size="md" className="font-sans">
        {tx('No comments here, yet!')}
      </SizableText>
    </div>
  )
}
