import {
  formattedDateLong,
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
import {useTxString, useTxUtils} from '@shm/shared/translation'
import {useResourceUrl} from '@shm/shared/url'
import {ChevronRight, Link} from 'lucide-react'
import {ReactNode, useEffect, useMemo, useState} from 'react'
import {toast} from 'sonner'
import {Button} from './button'
import {copyTextToClipboard} from './copy-to-clipboard'
import {BlocksContent, getBlockNodeById} from './document-content'
import {HMIcon} from './hm-icon'
import {BlockQuote, ReplyArrow} from './icons'
import {Tooltip} from './tooltip'
import {cn} from './utils'

const avatarSize = 18

// this is a LINEARIZED set of comments, where one comment is directly replying to another. the commentGroup.moreCommentsCount should be the number of replies to the last comment in the group.
export function CommentGroup({
  commentGroup,
  authors,
  renderCommentContent,
  enableReplies = true,
  highlightLastComment = false,
}: {
  commentGroup: HMCommentGroup
  authors?: HMAccountsMetadata | undefined
  renderCommentContent: (comment: HMComment) => ReactNode
  enableReplies?: boolean
  highlightLastComment?: boolean
}) {
  const lastComment = commentGroup.comments.at(-1)
  return (
    <div className="flex relative flex-col gap-2">
      {commentGroup.comments.length > 1 && (
        <div
          className="absolute w-px bg-border"
          style={{
            height: `calc(100% - ${avatarSize / 2}px)`,
            top: avatarSize / 2,
            left: avatarSize - 1,
          }}
        />
      )}
      {commentGroup.comments.map((comment) => {
        const isLastCommentInGroup = !!lastComment && comment === lastComment
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
  const {formattedDateMedium, formattedDateLong} = useTxUtils()
  useEffect(() => {
    if (defaultExpandReplies !== showReplies) {
      setShowReplies(defaultExpandReplies)
    }
  }, [defaultExpandReplies])
  const getUrl = useResourceUrl()
  return (
    <div
      className={cn(
        'flex relative gap-1 p-2 rounded-lg group',
        highlight ? 'bg-secondary dark:bg-brand-10' : '', // TODO: review color for dark theme
      )}
    >
      {isLast ? (
        <div
          className={cn(
            'absolute w-3 z-1',
            highlight
              ? 'bg-secondary dark:bg-brand-10' // TODO: review color for dark theme
              : 'bg-white dark:bg-background',
          )}
          style={{
            height: `calc(100% - ${avatarSize + 12}px)`,
            left: 12,
            bottom: 0,
          }}
        />
      ) : null}
      <div className="relative mt-0.5 min-w-5">
        <div
          className={cn(
            'absolute top-0 left-0 bg-transparent rounded-full transition-all duration-200 ease-in-out z-2 size-5',
            highlight
              ? 'outline-secondary hover:outline-secondary'
              : 'outline-white dark:outline-background dark:hover:outline-background hover:outline-white',
          )}
          {...authorLink}
        />
        {authorHmId && (
          <div className="size-5">
            <HMIcon id={authorHmId} metadata={authorMetadata} size={20} />
          </div>
        )}
      </div>
      <div className="flex flex-col flex-1 gap-1">
        <div className="flex gap-1 justify-between items-center group min-h-5">
          <div className="flex gap-1 items-center">
            <button
              className={cn(
                'px-1 h-5 text-sm font-bold rounded transition-colors hover:bg-accent',
                authorLink ? 'cursor-pointer' : '',
              )}
              {...authorLink}
            >
              {authorMetadata?.name || '...'}
            </button>
            <CommentDate comment={comment} />
          </div>
          <Tooltip content={tx('Copy Comment Link')}>
            <button
              className="opacity-0 transition-opacity duration-200 ease-in-out text-muted-foreground group-hover:opacity-100"
              onClick={() => {
                const url = getUrl(hmId(comment.id))
                copyTextToClipboard(url)
                toast.success('Copied Comment URL')
              }}
            >
              <Link size={12} />
            </button>
          </Tooltip>
        </div>
        <div className="-ml-2">{renderCommentContent(comment)}</div>
        {!highlight && (
          <div className="flex gap-2 items-center py-1 mb-2 -ml-1">
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
    <Tooltip content={formattedDateLong(comment.createTime)}>
      <a
        className="h-6 text-xs underline rounded text-muted-foreground hover:text-muted-foreground"
        {...link}
      >
        {formattedDateMedium(comment.createTime)}
      </a>
    </Tooltip>
  )
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
    <div className="rounded-lg bg-brand-50 dark:bg-brand-950">
      <div className="flex relative gap-1 p-2 rounded-lg transition-all duration-200 ease-in-out">
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
