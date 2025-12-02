import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {getCommentReplyCountImpl} from '@shm/shared/models/comments-service'

export const loader = async ({
  request,
}: {
  request: Request
}): Promise<WrappedResponse<number>> => {
  const url = new URL(request.url)
  const commentId = url.searchParams.get('targetId') || ''

  try {
    const result = await getCommentReplyCountImpl({
      client: grpcClient,
      params: {id: commentId},
    })
    return wrapJSON(result)
  } catch (error: any) {
    return wrapJSON({error: error.message})
  }
}
