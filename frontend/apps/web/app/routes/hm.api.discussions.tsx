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
  let result: HMDiscussionsPayload | {error: string}

  const citations = await grpcClient.entities.listEntityMentions({
    id: targetId.id,
    pageSize: BIG_INT,
  })

  const citingComments = citations.mentions.filter((m) => {
    if (m.sourceType != 'Comment') return false
    return true
  })

  console.log('=== citingComments', citingComments)

  try {
    const data = await grpcClient.comments.listComments({
      targetAccount: targetId.uid,
      targetPath: hmIdPathToEntityQueryPath(targetId.path),
      pageSize: BIG_INT,
    })

    const allComments = data.comments.map(
      (comment) => comment.toJson({emitDefaultValues: true}) as HMComment,
    )
    const commentGroups = getCommentGroups(allComments, undefined)

    const authorAccounts = new Set<string>()

    commentGroups.forEach((group) => {
      group.comments.forEach((comment) => {
        authorAccounts.add(comment.author)
      })
    })

    const citations = await grpcClient.entities.listEntityMentions({
      id: targetId.id,
      pageSize: BIG_INT,
    })

    const citingComments = citations.mentions.filter((m) => {
      if (m.sourceType != 'Comment') return false
      if (m.sourceDocument === targetId.id) return false
      return true
    })

    const citingDiscussions: HMExternalCommentGroup[] = await Promise.all(
      citingComments.map(async (c) => {
        const targetId = unpackHmId(c.sourceDocument)!
        const commentsQuery = await grpcClient.comments.listComments({
          targetAccount: targetId.uid,
          targetPath: hmIdPathToEntityQueryPath(targetId.path),
          pageSize: BIG_INT,
        })
        const comments = commentsQuery.comments.map((c) =>
          c.toJson({emitDefaultValues: true}),
        ) as Array<HMComment>
        const citingComment = comments.find(
          (comment) => comment.id === c.source.slice(5),
        )!
        authorAccounts.add(citingComment.author)
        const commentGroups = getCommentGroups(comments, c.source.slice(5))
        const selectedComments = commentGroups[0]?.comments || []
        selectedComments.forEach((comment) => {
          authorAccounts.add(comment.author)
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

    const authorAccountUids = Array.from(authorAccounts)
    const authors = await loadBatchAccounts(authorAccountUids)

    result = {
      discussions: commentGroups,
      citingDiscussions,
      authors,
    } satisfies ListDiscussionsResponse
  } catch (error: any) {
    console.error('=== Discussions API error', error)
    result = {error: error.message}
  }

  return wrapJSON(result)
}
