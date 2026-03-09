/**
 * Tests for issue #292: Navigate to Comments view if the selected comment is deleted.
 *
 * When the user deletes the comment they are currently focused on
 * (/:comments/<uid>/<tsid> or ?panel=comments/<uid>/<tsid>), the app should
 * navigate back to the comments list (/:comments) rather than showing a
 * dead-end error state.
 *
 * The navigation is triggered in the Comment component's delete onSuccess
 * callback, only when the deleted comment matches the currently focused one.
 */

import {describe, expect, it} from 'vitest'
import {hmId} from '../utils/entity-id-url'

// Helper that mimics the navigation logic in the Comment component's delete handler:
// given the current route and the id of the comment being deleted, return the
// route to navigate to (or null if no navigation is needed).
function getDeleteCommentNavTarget(
  currentRoute: Record<string, any>,
  deletedCommentId: string,
): Record<string, any> | null {
  // Only navigate if we're currently focused on the deleted comment.
  const isFocusedComment =
    (currentRoute.key === 'comments' && currentRoute.openComment === deletedCommentId) ||
    (currentRoute.panel?.key === 'comments' && currentRoute.panel.openComment === deletedCommentId)

  if (!isFocusedComment) return null

  // Main section: /:comments/<uid>/<tsid> → /:comments
  if (currentRoute.key === 'comments' && currentRoute.openComment) {
    const {openComment: _removed, ...rest} = currentRoute
    return rest
  }
  // Right panel: ?panel=comments/<uid>/<tsid> → ?panel=comments
  if (currentRoute.panel?.key === 'comments' && currentRoute.panel.openComment) {
    const {openComment: _removed, ...panelRest} = currentRoute.panel
    return {...currentRoute, panel: panelRest}
  }
  return null
}

const docId = hmId('z6MkTestUid123')
const commentOpenId = 'z6MkAuthor/z3TsCommentTsid'
const otherCommentId = 'z6MkOther/z3TsOtherTsid'

describe('delete focused comment navigation (issue #292)', () => {
  describe('main section (comments route)', () => {
    it('navigates to comments list when deleting the focused comment', () => {
      const currentRoute = {key: 'comments', id: docId, openComment: commentOpenId}
      const target = getDeleteCommentNavTarget(currentRoute, commentOpenId)
      expect(target).toEqual({key: 'comments', id: docId})
      expect(target).not.toHaveProperty('openComment')
    })

    it('does not navigate when deleting a different comment', () => {
      const currentRoute = {key: 'comments', id: docId, openComment: commentOpenId}
      const target = getDeleteCommentNavTarget(currentRoute, otherCommentId)
      expect(target).toBeNull()
    })

    it('does not navigate if already on comments list (no openComment)', () => {
      const currentRoute = {key: 'comments', id: docId}
      const target = getDeleteCommentNavTarget(currentRoute, commentOpenId)
      expect(target).toBeNull()
    })

    it('preserves other route fields (blockRef, etc.) when stripping openComment', () => {
      const idWithBlock = hmId('z6MkTestUid123', {blockRef: 'blk1'})
      const currentRoute = {key: 'comments', id: idWithBlock, openComment: commentOpenId}
      const target = getDeleteCommentNavTarget(currentRoute, commentOpenId)
      expect(target).toEqual({key: 'comments', id: idWithBlock})
      expect(target).not.toHaveProperty('openComment')
    })
  })

  describe('right panel route', () => {
    it('strips openComment from panel when deleting the focused comment', () => {
      const currentRoute = {
        key: 'document',
        id: docId,
        panel: {key: 'comments', id: docId, openComment: commentOpenId},
      }
      const target = getDeleteCommentNavTarget(currentRoute, commentOpenId)
      expect(target).toEqual({
        key: 'document',
        id: docId,
        panel: {key: 'comments', id: docId},
      })
      expect(target?.panel).not.toHaveProperty('openComment')
    })

    it('does not navigate when deleting a different comment via panel', () => {
      const currentRoute = {
        key: 'document',
        id: docId,
        panel: {key: 'comments', id: docId, openComment: commentOpenId},
      }
      const target = getDeleteCommentNavTarget(currentRoute, otherCommentId)
      expect(target).toBeNull()
    })

    it('does not navigate if panel has no openComment', () => {
      const currentRoute = {
        key: 'document',
        id: docId,
        panel: {key: 'comments', id: docId},
      }
      const target = getDeleteCommentNavTarget(currentRoute, commentOpenId)
      expect(target).toBeNull()
    })

    it('does not navigate if panel is not a comments panel', () => {
      const currentRoute = {
        key: 'document',
        id: docId,
        panel: {key: 'directory', id: docId},
      }
      const target = getDeleteCommentNavTarget(currentRoute, commentOpenId)
      expect(target).toBeNull()
    })

    it('preserves other panel fields when stripping openComment', () => {
      const currentRoute = {
        key: 'collaborators',
        id: docId,
        panel: {key: 'comments', id: docId, openComment: commentOpenId, isReplying: true},
      }
      const target = getDeleteCommentNavTarget(currentRoute, commentOpenId)
      expect(target).toEqual({
        key: 'collaborators',
        id: docId,
        panel: {key: 'comments', id: docId, isReplying: true},
      })
      expect(target?.panel).not.toHaveProperty('openComment')
    })
  })

  describe('non-comment routes', () => {
    it('does not navigate from a document route with no panel', () => {
      const currentRoute = {key: 'document', id: docId}
      const target = getDeleteCommentNavTarget(currentRoute, commentOpenId)
      expect(target).toBeNull()
    })
  })
})
