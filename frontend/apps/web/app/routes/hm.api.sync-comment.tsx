import {queryClient} from '@/client'
import {withCors} from '@/utils/cors'
import {discoverDocument} from '@/utils/discovery'
import {tryUntilSuccess} from '@/utils/try-until-success'
import {ActionFunction, json, LoaderFunction} from '@remix-run/node'
import {
  hmIdPathToEntityQueryPath,
  unpackedHmIdSchema,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {z} from 'zod'

const syncCommentRequestSchema = z.object({
  commentId: z.string(),
  target: z.string(),
  dependencies: z.array(unpackedHmIdSchema),
})

export type SyncCommentRequest = z.infer<typeof syncCommentRequestSchema>

export const loader: LoaderFunction = async ({request}) => {
  return withCors(json({message: 'Method not allowed'}, {status: 405}))
}

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return withCors(json({message: 'Method not allowed'}, {status: 405}))
  }
  try {
    const body = await request.json()
    const {commentId, target, dependencies} =
      syncCommentRequestSchema.parse(body)
    const targetId = unpackHmId(target)
    if (!targetId) {
      return json({message: 'Invalid target'}, {status: 400})
    }
    const commentExists = await getCommentExists(commentId)
    if (!commentExists) {
      await syncComment({
        commentId,
        targetId,
      })
    }
    await Promise.all(
      dependencies.map((dependency) => {
        return discoverDocument(
          dependency.uid,
          dependency.path || [],
          dependency.latest ? undefined : dependency.version ?? undefined,
        )
      }),
    )
    return withCors(
      json({
        message: 'Success',
      }),
    )
  } catch (error) {
    return withCors(
      json({message: 'Error syncing comment:' + error.message}, {status: 500}),
    )
  }
}

async function getCommentExists(commentId: string) {
  try {
    await queryClient.comments.getComment({
      id: commentId,
    })
    return true
  } catch (error) {
    return false
  }
}

async function syncComment({
  commentId,
  targetId,
}: {
  commentId: string
  targetId: UnpackedHypermediaId
}) {
  const discovered = await queryClient.entities.discoverEntity({
    account: targetId.uid,
    path: hmIdPathToEntityQueryPath(targetId.path),
    recursive: true,
  })
  await tryUntilSuccess(
    async () => {
      const comment = await queryClient.comments.getComment({
        id: commentId,
      })
      if (comment) {
        return true
      }
      return false
    },
    1000,
    30_000,
  )
}
