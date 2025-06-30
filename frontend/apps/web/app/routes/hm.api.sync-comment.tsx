import {queryClient} from '@/client'
import {withCors} from '@/utils/cors'
import {discoverDocument} from '@/utils/discovery'
import {ActionFunction, json, LoaderFunction} from '@remix-run/node'
import {
  hmIdPathToEntityQueryPath,
  unpackedHmIdSchema,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {tryUntilSuccess} from '@shm/shared/try-until-success'
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
    console.log('sync comment body', body)
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
    console.log('will discover dependencies', dependencies)
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
  console.log('syncing comment1', targetId)
  const discovered = await queryClient.entities.discoverEntity({
    account: targetId.uid,
    path: hmIdPathToEntityQueryPath(targetId.path),
    recursive: true,
  })
  const comment = await tryUntilSuccess(
    async () => {
      console.log('checking comment', commentId)
      const comment = await queryClient.comments.getComment({
        id: commentId,
      })
      console.log('comment', comment)
      return comment
    },
    {
      retryDelayMs: 1000,
      maxRetryMs: 30_000,
    },
  )
}
