import {grpcClient} from '@/client'
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

  let result: HMBlockDiscussionsPayload | {error: string}

  try {
    const res = await grpcClient.entities.listEntityMentions({
      id: targetId.id,
      pageSize: BIG_INT,
    })

    const allComments: HMComment[] = []
    const citingComments: HMCommentCitation[] = []
    for (const mention of res.mentions) {
      try {
        const sourceId = unpackHmId(mention.source)
        if (!sourceId) continue

        // ignore if not a comment
        if (mention.sourceType !== 'Comment') continue
        // ignore if not citing the block
        if (mention.targetFragment !== blockId) continue
        try {
          // get the comment from the server
          const serverComment = await grpcClient.comments.getComment({
            id: mention.sourceBlob?.cid,
          })
          // ignore if not found
          if (!serverComment) continue
          // convert to HMComment
          const comment = serverComment.toJson({
            emitDefaultValues: true,
          }) as HMComment
          // add to all comments
          allComments.push(comment)

          // get the target fragment
          const targetFragment = parseFragment(mention.targetFragment)
          // get the target id
          const citationTargetId = hmId(targetId.uid, {
            path: targetId.path,
            version: mention.targetVersion,
          })

          // get the author
          const author = comment.author
            ? await getAccount(comment.author)
            : null

          // add to citing comments
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

    const accounts = citingComments
      .filter((c) => !!c.author)
      .map((citation) => citation.author)
      .reduce((acc, author) => {
        if (!author || !author.id.id || !author.metadata) return acc

        acc[author.id.id] = {
          id: author.id,
          metadata: author.metadata,
        }
        return acc
      }, {} as HMAccountsMetadata)

    result = {
      citingComments,
      authors: accounts,
    } satisfies HMBlockDiscussionsPayload
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
