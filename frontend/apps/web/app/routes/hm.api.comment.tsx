import {SignedComment} from '@/api'
import {queryClient} from '@/client'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {ActionFunction, json} from '@remix-run/node'
import {
  entityQueryPathToHmIdPath,
  HMBlockNodeSchema,
  hmId,
  HMTimestampSchema,
} from '@shm/shared'
import {base58btc} from 'multiformats/bases/base58'
import {z} from 'zod'

const createCommentSchema = z
  .object({
    username: z.string(),
    hostname: z.string().optional(),
    response: z.object({
      clientDataJSON: z.string(),
      authenticatorData: z.string(),
      signature: z.string(),
    }),
  })
  .strict()

export type CreateCommentPayload = z.infer<typeof createCommentSchema>

const hmUnsignedCommentSchema = z.object({
  content: z.array(HMBlockNodeSchema),
  createTime: HMTimestampSchema,
})

export type HMUnsignedComment = z.infer<typeof hmUnsignedCommentSchema>

export type CommentPayload = {
  comment: Uint8Array
  blobs: {cid: string; data: Uint8Array}[]
  commentingOriginUrl?: string | undefined
}

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return json({message: 'Method not allowed'}, {status: 405})
  }
  if (request.headers.get('Content-Type') !== 'application/cbor') {
    return json(
      {message: 'Content-Type must be application/cbor'},
      {status: 400},
    )
  }
  const cborData = await request.arrayBuffer()
  const commentPayload = cborDecode(new Uint8Array(cborData)) as CommentPayload
  await queryClient.daemon.storeBlobs({blobs: commentPayload.blobs})
  const resultComment = await queryClient.daemon.storeBlobs({
    blobs: [
      {
        data: commentPayload.comment,
      },
    ],
  })
  const comment = cborDecode(
    new Uint8Array(commentPayload.comment),
  ) as SignedComment
  const resultCommentId = resultComment.cids[0]
  console.log('resultComment', resultCommentId, comment)
  if (!resultCommentId) {
    return json({message: 'Failed to store comment'}, {status: 500})
  }
  if (commentPayload.commentingOriginUrl) {
    const targetUid = base58btc.encode(comment.space)
    const targetId = hmId('d', targetUid, {
      path: entityQueryPathToHmIdPath(comment.path),
    })
    const url = new URL(commentPayload.commentingOriginUrl)
    const resp = await fetch(`${url.origin}/hm/api/sync-comment`, {
      method: 'POST',
      body: JSON.stringify({
        commentId: resultCommentId,
        target: targetId.id,
      }),
    })
    console.log('sync comment to url', url)
    console.log(resp.status)
  }
  return json({
    message: 'Success',
  })
}
