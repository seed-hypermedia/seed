import {grpcClient} from '@/client'
import {getAccount} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {
  BIG_INT,
  getCommentGroups,
  hmIdPathToEntityQueryPath,
  unpackHmId,
} from '@shm/shared'
import {HMComment} from '@shm/shared/hm-types'
import {ListDiscussionsResponse} from '@shm/shared/models/comments-service'

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

    const authorAccountUids = Array.from(authorAccounts)
    const accounts = await Promise.all(
      authorAccountUids.map(async (accountUid) => {
        return await getAccount(accountUid, {discover: true})
      }),
    )

    result = {
      discussions: commentGroups,
      authors: Object.fromEntries(
        authorAccountUids.map((acctUid, idx) => [acctUid, accounts[idx] || {}]),
      ),
    } satisfies ListDiscussionsResponse
  } catch (error: any) {
    console.error('=== Discussions API error', error)
    result = {error: error.message}
  }

  return wrapJSON(result)
}
