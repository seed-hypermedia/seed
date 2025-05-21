import {queryClient} from '@/client'
import {parseRequest} from '@/request'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {BIG_INT, unpackHmId} from '@shm/shared'

export type InteractionSummaryPayload = {
  citations: number
  comments: number
  blocks: Record<
    string,
    {
      citations: number
      comments: number
    }
  >
}

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<InteractionSummaryPayload>> => {
  const url = parseRequest(request)
  //   const id = parsedRequest.searchParams.get('id')
  const id = unpackHmId(url.searchParams.get('id') || undefined)

  if (!id) {
    return wrapJSON({
      citations: 0,
      comments: 0,
      blocks: {},
    })
  }
  const mentions = await queryClient.entities.listEntityMentions({
    id: id.id,
    pageSize: BIG_INT,
  })

  //   const comments = await queryClient.comments.listComments({
  //     targetAccount: id.uid,
  //     targetPath: hmIdPathToEntityQueryPath(id.path),
  //     pageSize: BIG_INT,
  //   })

  //   const commentMentions = mentions.mentions.filter((mention) => {
  //     const sourceId = unpackHmId(mention.source)
  //     if (!sourceId) return false
  //     if (sourceId.type !== 'c') return false
  //     return true
  //   })

  const blocks: Record<string, {citations: number; comments: number}> = {}

  let citationCount = 0
  let commentCount = 0

  mentions.mentions.forEach((mention) => {
    const sourceId = unpackHmId(mention.source)
    if (!sourceId) return false
    const targetFragment = mention.targetFragment
    const targetBlockId =
      targetFragment.at(-1) === '+'
        ? targetFragment.slice(0, -1)
        : targetFragment
    const blockCounts = targetBlockId
      ? (blocks[targetBlockId] = {
          citations: 0,
          comments: 0,
        })
      : null
    if (sourceId.type === 'c') {
      if (blockCounts) blockCounts.comments += 1
      commentCount += 1
    }
    if (sourceId.type === 'd') {
      if (blockCounts) blockCounts.citations += 1
      citationCount += 1
    }
  })

  return wrapJSON({
    citations: citationCount,
    comments: commentCount,
    blocks,
  } satisfies InteractionSummaryPayload)
}
