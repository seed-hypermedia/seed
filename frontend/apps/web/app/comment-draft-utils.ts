import {HMBlockNode} from '@shm/shared/hm-types'
import {useEffect, useRef, useState} from 'react'

interface CommentDraft {
  blocks: HMBlockNode[]
  timestamp: number
}

// Generate a unique key for storing drafts
function getDraftKey(
  docId: string,
  replyCommentId?: string | null,
  quotingBlockId?: string,
): string {
  const parts = ['comment-draft', docId]
  if (replyCommentId) parts.push(`reply-${replyCommentId}`)
  if (quotingBlockId) parts.push(`quote-${quotingBlockId}`)
  return parts.join('-')
}

// Clean up old drafts (older than 30 days)
function cleanupOldDrafts() {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const keysToRemove: string[] = []

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('comment-draft-')) {
      try {
        const draft = JSON.parse(
          localStorage.getItem(key) || '{}',
        ) as CommentDraft
        if (draft.timestamp < thirtyDaysAgo) {
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
) {
  const draftKey = getDraftKey(docId, replyCommentId, quotingBlockId)
  const [draft, setDraftState] = useState<CommentDraft | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout>()

  // Load draft on mount
  useEffect(() => {
    try {
      const savedDraft = localStorage.getItem(draftKey)
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft) as CommentDraft
        setDraftState(parsed)
      }
    } catch (error) {
      console.error('Failed to load comment draft:', error)
    } finally {
      setIsLoading(false)
    }

    // Clean up old drafts periodically
    cleanupOldDrafts()
  }, [draftKey])

  const saveDraft = (blocks: HMBlockNode[]) => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Debounce the save
    saveTimeoutRef.current = setTimeout(() => {
      try {
        const draft: CommentDraft = {
          blocks,
          timestamp: Date.now(),
        }
        localStorage.setItem(draftKey, JSON.stringify(draft))
        // Updating state here caused unnecessary rerenders that caused cursor jumping
        // The draft state is only needed for initial load so no need to update it
        // setDraftState(draft)
      } catch (error) {
        console.error('Failed to save comment draft:', error)
      }
    }, 500)
  }

  const removeDraft = () => {
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  return {
    draft: draft?.blocks || null,
    isLoading,
    saveDraft,
    removeDraft,
  }
}
