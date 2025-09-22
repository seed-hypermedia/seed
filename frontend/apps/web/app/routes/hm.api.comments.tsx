import {grpcClient} from '@/client'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {hmId, unpackHmId} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'
import {
  HMAccount,
  HMCitationsPayload,
  HMComment,
  HMMetadataPayload,
} from '@shm/shared/hm-types'
import {ListCommentsResponse} from '@shm/shared/models/comments-service'
import {loadBatchAccounts} from '@shm/shared/models/entity'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<HMCitationsPayload>> => {
  const url = new URL(request.url)
  const targetId = unpackHmId(url.searchParams.get('targetId') || undefined)
  if (!targetId) throw new Error('targetId is required')
  // TODO: fix types of comments here
  let result: any | {error: string}

  try {
    const data = await grpcClient.comments.listComments({
      targetAccount: targetId.uid,
      targetPath: hmIdPathToEntityQueryPath(targetId.path),
      pageSize: BIG_INT,
    })

    const allComments = data.comments.map(
      (comment) => comment.toJson({emitDefaultValues: true}) as HMComment,
    )

    const allAccounts = new Set<string>()
    allComments.forEach((comment) => {
      allAccounts.add(comment.author)
    })
    const authorAccountUids = Array.from(allAccounts)
    const authors = await loadBatchAccounts(authorAccountUids)

    result = {
      comments: allComments,
      authors,
    } satisfies ListCommentsResponse
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
