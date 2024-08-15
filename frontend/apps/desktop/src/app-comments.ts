import {HMCommentDraft} from '@shm/shared'
import z from 'zod'
import {commentDraftStore} from './app-store'
import {t} from './app-trpc'

export const commentsApi = t.router({
  getCommentDraft: t.procedure
    .input(
      z.object({
        targetDocId: z.string().or(z.undefined()).optional(),
      }),
    )
    .query(async ({input}) => {
      if (!input.targetDocId) return null
      const result = commentDraftStore.get(`Comment-${input.targetDocId}`)
      if (!result) return null
      return {...result, commentId: input.targetDocId} as HMCommentDraft
    }),
  writeCommentDraft: t.procedure
    .input(
      z.object({
        targetDocId: z.string(),
        account: z.string(),
        blocks: z.array(z.any()),
      }),
    )
    .mutation(async ({input}) => {
      const targetDocId = input.targetDocId
      commentDraftStore.set(`Comment-${targetDocId}`, {
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
        // targetDocId: z.string(),
      }),
    )
    .mutation(async ({input}) => {
      const targetDocId = input.targetDocId
      const comment = commentDraftStore.get(`Comment-${targetDocId}`)
      if (!comment) return
      commentDraftStore.delete(`Comment-${targetDocId}`)
      return
    }),
})
