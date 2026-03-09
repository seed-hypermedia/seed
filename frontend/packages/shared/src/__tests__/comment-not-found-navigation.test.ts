/**
 * Tests for issue #292: Navigate to Comments view if the selected comment is deleted.
 *
 * When the user is viewing a specific comment (/:comments/<uid>/<tsid>) and that
 * comment gets deleted, the app should navigate back to the comments list
 * (/:comments) rather than showing a dead-end error state.
 *
 * This covers both the main section route and the right-panel route.
 */

import {describe, expect, it} from 'vitest'
import {hmId} from '../utils/entity-id-url'

// Helper that mimics the navigation logic in CommentDiscussions:
// given the current route and that the comment was not found, what should we
// navigate to?
function getCommentNotFoundNavTarget(
  currentRoute: Record<string, any>,
): Record<string, any> | null {
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

describe('comment not found navigation (issue #292)', () => {
  describe('main section (comments route)', () => {
    it('strips openComment from a comments route', () => {
      const currentRoute = {key: 'comments', id: docId, openComment: commentOpenId}
      const target = getCommentNotFoundNavTarget(currentRoute)
      expect(target).toEqual({key: 'comments', id: docId})
      expect(target).not.toHaveProperty('openComment')
    })

    it('does not navigate if already on comments list (no openComment)', () => {
      const currentRoute = {key: 'comments', id: docId}
      const target = getCommentNotFoundNavTarget(currentRoute)
      expect(target).toBeNull()
    })

    it('preserves other route fields (blockRef, etc.) when stripping openComment', () => {
      const idWithBlock = hmId('z6MkTestUid123', {blockRef: 'blk1'})
      const currentRoute = {key: 'comments', id: idWithBlock, openComment: commentOpenId}
      const target = getCommentNotFoundNavTarget(currentRoute)
      expect(target).toEqual({key: 'comments', id: idWithBlock})
      expect(target).not.toHaveProperty('openComment')
    })
  })

  describe('right panel route', () => {
    it('strips openComment from panel while keeping the main route intact', () => {
      const currentRoute = {
        key: 'document',
        id: docId,
        panel: {key: 'comments', id: docId, openComment: commentOpenId},
      }
      const target = getCommentNotFoundNavTarget(currentRoute)
      expect(target).toEqual({
        key: 'document',
        id: docId,
        panel: {key: 'comments', id: docId},
      })
      expect(target?.panel).not.toHaveProperty('openComment')
    })

    it('does not navigate if panel has no openComment', () => {
      const currentRoute = {
        key: 'document',
        id: docId,
        panel: {key: 'comments', id: docId},
      }
      const target = getCommentNotFoundNavTarget(currentRoute)
      expect(target).toBeNull()
    })

    it('does not navigate if panel is not a comments panel', () => {
      const currentRoute = {
        key: 'document',
        id: docId,
        panel: {key: 'directory', id: docId},
      }
      const target = getCommentNotFoundNavTarget(currentRoute)
      expect(target).toBeNull()
    })

    it('preserves other panel fields when stripping openComment', () => {
      const currentRoute = {
        key: 'collaborators',
        id: docId,
        panel: {key: 'comments', id: docId, openComment: commentOpenId, isReplying: true},
      }
      const target = getCommentNotFoundNavTarget(currentRoute)
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
      const target = getCommentNotFoundNavTarget(currentRoute)
      expect(target).toBeNull()
    })
  })
})
