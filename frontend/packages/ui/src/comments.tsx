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
  createCommentUrl,
  formattedDateShort,
  getCommentTargetId,
  hmId,
  NavRoute,
  useCommentGroups,
  useCommentParents,
  useRouteLink,
} from '@shm/shared'

import {HMListDiscussionsOutput} from '@seed-hypermedia/client/hm-types'
import {
  useBlockDiscussionsService,
  useCommentReplyCount,
  useCommentsService,
  useCommentsServiceContext,
  useCommentVersions,
  useDeleteComment,
  useDiscussionsService,
  useHackyAuthorsSubscriptions,
  useUpdateComment,
} from '@shm/shared/comments-service-provider'
import {useIsCurrentUser, useResource} from '@shm/shared/models/entity'
import {getRoutePanel} from '@shm/shared/routes'
import {useTxString} from '@shm/shared/translation'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {Link, MessageSquare, Pencil, Trash2, X} from 'lucide-react'
import {memo, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {toast} from 'sonner'
import {SelectionContent} from './accessories'
import {BlockRangeSelectOptions, BlocksContent, BlocksContentProvider, getBlockNodeById} from './blocks-content'
import {Button} from './button'
import {Popover, PopoverContent, PopoverTrigger} from './components/popover'
import {copyTextToClipboard, copyUrlToClipboardWithFeedback} from './copy-to-clipboard'
import {HMIcon} from './hm-icon'
import {BlockQuote, ReplyArrow} from './icons'
import {AuthorNameLink, getContextualProfileRoute, InlineDescriptor, Timestamp} from './inline-descriptor'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
import {useAppDialog} from './universal-dialog'
import {cn} from './utils'

export function CommentDiscussions({
  targetId,
  isEntirelyHighlighted = false,
  commentId,
  commentEditor,
  targetDomain,
  selection,
}: {
  targetId: UnpackedHypermediaId
  commentId?: string
  commentEditor?: ReactNode
  onStartDiscussion?: () => void
  isEntirelyHighlighted?: boolean
  targetDomain?: string
  selection?: {
    blockId?: string
    blockRange?: BlockRange
  }
}) {
  const focusedCommentRef = useRef<HTMLDivElement>(null)
  const [showParents, setShowParents] = useState(false)
  const parentsRef = useRef<HTMLDivElement>(null)

  if (!commentId) return null

  // Fetch all comments for the document
  const commentsService = useCommentsService({targetId} as any)

  const parentThread = useCommentParents(commentsService.data?.comments, commentId)
  const commentGroupReplies = useCommentGroups(commentsService.data?.comments, commentId)

  // Subscribe to all authors in this discussion
  const allAuthorIds = useMemo(() => {
    const authors = new Set<string>()
    if (parentThread?.thread) {
      parentThread.thread.forEach((c) => {
        if (c.author) authors.add(c.author)
      })
    }
    if (commentGroupReplies.data) {
      commentGroupReplies.data.forEach((cg) => {
        cg.comments.forEach((c) => {
          if (c.author) authors.add(c.author)
        })
      })
    }
    return Array.from(authors)
  }, [parentThread?.thread, commentGroupReplies.data])

  useHackyAuthorsSubscriptions(allAuthorIds)

  const {showDeletedContent} = useCommentsServiceContext()

  const commentFound = commentsService.data?.comments?.some((c) => c.id === commentId)

  // On desktop, fetch version history for deleted comments so we can show their content
  const shouldFetchDeletedVersions = showDeletedContent && !commentFound && !!commentsService.data && !!commentId
  const deletedVersions = useCommentVersions(shouldFetchDeletedVersions ? commentId : null)

  // Find the actual focused comment
  const focusedComment = useMemo(() => {
    if (!commentsService.data?.comments) return null
    return commentsService.data.comments.find((c) => c.id === commentId)
  }, [commentsService.data?.comments, commentId])

  // Render parent thread after initial load and adjust scroll
  useLayoutEffect(() => {
    // Only run once when we have parent thread data and haven't shown parents yet
    if (!parentThread?.thread?.length || showParents) return

    // Delay to ensure focused comment is rendered first
    const timer = setTimeout(() => {
      setShowParents(true)
    }, 100)

    return () => clearTimeout(timer)
  }, [parentThread?.thread, showParents, commentId]) // Added commentId as dependency

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

  if (!commentFound && commentsService.data) {
    // On desktop, show the pre-deletion content if version history is available
    const deletedLastVersion = deletedVersions.data?.versions?.[0]
    if (showDeletedContent && deletedLastVersion) {
      return (
        <SelectionContent>
          <div className="p-2">
            <DeletedCommentPreview comment={deletedLastVersion} />
          </div>
        </SelectionContent>
      )
    }
    if (showDeletedContent && deletedVersions.isLoading) {
      return (
        <SelectionContent>
          <div className="flex items-center justify-center p-4">
            <Spinner />
          </div>
        </SelectionContent>
      )
    }
    return (
      <SelectionContent>
        <div className="flex flex-col items-center gap-2 p-4">
          <SizableText color="muted" size="sm">
            This comment could not be found. It may have been deleted.
          </SizableText>
        </div>
      </SelectionContent>
    )
  }

  // Check if there are actual parent comments (more than just the focused comment itself)
  const hasParents = parentThread?.thread && parentThread.thread.length > 1

  return (
    <SelectionContent>
      {/* Render parent thread above focused comment when ready */}
      {hasParents && showParents && (
        <div ref={parentsRef}>
          {parentThread.thread.slice(0, -1).map((comment, index, list) => (
            <div key={comment.id} className={cn('p-2', index != list.length - 1 && 'border-border border-b')}>
              <Comment
                comment={comment}
                authorId={comment.author}
                authorMetadata={commentsService.data?.authors?.[comment.author]?.metadata}
                targetDomain={targetDomain}
                isFirst={index === 0}
                isLast={false}
              />
            </div>
          ))}
        </div>
      )}

      {/* Render the focused comment */}
      {focusedComment && (
        <div ref={focusedCommentRef} className={cn('p-2')}>
          <Comment
            comment={focusedComment}
            authorId={focusedComment.author}
            authorMetadata={commentsService.data?.authors?.[focusedComment.author]?.metadata}
            targetDomain={targetDomain}
            isFirst={!(hasParents && showParents)}
            isLast={true}
            highlight
            selection={selection}
          />
        </div>
      )}

      <div className="relative py-4 max-h-1/2">
        <div
          className="absolute w-px bg-border"
          style={{
            height: isEntirelyHighlighted ? 40 : 56,
            top: isEntirelyHighlighted ? -16 : -32,
            left: 26,
          }}
        />
        <div className="px-2 pl-3 pr-4">{commentEditor}</div>
      </div>

      {commentGroupReplies.data?.length > 0
        ? commentGroupReplies.data.map((cg) => {
            return (
              <div key={cg.id} className={cn('p-2')}>
                <CommentGroup
                  key={cg.id}
                  commentGroup={cg}
                  authors={commentsService.data?.authors}
                  targetDomain={targetDomain}
                />
              </div>
            )
          })
        : null}
    </SelectionContent>
  )
}

export const Discussions = memo(function Discussions({
  targetId,
  commentId,
  targetDomain,
}: {
  targetId: UnpackedHypermediaId
  commentId?: string
  targetDomain?: string
}) {
  const discussionsService = useDiscussionsService({targetId, commentId})

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
      discussionsService.data.citingDiscussions.forEach((cg) => {
        cg.comments.forEach((c) => {
          if (c.author) authors.add(c.author)
        })
      })
    }
    return Array.from(authors)
  }, [discussionsService.data?.discussions, discussionsService.data?.citingDiscussions])

  useHackyAuthorsSubscriptions(allAuthorIds)

  let panelContent = null
  if (discussionsService.isLoading && !discussionsService.data) {
    panelContent = (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  } else if (discussionsService.error) {
    panelContent = (
      <div className="flex flex-col items-center gap-2 p-4">
        <SizableText color="muted" size="sm">
          Failed to load discussions
        </SizableText>
      </div>
    )
  } else if (discussionsService.data) {
    const totalCount =
      (discussionsService.data.discussions?.length ?? 0) + (discussionsService.data.citingDiscussions?.length ?? 0)
    panelContent =
      totalCount > 0 ? (
        <>
          {discussionsService.data.discussions?.map((cg) => {
            return (
              <div key={cg.id} className={cn('border-border border-b')}>
                <LazyCommentGroup>
                  <CommentGroup
                    commentGroup={cg}
                    authors={discussionsService.data.authors}
                    enableReplies
                    targetDomain={targetDomain}
                  />
                </LazyCommentGroup>
              </div>
            )
          })}
          {discussionsService.data.citingDiscussions?.map((cg) => {
            return (
              <div key={cg.id} className={cn('border-border border-b')}>
                <LazyCommentGroup>
                  <CommentGroup
                    commentGroup={cg}
                    authors={discussionsService.data.authors}
                    enableReplies
                    targetDomain={targetDomain}
                  />
                </LazyCommentGroup>
              </div>
            )
          })}
        </>
      ) : (
        <NoComments />
      )
  }

  return <SelectionContent>{panelContent}</SelectionContent>
})

