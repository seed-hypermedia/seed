import {describe, expect, it} from 'vitest'
import {getFocusedCommentViewState} from '../comment-discussion-state'

describe('getFocusedCommentViewState', () => {
  it('returns comment when the focused comment is available', () => {
    expect(
      getFocusedCommentViewState({
        hasFocusedComment: true,
        resourceType: 'comment',
        isResourceTombstone: false,
        isResourceLoading: false,
        showDeletedContent: false,
        hasDeletedVersion: false,
        isDeletedVersionsLoading: false,
      }),
    ).toBe('comment')
  })

  it('returns deleted-preview for confirmed tombstones with history available', () => {
    expect(
      getFocusedCommentViewState({
        hasFocusedComment: false,
        resourceType: 'tombstone',
        isResourceTombstone: true,
        isResourceLoading: false,
        showDeletedContent: true,
        hasDeletedVersion: true,
        isDeletedVersionsLoading: false,
      }),
    ).toBe('deleted-preview')
  })

  it('returns deleted-loading while deleted history is loading', () => {
    expect(
      getFocusedCommentViewState({
        hasFocusedComment: false,
        resourceType: 'tombstone',
        isResourceTombstone: true,
        isResourceLoading: false,
        showDeletedContent: true,
        hasDeletedVersion: false,
        isDeletedVersionsLoading: true,
      }),
    ).toBe('deleted-loading')
  })

  it('returns deleted for tombstones without deleted history UI', () => {
    expect(
      getFocusedCommentViewState({
        hasFocusedComment: false,
        resourceType: 'tombstone',
        isResourceTombstone: true,
        isResourceLoading: false,
        showDeletedContent: false,
        hasDeletedVersion: false,
        isDeletedVersionsLoading: false,
      }),
    ).toBe('deleted')
  })

  it('returns not-found for confirmed not-found resources', () => {
    expect(
      getFocusedCommentViewState({
        hasFocusedComment: false,
        resourceType: 'not-found',
        isResourceTombstone: false,
        isResourceLoading: false,
        showDeletedContent: false,
        hasDeletedVersion: false,
        isDeletedVersionsLoading: false,
      }),
    ).toBe('not-found')
  })

  it('returns loading while the direct resource lookup is still resolving', () => {
    expect(
      getFocusedCommentViewState({
        hasFocusedComment: false,
        resourceType: null,
        isResourceTombstone: false,
        isResourceLoading: true,
        showDeletedContent: false,
        hasDeletedVersion: false,
        isDeletedVersionsLoading: false,
      }),
    ).toBe('loading')
  })
})
