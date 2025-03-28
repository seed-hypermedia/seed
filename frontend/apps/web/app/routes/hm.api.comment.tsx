import {queryClient} from '@/client'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {ActionFunction, json} from '@remix-run/node'
import {HMBlockNodeSchema, HMTimestampSchema} from '@shm/shared'
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
  await queryClient.daemon.storeBlobs({
    blobs: [
      {
        data: commentPayload.comment,
      },
    ],
  })
  return json({
    message: 'Success',
  })
}
