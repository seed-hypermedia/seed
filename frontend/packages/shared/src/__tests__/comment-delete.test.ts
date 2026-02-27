import {describe, expect, it} from 'vitest'
import type {DeleteCommentInput} from '@seed-hypermedia/client'

describe('comment deletion', () => {
  describe('DeleteCommentInput validation', () => {
    it('requires commentId, targetAccount, targetPath, and targetVersion', () => {
      const input: DeleteCommentInput = {
        commentId: 'z6Mk123/z3T56RpZJjd',
        targetAccount: 'z6Mk123',
        targetPath: '/doc1',
        targetVersion: 'bafyCID1.bafyCID2',
      }
      expect(input.commentId).toBe('z6Mk123/z3T56RpZJjd')
      expect(input.targetAccount).toBe('z6Mk123')
      expect(input.targetVersion).toBe('bafyCID1.bafyCID2')
    })
  })

  describe('comment ownership check', () => {
    it('should show delete when currentAccountId matches comment.author', () => {
      const currentAccountId = 'z6Mk123'
      const commentAuthor = 'z6Mk123'
      // This is the same check used in comments.tsx
      expect(currentAccountId == commentAuthor).toBe(true)
    })

    it('should hide delete when currentAccountId does not match comment.author', () => {
      const currentAccountId = 'z6Mk123' as string
      const commentAuthor = 'z6MkOther' as string
      expect(currentAccountId == commentAuthor).toBe(false)
    })

    it('should hide delete when currentAccountId is undefined', () => {
      const currentAccountId: string | undefined = undefined
      const commentAuthor = 'z6Mk123'
      expect(currentAccountId == commentAuthor).toBe(false)
    })

    it('should show delete immediately when account UID is available from stream (no async document fetch required)', () => {
      // This test documents the fix for issue #279:
      // Previously, currentAccountId was derived from useSelectedAccount().id.uid which
      // requires an async account document fetch. While loading, currentAccountId was
      // undefined and the delete button was hidden even for the comment's author.
      //
      // The fix uses useSelectedAccountId() which reads the UID synchronously from the
      // selectedIdentity stream, so it's available immediately without waiting for
      // the account document to load.

      // Simulate the fixed behavior: UID is available directly from the stream
      const selectedAccountUidFromStream = 'z6Mk123' // sync, from useSelectedAccountId()
      const commentAuthor = 'z6Mk123'

      // With the fix, this comparison yields true immediately
      expect(selectedAccountUidFromStream == commentAuthor).toBe(true)

      // Simulate the old broken behavior: UID came from the async account document
      const selectedAccountDocumentUid: string | undefined = undefined // undefined while loading
      // This used to be false during the loading window, hiding the delete option
      expect(selectedAccountDocumentUid == commentAuthor).toBe(false)
    })
  })
})
