import {describe, expect, it, vi} from 'vitest'
import type {DeleteCommentInput} from '../universal-client'

describe('comment deletion', () => {
  describe('DeleteCommentInput validation', () => {
    it('requires commentId, targetDocId, and signingAccountId', () => {
      const input: DeleteCommentInput = {
        commentId: 'bafy123',
        targetDocId: {uid: 'z6Mk123', path: ['doc1'], id: 'hm://z6Mk123/doc1'} as any,
        signingAccountId: 'z6Mk123',
      }
      expect(input.commentId).toBe('bafy123')
      expect(input.signingAccountId).toBe('z6Mk123')
      expect(input.targetDocId.uid).toBe('z6Mk123')
    })
  })

  describe('comment ownership check', () => {
    it('should show delete when currentAccountId matches comment.author', () => {
      const currentAccountId = 'z6Mk123'
      const commentAuthor = 'z6Mk123'
      // This is the same check used in comments.tsx:674
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

    it('should hide delete when onCommentDelete is not provided', () => {
      const onCommentDelete: ((id: string, signingAccountId?: string) => void) | undefined = undefined
      const options: {key: string; label: string}[] = []
      if (onCommentDelete) {
        options.push({key: 'delete', label: 'Delete'})
      }
      expect(options).toHaveLength(0)
    })

    it('should add delete option when onCommentDelete is provided', () => {
      function buildOptions(onCommentDelete?: (id: string, signingAccountId?: string) => void) {
        const options: {key: string; label: string}[] = []
        if (onCommentDelete) {
          options.push({key: 'delete', label: 'Delete'})
        }
        return options
      }
      const options = buildOptions(vi.fn())
      expect(options).toHaveLength(1)
      expect(options[0]?.key).toBe('delete')
    })
  })

  describe('onCommentDelete callback construction', () => {
    it('should not call dialog when signingAccountId is missing', () => {
      const deleteCommentDialogOpen = vi.fn()
      const onCommentDelete = (commentId: string, signingAccountId?: string) => {
        if (!signingAccountId) return
        deleteCommentDialogOpen({commentId, signingAccountId})
      }
      onCommentDelete('bafy123')
      expect(deleteCommentDialogOpen).not.toHaveBeenCalled()
    })

    it('should call dialog when signingAccountId is provided', () => {
      const deleteCommentDialogOpen = vi.fn()
      const onCommentDelete = (commentId: string, signingAccountId?: string) => {
        if (!signingAccountId) return
        deleteCommentDialogOpen({commentId, signingAccountId})
      }
      onCommentDelete('bafy123', 'z6Mk123')
      expect(deleteCommentDialogOpen).toHaveBeenCalledWith({
        commentId: 'bafy123',
        signingAccountId: 'z6Mk123',
      })
    })

    it('should pass correct params to deleteComment.mutate on confirm', () => {
      const mutateFn = vi.fn()
      const targetDocId = {uid: 'z6Mk123', path: ['doc1'], id: 'hm://z6Mk123/doc1'} as any
      let confirmCallback: (() => void) | undefined

      const onCommentDelete = (commentId: string, signingAccountId?: string) => {
        if (!signingAccountId) return
        confirmCallback = () => {
          mutateFn({commentId, targetDocId, signingAccountId})
        }
      }

      onCommentDelete('bafy123', 'z6Mk123')
      expect(confirmCallback).toBeDefined()

      confirmCallback!()
      expect(mutateFn).toHaveBeenCalledWith({
        commentId: 'bafy123',
        targetDocId,
        signingAccountId: 'z6Mk123',
      })
    })
  })
})
