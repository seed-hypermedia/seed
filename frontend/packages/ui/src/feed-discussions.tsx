import {HMComment, HMMetadata} from '@seed-hypermedia/client/hm-types'
import {useCommentReplyCount, useDocumentComments} from '@shm/shared/models/comments'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {GroupedCommentFeedDiscussion, groupCommentFeedEvents} from '@shm/shared/grouped-comment-feed'
import {useRouteLink} from '@shm/shared/routing'
import {useActivityFeed} from '@shm/shared/use-activity-feed'
import {commentIdToHmId, getCommentTargetId, hmId} from '@shm/shared/utils/entity-id-url'
import {Hash, MessageCircle, MoveRight, Reply} from 'lucide-react'
import {useEffect, useMemo, useRef} from 'react'
import {CommentContent} from './comments'
import type {CommentEditorProps} from './resource-page-common'
import {HMIcon} from './hm-icon'
import {Spinner} from './spinner'
import {Text} from './text'

const MIN_DISCUSSION_GROUPS = 10

/** Props for the grouped discussions feed view. */
export interface FeedDiscussionsProps {
  filterResource: string
  /** Platform-specific composer used for inline thread replies. */
  CommentEditor?: React.ComponentType<CommentEditorProps>
}

/**
 * Feed-API-backed discussion view that filters to comments and groups them by
 * true thread root.
 */
export function FeedDiscussions({filterResource, CommentEditor}: FeedDiscussionsProps) {
  const observerRef = useRef<IntersectionObserver>()
  const lastElementNodeRef = useRef<HTMLDivElement>(null)

  const {data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error, refetch} = useActivityFeed({
    filterResource,
    filterEventType: ['Comment'],
  })

  const allEvents = data?.pages.flatMap((page) => page.events) || []
  const discussions = useMemo(() => groupCommentFeedEvents(allEvents), [allEvents])

  useEffect(() => {
    if (isLoading || isFetchingNextPage || !hasNextPage) return
    if (discussions.length >= MIN_DISCUSSION_GROUPS) return
    fetchNextPage()
  }, [discussions.length, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading])

  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = undefined
    }

    const node = lastElementNodeRef.current
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
      {rootMargin: '100px'},
    )

    observerRef.current.observe(node)

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = undefined
      }
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isLoading])

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <Text color="muted">Discussion feed error.</Text>
        <button className="text-primary text-sm underline" onClick={() => refetch()}>
          Retry
        </button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Spinner />
      </div>
    )
  }

  if (!discussions.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <Text weight="bold">No comment discussions yet</Text>
        <Text color="muted">New comment threads will appear here once the feed has them.</Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <div className="bg-muted/40 flex items-start justify-between gap-4 rounded-2xl border p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="bg-background flex size-10 shrink-0 items-center justify-center rounded-xl border shadow-xs">
            <MessageCircle className="text-muted-foreground size-5" />
          </div>
          <div className="min-w-0">
            <Text weight="bold">Discussion inbox</Text>
            <div className="text-muted-foreground text-sm">
              Comment threads grouped like conversations, sorted by newest reply.
            </div>
          </div>
        </div>
        <div className="bg-background hidden shrink-0 rounded-full border px-3 py-1 text-xs font-medium md:block">
          {discussions.length} active
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {discussions.map((discussion) => (
          <FeedDiscussionCard key={discussion.threadRootId} discussion={discussion} CommentEditor={CommentEditor} />
        ))}
      </div>

      <div className="h-20" ref={lastElementNodeRef} />
      {isFetchingNextPage ? <div className="text-muted-foreground py-3 text-center">Loading more…</div> : null}
      {!hasNextPage ? <div className="text-muted-foreground py-3 text-center">No more discussions</div> : null}
    </div>
  )
}

