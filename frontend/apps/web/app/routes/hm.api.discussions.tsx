import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {createDiscussionsResolver, HMListDiscussionsOutput, unpackHmId} from '@shm/shared'

const loadDiscussions = createDiscussionsResolver(grpcClient)

export type HMDiscussionsPayload = HMListDiscussionsOutput

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
