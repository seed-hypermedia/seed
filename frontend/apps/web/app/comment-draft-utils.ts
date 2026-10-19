import {hasBlockContent} from '@shm/shared/content'
import {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {useEffect, useRef, useState} from 'react'

interface CommentDraft {
  blocks: HMBlockNode[]
  mediaRefs?: Record<string, string> // blockId to serialized mediaRef JSON map
  timestamp: number
}

/** Range of a quoted fragment within a block, in codepoint offsets. */
export type QuotingRange = {start: number; end: number}

// Generate a unique key for storing drafts
function getDraftKey(
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

export function useCommentDraftPersistence(
  docId: string,
  replyCommentId?: string | null,
  quotingBlockId?: string,
  quotingRange?: QuotingRange,
) {
  const draftKey = getDraftKey(docId, replyCommentId, quotingBlockId, quotingRange)
  const [draft, setDraftState] = useState<CommentDraft | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout>()
  const pendingSaveRef = useRef<{key: string; draft: CommentDraft} | null>(null)
  const activeDraftKeyRef = useRef<string | null>(draftKey)

  const flushPendingSave = () => {
    clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = undefined
    const pending = pendingSaveRef.current
    pendingSaveRef.current = null
    if (!pending) return
    try {
      localStorage.setItem(pending.key, JSON.stringify(pending.draft))
    } catch (error) {
      console.error('Failed to save comment draft:', error)
    }
  }

  // Load draft on mount
  useEffect(() => {
    try {
      const savedDraft = localStorage.getItem(draftKey)
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft) as CommentDraft
        setDraftState(parsed)
      } else {
        setDraftState(null)
      }
    } catch (error) {
      console.error('Failed to load comment draft:', error)
    } finally {
      setIsLoading(false)
    }

    // Clean up old drafts periodically
    cleanupOldDrafts()
  }, [draftKey])

  const saveDraft = (blocks: HMBlockNode[], mediaRefs?: Record<string, string>) => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    pendingSaveRef.current = null

    // Check if content is empty
    const hasContent = blocks.some(hasBlockContent)

    if (!hasContent) {
      // If content is empty and there's an existing draft, remove it
      const existingDraft = localStorage.getItem(draftKey)
      if (existingDraft) {
        localStorage.removeItem(draftKey)
        setDraftState(null)
      }
      return
    }

    pendingSaveRef.current = {
      key: draftKey,
      draft: {blocks, timestamp: Date.now(), ...(mediaRefs && Object.keys(mediaRefs).length ? {mediaRefs} : {})},
    }
    // The editor can emit its final content during child cleanup after this
    // hook has unmounted. Save that content before the next editor loads it.
    if (activeDraftKeyRef.current !== draftKey) {
      flushPendingSave()
    } else {
      saveTimeoutRef.current = setTimeout(flushPendingSave, 500)
    }
  }

  const removeDraft = () => {
    pendingSaveRef.current = null
    clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = undefined
    try {
      localStorage.removeItem(draftKey)
      setDraftState(null)
      // Clear any pending save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    } catch (error) {
      console.error('Failed to remove comment draft:', error)
    }
  }

  // Preserve drafts when the editor moves between the main view and panel,
  // or when a new reply target replaces the current editor.
  useEffect(() => {
    activeDraftKeyRef.current = draftKey
    return () => {
      activeDraftKeyRef.current = null
      flushPendingSave()
    }
  }, [draftKey])

  return {
    draft: draft?.blocks || null,
    draftMediaRefs: draft?.mediaRefs || null,
    isLoading,
    saveDraft,
    removeDraft,
  }
}
