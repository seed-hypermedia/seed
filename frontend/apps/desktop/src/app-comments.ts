import {hasBlockContent} from '@shm/shared/content'
import {
  HMCommentDraft,
  HMListedCommentDraft,
  HMListedCommentDraftSchema,
} from '@shm/shared/hm-types'
import Store from 'electron-store'
import fs from 'fs/promises'
import {nanoid} from 'nanoid'
import {join} from 'path'
import z from 'zod'
import {appInvalidateQueries} from './app-invalidation'
import {userDataPath} from './app-paths'
// @ts-expect-error ignore import
import {commentDraftStore} from './app-store.mts'
import {t} from './app-trpc'
import {error} from './logger'

// Define interface for the electron store instance
// @ts-ignore
interface CommentStore extends Store<Record<string, any>> {
  get: (key: string) => any
  set: (key: string, value: any) => void
  delete: (key: string) => void
  store: Record<string, any>
}

// Cast the store to the interface
const typedCommentStore = commentDraftStore as CommentStore

const commentDraftsDir = join(userDataPath, 'comment-drafts')
const commentDraftIndexPath = join(commentDraftsDir, 'index.json')

let commentDraftIndex: HMListedCommentDraft[] | undefined = undefined

export async function initCommentDrafts() {
  await fs.mkdir(commentDraftsDir, {recursive: true})

  if (!(await fs.stat(commentDraftIndexPath).catch(() => false))) {
    // Migrate from old electron-store format to new file-based index
    const allKeys = Object.keys(typedCommentStore.store || {})
    const newCommentDraftIndex: HMListedCommentDraft[] = []

    for (const key of allKeys) {
      if (key.startsWith('Comment-')) {
        const oldDraft = typedCommentStore.get(key)
        if (oldDraft && oldDraft.blocks) {
          const draftId = nanoid(10)
          const parts = key.replace('Comment-', '').split('-')
          const targetDocId = parts[0]
          const replyCommentId = parts[1]

          const indexedDraft: HMListedCommentDraft = {
            id: draftId,
            targetDocId,
            replyCommentId,
            lastUpdateTime: Date.now(),
          }

          await fs.writeFile(
            join(commentDraftsDir, `${draftId}.json`),
            JSON.stringify({blocks: oldDraft.blocks}, null, 2),
          )
          newCommentDraftIndex.push(indexedDraft)
        }
      }
    }

    commentDraftIndex = newCommentDraftIndex
    await saveCommentDraftIndex()
  } else {
    const commentIndexJSON = await fs.readFile(commentDraftIndexPath, 'utf-8')
    commentDraftIndex = z
      .array(HMListedCommentDraftSchema)
      .parse(JSON.parse(commentIndexJSON))
  }

  // Clean up empty drafts on init
  await cleanupEmptyDrafts()
}

async function cleanupEmptyDrafts() {
  if (!commentDraftIndex) return

  const draftsToRemove: string[] = []

  for (const draft of commentDraftIndex) {
    try {
      const draftPath = join(commentDraftsDir, `${draft.id}.json`)
      const fileContent = await fs.readFile(draftPath, 'utf-8')
      const draftContent = JSON.parse(fileContent)

      // Check if blocks are empty
      if (!draftContent.blocks || !draftContent.blocks.some(hasBlockContent)) {
        draftsToRemove.push(draft.id)
        await fs.unlink(draftPath).catch(() => {})
      }
    } catch (e) {
      // If file doesn't exist or is invalid, mark for removal
      draftsToRemove.push(draft.id)
    }
  }

  if (draftsToRemove.length > 0) {
    commentDraftIndex = commentDraftIndex.filter(
      (d) => !draftsToRemove.includes(d.id),
    )
    await saveCommentDraftIndex()
  }
}

async function saveCommentDraftIndex() {
  await fs.writeFile(
    commentDraftIndexPath,
    JSON.stringify(commentDraftIndex, null, 2),
  )
}

function getCommentStoreId(
  targetDocId: string,
  replyCommentId?: string,
  quotingBlockId?: string,
  context?: 'accessory' | 'feed' | 'document-content',
) {
  const parts = ['Comment', targetDocId]
  if (replyCommentId) parts.push(replyCommentId)
  if (quotingBlockId) parts.push(quotingBlockId)
  if (context) parts.push(context)
  return parts.join('-')
}

