import {
  AlertDialogDescription,
  AlertDialogTitle,
} from '@radix-ui/react-alert-dialog'
import {
  BlockRange,
  commentIdToHmId,
  getCommentTargetId,
  HMComment,
  HMCommentGroup,
  HMDocument,
  HMExternalCommentGroup,
  hmId,
  HMMetadata,
  HMMetadataPayload,
  NavRoute,
  UnpackedHypermediaId,
  useCommentGroups,
  useCommentParents,
  useOpenRoute,
  useRouteLink,
} from '@shm/shared'

import {
  useBlockDiscussionsService,
  useCommentReplyCount,
  useCommentsService,
  useCommentsServiceContext,
  useDiscussionsService,
  useHackyAuthorsSubscriptions,
} from '@shm/shared/comments-service-provider'
import {ListDiscussionsResponse} from '@shm/shared/models/comments-service'
import {useResource} from '@shm/shared/models/entity'
import {useTxString} from '@shm/shared/translation'
import {useResourceUrl} from '@shm/shared/url'
import {Link, MessageSquare, Trash2} from 'lucide-react'
import {
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {toast} from 'sonner'
import {AccessoryContent} from './accessories'
import {
  BlockRangeSelectOptions,
  BlocksContent,
  BlocksContentProvider,
  getBlockNodeById,
} from './blocks-content'
import {Button} from './button'
import {
  copyTextToClipboard,
  copyUrlToClipboardWithFeedback,
} from './copy-to-clipboard'
import {HMIcon} from './hm-icon'
import {BlockQuote, ReplyArrow} from './icons'
import {AuthorNameLink, InlineDescriptor, Timestamp} from './inline-descriptor'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
import {useAppDialog} from './universal-dialog'
import {cn} from './utils'

const avatarSize = 18

export function CommentDiscussions({
  targetId,
  commentId,
  commentEditor,
  targetDomain,
  currentAccountId,
  onCommentDelete,
  selection,
}: {
  targetId: UnpackedHypermediaId
  commentId?: string
  commentEditor?: ReactNode
  onStartDiscussion?: () => void
  targetDomain?: string
  currentAccountId?: string
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  selection?: {
    blockId?: string
    blockRange?: BlockRange
  }
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const focusedCommentRef = useRef<HTMLDivElement>(null)
  const [showParents, setShowParents] = useState(false)
  const [bottomPadding, setBottomPadding] = useState<number>(400)
  const parentsRef = useRef<HTMLDivElement>(null)

  // Reset scroll and parent visibility when commentId changes
  useEffect(() => {
    if (!commentId) return

    // Reset state when switching to a different comment
    setShowParents(false)

    // Reset scroll position to top
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector(
        '[data-slot="scroll-area-viewport"]',
      ) as HTMLElement
      if (viewport) {
        viewport.scrollTop = 0
      }
    }
  }, [commentId])

  if (!commentId) return null

  // Fetch all comments for the document
  const commentsService = useCommentsService({targetId} as any)

  const parentThread = useCommentParents(
    commentsService.data?.comments,
    commentId,
  )
  const commentGroupReplies = useCommentGroups(
    commentsService.data?.comments,
    commentId,
  )

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

  const commentFound = commentsService.data?.comments?.some(
    (c) => c.id === commentId,
  )

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

  // Adjust scroll position when parents are shown
  useLayoutEffect(() => {
    if (!showParents || !parentsRef.current || !scrollRef.current) return

    // Measure parent height and adjust scroll
    const parentHeight = parentsRef.current.offsetHeight
    const viewport = scrollRef.current.querySelector(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLElement

    if (viewport) {
      // Scroll down by parent height to keep focused comment in view
      viewport.scrollTop = parentHeight + 8
    }
  }, [showParents, commentId]) // Added commentId to re-run on comment change

  // Calculate bottom padding based on viewport height
  useLayoutEffect(() => {
    if (!scrollRef.current) return

    const calculatePadding = () => {
      const viewport = scrollRef.current?.querySelector(
        '[data-slot="scroll-area-viewport"]',
      ) as HTMLElement
      if (viewport) {
        // Get viewport height and calculate padding
        // We want enough padding so the focused comment can be scrolled to the top
        const viewportHeight = viewport.clientHeight
        // Add some extra padding to ensure smooth scrolling
        const padding = Math.max(viewportHeight * 0.75, 300)
        setBottomPadding(padding)
      }
    }

    // Calculate initially
    calculatePadding()

    // Recalculate on resize
    const resizeObserver = new ResizeObserver(calculatePadding)
    const viewport = scrollRef.current.querySelector(
      '[data-slot="scroll-area-viewport"]',
    ) as HTMLElement
    if (viewport) {
      resizeObserver.observe(viewport)
    }

    return () => resizeObserver.disconnect()
  }, [scrollRef.current])

  if (commentsService.error) {
    return (
      <AccessoryContent>
        <div className="flex flex-col items-center gap-2 p-4">
          <SizableText color="muted" size="sm">
            Failed to load comment thread
          </SizableText>
        </div>
      </AccessoryContent>
    )
  }

  if (commentsService.isLoading && !commentsService.data) {
    return (
      <AccessoryContent>
        <div className="flex items-center justify-center p-4">
          <Spinner />
        </div>
      </AccessoryContent>
    )
  }

  // If comment not found in the list, show a message
  if (!commentFound && commentsService.data) {
    return (
      <AccessoryContent>
        <div className="flex flex-col items-center gap-2 p-4">
          <SizableText color="muted" size="sm">
            This comment is not available in the current document version
          </SizableText>
        </div>
      </AccessoryContent>
    )
  }

  // Check if there are actual parent comments (more than just the focused comment itself)
  const hasParents = parentThread?.thread && parentThread.thread.length > 1

  return (
    <AccessoryContent scrollRef={scrollRef} bottomPadding={bottomPadding}>
      {/* Render parent thread above focused comment when ready */}
      {hasParents && showParents && (
        <div ref={parentsRef}>
          {parentThread.thread.slice(0, -1).map((comment, index, list) => (
            <div
              key={comment.id}
              className={cn(
                'p-2',
                index != list.length - 1 && 'border-border border-b',
              )}
            >
              <Comment
                comment={comment}
                authorId={comment.author}
                authorMetadata={
                  commentsService.data?.authors?.[comment.author]?.metadata
                }
                targetDomain={targetDomain}
                currentAccountId={currentAccountId}
                onCommentDelete={onCommentDelete}
                isFirst={index === 0}
                isLast={false}
              />
            </div>
          ))}
        </div>
      )}

      {/* Render the focused comment */}
      {focusedComment && (
        <div
          ref={focusedCommentRef}
          className={cn('border-border border-b p-2')}
        >
          <Comment
            comment={focusedComment}
            authorId={focusedComment.author}
            authorMetadata={
              commentsService.data?.authors?.[focusedComment.author]?.metadata
            }
            targetDomain={targetDomain}
            currentAccountId={currentAccountId}
            onCommentDelete={onCommentDelete}
            isFirst={!(hasParents && showParents)}
            isLast={true}
            selection={selection}
          />
        </div>
      )}

      <div className="border-border relative max-h-1/2 border-b py-4">
        <div
          className="bg-border absolute w-px"
          style={{
            height: 40,
            top: -16,
            left: avatarSize + 4,
          }}
        />
        <div className="px-2 pr-4">{commentEditor}</div>
      </div>

      {commentGroupReplies.data?.length > 0 ? (
        commentGroupReplies.data.map((cg) => {
          return (
            <div key={cg.id} className={cn('border-border border-b p-2')}>
              <CommentGroup
                key={cg.id}
                commentGroup={cg}
                authors={commentsService.data?.authors}
                onCommentDelete={onCommentDelete}
                targetDomain={targetDomain}
                currentAccountId={currentAccountId}
              />
            </div>
          )
        })
      ) : (
        <EmptyDiscussions emptyReplies />
      )}
    </AccessoryContent>
  )
}

export function Discussions({
  targetId,
  commentId,
  commentEditor,
  targetDomain,
  currentAccountId,
  onCommentDelete,
}: {
  targetId: UnpackedHypermediaId
  commentId?: string
  commentEditor?: ReactNode
  targetDomain?: string
  currentAccountId?: string
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
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
  }, [
    discussionsService.data?.discussions,
    discussionsService.data?.citingDiscussions,
  ])

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
      (discussionsService.data.discussions?.length ?? 0) +
      (discussionsService.data.citingDiscussions?.length ?? 0)
    panelContent =
      totalCount > 0 ? (
        <>
          {discussionsService.data.discussions?.map((cg) => {
            return (
              <div key={cg.id} className={cn('border-border border-b')}>
                <CommentGroup
                  commentGroup={cg}
                  authors={discussionsService.data.authors}
                  enableReplies
                  targetDomain={targetDomain}
                  currentAccountId={currentAccountId}
                  onCommentDelete={onCommentDelete}
                />
              </div>
            )
          })}
          {discussionsService.data.citingDiscussions?.map((cg) => {
            return (
              <div key={cg.id} className={cn('border-border border-b')}>
                <CommentGroup
                  commentGroup={cg}
                  authors={discussionsService.data.authors}
                  enableReplies
                  targetDomain={targetDomain}
                  currentAccountId={currentAccountId}
                  onCommentDelete={onCommentDelete}
                />
              </div>
            )
          })}
        </>
      ) : (
        <EmptyDiscussions />
      )
  }

  return (
    <AccessoryContent header={commentEditor}>{panelContent}</AccessoryContent>
  )
}

