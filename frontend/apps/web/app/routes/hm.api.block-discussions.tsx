import {queryClient} from '@/client'
import {getAccount} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {BIG_INT, hmId, parseFragment, unpackHmId} from '@shm/shared'
import {
  HMAccountsMetadata,
  HMComment,
  HMCommentCitation,
} from '@shm/shared/hm-types'

export type HMBlockDiscussionsPayload = {
  citingComments: HMCommentCitation[]
  authors: HMAccountsMetadata
}

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<HMBlockDiscussionsPayload>> => {
  const url = new URL(request.url)
  const targetId = unpackHmId(url.searchParams.get('targetId') || undefined)
  const blockId = url.searchParams.get('blockId')
  if (!targetId) throw new Error('targetId is required')
  if (!blockId) throw new Error('blockId is required')
  // TODO: fix types of comments here
  let result: any | {error: string}

  try {
    const res = await queryClient.entities.listEntityMentions({
      id: targetId.id,
      pageSize: BIG_INT,
    })

    const allComments: HMComment[] = []
    const citingComments: HMCommentCitation[] = []
    for (const mention of res.mentions) {
      try {
        const sourceId = unpackHmId(mention.source)
        if (!sourceId) continue
        console.log('~~ TODO: fix this', mention.sourceType)
        // mention.sourceType
        // if (mention.source?.type !== 'c') continue
        if (mention.targetFragment !== blockId) continue
        const serverComment = await queryClient.comments.getComment({
          id: mention.sourceBlob?.cid,
        })
        if (!serverComment) continue
        const comment = serverComment.toJson({
          emitDefaultValues: true,
        }) as HMComment
        allComments.push(comment)

        const targetFragment = parseFragment(mention.targetFragment)
        const citationTargetId = hmId(targetId.uid, {
          path: targetId.path,
          version: mention.targetVersion,
        })

        const author = comment.author ? await getAccount(comment.author) : null

        citingComments.push({
          source: {
            id: sourceId,
            type: 'c',
            author: mention.sourceBlob?.author,
            time: mention.sourceBlob?.createTime,
          },
          targetFragment,
          targetId: citationTargetId,
          isExactVersion: mention.isExactVersion,
          comment,
          author,
        })
      } catch (error) {
        console.error('=== comment error', error)
      }
    }

    const allAccounts = new Set<string>()
    citingComments.forEach((citation) => {
      if (citation.comment) allAccounts.add(citation.comment.author)
    })
    const allAccountUids = Array.from(allAccounts)
    const accounts = await Promise.all(
      allAccountUids.map(async (accountUid) => {
        return await getAccount(accountUid)
      }),
    )

    result = {
      citingComments,
      authors: Object.fromEntries(
        allAccountUids.map((acctUid, idx) => [acctUid, accounts[idx]]),
      ),
    } satisfies HMBlockDiscussionsPayload
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
