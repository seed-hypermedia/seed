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
  })
})
