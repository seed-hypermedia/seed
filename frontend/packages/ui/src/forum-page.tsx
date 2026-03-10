import {
  HMCommentGroup,
  HMExternalCommentGroup,
  HMListDiscussionsOutput,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {getBlockText, hmId, useRouteLink} from '@shm/shared'
import {useDiscussionsService, useHackyAuthorsSubscriptions} from '@shm/shared/comments-service-provider'
import {ArrowLeft, MessageSquare} from 'lucide-react'
import {ReactNode, useMemo} from 'react'
import {Button} from './button'
import {CommentDiscussions} from './comments'
import {HMIcon} from './hm-icon'
import {Timestamp} from './inline-descriptor'
import {PageLayout} from './page-layout'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {cn} from './utils'

import type {CommentEditorProps} from './resource-page-common'

export interface ForumPageContentProps {
  docId: UnpackedHypermediaId
  openComment?: string
  contentMaxWidth?: number
  targetDomain?: string
  CommentEditor?: React.ComponentType<CommentEditorProps>
}

export function ForumPageContent({
  docId,
  openComment,
  contentMaxWidth,
  targetDomain,
  CommentEditor,
}: ForumPageContentProps) {
  if (openComment) {
    return (
      <ForumDetailPage
        docId={docId}
        commentId={openComment}
        contentMaxWidth={contentMaxWidth}
        targetDomain={targetDomain}
        CommentEditor={CommentEditor}
      />
    )
  }

  return <ForumListPage docId={docId} contentMaxWidth={contentMaxWidth} />
}

function ForumListPage({docId, contentMaxWidth}: {docId: UnpackedHypermediaId; contentMaxWidth?: number}) {
  const discussionsService = useDiscussionsService({targetId: docId})

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

  let content: ReactNode = null

  if (discussionsService.isLoading && !discussionsService.data) {
    content = (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    )
  } else if (discussionsService.error) {
    content = (
      <div className="flex flex-col items-center gap-2 p-4">
        <SizableText color="muted" size="sm">
          Failed to load discussions
        </SizableText>
      </div>
    )
  } else if (discussionsService.data) {
    const discussions = discussionsService.data.discussions ?? []
    const citingDiscussions = discussionsService.data.citingDiscussions ?? []
    const totalCount = discussions.length + citingDiscussions.length

    if (totalCount > 0) {
      content = (
        <div className="flex flex-col">
          {discussions.map((cg) => (
            <ForumItem key={cg.id} commentGroup={cg} authors={discussionsService.data.authors} docId={docId} />
          ))}
          {citingDiscussions.map((cg) => (
            <ForumItem key={cg.id} commentGroup={cg} authors={discussionsService.data.authors} docId={docId} />
          ))}
        </div>
      )
    } else {
      content = (
        <div className="flex flex-col items-center gap-2 py-8">
          <MessageSquare className="text-muted-foreground size-8" />
          <SizableText color="muted" size="sm">
            No discussions yet
          </SizableText>
        </div>
      )
    }
  }

  return (
    <div className="p-4">
      <PageLayout title="Forum" contentMaxWidth={contentMaxWidth}>
        {content}
      </PageLayout>
    </div>
  )
}

function ForumItem({
  commentGroup,
  authors,
  docId,
}: {
  commentGroup: HMCommentGroup | HMExternalCommentGroup
  authors?: HMListDiscussionsOutput['authors']
  docId: UnpackedHypermediaId
}) {
  const firstComment = commentGroup.comments[0]
  if (!firstComment) return null

  const authorMetadata = firstComment.author ? authors?.[firstComment.author] : undefined
  const previewText = firstComment.content
    ?.map((node) => getBlockText(node.block))
    .filter(Boolean)
    .join(' ')
  const truncatedPreview = previewText && previewText.length > 200 ? previewText.slice(0, 200) + '...' : previewText
  const replyCount = commentGroup.comments.length - 1 + commentGroup.moreCommentsCount

  // Collect all unique authors from the thread (excluding the root comment author)
  const threadAuthorIds = useMemo(() => {
    const authorSet = new Set<string>()
    commentGroup.comments.forEach((c) => {
      if (c.author && c.author !== firstComment.author) {
        authorSet.add(c.author)
      }
    })
    return Array.from(authorSet)
  }, [commentGroup.comments, firstComment.author])

  const route = {
    key: 'forum' as const,
    id: docId,
    openComment: commentGroup.id,
  }
  const linkProps = useRouteLink(route)

  const authorHmId = firstComment.author ? hmId(firstComment.author) : undefined

  return (
    <a
      {...linkProps}
      className={cn(
        'border-border hover:bg-sidebar-accent flex flex-col gap-2 border-b p-4 transition-colors',
        'cursor-pointer',
      )}
    >
      {truncatedPreview ? (
        <SizableText size="lg" className="line-clamp-2">
          {truncatedPreview}
        </SizableText>
      ) : null}
      <div className="flex items-center gap-2">
        {authorHmId ? (
          <HMIcon
            id={authorHmId}
            name={authorMetadata?.metadata?.name}
            icon={authorMetadata?.metadata?.icon}
            size={20}
          />
        ) : null}
        <span className="text-muted-foreground text-sm">
          {authorMetadata?.metadata?.name || firstComment.author?.slice(0, 8)}
        </span>
        {firstComment.createTime ? (
          <span className="text-muted-foreground text-sm">
            &middot; <Timestamp time={firstComment.createTime} />
          </span>
        ) : null}
      </div>
      {replyCount > 0 ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <div className="flex items-center gap-1">
            <MessageSquare className="size-3.5" />
            <span>
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </span>
          </div>
          {threadAuthorIds.length > 0 ? (
            <div className="flex items-center -space-x-1">
              {threadAuthorIds.slice(0, 5).map((uid) => {
                const meta = authors?.[uid]
                return (
                  <HMIcon key={uid} id={hmId(uid)} name={meta?.metadata?.name} icon={meta?.metadata?.icon} size={18} />
                )
              })}
              {threadAuthorIds.length > 5 ? (
                <span className="text-muted-foreground pl-2 text-xs">+{threadAuthorIds.length - 5}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </a>
  )
}

function ForumDetailPage({
  docId,
  commentId,
  contentMaxWidth,
  targetDomain,
  CommentEditor,
}: {
  docId: UnpackedHypermediaId
  commentId: string
  contentMaxWidth?: number
  targetDomain?: string
  CommentEditor?: React.ComponentType<CommentEditorProps>
}) {
  const backRoute = {key: 'forum' as const, id: docId}
  const backLinkProps = useRouteLink(backRoute)

  return (
    <div className="p-4">
      <PageLayout contentMaxWidth={contentMaxWidth}>
        <div className="mb-4">
          <Button variant="ghost" size="sm" asChild>
            <a {...backLinkProps}>
              <ArrowLeft className="size-4" />
              <span>Back to Forum</span>
            </a>
          </Button>
        </div>
        <CommentDiscussions
          commentId={commentId}
          targetId={docId}
          targetDomain={targetDomain}
          isEntirelyHighlighted
          commentEditor={CommentEditor ? <CommentEditor docId={docId} commentId={commentId} isReplying /> : undefined}
        />
      </PageLayout>
    </div>
  )
}
