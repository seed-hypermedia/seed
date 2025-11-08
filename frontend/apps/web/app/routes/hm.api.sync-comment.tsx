import {grpcClient} from '@/client.server'
import {withCors} from '@/utils/cors'
import {discoverDocument} from '@/utils/discovery'
import {ActionFunction, LoaderFunction} from 'react-router'
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
  return withCors(
    Response.json({message: 'Method not allowed'}, {status: 405}),
  )
}

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return withCors(
      Response.json(
        {message: 'Method not allowed'},
        {status: 405},
      ),
    )
  }
  try {
    const body = await request.json()
    console.log('sync comment body', body)
    const {commentId, target, dependencies} =
      syncCommentRequestSchema.parse(body)
    const targetId = unpackHmId(target)
    if (!targetId) {
      return Response.json({message: 'Invalid target'}, {status: 400})
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
      Response.json({
        message: 'Success',
      }),
    )
  } catch (error: any) {
    return withCors(
      Response.json(
        {message: 'Error syncing comment:' + error.message},
        {status: 500},
      ),
    )
  }
}

async function getCommentExists(commentId: string) {
  try {
    await grpcClient.comments.getComment({
      id: commentId,
    })
    return true
  } catch (error: any) {
    // Handle ConnectError for NotFound comments gracefully
    if (error?.code === 'not_found' || error?.message?.includes('not found')) {
      return false
    }
    // Re-throw other errors
    throw error
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
  const discovered = await grpcClient.entities.discoverEntity({
    account: targetId.uid,
    path: hmIdPathToEntityQueryPath(targetId.path),
    recursive: true,
  })
  const comment = await tryUntilSuccess(
    async () => {
      console.log('checking comment', commentId)
      try {
        const comment = await grpcClient.comments.getComment({
          id: commentId,
        })
        console.log('comment', comment)
        return comment
      } catch (error: any) {
        // Handle ConnectError for NotFound comments gracefully
        if (
          error?.code === 'not_found' ||
          error?.message?.includes('not found')
        ) {
          console.warn(`Comment ${commentId} not found during sync, will retry`)
          return null // This will cause tryUntilSuccess to retry
        }
        // Re-throw other errors
        throw error
      }
    },
    {
      retryDelayMs: 1000,
      maxRetryMs: 30_000,
    },
  )
}
