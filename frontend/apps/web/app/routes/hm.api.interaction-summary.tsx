import {grpcClient} from '@/client'
import {parseRequest} from '@/request'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import type {Params} from 'react-router'
import {
  calculateInteractionSummary,
  hmIdPathToEntityQueryPath,
  InteractionSummaryPayload,
  unpackHmId,
} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'

export type {InteractionSummaryPayload} from '@shm/shared'

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<InteractionSummaryPayload>> => {
  const url = parseRequest(request)
  const id = unpackHmId(url.searchParams.get('id') || undefined)

  if (!id) {
    return wrapJSON({
      citations: 0,
      comments: 0,
      changes: 0,
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

  const summary = calculateInteractionSummary(
    mentions.mentions,
    comments.comments,
    changes.changes,
    id,
  )

  return wrapJSON(summary)
}