export function BlockDiscussions({
  targetId,
  commentEditor,
  targetDomain,
  currentAccountId,
  onCommentDelete,
}: {
  targetId: UnpackedHypermediaId
  commentEditor?: ReactNode
  targetDomain?: string
  currentAccountId?: string
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
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
    quotedContent = (
      <QuotedDocBlock
        docId={targetId}
        blockId={targetId.blockRef}
        doc={doc.data.document}
      />
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
  } else if (
    commentsService.data &&
    commentsService.data.comments &&
    commentsService.data.comments.length
  ) {
    panelContent = (
      <>
        {commentsService.data.comments.map((comment) => {
          return (
            <div key={comment.id} className={cn('border-border border-b p-2')}>
              <Comment
                isFirst
                isLast
                key={comment.id}
                comment={comment}
                authorId={comment.author}
                authorMetadata={
                  commentsService.data.authors[comment.author]?.metadata
                }
                targetDomain={targetDomain}
                currentAccountId={currentAccountId}
                onCommentDelete={onCommentDelete}
              />
            </div>
          )
        })}
      </>
    )
  }

  return (
    <AccessoryContent>
      {quotedContent}
      <div className="px-2 pr-4">{commentEditor}</div>
      <div className="border-border mt-2 border-t pt-2">{panelContent}</div>
    </AccessoryContent>
  )
}

// this is a LINEARIZED set of comments, where one comment is directly replying to another. the commentGroup.moreCommentsCount should be the number of replies to the last comment in the group.
export function CommentGroup({
  commentGroup,
  authors,
  enableReplies = true,
  highlightLastComment = false,
  targetDomain,
  currentAccountId,
  onCommentDelete,
}: {
  commentGroup: HMCommentGroup | HMExternalCommentGroup
  authors?: ListDiscussionsResponse['authors']
  enableReplies?: boolean
  highlightLastComment?: boolean
  currentAccountId?: string
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
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
              isFirstCommentInGroup &&
              commentGroup.type === 'externalCommentGroup'
                ? commentGroup.target
                : undefined
            }
            key={comment.id}
            comment={comment}
            authorMetadata={
              comment.author ? authors?.[comment.author]?.metadata : null
            }
            authorId={comment.author}
            enableReplies={enableReplies}
            highlight={highlightLastComment && isLastCommentInGroup}
            currentAccountId={currentAccountId}
            onCommentDelete={onCommentDelete}
            targetDomain={targetDomain}
          />
        )
      })}
    </div>
  )
}

