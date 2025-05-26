import {queryClient} from '@/client'
import {getAccount} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {BIG_INT, getCommentGroups, unpackHmId} from '@shm/shared'
import {
  HMAccountsMetadata,
  HMComment,
  HMCommentGroup,
} from '@shm/shared/hm-types'

export type HMDiscussionsPayload = {
  commentGroups: HMCommentGroup[]
  authors: HMAccountsMetadata
}

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
    const res = await queryClient.entities.listEntityMentions({
      id: targetId.id,
      pageSize: BIG_INT,
    })

    const allComments: HMComment[] = []
    const alreadyCommentIds = new Set<string>()
    for (const mention of res.mentions) {
      try {
        const sourceId = unpackHmId(mention.source)
        if (!sourceId) continue
        if (sourceId.type !== 'c') continue
        if (!mention.sourceBlob?.cid) continue
        if (alreadyCommentIds.has(mention.sourceBlob?.cid)) continue
        const comment = await queryClient.comments.getComment({
          id: mention.sourceBlob.cid,
        })
        alreadyCommentIds.add(mention.sourceBlob.cid)
        if (!comment) continue
        allComments.push(comment.toJson({emitDefaultValues: true}) as HMComment)
      } catch (error) {
        console.error('=== comment error', error)
      }
    }

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
        return await getAccount(accountUid)
      }),
    )

    result = {
      commentGroups: commentGroups,
      authors: Object.fromEntries(
        authorAccountUids.map((acctUid, idx) => [acctUid, accounts[idx]]),
      ),
    } satisfies HMDiscussionsPayload
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
