import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {unpackHmId} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'
import {HMCitationsPayload, HMComment} from '@shm/shared/hm-types'
import {ListCommentsResponse} from '@shm/shared/models/comments-service'
import {createBatchAccountsResolver} from '@shm/shared/models/entity'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'

const loadBatchAccounts = createBatchAccountsResolver(grpcClient)

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

  let allComments: HMComment[] = []
  let authors = {}

  const data = await grpcClient.comments.listComments({
    targetAccount: targetId.uid,
    targetPath: hmIdPathToEntityQueryPath(targetId.path),
    pageSize: BIG_INT,
  })

  allComments = data.comments.map(
    (comment) => comment.toJson({emitDefaultValues: true}) as HMComment,
  )

  const allAccounts = new Set<string>()
  allComments.forEach((comment) => {
    if (comment.author && comment.author.trim() !== '') {
      allAccounts.add(comment.author)
    }
  })
  const authorAccountUids = Array.from(allAccounts)
  if (authorAccountUids.length > 0) {
    authors = await loadBatchAccounts(authorAccountUids)
  }

  const result: ListCommentsResponse = {
    comments: allComments,
    authors,
  }

  return wrapJSON(result)
}
