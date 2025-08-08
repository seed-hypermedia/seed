import {queryClient} from '@/client'
import {getAccount} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {BIG_INT, getCommentGroups, unpackHmId} from '@shm/shared'
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
    const res = await queryClient.entities.listEntityMentions({
      id: id.id,
      pageSize: BIG_INT,
    })

    const allComments: HMComment[] = []

    for (const mention of res.mentions) {
      try {
        const sourceId = unpackHmId(mention.source)
        if (!sourceId) continue
        try {
          const comment = await queryClient.comments.getComment({
            id: mention.sourceBlob?.cid,
          })
          if (!comment) continue
          allComments.push(
            comment.toJson({emitDefaultValues: true}) as HMComment,
          )
        } catch (commentError: any) {
          // Handle ConnectError for NotFound comments gracefully
          if (
            commentError?.code === 'not_found' ||
            commentError?.message?.includes('not found')
          ) {
            console.warn(
              `Comment ${mention.sourceBlob?.cid} not found, skipping`,
            )
            continue
          }
          // Re-throw other errors
          throw commentError
        }
      } catch (error) {
        console.error('=== comment error', error)
      }
    }

    const allAccounts = new Set<string>()
    allComments.forEach((comment) => {
      allAccounts.add(comment.author)
    })
    const allAccountUids = Array.from(allAccounts)
    const accounts = await Promise.all(
      allAccountUids.map(async (accountUid) => {
        return await getAccount(accountUid)
      }),
    )

    const commentGroups = getCommentGroups(allComments, undefined)

    result = {
      allComments,
      commentGroups: commentGroups,
      // @ts-expect-error
      commentAuthors: Object.fromEntries(
        allAccountUids.map((acctUid, idx) => [acctUid, accounts[idx]]),
      ),
    } satisfies HMCommentsPayload
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