export function BlockDiscussions({
  targetId,
  commentEditor,
  targetDomain,
}: {
  targetId: UnpackedHypermediaId
  commentEditor?: ReactNode
  targetDomain?: string
}) {
  const commentsService = useBlockDiscussionsService({targetId})
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
    quotedContent = <QuotedDocBlock docId={targetId} blockId={targetId.blockRef} doc={doc.data.document} />
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
                isFirst
                isLast
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
      <div className="pt-2 mt-2">{panelContent}</div>
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
function LazyCommentGroup({children}: {children: ReactNode}) {
  const ref = useRef<HTMLDivElement>(null)
  const [isNearViewport, setIsNearViewport] = useState(false)
  const heightRef = useRef(LAZY_COMMENT_PLACEHOLDER_HEIGHT)

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
          }
          setIsNearViewport(false)
        }
      },
      {rootMargin: '600px'},
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} style={isNearViewport ? undefined : {minHeight: heightRef.current}}>
      {isNearViewport ? children : null}
    </div>
  )
}

export const CommentGroup = memo(function CommentGroup({
  commentGroup,
  authors,
  enableReplies = true,
  highlightLastComment = false,
  targetDomain,
}: {
  commentGroup: HMCommentGroup | HMExternalCommentGroup
  authors?: HMListDiscussionsOutput['authors']
  enableReplies?: boolean
  highlightLastComment?: boolean
  targetDomain?: string
}) {
  const lastComment = commentGroup.comments.at(-1)
  const firstComment = commentGroup.comments[0]

  return (
    <div className="relative flex flex-col gap-2 p-2">
      {/* {commentGroup.comments.length > 1 && (
        <div
          className="absolute w-px bg-border"
          style={{
            height: `calc(100% - ${avatarSize * 2}px)`,
            top: avatarSize + avatarSize / 2 - 1,
            left: avatarSize + avatarSize / 2 - 1,
          }}
        />
      )} */}

      {commentGroup.comments.map((comment) => {
        const isLastCommentInGroup = !!lastComment && comment === lastComment
        const isFirstCommentInGroup = !!lastComment && comment === firstComment
        return (
          <Comment
            isLast={isLastCommentInGroup}
            isFirst={isFirstCommentInGroup}
            externalTarget={
              isFirstCommentInGroup && commentGroup.type === 'externalCommentGroup' ? commentGroup.target : undefined
            }
            key={comment.id}
            comment={comment}
            authorMetadata={comment.author ? authors?.[comment.author]?.metadata : null}
            authorId={comment.author}
            enableReplies={enableReplies}
            highlight={highlightLastComment && isLastCommentInGroup}
            targetDomain={targetDomain}
          />
        )
      })}
    </div>
  )
})

