import {SignedComment} from '@/api'
import {queryClient} from '@/client'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {ActionFunction, json} from '@remix-run/node'
import {
  entityQueryPathToHmIdPath,
  HMBlockNodeSchema,
  HMComment,
  hmId,
  HMPublishableBlock,
  HMTimestampSchema,
  UnpackedHypermediaId,
  unpackHmId,
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

export type CommentResponsePayload = {
  dependencies: UnpackedHypermediaId[]
  commentId: string
  targetId: UnpackedHypermediaId
  comment: HMComment
  message: string
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
  const signerUid = base58btc.encode(comment.signer)
  const resultCommentId = resultComment.cids[0]
  if (!resultCommentId) {
    return json({message: 'Failed to store comment'}, {status: 500})
  }
  const targetUid = base58btc.encode(comment.space)
  const targetId = hmId(targetUid, {
    path: entityQueryPathToHmIdPath(comment.path),
  })
  const dependencies: UnpackedHypermediaId[] = [
    hmId(signerUid, {}),
    ...extractReferenceMaterials(comment.body), // warning! this does not include references of references, so there may be incomplete content syncronized but lets not worry about that for now!
  ]
  const commentResult = await queryClient.comments.getComment({
    id: resultCommentId,
  })
  return json({
    message: 'Success',
    dependencies,
    commentId: resultCommentId,
    // @ts-expect-error
    comment: commentResult.toJson(),
    targetId,
  } satisfies CommentResponsePayload)
}

/**
 * Extracts reference materials (links and embeds) from a publishable block.
 *
 * @param body - The body of the publishable block.
 * @returns An array of HMIds
 */
function extractReferenceMaterials(body: HMPublishableBlock[]) {
  const references: UnpackedHypermediaId[] = []

  function reviewBlock(block: HMPublishableBlock) {
    // skip over query blocks because comments don't support them yet.
    // if (block.type === 'Query') {
    //   return
    // }
    if (block.type === 'Embed' && block.link) {
      const id = unpackHmId(block.link)
      if (id) references.push(id)
    }
    if (block.type === 'Paragraph' || block.type === 'Heading') {
      block.annotations.forEach((annotation) => {
        if (annotation.type === 'Link') {
          const id = unpackHmId(annotation.link)
          if (id) references.push(id)
        }
      })
    }
  }
  body.forEach(reviewBlock)
  return references
}
