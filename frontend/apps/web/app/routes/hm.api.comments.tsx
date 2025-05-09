import {queryClient} from '@/client'
import {getAccount} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {
  BIG_INT,
  getCommentGroups,
  hmIdPathToEntityQueryPath,
  unpackHmId,
} from '@shm/shared'
import {
  HMCitationsPayload,
  HMComment,
  HMCommentsPayload,
} from '@shm/shared/hm-types'

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<HMCitationsPayload>> => {
  const url = new URL(request.url)
  const id = unpackHmId(url.searchParams.get('id') || undefined)
  if (!id) throw new Error('id is required')
  // TODO: fix types of comments here
  let result: any | {error: string}
  try {
    const res = await queryClient.comments.listComments({
      targetAccount: id.uid,
      targetPath: hmIdPathToEntityQueryPath(id.path),
      pageSize: BIG_INT,
    })

    const allComments = res.comments.map(
      (comment) => comment.toJson({emitDefaultValues: true}) as HMComment,
    )

    const allAccounts = new Set<string>()
    allComments.forEach((comment) => {
      allAccounts.add(comment.author)
    })

    const accounts = await Promise.all(
      Array.from(allAccounts).map(async (accountUid) => {
        return await getAccount(accountUid)
      }),
    )

    const commentGroups = getCommentGroups(allComments, null)

    result = {
      allComments,
      commentGroups: commentGroups,
      commentAuthors: Object.fromEntries(
        accounts.map((account) => [
          account.id.uid,
          {id: account.id, metadata: account.metadata},
        ]),
      ),
    } satisfies HMCommentsPayload
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
