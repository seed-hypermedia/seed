/**
 * Tests for the optimistic-comment module.
 *
 * Covers:
 * - navigateToComment: pure navigation logic for focusing a comment after publish
 * - applyOptimisticComment: cache injection into React Query
 */

import {QueryClient} from '@tanstack/react-query'
import {describe, expect, it, vi} from 'vitest'
import type {HMBlockNode, HMComment, HMListCommentsOutput, HMMetadataPayload} from '@seed-hypermedia/client/hm-types'
import {queryKeys} from '../models/query-keys'
import {hmId} from '../utils/entity-id-url'
import {applyOptimisticComment, navigateToComment} from '../optimistic-comment'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const docId = hmId('z6MkTestUser123', {path: ['my-doc'], version: 'bafy123'})
const commentRecordId = 'z6MkAuthor456/z3TsComment789'

function makeComment(overrides: Partial<HMComment> = {}): HMComment {
  return {
    id: commentRecordId,
    version: `optimistic-${Date.now()}`,
    author: 'z6MkAuthor456',
    targetAccount: docId.uid,
    targetPath: '/my-doc',
    targetVersion: 'bafy123',
    replyParent: '',
    content: [
      {block: {id: 'b1', type: 'Paragraph', text: 'hello', attributes: {}, annotations: []}, children: []},
    ] as HMBlockNode[],
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
    visibility: 'PUBLIC',
    ...overrides,
  }
}

const authorMetadata: HMMetadataPayload = {
  id: hmId('z6MkAuthor456'),
  metadata: {name: 'Test Author'},
}

// ─── navigateToComment ──────────────────────────────────────────────────────

describe('navigateToComment', () => {
  it('sets openComment on a comments route', () => {
    const navigate = vi.fn()
    const route = {key: 'comments' as const, id: docId}
    const prev = navigateToComment(navigate, route, commentRecordId)

    expect(navigate).toHaveBeenCalledWith({
      ...route,
      openComment: commentRecordId,
      isReplying: undefined,
      replyCommentVersion: undefined,
      rootReplyCommentVersion: undefined,
    })
    expect(prev).toEqual(route)
  })

  it('sets openComment on a document route with comments panel', () => {
    const navigate = vi.fn()
    const panel = {key: 'comments' as const, id: docId}
    const route = {key: 'document' as const, id: docId, panel}
    const prev = navigateToComment(navigate, route, commentRecordId)

    expect(navigate).toHaveBeenCalledWith({
      ...route,
      panel: {
        ...panel,
        openComment: commentRecordId,
        isReplying: undefined,
        replyCommentVersion: undefined,
        rootReplyCommentVersion: undefined,
      },
    })
    expect(prev).toBeTruthy()
  })

  it('returns null for unrelated routes', () => {
    const navigate = vi.fn()
    const route = {key: 'library' as const}
    const prev = navigateToComment(navigate, route, commentRecordId)

    expect(navigate).not.toHaveBeenCalled()
    expect(prev).toBeNull()
  })

  it('returns null when document route has a non-comments panel', () => {
    const navigate = vi.fn()
    const route = {key: 'document' as const, id: docId, panel: {key: 'activity' as const, id: docId}}
    const prev = navigateToComment(navigate, route, commentRecordId)

    expect(navigate).not.toHaveBeenCalled()
    expect(prev).toBeNull()
  })

  it('preserves existing route fields when navigating', () => {
    const navigate = vi.fn()
    const route = {key: 'comments' as const, id: docId, targetBlockId: 'blk1', width: 400}
    navigateToComment(navigate, route, commentRecordId)

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({targetBlockId: 'blk1', width: 400, openComment: commentRecordId}),
    )
  })

  it('clears stale reply data on a comments route after posting', () => {
    const navigate = vi.fn()
    const route = {
      key: 'comments' as const,
      id: docId,
      openComment: 'old-comment/id',
      isReplying: true,
      replyCommentVersion: 'bafyOldReplyVersion',
      rootReplyCommentVersion: 'bafyOldRootVersion',
    }
    navigateToComment(navigate, route, commentRecordId)

    const navigatedRoute = navigate.mock.calls[0][0]
    expect(navigatedRoute.openComment).toBe(commentRecordId)
    expect(navigatedRoute.isReplying).toBeUndefined()
    expect(navigatedRoute.replyCommentVersion).toBeUndefined()
    expect(navigatedRoute.rootReplyCommentVersion).toBeUndefined()
  })

  it('clears stale reply data on a document route with comments panel after posting', () => {
    const navigate = vi.fn()
    const panel = {
      key: 'comments' as const,
      id: docId,
      openComment: 'old-comment/id',
      isReplying: true,
      replyCommentVersion: 'bafyOldReplyVersion',
      rootReplyCommentVersion: 'bafyOldRootVersion',
    }
    const route = {key: 'document' as const, id: docId, panel}
    navigateToComment(navigate, route, commentRecordId)

    const navigatedRoute = navigate.mock.calls[0][0]
    expect(navigatedRoute.panel.openComment).toBe(commentRecordId)
    expect(navigatedRoute.panel.isReplying).toBeUndefined()
    expect(navigatedRoute.panel.replyCommentVersion).toBeUndefined()
    expect(navigatedRoute.panel.rootReplyCommentVersion).toBeUndefined()
  })
})

