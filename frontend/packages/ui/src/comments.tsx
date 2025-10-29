import {
  AlertDialogDescription,
  AlertDialogTitle,
} from '@radix-ui/react-alert-dialog'
import {
  formattedDateShort,
  getCommentTargetId,
  HMComment,
  HMCommentGroup,
  HMDocument,
  HMExternalCommentGroup,
  hmId,
  HMMetadata,
  HMMetadataPayload,
  UnpackedHypermediaId,
  useCommentGroups,
  useCommentParents,
  useRouteLink,
  useUniversalAppContext,
} from '@shm/shared'
import {
  useBlockDiscussionsService,
  useCommentsService,
  useCommentsServiceContext,
  useDiscussionsService,
} from '@shm/shared/comments-service-provider'
import {ListDiscussionsResponse} from '@shm/shared/models/comments-service'
import {useResource} from '@shm/shared/models/entity'
import {useTxString} from '@shm/shared/translation'
import {useResourceUrl} from '@shm/shared/url'
import {Link, MessageSquare, Trash2} from 'lucide-react'
import {ReactNode, useContext, useEffect, useMemo, useState} from 'react'
import {toast} from 'sonner'
import {AccessoryBackButton, AccessoryContent} from './accessories'
import {Button} from './button'
import {copyTextToClipboard} from './copy-to-clipboard'
import {
  BlocksContent,
  docContentContext,
  DocContentProvider,
  getBlockNodeById,
} from './document-content'
import {HMIcon} from './hm-icon'
import {BlockQuote, ReplyArrow} from './icons'
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
  renderCommentContent,
  onBack,
  commentEditor,
  targetDomain,
  currentAccountId,
  onCommentDelete,
}: {
  targetId: UnpackedHypermediaId
  commentId?: string
  renderCommentContent?: (comment: HMComment) => ReactNode
  commentEditor?: ReactNode
  onStartDiscussion?: () => void
  onBack?: () => void
  targetDomain?: string
  currentAccountId?: string
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
}) {
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

  const commentFound = commentsService.data?.comments?.some(
    (c) => c.id === commentId,
  )

  if (commentsService.error) {
    return (
      <AccessoryContent>
        <AccessoryBackButton onClick={onBack} />
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
        <AccessoryBackButton onClick={onBack} />
        <div className="flex items-center justify-center">
          <Spinner />
        </div>
      </AccessoryContent>
    )
  }

  // If comment not found in the list, show a message
  if (!commentFound && commentsService.data) {
    return (
      <AccessoryContent>
        <AccessoryBackButton onClick={onBack} />
        <div className="flex flex-col items-center gap-2 p-4">
          <SizableText color="muted" size="sm">
            This comment is not available in the current document version
          </SizableText>
        </div>
      </AccessoryContent>
    )
  }

  return (
    <AccessoryContent>
      <AccessoryBackButton onClick={onBack} />
      {commentId && parentThread ? (
        parentThread.thread.length > 0 ? (
          <CommentGroup
            commentGroup={{
              id: commentId,
              comments: parentThread.thread,
              moreCommentsCount: 0,
              type: 'commentGroup',
            }}
            authors={commentsService.data?.authors}
            onCommentDelete={onCommentDelete}
            currentAccountId={currentAccountId}
            renderCommentContent={renderCommentContent}
            highlightLastComment
            targetDomain={targetDomain}
          />
        ) : (
          <EmptyDiscussions emptyReplies />
        )
      ) : null}
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
                renderCommentContent={renderCommentContent}
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
  renderCommentContent,
  commentEditor,
  onBack,
  targetDomain,
  currentAccountId,
  onCommentDelete,
}: {
  targetId: UnpackedHypermediaId
  commentId?: string
  renderCommentContent?: (comment: HMComment) => ReactNode
  commentEditor?: ReactNode
  onBack?: () => void
  targetDomain?: string
  currentAccountId?: string
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
}) {
  const discussionsService = useDiscussionsService({targetId, commentId})
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
    panelContent =
      discussionsService.data.discussions?.length > 0 ? (
        <>
          {discussionsService.data.discussions?.map((cg) => {
            return (
              <div key={cg.id} className={cn('border-border border-b')}>
                <CommentGroup
                  commentGroup={cg}
                  authors={discussionsService.data.authors}
                  renderCommentContent={renderCommentContent}
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
                  renderCommentContent={renderCommentContent}
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
    <AccessoryContent header={commentEditor}>
      {commentId ? <AccessoryBackButton onClick={onBack} /> : null}
      {panelContent}
    </AccessoryContent>
  )
}

export function BlockDiscussions({
  targetId,
  renderCommentContent,
  commentEditor,
  onBack,
  targetDomain,
  currentAccountId,
  onCommentDelete,
}: {
  targetId: UnpackedHypermediaId
  renderCommentContent?: (comment: HMComment) => ReactNode
  commentEditor?: ReactNode
  onBack?: () => void
  targetDomain?: string
  currentAccountId?: string
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
}) {
  const commentsService = useBlockDiscussionsService({targetId})
  const doc = useResource(targetId)
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
                renderCommentContent={renderCommentContent}
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
      <AccessoryBackButton onClick={onBack} />
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
  renderCommentContent,
  enableReplies = true,
  highlightLastComment = false,
  targetDomain,
  currentAccountId,
  onCommentDelete,
}: {
  commentGroup: HMCommentGroup | HMExternalCommentGroup
  authors?: ListDiscussionsResponse['authors']
  renderCommentContent?: (comment: HMComment) => ReactNode
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
            renderCommentContent={renderCommentContent}
            replyCount={
              isLastCommentInGroup ? commentGroup.moreCommentsCount : undefined
            }
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
  replyCount,
  isFirst = true,
  isLast = false,
  authorMetadata,
  authorId,
  renderCommentContent,
  enableReplies = true,
  defaultExpandReplies = false,
  highlight = false,
  onCommentDelete,
  currentAccountId,
  targetDomain,
  heading,
  externalTarget,
}: {
  comment: HMComment
  replyCount?: number
  isFirst?: boolean
  isLast?: boolean
  authorMetadata?: HMMetadata | null
  authorId?: string | null
  renderCommentContent?: (comment: HMComment) => ReactNode
  enableReplies?: boolean
  defaultExpandReplies?: boolean
  highlight?: boolean
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  targetDomain?: string
  currentAccountId?: string
  heading?: ReactNode
  externalTarget?: HMMetadataPayload
}) {
  const tx = useTxString()
  const universalContext = useUniversalAppContext()
  let renderContent = renderCommentContent
  if (!renderContent) {
    renderContent = (comment) => (
      <DocContentProvider
        entityComponents={
          universalContext.entityComponents || {
            Document: () => null,
            Inline: () => null,
            Query: () => null,
            Comment: () => null,
          }
        }
        onBlockCopy={() => {}}
        onBlockReply={() => {}}
        onBlockCommentClick={() => {}}
        onBlockCitationClick={() => {}}
        textUnit={14}
        layoutUnit={16}
        comment
        debug={false}
        collapsedBlocks={new Set()}
        setCollapsedBlocks={() => {}}
      >
        <BlocksContent
          hideCollapseButtons
          blocks={comment.content}
          parentBlockId={null}
        />
      </DocContentProvider>
    )
  }
  const [showReplies, setShowReplies] = useState(defaultExpandReplies)
  const commentsContext = useCommentsServiceContext()

  const authorHmId =
    comment.author || authorId ? hmId(authorId || comment.author) : null

  const authorLink = useRouteLink(
    authorHmId ? {key: 'profile', id: authorHmId} : null,
    {
      handler: 'onClick',
    },
  )

  const externalTargetLink = useRouteLink(
    externalTarget ? {key: 'document', id: externalTarget.id} : null,
    {
      handler: 'onClick',
    },
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
  return (
    <div
      className={cn(
        'group relative flex gap-1 rounded-lg p-2',
        highlight && 'bg-accent', // TODO: review color for dark theme
      )}
    >
      {heading ? null : (
        <div className="relative mt-0.5 flex min-w-5 flex-col items-center">
          {!isFirst ? (
            <div className="bg-border absolute top-[-40px] left-1/2 h-[40px] w-px" />
          ) : null}
          <div
            className={cn(
              'absolute top-0 left-0 z-2 size-5 rounded-full bg-transparent transition-all duration-200 ease-in-out',
              highlight
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
        {heading ? (
          <div className="inline">{heading}</div>
        ) : (
          <div className="group flex items-center justify-between gap-2 overflow-hidden pr-2">
            {heading ? null : (
              <div className="flex items-baseline gap-1 overflow-hidden">
                <a
                  className={cn(
                    'hover:bg-accent h-5 truncate rounded px-1 text-sm font-bold transition-colors',
                    authorLink ? 'cursor-pointer' : '',
                  )}
                  {...authorLink}
                >
                  {authorMetadata?.name || authorId?.slice(0, 10) || '...'}
                </a>
                {externalTarget ? (
                  <>
                    <span className="text-muted-foreground text-xs">on</span>
                    <button
                      {...externalTargetLink}
                      className="hover:bg-accent h-5 truncate rounded px-1 text-sm font-bold transition-colors"
                    >
                      {externalTarget.metadata?.name}
                    </button>
                  </>
                ) : null}
                <CommentDate comment={comment} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Tooltip content={tx('Copy Comment Link')}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground transition-opacity duration-200 ease-in-out group-hover:opacity-100 sm:opacity-0"
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
                  className="transition-opacity duration-200 ease-in-out group-hover:opacity-100 sm:opacity-0"
                  menuItems={options}
                />
              ) : null}
            </div>
          </div>
        )}

        <div>{renderContent(comment)}</div>
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
  size = 'md',
}: {
  comment: HMComment
  size?: 'sm' | 'md'
}) {
  const context = useContext(docContentContext)
  const universalContext = useUniversalAppContext()

  const content = (
    <BlocksContent
      hideCollapseButtons
      blocks={comment.content}
      parentBlockId={null}
    />
  )

  if (size != 'md') {
    return (
      <DocContentProvider
        onBlockCopy={context?.onBlockCopy ?? null}
        entityComponents={
          context?.entityComponents ||
          universalContext.entityComponents || {
            Document: () => null,
            Inline: () => null,
            Query: () => null,
            Comment: () => null,
          }
        }
        textUnit={12}
        layoutUnit={14}
        debug={context?.debug ?? false}
        collapsedBlocks={context?.collapsedBlocks ?? new Set()}
        setCollapsedBlocks={context?.setCollapsedBlocks ?? (() => {})}
      >
        {content}
      </DocContentProvider>
    )
  } else {
    return content
  }
}

function CommentDate({comment}: {comment: HMComment}) {
  const targetId = getCommentTargetId(comment)
  const link = useRouteLink(
    {
      key: 'document',
      id: targetId!,
      accessory: {
        key: 'discussions',
        openComment: comment.id,
      },
    },
    {
      handler: 'onClick',
    },
  )
  return (
    <a
      className="text-muted-foreground hover:text-muted-foreground truncate rounded text-xs underline"
      {...link}
    >
      {formattedDateShort(comment.createTime)}
    </a>
  )
}

export function QuotedDocBlock({
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
            <BlocksContent
              blocks={[blockContent]}
              parentBlockId={blockId}
              hideCollapseButtons
            />
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
