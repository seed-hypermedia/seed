import {grpcClient} from '@/client.server'
import {getMetadata} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {
  getCommentGroups,
  hmIdPathToEntityQueryPath,
  unpackHmId,
} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'
import {HMComment, HMExternalCommentGroup} from '@shm/shared/hm-types'
import {ListDiscussionsResponse} from '@shm/shared/models/comments-service'
import {loadBatchAccounts} from '@shm/shared/models/entity'

export type HMDiscussionsPayload = ListDiscussionsResponse

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<HMDiscussionsPayload>> => {
  const url = new URL(request.url)
  const targetId = unpackHmId(url.searchParams.get('targetId') || undefined)
  if (!targetId) throw new Error('targetId is required')

  const authorAccounts = new Set<string>()
  let commentGroups: any[] = []
  let citingDiscussions: HMExternalCommentGroup[] = []

  // Fetch direct comments with error handling
  try {
    const data = await grpcClient.comments.listComments({
      targetAccount: targetId.uid,
      targetPath: hmIdPathToEntityQueryPath(targetId.path),
      pageSize: BIG_INT,
    })

    const allComments = data.comments.map(
      (comment) => comment.toJson({emitDefaultValues: true}) as HMComment,
    )
    commentGroups = getCommentGroups(allComments, undefined)

    commentGroups.forEach((group) => {
      group.comments.forEach((comment) => {
        if (comment.author && comment.author.trim() !== '') {
          authorAccounts.add(comment.author)
        }
      })
    })
  } catch (error: any) {
    console.error('Failed to load direct discussions:', error.message)
  }

  // Fetch citing discussions with error handling
  try {
    const citations = await grpcClient.entities.listEntityMentions({
      id: targetId.id,
      pageSize: BIG_INT,
    })

    const citingComments = citations.mentions.filter((m) => {
      if (m.sourceType != 'Comment') return false
      if (m.sourceDocument === targetId.id) return false
      return true
    })

    // Process each citing comment independently with error handling
    const citingDiscussionResults = await Promise.allSettled(
      citingComments.map(async (c) => {
        const commentTargetId = unpackHmId(c.sourceDocument)!
        const commentsQuery = await grpcClient.comments.listComments({
          targetAccount: commentTargetId.uid,
          targetPath: hmIdPathToEntityQueryPath(commentTargetId.path),
          pageSize: BIG_INT,
        })
        const comments = commentsQuery.comments.map((c) =>
          c.toJson({emitDefaultValues: true}),
        ) as Array<HMComment>
        const citingComment = comments.find(
          (comment) => comment.id === c.source.slice(5),
        )!

        if (citingComment?.author && citingComment.author.trim() !== '') {
          authorAccounts.add(citingComment.author)
        }

        const commentGroups = getCommentGroups(comments, c.source.slice(5))
        const selectedComments = commentGroups[0]?.comments || []
        selectedComments.forEach((comment) => {
          if (comment.author && comment.author.trim() !== '') {
            authorAccounts.add(comment.author)
          }
        })

        return {
          comments: [citingComment, ...selectedComments],
          moreCommentsCount: 0,
          id: c.source,
          target: await getMetadata(unpackHmId(c.sourceDocument)!),
          type: 'externalCommentGroup',
        }
      }),
    )

    // Extract successful results and log failures
    citingDiscussions = citingDiscussionResults
      .filter((result): result is PromiseFulfilledResult<HMExternalCommentGroup> => {
        if (result.status === 'rejected') {
          console.error('Failed to load citing discussion:', result.reason)
          return false
        }
        return true
      })
      .map((result) => result.value)
  } catch (error: any) {
    console.error('Failed to load citing discussions:', error.message)
  }

  // Load authors with error handling
  let authors = {}
  try {
    const authorAccountUids = Array.from(authorAccounts)
    if (authorAccountUids.length > 0) {
      authors = await loadBatchAccounts(authorAccountUids)
    }
  } catch (error: any) {
    console.error('Failed to load authors:', error.message)
  }

  const result: ListDiscussionsResponse = {
    discussions: commentGroups,
    citingDiscussions,
    authors,
  }

  return wrapJSON(result)
}