export function Comment({
  comment,
  isFirst = true,
  isLast = false,
  authorMetadata,
  authorId,
  enableReplies = true,
  defaultExpandReplies = false,
  highlight = false,
  onCommentDelete,
  currentAccountId,
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
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  targetDomain?: string
  currentAccountId?: string
  heading?: ReactNode
  externalTarget?: HMMetadataPayload
  selection?: {
    blockId?: string
    blockRange?: BlockRange
  }
}) {
  const tx = useTxString()
  const [showReplies, setShowReplies] = useState(defaultExpandReplies)
  const commentsContext = useCommentsServiceContext()
  const {data: replyCount} = useCommentReplyCount({id: comment.id})

  const authorHmId =
    comment.author || authorId ? hmId(authorId || comment.author) : null

  const authorLink = useRouteLink(
    authorHmId ? {key: 'profile', id: authorHmId} : null,
  )

  const externalTargetLink = useRouteLink(
    externalTarget ? {key: 'document', id: externalTarget.id} : null,
  )

  useEffect(() => {
    if (defaultExpandReplies !== showReplies) {
      setShowReplies(defaultExpandReplies)
    }
  }, [defaultExpandReplies])
  const getUrl = useResourceUrl(targetDomain)
  const options: MenuItemType[] = []
  if (onCommentDelete) {
    options.push({
      icon: <Trash2 className="size-4" />,
      label: 'Delete',
      onClick: () => {
        onCommentDelete(comment.id, currentAccountId)
      },
      key: 'delete',
    })
  }
  const isEntirelyHighlighted = highlight && !selection
  return (
    <div
      className={cn(
        'group relative flex gap-1 rounded-lg p-2',
        isEntirelyHighlighted && 'bg-accent', // TODO: review color for dark theme
      )}
    >
      {heading ? null : (
        <div className="relative mt-0.5 flex min-w-5 flex-col items-center">
          {isFirst ? null : (
            <div className="bg-border absolute top-[-40px] left-1/2 h-[40px] w-px" />
          )}
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
              <HMIcon
                id={authorHmId}
                name={authorMetadata?.name}
                icon={authorMetadata?.icon}
                size={20}
              />
            </div>
          )}
          {!isLast ? <div className="bg-border h-full w-px" /> : null}
        </div>
      )}

      <div className="flex w-full flex-1 flex-col gap-1">
        <div className="group flex items-center justify-between gap-2 overflow-hidden pr-2">
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
            </InlineDescriptor>
          )}
          <div className="flex items-center gap-2">
            <Tooltip content={tx('Copy Comment Link')}>
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground hover-hover:opacity-0 hover-hover:group-hover:opacity-100 transition-opacity duration-200 ease-in-out"
                onClick={() => {
                  const url = getUrl(hmId(comment.id))
                  copyTextToClipboard(url)
                  toast.success('Copied Comment URL')
                }}
              >
                <Link className="size-3" />
              </Button>
            </Tooltip>
            {currentAccountId == comment.author ? (
              <OptionsDropdown
                side="bottom"
                align="end"
                className="hover-hover:opacity-0 hover-hover:group-hover:opacity-100 transition-opacity duration-200 ease-in-out"
                menuItems={options}
              />
            ) : null}
          </div>
        </div>

        <CommentContent comment={comment} selection={selection} />

        {!highlight && (
          <div
            className={cn(
              '-ml-1 flex items-center gap-2 py-1',
              !heading && 'mb-2',
            )}
          >
            {enableReplies || commentsContext.onReplyClick ? (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:text-muted-foreground active:text-muted-foreground"
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
  )
}

export function CommentContent({
  comment,
  size,
  selection,
  allowHighlight = true,
}: {
  comment: HMComment
  size?: 'sm' | 'md'
  selection?: {
    blockId?: string
    blockRange?: BlockRange
  }
  allowHighlight?: boolean
}) {
  const openRoute = useOpenRoute()
  const targetHomeEntity = useResource(hmId(comment.targetAccount))
  const targetHomeDoc =
    targetHomeEntity.data?.type === 'document'
      ? targetHomeEntity.data.document
      : undefined
  const getUrl = useResourceUrl(targetHomeDoc?.metadata?.siteUrl)
  const textUnit = size === 'sm' ? 12 : 14
  const layoutUnit = size === 'sm' ? 14 : 16
  const onBlockSelect = (blockId: string, opts?: BlockRangeSelectOptions) => {
    let blockRange: BlockRange | null = null
    if (opts) {
      const {copyToClipboard, ...br} = opts
      blockRange = br
    }
    if (opts?.copyToClipboard) {
      const fullUrl = getUrl({
        ...commentIdToHmId(comment.id),
        blockRef: blockId,
        blockRange,
      })
      copyUrlToClipboardWithFeedback(fullUrl, 'Comment Block')
    } else {
      const targetId = getCommentTargetId(comment)
      if (!targetId) {
        toast.error('Failed to get target comment target ID')
        return
      }
      openRoute({
        key: 'document',
        id: targetId,
        accessory: {
          key: 'discussions',
          openComment: comment.id,
          blockId,
          blockRange,
        },
      })
    }
  }
  const focusedId = {
    ...commentIdToHmId(comment.id),
    blockRef: selection?.blockId || null,
    blockRange: selection?.blockRange || null,
  }
  return (
    <BlocksContentProvider
      resourceId={focusedId}
      commentStyle
      textUnit={textUnit}
      layoutUnit={layoutUnit}
      onBlockSelect={onBlockSelect}
    >
      <BlocksContent
        hideCollapseButtons
        allowHighlight={allowHighlight}
        blocks={comment.content}
      />
    </BlocksContentProvider>
  )
}

function CommentDate({comment}: {comment: HMComment}) {
  const targetId = getCommentTargetId(comment)
  const destRoute: NavRoute = {
    key: 'document',
    id: targetId!,
    accessory: {
      key: 'discussions',
      openComment: comment.id,
    },
  }
  return <Timestamp time={comment.createTime} route={destRoute} />
}

export function QuotedDocBlock({
  docId,
  blockId,
  doc,
}: {
  docId: UnpackedHypermediaId
  blockId: string
  doc: HMDocument
}) {
  const blockContent = useMemo(() => {
    if (!doc.content) return null
    return getBlockNodeById(doc.content, blockId)
  }, [doc.content, blockId])

  return (
    <div className="bg-brand-50 dark:bg-brand-950 rounded-lg">
      <div className="relative flex gap-1 rounded-lg p-2 transition-all duration-200 ease-in-out">
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

function DeleteCommentDialog({
  input,
  onClose,
}: {
  input: {onConfirm: () => void}
  onClose: () => void
}) {
  return (
    <>
      <AlertDialogTitle className="text-xl font-bold">
        Really Delete?
      </AlertDialogTitle>
      <AlertDialogDescription>
        You will publicly delete this comment, although other peers may have
        already archived it.
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

export function EmptyDiscussions({
  emptyReplies = false,
}: {
  emptyReplies?: boolean
}) {
  const tx = useTxString()
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <MessageSquare className="size-25 text-gray-200" size={48} />
      <SizableText size="md">
        {tx(emptyReplies ? 'Be the first on replying' : 'No discussions')}
      </SizableText>
    </div>
  )
}