export const Comment = memo(function Comment({
  comment,
  isFirst = true,
  isLast = false,
  authorMetadata,
  authorId,
  enableReplies = true,
  defaultExpandReplies = false,
  highlight = false,
  targetDomain,
  heading,
  externalTarget,
  selection,
}: {
  comment: HMComment
  isFirst?: boolean
  isLast?: boolean
  authorMetadata?: HMMetadata | null
  authorId?: string | null
  enableReplies?: boolean
  defaultExpandReplies?: boolean
  highlight?: boolean
  targetDomain?: string
  heading?: ReactNode
  externalTarget?: HMMetadataPayload
  selection?: {
    blockId?: string
    blockRange?: BlockRange
  }
}) {
  const tx = useTxString()
  const [showReplies, setShowReplies] = useState(defaultExpandReplies)
  const [isEditing, setIsEditing] = useState(false)
  const [viewingVersion, setViewingVersion] = useState<HMComment | null>(null)
  const commentsContext = useCommentsServiceContext()
  const {data: replyCount} = useCommentReplyCount({id: comment.id})
  const isAuthor = useIsCurrentUser(comment.author)
  const deleteCommentMutation = useDeleteComment()
  const updateCommentMutation = useUpdateComment()
  const deleteCommentDialog = useDeleteCommentDialog()
  const currentRoute = useNavRoute()

  const authorHmId = comment.author || authorId ? hmId(authorId || comment.author) : null
  const docId = getCommentTargetId(comment)
  const authorLink = useRouteLink(getContextualProfileRoute(currentRoute, authorHmId, docId?.uid))

  const externalTargetLink = useRouteLink(externalTarget ? {key: 'document', id: externalTarget.id} : null)

  useEffect(() => {
    if (defaultExpandReplies !== showReplies) {
      setShowReplies(defaultExpandReplies)
    }
  }, [defaultExpandReplies])
  const navigate = useNavigate('replace')
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
                  if (!isFocusedComment) return
                  if (currentRoute.key === 'comments' && currentRoute.openComment) {
                    navigate({...currentRoute, openComment: undefined})
                  } else if ('panel' in currentRoute && routePanel?.key === 'comments' && routePanel.openComment) {
                    navigate({...currentRoute, panel: {...routePanel, openComment: undefined}} as NavRoute)
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
      <div className={cn('group relative flex gap-1 rounded-lg p-2', isEntirelyHighlighted && 'bg-accent')}>
        {heading ? null : (
          <div className="relative mt-0.5 flex min-w-5 flex-col items-center">
            {isFirst ? null : <div className="bg-border absolute top-[-40px] left-1/2 h-[40px] w-px" />}
            <div
              className={cn(
                'absolute top-0 left-0 z-2 size-5 rounded-full bg-transparent transition-all duration-200 ease-in-out',
                isEntirelyHighlighted
                  ? 'outline-secondary hover:outline-secondary'
                  : 'dark:outline-background dark:hover:outline-background outline-white hover:outline-white',
              )}
              {...authorLink}
            />
            {authorHmId && (
              <div className="size-5">
                <HMIcon id={authorHmId} name={authorMetadata?.name} icon={authorMetadata?.icon} size={20} />
              </div>
            )}
            {!isLast || (highlight && selection?.blockId) ? <div className="w-px h-full bg-border" /> : null}
          </div>
        )}

        <div className="flex flex-col flex-1 w-full gap-1">
          <div className="flex items-center justify-between gap-2 pr-2 overflow-hidden group">
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
                      className="h-5 px-1 text-sm font-bold truncate transition-colors rounded hover:bg-accent text-foreground"
                    >
                      {externalTarget.metadata?.name}
                    </button>
                  </>
                ) : null}
                <CommentDate comment={comment} />
                {JSON.stringify(comment.createTime) !== JSON.stringify(comment.updateTime) ? (
                  <EditedIndicator commentId={comment.id} onSelectVersion={setViewingVersion} />
                ) : null}
              </InlineDescriptor>
            )}
            <div className="flex items-center gap-2">
              {!isEditing && (
                <Tooltip content={tx('Copy Comment Link')}>
                  <Button
                    // size="icon"
                    size="xs"
                    variant="ghost"
                    className="transition-opacity duration-200 ease-in-out text-muted-foreground hover-hover:opacity-0 hover-hover:group-hover:opacity-100"
                    onClick={() => {
                      if (docId) {
                        const routeLatest =
                          currentRoute.key === 'document' ||
                          currentRoute.key === 'comments' ||
                          currentRoute.key === 'activity'
                            ? currentRoute.id.latest
                            : undefined
                        const url = createCommentUrl({
                          docId,
                          commentId: comment.id,
                          commentVersion: comment.version,
                          siteUrl: targetDomain,
                          latest: routeLatest,
                        })
                        copyTextToClipboard(url)
                        toast.success('Copied Comment URL')
                      }
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
                  className="transition-opacity duration-200 ease-in-out hover-hover:opacity-0 hover-hover:group-hover:opacity-100"
                  menuItems={options}
                />
              ) : null}
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
          ) : viewingVersion ? (
            <VersionPreview version={viewingVersion} onDismiss={() => setViewingVersion(null)} />
          ) : (
            <CommentContent comment={comment} selection={selection} />
          )}

          {!isEntirelyHighlighted && !isEditing && (
            <div className={cn('-ml-1 flex items-center gap-2 py-1', !heading && 'mb-2')}>
              {enableReplies || commentsContext.onReplyClick ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className={cn(
                    'text-muted-foreground hover:text-muted-foreground active:text-muted-foreground',
                    'plausible-event-name=Reply+Click',
                  )}
                  onClick={() => {
                    if (commentsContext.onReplyClick) {
                      commentsContext.onReplyClick(comment)
                    } else if (replyCount && commentsContext.onReplyCountClick) {
                      commentsContext.onReplyCountClick(comment)
                    }
                  }}
                >
                  <ReplyArrow className="size-3" />
                  {tx('Reply')}
                  {replyCount && replyCount > 0 ? ` (${replyCount})` : ''}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </>
  )
})

