import {hasBlockContent} from '@shm/shared/content'
import {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import type {CommentComposerContent} from '@shm/shared/models/comment-composer-machine'

interface CommentDraft {
  docId?: string
  replyCommentId?: string | null
  quotingBlockId?: string
  quotingRange?: QuotingRange
  blocks: HMBlockNode[]
  mediaRefs?: Record<string, string> // blockId to serialized mediaRef JSON map
  timestamp: number
}

/** Range of a quoted fragment within a block, in codepoint offsets. */
export type QuotingRange = {start: number; end: number}

/** Storage key for one draft target. */
export function getDraftKey(
  docId: string,
  replyCommentId?: string | null,
  quotingBlockId?: string,
  quotingRange?: QuotingRange,
): string {
  const parts = ['comment-draft', docId]
  if (replyCommentId) parts.push(`reply-${replyCommentId}`)
  if (quotingBlockId) parts.push(`quote-${quotingBlockId}`)
  if (quotingRange) parts.push(`range-${quotingRange.start}-${quotingRange.end}`)
  return parts.join('-')
}

// Clean up old drafts (older than 30 days) and empty drafts
function cleanupOldDrafts() {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const keysToRemove: string[] = []

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('comment-draft-')) {
      try {
        const draft = JSON.parse(localStorage.getItem(key) || '{}') as CommentDraft

        // Remove if older than 30 days
        if (draft.timestamp < thirtyDaysAgo) {
          keysToRemove.push(key)
          continue
        }

        // Remove if content is empty
        if (draft.blocks && !draft.blocks.some(hasBlockContent)) {
          keysToRemove.push(key)
        }
      } catch {
        // Invalid draft, remove it
        keysToRemove.push(key)
      }
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key))
}

/** Re-inject serialized mediaRefs into block attributes so the editor can rehydrate media. */
export function injectMediaRefs(content: CommentComposerContent): HMBlockNode[] {
  const mediaRefs = content.mediaRefs
  if (!mediaRefs) return content.blocks
  return content.blocks.map((node) => {
    const block = node.block as any
    const blockId = block?.id
    if (!blockId || !mediaRefs[blockId]) return node
    return {
      ...node,
      block: {
        ...block,
        attributes: {
          ...block.attributes,
          mediaRef: JSON.parse(mediaRefs[blockId]),
        },
      },
    }
  }) as HMBlockNode[]
}

/** Load a stored draft, re-injecting serialized mediaRefs into block attributes. */
export function loadWebCommentDraft(key: string): CommentComposerContent | null {
  cleanupOldDrafts()
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const draft = JSON.parse(raw) as CommentDraft
    if (!Array.isArray(draft.blocks)) return null
    const mediaRefs = draft.mediaRefs
    return {blocks: injectMediaRefs({blocks: draft.blocks, mediaRefs}), ...(mediaRefs ? {mediaRefs} : {})}
  } catch {
    return null
  }
}

/** Persist a composer draft under `key`, dropping it when the content is empty. */
export function saveWebCommentDraft(
  key: string,
  target: {
    docId: string
    replyCommentId?: string | null
    quotingBlockId?: string
    quotingRange?: QuotingRange
  },
  content: CommentComposerContent,
): void {
  if (!content.blocks.some(hasBlockContent)) {
    if (localStorage.getItem(key)) localStorage.removeItem(key)
    return
  }
  const draft: CommentDraft = {
    blocks: content.blocks,
    docId: target.docId,
    replyCommentId: target.replyCommentId ?? undefined,
    quotingBlockId: target.quotingBlockId,
    quotingRange: target.quotingRange,
    timestamp: Date.now(),
    ...(content.mediaRefs && Object.keys(content.mediaRefs).length ? {mediaRefs: content.mediaRefs} : {}),
  }
  localStorage.setItem(key, JSON.stringify(draft))
}

/** Remove a stored composer draft. */
export function removeWebCommentDraft(key: string): void {
  localStorage.removeItem(key)
}

/** A local comment draft and its exact storage key, used to resume or discard it. */
export interface ListedWebCommentDraft extends CommentDraft {
  storageKey: string
  docId: string
  ambiguousTarget?: boolean
}

/** List nonempty comment drafts across all local targets without deleting stored data. */
export function listWebCommentDrafts(): ListedWebCommentDraft[] {
  if (typeof localStorage === 'undefined') return []
  const drafts: ListedWebCommentDraft[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i)
    if (!storageKey?.startsWith('comment-draft-')) continue
    const raw = localStorage.getItem(storageKey)
    try {
      const draft = JSON.parse(raw || '{}') as CommentDraft
      if (!Array.isArray(draft.blocks) || !draft.blocks.some(hasBlockContent) || !Number.isFinite(draft.timestamp))
        continue
      // Older records stored the target only in the key. New records keep the
      // fields explicitly so paths containing separator words remain unambiguous.
      const legacy = storageKey
        .slice('comment-draft-'.length)
        .match(/^(.*?)(?:-reply-(.*?))?(?:-quote-(.*?))?(?:-range-(\d+)-(\d+))?$/)
      const docId = draft.docId || legacy?.[1]
      if (!docId) continue
      drafts.push({
        ...draft,
        storageKey,
        docId,
        ambiguousTarget: !draft.docId && /-(?:reply|quote|range)-/.test(storageKey.slice('comment-draft-'.length)),
        replyCommentId: draft.docId ? draft.replyCommentId : legacy?.[2],
        quotingBlockId: draft.docId ? draft.quotingBlockId : legacy?.[3],
        quotingRange: draft.docId
          ? draft.quotingRange
          : legacy?.[4] && legacy?.[5]
            ? {start: Number(legacy[4]), end: Number(legacy[5])}
            : undefined,
      })
    } catch {
      // Leave unreadable records intact; one corrupt record must not hide other drafts.
    }
  }
  return drafts.sort((a, b) => b.timestamp - a.timestamp)
}

/** Discard only the selected comment draft, including legacy keys. */
export function deleteWebCommentDraft(storageKey: string): void {
  if (!storageKey.startsWith('comment-draft-')) throw new Error('Invalid comment draft key')
  localStorage.removeItem(storageKey)
}
