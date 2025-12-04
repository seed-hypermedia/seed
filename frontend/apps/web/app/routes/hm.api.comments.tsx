import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {
  createCommentsResolver,
  HMListCommentsOutput,
  unpackHmId,
} from '@shm/shared'

const loadComments = createCommentsResolver(grpcClient)

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<HMListCommentsOutput>> => {
  const url = new URL(request.url)
  const targetId = unpackHmId(url.searchParams.get('targetId') || undefined)
  if (!targetId) throw new Error('targetId is required')

  const result = await loadComments(targetId)

  return wrapJSON(result)
}
