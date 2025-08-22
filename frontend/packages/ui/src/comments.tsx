import {
  AlertDialogDescription,
  AlertDialogTitle,
} from '@radix-ui/react-alert-dialog'
import {
  formattedDateMedium,
  getCommentTargetId,
  HMComment,
  HMCommentGroup,
  HMDocument,
  hmId,
  HMMetadata,
  UnpackedHypermediaId,
  useCommentGroups,
  useCommentParents,
  useRouteLink,
} from '@shm/shared'
import {
  useCommentsService,
  useCommentsServiceContext,
  useDiscussionsService,
} from '@shm/shared/comments-service-provider'
import {ListDiscussionsResponse} from '@shm/shared/models/comments-service'
import {useTxString} from '@shm/shared/translation'
import {useResourceUrl} from '@shm/shared/url'
import {ChevronRight, Link, MessageSquare, Trash2} from 'lucide-react'
import {ReactNode, useEffect, useMemo, useState} from 'react'
import {toast} from 'sonner'
import {AccessoryBackButton, AccessoryContent} from './accessories'
import {Button} from './button'
import {copyTextToClipboard} from './copy-to-clipboard'
import {
  BlocksContent,
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
}: {
  targetId: UnpackedHypermediaId
  commentId?: string
  renderCommentContent?: (comment: HMComment) => ReactNode
  commentEditor?: ReactNode
  onStartDiscussion?: () => void
  onBack?: () => void
}) {
  const commentsService = useCommentsService({targetId})
  if (!commentId) return null
  const parentThread = useCommentParents(
    commentsService.data?.comments,
    commentId,
  )
  const commentGroupReplies = useCommentGroups(
    commentsService.data?.comments,
    commentId,
  )

  console.log(
    `== ~ COMMENT commentsService.data?.authors:`,
    commentsService.data?.authors,
  )

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
            onDelete={(id) => {
              console.log('TODO: delete comment', id)
              // if (!myAccountId) return
              // deleteCommentDialog.open({
              //   onConfirm: () => {
              //     deleteComment.mutate({
              //       commentId: id,
              //       targetDocId: docId,
              //       signingAccountId: myAccountId,
              //     })
              //     if (id === commentId) {
              //       onBack()
              //     }
              //   },
              // })
            }}
            // currentAccountId={myAccountId ?? undefined}
            renderCommentContent={renderCommentContent}
            highlightLastComment
            // targetDomain={targetDomain}
          />
        ) : (
          <EmptyDiscussions emptyReplies />
        )
      ) : null}
      <div className="border-border relative max-h-1/2 border-b py-4">
        <div
          className="bg-border absolute w-px"
          style={{
            height: 32,
            top: -12,
            left: 32 / 2 - 1,
          }}
        />
        {commentEditor}
      </div>
      {commentGroupReplies.data?.length > 0 ? (
        commentGroupReplies.data.map((cg, idx) => {
          return (
            <div
              key={cg.id}
              className={cn(
                'border-border border-b',
                commentGroupReplies.data.length - 1 > idx && 'mb-4',
              )}
            >
              <CommentGroup
                key={cg.id}
                commentGroup={cg}
                authors={commentsService.data?.authors}
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
}: {
  targetId: UnpackedHypermediaId
  commentId?: string
  renderCommentContent?: (comment: HMComment) => ReactNode
  commentEditor?: ReactNode
  onBack?: () => void
}) {
  const discussionsService = useDiscussionsService({targetId, commentId})
  let panelContent = null

  if (discussionsService.isLoading && !discussionsService.data) {
    panelContent = (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  } else if (discussionsService.data) {
    panelContent =
      discussionsService.data.discussions?.length > 0 ? (
        discussionsService.data.discussions?.map((cg, idx) => {
          return (
            <div
              key={cg.id}
              className={cn(
                'border-border border-b',
                discussionsService.data.discussions.length - 1 > idx && 'mb-4',
              )}
            >
              <CommentGroup
                commentGroup={cg}
                authors={discussionsService.data.authors}
                renderCommentContent={renderCommentContent}
                enableReplies
              />
            </div>
          )
        })
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

// this is a LINEARIZED set of comments, where one comment is directly replying to another. the commentGroup.moreCommentsCount should be the number of replies to the last comment in the group.
export function CommentGroup({
  commentGroup,
  authors,
  renderCommentContent,
  enableReplies = true,
  highlightLastComment = false,
  onDelete,
  currentAccountId,
  targetDomain,
}: {
  commentGroup: HMCommentGroup
  authors?: ListDiscussionsResponse['authors']
  renderCommentContent?: (comment: HMComment) => ReactNode
  enableReplies?: boolean
  highlightLastComment?: boolean
  onDelete?: (commentId: string) => void
  currentAccountId?: string
  targetDomain?: string
}) {
  const lastComment = commentGroup.comments.at(-1)

  console.log(`== ~ COMMENT commentGroup.comments:`, commentGroup.comments)
  return (
    <div className="relative flex flex-col gap-2">
      {commentGroup.comments.length > 1 && (
        <div
          className="bg-border absolute w-px"
          style={{
            height: `calc(100% - ${avatarSize / 2}px)`,
            top: avatarSize / 2,
            left: avatarSize / 2,
          }}
        />
      )}

      {commentGroup.comments.map((comment) => {
        const isLastCommentInGroup = !!lastComment && comment === lastComment
        const isCurrentAccountComment = comment.author === currentAccountId
        return (
          <Comment
            isLast={isLastCommentInGroup}
            key={comment.id}
            comment={comment}
            authorMetadata={authors?.[comment.author]?.metadata}
            authorId={comment.author}
            renderCommentContent={renderCommentContent}
            replyCount={
              isLastCommentInGroup ? commentGroup.moreCommentsCount : undefined
            }
            enableReplies={enableReplies}
            highlight={highlightLastComment && isLastCommentInGroup}
            onDelete={
              isCurrentAccountComment ? () => onDelete?.(comment.id) : undefined
            }
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
  isLast = false,
  authorMetadata,
  authorId,
  renderCommentContent,
  enableReplies = true,
  defaultExpandReplies = false,
  highlight = false,
  onDelete,
  targetDomain,
  heading,
}: {
  comment: HMComment
  replyCount?: number
  isLast?: boolean
  authorMetadata?: HMMetadata | null
  authorId?: string | null
  renderCommentContent?: (comment: HMComment) => ReactNode
  enableReplies?: boolean
  defaultExpandReplies?: boolean
  highlight?: boolean
  onDelete?: () => void
  targetDomain?: string
  heading?: ReactNode
}) {
  console.log('== ~ Comment ~ authorMetadata:', authorMetadata)
  let renderContent = renderCommentContent
  if (!renderContent) {
    renderContent = (comment) => (
      <DocContentProvider
        entityId={hmId(comment.id)}
        entityComponents={{
          Document: () => null,
          Inline: () => null,
          Query: () => null,
          Comment: () => null,
        }}
        onBlockCopy={() => {}}
        onBlockReply={() => {}}
        onBlockCommentClick={() => {}}
        onBlockCitationClick={() => {}}
        layoutUnit={14}
        textUnit={14}
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
  const CommentsContext = useCommentsServiceContext()
  const authorHmId =
    comment.author || authorId ? hmId(authorId || comment.author) : null
  const authorLink = useRouteLink(
    authorHmId ? {key: 'document', id: authorHmId} : null,
    {
      handler: 'onClick',
    },
  )
  const tx = useTxString()

  useEffect(() => {
    if (defaultExpandReplies !== showReplies) {
      setShowReplies(defaultExpandReplies)
    }
  }, [defaultExpandReplies])
  const getUrl = useResourceUrl(targetDomain)
  const options: MenuItemType[] = []
  if (onDelete) {
    options.push({
      icon: <Trash2 className="size-4" />,
      label: 'Delete',
      onClick: () => {
        onDelete()
      },
      key: 'delete',
    })
  }
  return (
    <div
      className={cn(
        'group relative flex gap-1 rounded-lg',
        highlight ? 'bg-secondary dark:bg-brand-10' : '', // TODO: review color for dark theme
      )}
    >
      {isLast ? (
        <div
          className={cn(
            'absolute z-1 w-3',
            highlight
              ? 'bg-secondary dark:bg-brand-10' // TODO: review color for dark theme
              : 'dark:bg-background bg-white',
          )}
          style={{
            height: `calc(100% - ${avatarSize}px)`,
            left: 3,
            bottom: 0,
          }}
        />
      ) : null}

      {heading ? null : (
        <div className="relative mt-0.5 min-w-5">
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
              <HMIcon id={authorHmId} metadata={authorMetadata} size={20} />
            </div>
          )}
        </div>
      )}
      <div className="flex w-full flex-1 flex-col gap-1">
        {heading ? <div className="inline">{heading}</div> : null}
        <div className="group flex items-center justify-between gap-2 overflow-hidden pr-2">
          {heading ? null : (
            <div className="flex items-baseline gap-1 overflow-hidden">
              <button
                className={cn(
                  'hover:bg-accent h-5 truncate rounded px-1 text-sm font-bold transition-colors',
                  authorLink ? 'cursor-pointer' : '',
                )}
                {...authorLink}
              >
                {authorMetadata?.name || '...'}
              </button>

              <CommentDate comment={comment} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Tooltip content={tx('Copy Comment Link')}>
              <Button
                size="iconSm"
                variant="ghost"
                className="text-muted-foreground opacity-0 transition-opacity duration-200 ease-in-out group-hover:opacity-100"
                onClick={() => {
                  const url = getUrl(hmId(comment.id))
                  copyTextToClipboard(url)
                  toast.success('Copied Comment URL')
                }}
              >
                <Link className="size-3" />
              </Button>
            </Tooltip>
            {options.length > 0 ? (
              <OptionsDropdown
                className="opacity-0 transition-opacity duration-200 ease-in-out group-hover:opacity-100"
                menuItems={options}
              />
            ) : null}
          </div>
        </div>
        <div className="-ml-2">{renderContent(comment)}</div>
        {!highlight && (
          <div className="mb-2 -ml-1 flex items-center gap-2 py-1">
            {replyCount ? (
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-muted-foreground active:text-muted-foreground"
                size="xs"
                onClick={() => {
                  CommentsContext.onReplyCountClick(comment)
                }}
              >
                <ChevronRight className="size-3" />

                {tx(
                  'replies_count',
                  (args: {count: number}) => `Replies (${args.count})`,
                  {count: replyCount},
                )}
              </Button>
            ) : null}
            {enableReplies || CommentsContext.onReplyClick ? (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:text-muted-foreground active:text-muted-foreground"
                onClick={() => {
                  if (CommentsContext.onReplyClick) {
                    CommentsContext.onReplyClick(comment)
                  }
                }}
              >
                <ReplyArrow className="size-3" />

                {tx('Reply')}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
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
      {formattedDateMedium(comment.createTime)}
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
