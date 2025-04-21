import {queryClient} from '@/client'
import {ActionFunction, json} from '@remix-run/node'
import {
  hmIdPathToEntityQueryPath,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {z} from 'zod'

const syncCommentRequestSchema = z.object({
  commentId: z.string(),
  target: z.string(),
})

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return json({message: 'Method not allowed'}, {status: 405})
  }
  const body = await request.json()
  const {commentId, target} = syncCommentRequestSchema.parse(body)
  const targetId = unpackHmId(target)
  if (!targetId) {
    return json({message: 'Invalid target'}, {status: 400})
  }
  const comment = await queryClient.comments.getComment({
    id: commentId,
  })
  if (!comment) {
    await syncComment({
      commentId,
      targetId,
    })
    return json({message: 'Comment not found'}, {status: 404})
  }

  return json({
    message: 'Success',
  })
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
    20_000,
  )
}

async function tryUntilSuccess(
  fn: () => Promise<boolean>,
  retryDelayMs: number,
  maxRetryMs: number,
) {
  const startTime = Date.now()
  let didResolve = false
  let didTimeout = false
  while (!didResolve) {
    const result = await fn()
    if (result) {
      didResolve = true
    } else {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
    if (Date.now() - startTime > maxRetryMs) {
      didTimeout = true
    }
  }
  if (didTimeout) {
    throw new Error('Timed out')
  }
}