// ─── applyOptimisticComment ─────────────────────────────────────────────────

describe('applyOptimisticComment', () => {
  function createQueryClient() {
    return new QueryClient({defaultOptions: {queries: {retry: false}}})
  }

  it('appends a comment to the DOCUMENT_COMMENTS cache', () => {
    const qc = createQueryClient()
    const comment = makeComment()
    const key = [queryKeys.DOCUMENT_COMMENTS, docId]

    // Seed with existing comment
    const existing: HMListCommentsOutput = {comments: [makeComment({id: 'existing/comment'})], authors: {}}
    qc.setQueryData(key, existing)

    applyOptimisticComment(qc, docId, comment, authorMetadata)

    const data = qc.getQueryData<HMListCommentsOutput>(key)
    expect(data?.comments).toHaveLength(2)
    expect(data?.comments?.[1]?.id).toBe(commentRecordId)
  })

  it('includes author metadata in the cache', () => {
    const qc = createQueryClient()
    const comment = makeComment()
    const key = [queryKeys.DOCUMENT_COMMENTS, docId]

    qc.setQueryData(key, {comments: [], authors: {}})
    applyOptimisticComment(qc, docId, comment, authorMetadata)

    const data = qc.getQueryData<HMListCommentsOutput>(key)
    expect(data?.authors?.[comment.author]).toEqual(authorMetadata)
  })

  it('creates cache entry when none exists', () => {
    const qc = createQueryClient()
    const comment = makeComment()
    const key = [queryKeys.DOCUMENT_COMMENTS, docId]

    applyOptimisticComment(qc, docId, comment, authorMetadata)

    const data = qc.getQueryData<HMListCommentsOutput>(key)
    expect(data?.comments).toHaveLength(1)
    expect(data?.comments?.[0]?.id).toBe(commentRecordId)
  })

  it('updates BLOCK_DISCUSSIONS cache when quoting a block', () => {
    const qc = createQueryClient()
    const comment = makeComment()
    const quotingBlockId = 'blockXYZ'

    const blockTargetId = {...docId, blockRef: quotingBlockId}
    const blockKey = [queryKeys.BLOCK_DISCUSSIONS, blockTargetId]

    // Pre-seed block discussions cache
    qc.setQueryData(blockKey, {comments: [], authors: {}})

    applyOptimisticComment(qc, docId, comment, authorMetadata, quotingBlockId)

    const blockData = qc.getQueryData<HMListCommentsOutput>(blockKey)
    expect(blockData?.comments).toHaveLength(1)
    expect(blockData?.comments?.[0]?.id).toBe(commentRecordId)
  })

  it('skips BLOCK_DISCUSSIONS when no quoting block is given', () => {
    const qc = createQueryClient()
    const comment = makeComment()

    applyOptimisticComment(qc, docId, comment, authorMetadata)

    // No block discussion cache should be created
    const blockKey = [queryKeys.BLOCK_DISCUSSIONS, {...docId, blockRef: 'anyBlock'}]
    expect(qc.getQueryData(blockKey)).toBeUndefined()
  })

  it('returns a rollback function that restores previous state', () => {
    const qc = createQueryClient()
    const comment = makeComment()
    const key = [queryKeys.DOCUMENT_COMMENTS, docId]

    const existing: HMListCommentsOutput = {comments: [makeComment({id: 'existing/comment'})], authors: {}}
    qc.setQueryData(key, existing)

    const rollback = applyOptimisticComment(qc, docId, comment, authorMetadata)

    // Verify comment was added
    expect(qc.getQueryData<HMListCommentsOutput>(key)?.comments).toHaveLength(2)

    // Roll back
    rollback()

    const restored = qc.getQueryData<HMListCommentsOutput>(key)
    expect(restored?.comments).toHaveLength(1)
    expect(restored?.comments?.[0]?.id).toBe('existing/comment')
  })

  it('rollback restores BLOCK_DISCUSSIONS cache too', () => {
    const qc = createQueryClient()
    const comment = makeComment()
    const quotingBlockId = 'blockXYZ'

    const blockTargetId = {...docId, blockRef: quotingBlockId}
    const blockKey = [queryKeys.BLOCK_DISCUSSIONS, blockTargetId]

    const existingBlock: HMListCommentsOutput = {comments: [], authors: {}}
    qc.setQueryData(blockKey, existingBlock)

    const rollback = applyOptimisticComment(qc, docId, comment, authorMetadata, quotingBlockId)

    expect(qc.getQueryData<HMListCommentsOutput>(blockKey)?.comments).toHaveLength(1)

    rollback()

    expect(qc.getQueryData<HMListCommentsOutput>(blockKey)?.comments).toHaveLength(0)
  })

  it('handles null authorMetadata without crashing', () => {
    const qc = createQueryClient()
    const comment = makeComment()
    const key = [queryKeys.DOCUMENT_COMMENTS, docId]

    qc.setQueryData(key, {comments: [], authors: {}})

    expect(() => applyOptimisticComment(qc, docId, comment, null)).not.toThrow()

    const data = qc.getQueryData<HMListCommentsOutput>(key)
    expect(data?.comments).toHaveLength(1)
    expect(data?.authors).toEqual({})
  })
})
