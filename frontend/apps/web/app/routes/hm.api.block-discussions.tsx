import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {parseFragment, unpackHmId} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'
import {HMComment} from '@shm/shared/hm-types'
import {ListCommentsByReferenceResponse} from '@shm/shared/models/comments-service'
import {loadBatchAccounts} from '@shm/shared/models/entity'

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<ListCommentsByReferenceResponse>> => {
  const url = new URL(request.url)
  const targetId = unpackHmId(url.searchParams.get('targetId') || undefined)
  const blockId = url.searchParams.get('blockId')
  if (!targetId) throw new Error('targetId is required')
  if (!blockId) throw new Error('blockId is required')

  let result: ListCommentsByReferenceResponse | {error: string}

  try {
    const citations = await grpcClient.entities.listEntityMentions({
      id: targetId.id,
      pageSize: BIG_INT,
    })

    const commentCitations = citations.mentions.filter((m) => {
      if (m.sourceType != 'Comment') return false
      const targetFragment = parseFragment(m.targetFragment)
      if (!targetFragment) return false
      return targetFragment.blockId == blockId
    })

    const commentIds = commentCitations
      .map((c) => {
        const id = unpackHmId(c.source)
        if (!id) return null
        return `${id.uid}/${id.path}`
      })
      .filter(Boolean) as Array<string>

    const res = await grpcClient.comments.batchGetComments({
      ids: commentIds,
    })

    const authorAccounts = new Set<string>()

    const comments = res.comments
      .sort((a, b) => {
        const aTime =
          a?.updateTime && typeof a?.updateTime == 'string'
            ? new Date(a?.updateTime).getTime()
            : 0
        const bTime =
          b?.updateTime && typeof b?.updateTime == 'string'
            ? new Date(b?.updateTime).getTime()
            : 1
        return aTime - bTime // Newest first (descending order)
      })
      .map((c) => {
        if (c.author && c.author.trim() !== '') {
          authorAccounts.add(c.author)
        }
        return c.toJson({emitDefaultValues: true})
      }) as Array<HMComment>

    const authorAccountUids = Array.from(authorAccounts)
    const authors = await loadBatchAccounts(authorAccountUids)

    result = {
      comments,
      authors,
    }
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
