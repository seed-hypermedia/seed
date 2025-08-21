import {grpcClient} from '@/client'
import {getAccount} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {BIG_INT, unpackHmId} from '@shm/shared'
import {HMCitationsPayload, HMComment} from '@shm/shared/hm-types'
import {ListCommentsResponse} from '@shm/shared/models/comments-service'
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
    const allAccountUids = Array.from(allAccounts)
    const accounts = await Promise.all(
      allAccountUids.map(async (accountUid) => {
        try {
          return await getAccount(accountUid, {discover: true})
        } catch (e) {
          console.error(`Error fetching account ${accountUid}`, e)
          return {}
        }
      }),
    )

    result = {
      comments: allComments,
      authors: Object.fromEntries(
        allAccountUids.map((acctUid, idx) => [acctUid, accounts[idx] || {}]),
      ),
    } satisfies ListCommentsResponse
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
