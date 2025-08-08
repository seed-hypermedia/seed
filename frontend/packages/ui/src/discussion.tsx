import {
  AlertDialogDescription,
  AlertDialogTitle,
} from '@radix-ui/react-alert-dialog'
import {
  formattedDateMedium,
  getCommentTargetId,
  HMAccountsMetadata,
  HMComment,
  HMCommentGroup,
  HMDocument,
  hmId,
  HMMetadata,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useDiscussionsContext} from '@shm/shared/discussions-provider'
import {useTxString} from '@shm/shared/translation'
import {useResourceUrl} from '@shm/shared/url'
import {ChevronRight, Link, Trash2} from 'lucide-react'
import {ReactNode, useEffect, useMemo, useState} from 'react'
import {toast} from 'sonner'
import {Button} from './button'
import {copyTextToClipboard} from './copy-to-clipboard'
import {BlocksContent, getBlockNodeById} from './document-content'
import {HMIcon} from './hm-icon'
import {BlockQuote, ReplyArrow} from './icons'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {Tooltip} from './tooltip'
import {useAppDialog} from './universal-dialog'
import {cn} from './utils'

const avatarSize = 18

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
  authors?: HMAccountsMetadata | undefined
  renderCommentContent: (comment: HMComment) => ReactNode
  enableReplies?: boolean
  highlightLastComment?: boolean
  onDelete?: (commentId: string) => void
  currentAccountId?: string
  targetDomain?: string
}) {
  const lastComment = commentGroup.comments.at(-1)
  return (
    <div className="relative flex flex-col gap-2">
      {commentGroup.comments.length > 1 && (
        <div
          className="bg-border absolute w-px"
          style={{
            height: `calc(100% - ${avatarSize / 2}px)`,
            top: avatarSize / 2,
            left: avatarSize - 1,
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
            authorId={authors?.[comment.author]?.id.uid}
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
}: {
  comment: HMComment
  replyCount?: number
  isLast?: boolean
  authorMetadata?: HMMetadata | null
  authorId?: string | null
  renderCommentContent: (comment: HMComment) => ReactNode
  enableReplies?: boolean
  defaultExpandReplies?: boolean
  highlight?: boolean
  onDelete?: () => void
  targetDomain?: string
}) {
  const [showReplies, setShowReplies] = useState(defaultExpandReplies)
  const discussionsContext = useDiscussionsContext()
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
        'group relative flex gap-1 rounded-lg p-2',
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
            height: `calc(100% - ${avatarSize + 12}px)`,
            left: 12,
            bottom: 0,
          }}
        />
      ) : null}
      <div className="relative mt-0.5 min-w-5">
        {/* @ts-expect-error */}
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
      <div className="flex w-full flex-1 flex-col gap-1">
        <div className="group flex items-center justify-between gap-2 overflow-hidden pr-2">
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
        <div className="-ml-2">{renderCommentContent(comment)}</div>
        {!highlight && (
          <div className="mb-2 -ml-1 flex items-center gap-2 py-1">
            {replyCount ? (
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-muted-foreground active:text-muted-foreground"
                size="xs"
                onClick={() => {
                  discussionsContext.onReplyCountClick(comment)
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
            {enableReplies || discussionsContext.onReplyClick ? (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:text-muted-foreground active:text-muted-foreground"
                onClick={() => {
                  if (discussionsContext.onReplyClick) {
                    discussionsContext.onReplyClick(comment)
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
    // @ts-expect-error
    <a
      className="text-muted-foreground hover:text-muted-foreground truncate rounded text-xs underline"
      {...link}
    >
      {formattedDateMedium(comment.createTime)}
    </a>
  )
}

export function QuotedDocBlock({
  // @ts-expect-error
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
