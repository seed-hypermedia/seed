import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {createDiscussionsResolver, unpackHmId} from '@shm/shared'
import {ListDiscussionsResponse} from '@shm/shared/models/comments-service'

const loadDiscussions = createDiscussionsResolver(grpcClient)

export type HMDiscussionsPayload = ListDiscussionsResponse

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

  const result = await loadDiscussions(targetId, undefined)

  return wrapJSON(result)
}
