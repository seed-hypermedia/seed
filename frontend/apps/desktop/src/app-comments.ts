import {HMCommentDraft} from '@shm/shared/hm-types'
import z from 'zod'
import {commentDraftStore} from './app-store'
import {t} from './app-trpc'

function getCommentStoreId(targetDocId: string, replyCommentId?: string) {
  if (replyCommentId) return `Comment-${targetDocId}-${replyCommentId}`
  return `Comment-${targetDocId}`
}

export const commentsApi = t.router({
  getCommentDraft: t.procedure
    .input(
      z.object({
        targetDocId: z.string().or(z.undefined()).optional(),
        replyCommentId: z.string().optional(),
      }),
    )
    .query(async ({input}) => {
      const {targetDocId, replyCommentId} = input
      if (!targetDocId) return null
      const commentId = getCommentStoreId(targetDocId, replyCommentId)
      const result = commentDraftStore.get(commentId)
      if (!result) return null
      return {...result, commentId: input.targetDocId} as HMCommentDraft
    }),
  writeCommentDraft: t.procedure
    .input(
      z.object({
        targetDocId: z.string(),
        replyCommentId: z.string().optional(),
        account: z.string(),
        blocks: z.array(z.any()),
      }),
    )
    .mutation(async ({input}) => {
      const {targetDocId, replyCommentId} = input
      const commentId = getCommentStoreId(targetDocId, replyCommentId)
      commentDraftStore.set(commentId, {
        // ...comment,
        blocks: input.blocks,
        account: input.account,
      })
      return targetDocId
    }),
  removeCommentDraft: t.procedure
    .input(
      z.object({
        targetDocId: z.string(),
        replyCommentId: z.string().optional(),
        // targetDocId: z.string(),
      }),
    )
    .mutation(async ({input}) => {
      const {targetDocId, replyCommentId} = input
      const commentId = getCommentStoreId(targetDocId, replyCommentId)
      const comment = commentDraftStore.get(commentId)
      if (!comment) return
      commentDraftStore.delete(commentId)
      return
    }),
})