export function CommentContent({
  comment,
  size,
  zoomBlockRef,
  selection,
  allowHighlight = true,
  openOnClick = true,
  onBlockSelect: onBlockSelectProp,
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
}) {
  const navigate = useNavigate()
  const replaceNavigate = useNavigate('replace')
  const currentRoute = useNavRoute()
  const targetHomeEntity = useResource(hmId(comment.targetAccount))
  const targetHomeDoc = targetHomeEntity.data?.type === 'document' ? targetHomeEntity.data.document : undefined
  const targetDocId = getCommentTargetId(comment)
  const siteUrl = targetHomeDoc?.metadata?.siteUrl as string | undefined
  const textUnit = size === 'sm' ? 12 : 14
  const layoutUnit = size === 'sm' ? 14 : 16
  const onBlockSelect = (blockId: string, opts?: BlockRangeSelectOptions): boolean => {
    let blockRange: BlockRange | null = null
    if (opts) {
      const {copyToClipboard, ...br} = opts
      blockRange = br
    }
    if (opts?.copyToClipboard) {
      if (targetDocId) {
        const routeLatest =
          currentRoute.key === 'document' || currentRoute.key === 'comments' || currentRoute.key === 'activity'
            ? currentRoute.id.latest
            : undefined
        const fullUrl = createCommentUrl({
          docId: targetDocId,
          commentId: comment.id,
          siteUrl,
          latest: routeLatest,
          blockRef: blockId,
          blockRange,
        })
        copyUrlToClipboardWithFeedback(fullUrl, 'Comment Block')
      }
      return true
    } else {
      if (!openOnClick) return false
      const targetId = getCommentTargetId(comment)
      if (!targetId) {
        toast.error('Failed to get target comment target ID')
        return false
      }
      if (onBlockSelectProp) {
        onBlockSelectProp(blockId, blockRange)
      } else {
        const commentEntityId = commentIdToHmId(comment.id)
        // Detect comment main view: route is document with the comment entity ID
        const isCommentMainView =
          currentRoute.key === 'document' &&
          currentRoute.id.uid === commentEntityId.uid &&
          currentRoute.id.path?.join('/') === commentEntityId.path?.join('/')
        if (isCommentMainView) {
          // Stay in place, highlight block, update URL fragment
          replaceNavigate({
            key: 'document',
            id: {
              ...commentEntityId,
              blockRef: blockId || null,
              blockRange: blockRange || null,
            },
          })
        } else {
          const idWithBlock = {
            ...targetId,
            blockRef: blockId || null,
            blockRange: blockRange || null,
          }
          const useFullPageNavigation = currentRoute.key === 'activity' || currentRoute.key === 'comments'
          navigate(
            useFullPageNavigation
              ? {
                  key: 'comments',
                  id: idWithBlock,
                  openComment: comment.id,
                  blockId: blockId || undefined,
                  blockRange,
                }
              : {
                  key: 'document',
                  id: targetId,
                  panel: {
                    key: 'comments',
                    id: idWithBlock,
                    openComment: comment.id,
                    blockId: blockId || undefined,
                    blockRange,
                  },
                },
          )
        }
      }
      return true
    }
  }
  const focusedId = {
    ...commentIdToHmId(comment.id),
    blockRef: selection?.blockId || null,
    blockRange: selection?.blockRange || null,
  }
  const zoomedBlock = zoomBlockRef ? getBlockNodeById(comment.content, zoomBlockRef) : null
  const zoomedContent = zoomedBlock ? [zoomedBlock] : comment.content
  return (
    <BlocksContentProvider
      resourceId={focusedId}
      commentStyle
      textUnit={textUnit}
      layoutUnit={layoutUnit}
      onBlockSelect={onBlockSelect}
      openOnClick={openOnClick}
    >
      <BlocksContent hideCollapseButtons allowHighlight={allowHighlight} blocks={zoomedContent} />
    </BlocksContentProvider>
  )
}

