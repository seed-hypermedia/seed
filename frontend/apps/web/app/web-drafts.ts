import {isPendingSpaceUid} from '@shm/shared/utils/pending-space'
import {unpackHmId} from '@shm/shared'
import type {NavRoute} from '@shm/shared/routes'
import {deleteWebCommentDraft, listWebCommentDrafts} from './comment-draft-utils'
import {deleteWebDocDraft, listWebDocDrafts} from './document-edit/web-draft-db'

/** A local draft row with its resume route and exact storage identity. */
export interface WebDraftItem {
  key: string
  storageId: string
  type: 'document' | 'comment'
  title: string
  updatedAt: number
  route: NavRoute | null
  signingAccountId?: string
  unavailableReason?: string
}

/** Read all active local drafts, across accounts and spaces, newest first. */
export async function listWebDrafts(): Promise<WebDraftItem[]> {
  const documents = await listWebDocDrafts()
  const comments = listWebCommentDrafts()
  const seenDocuments = new Set<string>()
  return [
    ...documents.map((draft): WebDraftItem => {
      const id = unpackHmId(draft.docId)
      const isOlderDraft = seenDocuments.has(draft.docId)
      seenDocuments.add(draft.docId)
      return {
        key: `document-${draft.draftId}`,
        storageId: draft.draftId,
        type: 'document',
        title:
          typeof draft.metadata.name === 'string' && draft.metadata.name ? draft.metadata.name : 'Untitled document',
        updatedAt: draft.updatedAt,
        route: id && !isOlderDraft ? {key: 'document', id} : null,
        signingAccountId: draft.signingAccountId,
        unavailableReason: isOlderDraft
          ? 'Resume the newer draft for this document first.'
          : !id
            ? 'This draft has no valid document address.'
            : undefined,
      }
    }),
    ...comments.map((draft): WebDraftItem => {
      const id = unpackHmId(draft.docId)
      return {
        key: draft.storageKey,
        storageId: draft.storageKey,
        type: 'comment',
        title:
          draft.blocks
            .map((node) => ('text' in node.block ? node.block.text || '' : ''))
            .join(' ')
            .slice(0, 160) || 'Comment draft',
        updatedAt: draft.timestamp,
        unavailableReason: draft.ambiguousTarget
          ? 'Open the original document to resume this older comment draft.'
          : undefined,
        route:
          id && !draft.ambiguousTarget
            ? {
                key: 'comments',
                id,
                openComment: draft.replyCommentId || undefined,
                replyCommentId: draft.replyCommentId || undefined,
                targetBlockId: draft.quotingBlockId,
                blockId: draft.quotingBlockId,
                blockRange: draft.quotingRange,
                autoFocus: true,
                isReplying: true,
              }
            : null,
      }
    }),
  ].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Discard only the selected active draft through its original local store. */
export async function discardWebDraft(draft: WebDraftItem): Promise<void> {
  if (draft.type === 'document') await deleteWebDocDraft(draft.storageId)
  else deleteWebCommentDraft(draft.storageId)
}

/** Explain why a draft cannot resume with the active web document signing account. */
export function webDraftResumeReason(draft: WebDraftItem, delegatedAccountUid?: string): string | undefined {
  if (draft.unavailableReason) return draft.unavailableReason
  if (draft.type !== 'document') return undefined
  if (draft.route && 'id' in draft.route && typeof draft.route.id === 'object' && isPendingSpaceUid(draft.route.id.uid))
    return undefined
  if (!draft.signingAccountId) return 'This draft has no saved signing account.'
  if (draft.signingAccountId !== delegatedAccountUid)
    return 'Sign in with the account that created this draft to resume.'
  return undefined
}