function FeedDiscussionCard({
  discussion,
  CommentEditor,
}: {
  discussion: GroupedCommentFeedDiscussion
  CommentEditor?: React.ComponentType<CommentEditorProps>
}) {
  const rootCommentId = useMemo(
    () => commentIdToHmId(discussion.threadRootId, discussion.threadRootVersion),
    [discussion.threadRootId, discussion.threadRootVersion],
  )
  const rootResource = useResource(discussion.rootCommentEvent ? null : rootCommentId)
  const rootComment =
    discussion.rootCommentEvent?.comment || (rootResource.data?.type === 'comment' ? rootResource.data.comment : null)
  const latestReplyComment = discussion.latestReplyEvent?.comment || null
  const targetId = getCommentTargetId(rootComment || undefined) || discussion.targetId
  const targetTitle =
    discussion.rootCommentEvent?.target?.metadata?.name ||
    discussion.latestCommentEvent.target?.metadata?.name ||
    targetId.path?.at(-1) ||
    'Untitled document'
  const commentsService = useDocumentComments(targetId)
  const threadComments = useMemo(
    () =>
      getThreadComments({
        allComments: commentsService.data?.comments,
        threadRootId: discussion.threadRootId,
        threadRootVersion: discussion.threadRootVersion,
        fallbackRoot: rootComment,
        fallbackLatestReply: latestReplyComment,
      }),
    [
      commentsService.data?.comments,
      discussion.threadRootId,
      discussion.threadRootVersion,
      rootComment,
      latestReplyComment,
    ],
  )
  const replyCount = useCommentReplyCount({id: discussion.threadRootId})
  const fallbackReplyCount = Math.max(discussion.eventCount - 1, 0)
  const totalReplies = typeof replyCount.data === 'number' ? replyCount.data : fallbackReplyCount
  const route = useMemo(
    () => ({key: 'comments' as const, id: targetId, openComment: discussion.threadRootId}),
    [discussion.threadRootId, targetId],
  )
  const linkProps = useRouteLink(route)

  const rootAuthorUid = rootComment?.author || null
  const rootAuthor = useAccount(rootAuthorUid)
  const rootAuthorMetadata =
    discussion.rootCommentEvent?.author?.metadata || (rootAuthor.data?.metadata as HMMetadata | undefined)

  return (
    <div
      className={
        'group relative overflow-hidden rounded-2xl border bg-white shadow-xs transition-all ' +
        'hover:-translate-y-px hover:border-foreground/20 hover:shadow-md dark:bg-white/5'
      }
      {...linkProps}
    >
      <div className="bg-brand absolute top-0 bottom-0 left-0 w-1 opacity-80" />
      <div className="flex flex-col gap-3 p-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Hash className="text-muted-foreground size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Text weight="bold" className="truncate">
                  {targetTitle}
                </Text>
                <span className="text-muted-foreground text-xs">•</span>
                <span className="text-muted-foreground text-xs">
                  {formatTimestamp(discussion.latestCommentEvent.eventAtMs)}
                </span>
              </div>
              <div className="text-muted-foreground text-xs">
                Started by {rootAuthorMetadata?.name || rootAuthorUid || 'Unknown author'}
              </div>
            </div>
          </div>
          <div className="bg-muted hidden shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium md:flex">
            <Reply className="size-3" />
            {totalReplies === 1 ? '1 reply' : `${totalReplies} replies`}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {commentsService.isLoading && threadComments.length <= 1 ? (
            <div className="ml-12 flex items-center gap-2 rounded-2xl border bg-stone-50 p-3 dark:bg-black/20">
              <Spinner />
              <Text color="muted">Loading thread…</Text>
            </div>
          ) : null}

          {threadComments.map((comment, index) => (
            <ThreadCommentBubble
              key={comment.id}
              comment={comment}
              resourceId={commentIdToHmId(comment.id, comment.version)}
              isRoot={comment.id === discussion.threadRootId || index === 0}
              isIndented={index > 0}
            />
          ))}
        </div>

        {CommentEditor && rootComment ? (
          <div
            className="ml-12 rounded-2xl border bg-white p-2 shadow-xs dark:bg-black/20"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="text-muted-foreground px-2 pb-2 text-xs font-medium">Reply in thread</div>
            <CommentEditor
              docId={targetId}
              commentId={rootComment.id}
              isReplying
              replyCommentVersion={rootComment.version}
              rootReplyCommentVersion={rootComment.threadRootVersion || rootComment.version}
            />
          </div>
        ) : null}

        <div
          className={
            'text-brand flex items-center gap-2 pl-12 text-sm font-medium opacity-80 transition-opacity ' +
            'group-hover:opacity-100'
          }
        >
          Open thread
          <MoveRight className="size-4" />
        </div>
      </div>
    </div>
  )
}