export const commentsApi = t.router({
  listCommentDrafts: t.procedure.query((): HMListedCommentDraft[] => {
    return commentDraftIndex || []
  }),
  getCommentDraft: t.procedure
    .input(
      z.object({
        targetDocId: z.string().or(z.undefined()).optional(),
        replyCommentId: z.string().optional(),
        quotingBlockId: z.string().optional(),
        context: z.enum(['accessory', 'feed', 'document-content']).optional(),
      }),
    )
    .query(async ({input}) => {
      const {targetDocId, replyCommentId, quotingBlockId, context} = input
      if (!targetDocId) return null

      // Find existing draft matching these parameters
      const existingDraft = commentDraftIndex?.find(
        (d) =>
          d.targetDocId === targetDocId &&
          d.replyCommentId === replyCommentId &&
          d.quotingBlockId === quotingBlockId &&
          d.context === context,
      )

      if (!existingDraft) return null

      try {
        const draftPath = join(commentDraftsDir, `${existingDraft.id}.json`)
        const fileContent = await fs.readFile(draftPath, 'utf-8')
        const draftContent = JSON.parse(fileContent)
        return {
          ...draftContent,
          targetDocId,
          replyCommentId,
          quotingBlockId,
          context,
          lastUpdateTime: existingDraft.lastUpdateTime,
        } as HMCommentDraft
      } catch (e) {
        error('Failed to read comment draft', {
          id: existingDraft.id,
          error: e,
        })
        return null
      }
    }),
  writeCommentDraft: t.procedure
    .input(
      z.object({
        targetDocId: z.string(),
        replyCommentId: z.string().optional(),
        quotingBlockId: z.string().optional(),
        context: z.enum(['accessory', 'feed', 'document-content']).optional(),
        blocks: z.array(z.any()),
      }),
    )
    .mutation(async ({input}) => {
      const {targetDocId, replyCommentId, quotingBlockId, context, blocks} =
        input

      if (!commentDraftIndex) {
        throw Error('[COMMENT DRAFT]: Comment Draft Index not initialized')
      }

      // Find existing draft or create new one
      let existingDraft = commentDraftIndex.find(
        (d) =>
          d.targetDocId === targetDocId &&
          d.replyCommentId === replyCommentId &&
          d.quotingBlockId === quotingBlockId &&
          d.context === context,
      )

      const draftId = existingDraft?.id || nanoid(10)
      const draftPath = join(commentDraftsDir, `${draftId}.json`)

      // Update or create index entry
      commentDraftIndex = [
        ...commentDraftIndex.filter((d) => d.id !== draftId),
        {
          id: draftId,
          targetDocId,
          replyCommentId,
          quotingBlockId,
          context,
          lastUpdateTime: Date.now(),
        },
      ]

      await saveCommentDraftIndex()

      const draft = {blocks}
      await fs.writeFile(draftPath, JSON.stringify(draft, null, 2))

      appInvalidateQueries(['trpc.comments.listCommentDrafts'])
      return draftId
    }),
  removeCommentDraft: t.procedure
    .input(
      z.object({
        targetDocId: z.string(),
        replyCommentId: z.string().optional(),
        quotingBlockId: z.string().optional(),
        context: z.enum(['accessory', 'feed', 'document-content']).optional(),
      }),
    )
    .mutation(async ({input}) => {
      const {targetDocId, replyCommentId, quotingBlockId, context} = input

      const existingDraft = commentDraftIndex?.find(
        (d) =>
          d.targetDocId === targetDocId &&
          d.replyCommentId === replyCommentId &&
          d.quotingBlockId === quotingBlockId &&
          d.context === context,
      )

      if (!existingDraft) return

      commentDraftIndex = commentDraftIndex?.filter(
        (d) => d.id !== existingDraft.id,
      )
      await saveCommentDraftIndex()

      const draftPath = join(commentDraftsDir, `${existingDraft.id}.json`)
      try {
        await fs.unlink(draftPath)
        appInvalidateQueries(['trpc.comments.listCommentDrafts'])
      } catch (e) {
        error('[COMMENT DRAFT]: Error deleting comment draft', {
          id: existingDraft.id,
          error: e,
        })
      }
    }),
})
