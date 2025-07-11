import {
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
import {useTx, useTxUtils} from '@shm/shared/translation'
import {ChevronRight} from 'lucide-react'
import {ReactNode, useEffect, useMemo, useState} from 'react'
import {Button} from './button'
import {copyTextToClipboard} from './copy-to-clipboard'
import {BlocksContent, getBlockNodeById} from './document-content'
import {HMIcon} from './hm-icon'
import {BlockQuote, ReplyArrow} from './icons'
import {Tooltip} from './tooltip'
import {useIsDark} from './use-is-dark'
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
    comment.author || authorId ? hmId('d', authorId || comment.author) : null
  const authorLink = useRouteLink(
    authorHmId ? {key: 'document', id: authorHmId} : null,
    {
      handler: 'onClick',
    },
  )
  const isDark = useIsDark()
  const tx = useTx()
  const {formattedDateMedium, formattedDateLong} = useTxUtils()
  useEffect(() => {
    if (defaultExpandReplies !== showReplies) {
      setShowReplies(defaultExpandReplies)
    }
  }, [defaultExpandReplies])

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
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex min-h-5 items-center gap-1">
          <button
            className={cn(
              'hover:bg-accent h-5 rounded px-1 text-sm font-bold transition-colors',
              authorLink ? 'cursor-pointer' : '',
            )}
            {...authorLink}
          >
            {authorMetadata?.name || '...'}
          </button>
          <Tooltip content={formattedDateLong(comment.createTime)}>
            <button
              className="text-muted-foreground hover:text-muted-foreground h-6 rounded text-xs"
              onClick={() => {
                copyTextToClipboard(comment.id)
              }}
            >
              {formattedDateMedium(comment.createTime)}
            </button>
          </Tooltip>
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