function CommentDate({comment}: {comment: HMComment}) {
  const targetId = getCommentTargetId(comment)
  const currentRoute = useNavRoute()
  const useFullPageNavigation = currentRoute.key === 'activity' || currentRoute.key === 'comments'
  const commentEntityId = commentIdToHmId(comment.id)
  const destRoute: NavRoute = useFullPageNavigation
    ? {key: 'document', id: commentEntityId}
    : {
        key: 'document',
        id: targetId!,
        panel: {key: 'comments', id: targetId!, openComment: comment.id},
      }
  return <Timestamp time={comment.createTime} route={destRoute} />
}

export function QuotedDocBlock({docId, blockId, doc}: {docId: UnpackedHypermediaId; blockId: string; doc: HMDocument}) {
  const blockContent = useMemo(() => {
    if (!doc.content) return null
    return getBlockNodeById(doc.content, blockId)
  }, [doc.content, blockId])

  return (
    <div className="rounded-lg bg-brand-50 dark:bg-brand-950">
      <div className="relative flex gap-1 p-2 transition-all duration-200 ease-in-out rounded-lg">
        <div className="flex-shrink-0 py-1.5">
          <BlockQuote size={23} />
        </div>
        <div className="flex-1">
          {blockContent && (
            <BlocksContentProvider resourceId={{...docId, blockRef: blockId}}>
              <BlocksContent
                blocks={[blockContent]}
                // parentBlockId={blockId}
                hideCollapseButtons
              />
            </BlocksContentProvider>
          )}
        </div>
      </div>
    </div>
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
      <PopoverContent side="bottom" align="start" className="p-0 w-72">
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

/** Popover list of comment versions. Clicking a past version triggers onSelect. */
function CommentVersionList({commentId, onSelect}: {commentId: string; onSelect: (version: HMComment) => void}) {
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
      <div className="px-3 py-2 border-b border-border">
        <SizableText size="sm" className="font-semibold">
          Edited {editCount} {editCount === 1 ? 'time' : 'times'}
        </SizableText>
      </div>
      <div className="overflow-y-auto max-h-80">
        {data.versions.map((version, index) => {
          const versionNumber = data.versions.length - index
          const isCurrent = index === 0
          if (isCurrent) {
            return (
              <div
                key={version.version || index}
                className="flex items-center justify-between w-full px-3 py-2 border-b border-border last:border-b-0"
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
              </div>
            )
          }
          return (
            <button
              key={version.version || index}
              className="flex items-center justify-between w-full px-3 py-2 text-left border-b hover:bg-accent border-border last:border-b-0"
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
    <div className="border border-red-300 rounded-md bg-red-50 dark:border-red-700 dark:bg-red-950">
      <div className="flex items-center px-3 py-1.5">
        <SizableText size="xs" className="text-red-800 dark:text-red-200">
          This comment was deleted
          {comment.updateTime ? ` · ${formattedDateShort(comment.updateTime)}` : ''}
        </SizableText>
      </div>
      <div className="px-1 pb-2">
        <CommentContent comment={comment} size="sm" openOnClick={false} />
      </div>
    </div>
  )
}

/** Yellow inline banner showing a previous version of the comment in place of the current content. */
function VersionPreview({version, onDismiss}: {version: HMComment; onDismiss: () => void}) {
  return (
    <div className="border border-yellow-300 rounded-md bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950">
      <div className="flex items-center justify-between px-3 py-1.5">
        <SizableText size="xs" className="text-yellow-800 dark:text-yellow-200">
          Viewing previous version {version.updateTime ? `\u00b7 ${formattedDateShort(version.updateTime)}` : ''}
        </SizableText>
        <Button
          variant="ghost"
          size="icon"
          className="text-yellow-800 size-6 hover:bg-yellow-200 dark:text-yellow-200 dark:hover:bg-yellow-900"
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="px-1 pb-2">
        <CommentContent comment={version} size="sm" openOnClick={false} />
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
        <SizableText size="sm" color="muted">
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
      <MessageSquare className="text-gray-200 size-25" size={48} />
      <SizableText size="md">{tx('No comments here, yet!')}</SizableText>
    </div>
  )
}
