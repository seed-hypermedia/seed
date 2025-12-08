import {GRPCClient} from '..'

/**
 * @deprecated Use client.request<HMGetCommentReplyCountRequest>('GetCommentReplyCount', {id}) instead
 * Kept only for backwards compatibility with existing code that hasn't been migrated
 */
export async function getCommentReplyCountImpl({
  client,
  params,
}: {
  client: GRPCClient
  params: {id: string}
}): Promise<number> {
  let req = await client.comments.getCommentReplyCount(params)
  return Number(req.replyCount)
}
