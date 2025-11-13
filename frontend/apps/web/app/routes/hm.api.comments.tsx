import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {createCommentsResolver, unpackHmId} from '@shm/shared'
import {ListCommentsResponse} from '@shm/shared/models/comments-service'

const loadComments = createCommentsResolver(grpcClient)

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<ListCommentsResponse>> => {
  const url = new URL(request.url)
  const targetId = unpackHmId(url.searchParams.get('targetId') || undefined)
  if (!targetId) throw new Error('targetId is required')

  const result = await loadComments(targetId)

  return wrapJSON(result)
}
