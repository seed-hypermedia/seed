import {HMCommentDraft} from '@shm/shared/hm-types'
import Store from 'electron-store'
import z from 'zod'
// @ts-expect-error ignore import
import {commentDraftStore} from './app-store.mts'
import {t} from './app-trpc'

// Define interface for the electron store instance
interface CommentStore extends Store<Record<string, any>> {
  get: (key: string) => any
  set: (key: string, value: any) => void
  delete: (key: string) => void
}

// Cast the store to the interface
const typedCommentStore = commentDraftStore as CommentStore

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
      const result = typedCommentStore.get(commentId)
      if (!result) return null
      return {...result, commentId: input.targetDocId} as HMCommentDraft
    }),
  writeCommentDraft: t.procedure
    .input(
      z.object({
        targetDocId: z.string(),
        replyCommentId: z.string().optional(),
        blocks: z.array(z.any()),
      }),
    )
    .mutation(async ({input}) => {
      const {targetDocId, replyCommentId} = input
      const commentId = getCommentStoreId(targetDocId, replyCommentId)
      typedCommentStore.set(commentId, {
        blocks: input.blocks,
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
      const comment = typedCommentStore.get(commentId)
      if (!comment) return
      typedCommentStore.delete(commentId)
      return
    }),
})
