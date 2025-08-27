import {grpcClient} from '@/client'
import {parseRequest} from '@/request'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {
  BIG_INT,
  deduplicateCitations,
  hmIdPathToEntityQueryPath,
  unpackHmId,
} from '@shm/shared'
import {parseFragment} from '@shm/shared/utils/entity-id-url'

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
  const mentions = await grpcClient.entities.listEntityMentions({
    id: id.id,
    pageSize: BIG_INT,
  })

  const comments = await grpcClient.comments.listComments({
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
  let citationCount = dedupedDocCitations.length
  let commentCount = 0
  const blocks: Record<string, {citations: number; comments: number}> = {}
  // @ts-expect-error
  dedupedDocCitations.forEach((mention) => {
    if (!mention.source.id) return false
    const targetFragment = parseFragment(mention.targetFragment)

    const blockCounts = targetFragment?.blockId
      ? (blocks[targetFragment?.blockId] = blocks[targetFragment?.blockId] || {
          citations: 0,
          comments: 0,
        })
      : null

    if (mention.source.type == 'c') {
      if (blockCounts) blockCounts.comments += 1
      commentCount += 1
    }
    if (mention.source.type === 'd' && blockCounts) {
      blockCounts.citations += 1
    }
  })

  const latestDoc = await grpcClient.documents.getDocument({
    account: id.uid,
    path: hmIdPathToEntityQueryPath(id.path),
    version: undefined,
  })
  const changes = await grpcClient.documents.listDocumentChanges({
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
