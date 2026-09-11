import {HMComment, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {MentionThreadContext} from './mention-ranking'
import {normalizeDate} from '../utils/date'
import {useQuery} from '@tanstack/react-query'
import {useUniversalClient} from '../routing'
import {
  queryBlockDiscussions,
  queryCommentReplyCount,
  queryCommentVersions,
  queryDocumentComments,
  queryDocumentDiscussions,
} from './queries'

/** Fetches comments for the main document comments view. */
export function useDocumentComments(targetId: UnpackedHypermediaId) {
  const client = useUniversalClient()
  return useQuery(queryDocumentComments(client, targetId))
}

/** Fetches grouped discussions for a document or focused comment. */
export function useDocumentDiscussions(targetId: UnpackedHypermediaId, commentId?: string) {
  const client = useUniversalClient()
  return useQuery(queryDocumentDiscussions(client, targetId, commentId))
}

/** Fetches comments that reference a specific document block. */
export function useBlockDiscussions(targetId: UnpackedHypermediaId) {
  const client = useUniversalClient()
  return useQuery(queryBlockDiscussions(client, targetId))
}

/** Fetches all versions of a comment. */
export function useCommentVersions(commentId: string | null | undefined) {
  const client = useUniversalClient()
  return useQuery(queryCommentVersions(client, commentId))
}

/** Fetches the number of replies to a comment. */
export function useCommentReplyCount({id}: {id: string}) {
  const client = useUniversalClient()
  return useQuery(queryCommentReplyCount(client, id))
}

/** Builds local mention relevance from loaded comments in the thread being replied to. */
export function getMentionThreadContext(
  comments: HMComment[] | undefined,
  reply: {replyCommentId?: string | null; replyCommentVersion?: string | null; rootReplyCommentVersion?: string | null},
): MentionThreadContext | undefined {
  if (!comments?.length) return undefined
  const parent = comments.find(
    (c) =>
      (reply.replyCommentId && c.id === reply.replyCommentId) ||
      (reply.replyCommentVersion && c.version === reply.replyCommentVersion),
  )
  const rootVersion = reply.rootReplyCommentVersion || parent?.threadRootVersion || parent?.version
  const rootId =
    parent?.threadRoot ||
    parent?.id ||
    comments.find((c) => rootVersion && c.version === rootVersion)?.id ||
    comments.find((c) => rootVersion && c.threadRootVersion === rootVersion)?.threadRoot
  if (!rootId && !rootVersion) return undefined
  const participants = new Map<string, NonNullable<MentionThreadContext['participants']>[number]>()
  for (const comment of comments) {
    if (
      !(rootId && (comment.id === rootId || comment.threadRoot === rootId)) &&
      !(rootVersion && (comment.version === rootVersion || comment.threadRootVersion === rootVersion))
    )
      continue
    const existing = participants.get(comment.author)
    const time = normalizeDate(comment.createTime)?.getTime()
    participants.set(comment.author, {
      uid: comment.author,
      isThreadAuthor: !!existing?.isThreadAuthor || comment.id === rootId,
      latestCommentTime:
        time === undefined ? existing?.latestCommentTime : Math.max(existing?.latestCommentTime ?? time, time),
    })
  }
  return {replyAuthorUid: parent?.author, participants: Array.from(participants.values())}
}