function ThreadCommentBubble({
  comment,
  resourceId,
  isRoot,
  isIndented,
}: {
  comment: HMComment
  resourceId: ReturnType<typeof commentIdToHmId>
  isRoot: boolean
  isIndented: boolean
}) {
  const author = useAccount(comment.author)
  const authorMetadata = author.data?.metadata as HMMetadata | undefined

  return (
    <div className={isIndented ? 'ml-12 flex gap-3 border-l pl-4' : 'flex gap-3'}>
      <div className={isIndented ? 'mt-1 size-7 shrink-0' : 'mt-1 size-9 shrink-0'}>
        {comment.author ? (
          <HMIcon
            id={hmId(comment.author)}
            name={authorMetadata?.name}
            icon={authorMetadata?.icon}
            size={isIndented ? 28 : 36}
          />
        ) : null}
      </div>
      <div
        className={
          isIndented
            ? 'min-w-0 flex-1 rounded-xl bg-blue-50/70 p-3 dark:bg-blue-950/20'
            : 'min-w-0 flex-1 rounded-2xl bg-stone-50 p-3 dark:bg-black/20'
        }
      >
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Text weight="bold" size="sm">
            {authorMetadata?.name || comment.author || 'Unknown author'}
          </Text>
          <span className="text-muted-foreground text-xs">{isRoot ? 'Root comment' : 'Reply'}</span>
          <span className="text-muted-foreground text-xs">{formatCommentTime(comment)}</span>
        </div>
        <CommentContent comment={comment} size="sm" resourceId={resourceId} />
      </div>
    </div>
  )
}

function getThreadComments({
  allComments,
  threadRootId,
  threadRootVersion,
  fallbackRoot,
  fallbackLatestReply,
}: {
  allComments?: HMComment[]
  threadRootId: string
  threadRootVersion?: string
  fallbackRoot: HMComment | null
  fallbackLatestReply: HMComment | null
}) {
  if (!allComments?.length) {
    return [fallbackRoot, fallbackLatestReply].filter((comment, index, list): comment is HMComment => {
      return !!comment && list.findIndex((item) => item?.id === comment.id) === index
    })
  }

  const byId = new Map(allComments.map((comment) => [comment.id, comment]))
  const included = new Set<string>()

  allComments.forEach((comment) => {
    if (
      comment.id === threadRootId ||
      comment.threadRoot === threadRootId ||
      (!!threadRootVersion && comment.threadRootVersion === threadRootVersion)
    ) {
      included.add(comment.id)
    }
  })

  if (fallbackRoot) included.add(fallbackRoot.id)
  if (fallbackLatestReply) included.add(fallbackLatestReply.id)

  let changed = true
  while (changed) {
    changed = false
    allComments.forEach((comment) => {
      if (comment.replyParent && included.has(comment.replyParent) && !included.has(comment.id)) {
        included.add(comment.id)
        changed = true
      }
    })
  }

  const comments = Array.from(included)
    .map(
      (id) =>
        byId.get(id) ||
        (fallbackRoot?.id === id ? fallbackRoot : null) ||
        (fallbackLatestReply?.id === id ? fallbackLatestReply : null),
    )
    .filter((comment): comment is HMComment => !!comment)

  return comments.sort((a, b) => getCommentTimeMs(a) - getCommentTimeMs(b))
}

function getCommentTimeMs(comment: HMComment) {
  const value = comment.createTime || comment.updateTime
  if (typeof value === 'string') return new Date(value).getTime() || 0
  if (value && typeof value === 'object' && 'seconds' in value) return Number(value.seconds) * 1000
  return 0
}

function formatCommentTime(comment: HMComment) {
  const timeMs = getCommentTimeMs(comment)
  if (!timeMs) return ''
  return new Date(timeMs).toLocaleString([], {dateStyle: 'short', timeStyle: 'short'})
}

function formatTimestamp(eventAtMs: number) {
  return new Date(eventAtMs).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
