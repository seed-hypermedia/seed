import {queryClient} from '@/client'
import {parseRequest} from '@/request'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {
  BIG_INT,
  deduplicateCitations,
  hmIdPathToEntityQueryPath,
  unpackHmId,
} from '@shm/shared'

export type InteractionSummaryPayload = {
  citations: number
  comments: number
  changes: number
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

  const comments = await queryClient.comments.listComments({
    targetAccount: id.uid,
    targetPath: hmIdPathToEntityQueryPath(id.path),
    pageSize: BIG_INT,
  })

  const docCitations = mentions.mentions
    .map((mention) => {
      if (mention.sourceType !== 'Ref') return null
      const sourceId = unpackHmId(mention.source)
      if (!sourceId) return null
      return {
        source: {
          id: sourceId,
          type: 'd',
          author: mention.sourceBlob?.author,
          time: mention.sourceBlob?.createTime,
        },
        targetFragment: mention.targetFragment,
        isExactVersion: mention.isExactVersion,
        targetId: id,
      }
    })
    .filter((d) => !!d)
  const dedupedDocCitations = deduplicateCitations(docCitations)
  let citationCount = docCitations.length
  let commentCount = 0
  const blocks: Record<string, {citations: number; comments: number}> = {}
  dedupedDocCitations.forEach((mention) => {
    if (!mention.source.id) return false
    const targetFragment = mention.targetFragment
    const targetBlockId =
      targetFragment.at(-1) === '+'
        ? targetFragment.slice(0, -1)
        : targetFragment
    const blockCounts = targetBlockId
      ? (blocks[targetBlockId] = blocks[targetBlockId] || {
          citations: 0,
          comments: 0,
        })
      : null
    if (mention.source.id.type === 'c') {
      if (blockCounts) blockCounts.comments += 1
      commentCount += 1
    }
    if (mention.source.id.type === 'd' && blockCounts) {
      blockCounts.citations += 1
    }
  })

  const latestDoc = await queryClient.documents.getDocument({
    account: id.uid,
    path: hmIdPathToEntityQueryPath(id.path),
    version: undefined,
  })
  const changes = await queryClient.documents.listDocumentChanges({
    account: id.uid,
    path: id.path && id.path.length > 0 ? '/' + id.path.join('/') : '',
    version: latestDoc.version,
  })

  return wrapJSON({
    citations: citationCount,
    comments: comments.comments.length,
    changes: changes.changes.length,
    blocks,
  } satisfies InteractionSummaryPayload)
}
