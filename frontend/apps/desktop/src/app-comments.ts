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
  // getCommentDrafts: t.procedure
  //   .input(
  //     z.object({
  //       docId: z.string(),
  //     }),
  //   )
  //   .query(({input}) => {
  //     console.log('============= QUERY DRAFTS', input)
  //     const result = commentDraftStore.get(`Doc-${input.docId}`)
  //     if (!result) return []
  //     const commentIds = Object.keys(result)
  //     return commentIds
  //       .map((commentId) => {
  //         const comment = commentDraftStore.get(`Comment-${commentId}`)
  //         if (!comment) return null
  //         return {
  //           ...comment,
  //           commentId,
  //         }
  //       })
  //       .filter(Boolean) as HMCommentDraft[]
  //   }),
  // createCommentDraft: t.procedure
  //   .input(
  //     z.object({
  //       targetDocId: z.string(),
  //       targetDocVersion: z.string(),
  //       targetCommentId: z.string().or(z.null()),
  //       blocks: z.array(z.any()).optional(),
  //     }),
  //   )
  //   .mutation(async ({input}) => {
  //     const draftId = Math.random().toString(36).slice(2)

  //     console.log(`== ~ .mutation ~ draftId:`, draftId)
  //     const prevIndex = commentDraftStore.get(`Doc-${input.targetDocId}`) || {}
  //     commentDraftStore.set(`Doc-${input.targetDocId}`, {
  //       ...prevIndex,
  //       [draftId]: true,
  //     })
  //     console.log(`== ~ .mutation ~ prevIndex:`, prevIndex)
  //     commentDraftStore.set(`Comment-${draftId}`, {
  //       blocks: input.blocks || [],
  //       targetDocId: input.targetDocId,
  //       targetDocVersion: input.targetDocVersion,
  //       targetCommentId: input.targetCommentId,
  //     })
  //     return draftId
  //   }),
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
      // const comment = commentDraftStore.get(`Comment-${targetDocId}`)
      // if (!comment) throw new Error('Comment with this commentId not found')
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
      if (!comment) throw new Error('Comment with this commentId not found')
      commentDraftStore.delete(`Comment-${targetDocId}`)
      // const index = commentDraftStore.get(`Doc-${comment.targetDocId}`)
      // if (!index) throw new Error('Comment index not found')
      // commentDraftStore.set(`Doc-${comment.targetDocId}`, {
      //   ...index,
      //   [commentId]: undefined,
      // })
      return true
    }),
})
