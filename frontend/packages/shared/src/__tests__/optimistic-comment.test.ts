/**
 * Tests for the optimistic-comment module.
 *
 * Covers:
 * - navigateToComment: pure navigation logic for focusing a comment after publish
 * - applyOptimisticComment: cache injection into React Query
 */

import {QueryClient} from '@tanstack/react-query'
import {describe, expect, it} from 'vitest'
import type {HMBlockNode, HMComment, HMListCommentsOutput, HMMetadataPayload} from '@seed-hypermedia/client/hm-types'
import type {NavRoute} from '../routes'
import {queryKeys} from '../models/query-keys'
import {hmId} from '../utils/entity-id-url'
import {applyOptimisticComment, getCommentSubmissionRoute} from '../optimistic-comment'

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

describe('getCommentSubmissionRoute', () => {
  it.each(['document', 'directory'] as const)('inherits the document ID for root submissions in a %s panel', (key) => {
    const route = {key, id: docId, panel: {key: 'comments'}} as NavRoute
    expect(getCommentSubmissionRoute(route, commentRecordId)).toBeNull()
  })

  it.each(['document', 'directory'] as const)('inherits the document ID for replies in a %s panel', (key) => {
    const route = {key, id: docId, panel: {key: 'comments', openComment: 'author/root'}} as NavRoute
    expect(getCommentSubmissionRoute(route, commentRecordId)).toMatchObject({
      key,
      id: docId,
      panel: {key: 'comments', openComment: 'author/root', replyCommentId: commentRecordId},
    })
  })

  it('keeps root lists and block discussions in place', () => {
    expect(getCommentSubmissionRoute({key: 'comments', id: docId}, commentRecordId)).toBeNull()
    expect(getCommentSubmissionRoute({key: 'comments', id: docId, targetBlockId: 'block'}, commentRecordId)).toBeNull()
    expect(
      getCommentSubmissionRoute({key: 'document', id: docId, panel: {key: 'comments', id: docId}}, commentRecordId),
    ).toBeNull()
  })

  it('extends the main discussion without replacing its context', () => {
    const route = {
      key: 'comments' as const,
      id: docId,
      openComment: 'author/context',
      replyCommentId: 'author/previous',
      openCommentVersion: 'old-version',
      blockId: 'old-block',
      blockRange: {start: 1, end: 2},
      replyCommentVersion: 'old-parent-version',
    }
    const next = getCommentSubmissionRoute(route, commentRecordId)
    expect(next).toMatchObject({
      key: 'comments',
      id: docId,
      openComment: 'author/context',
      replyCommentId: commentRecordId,
    })
    expect(next).not.toHaveProperty('blockId', 'old-block')
    expect(next).not.toHaveProperty('replyCommentVersion', 'old-parent-version')
    expect(route.replyCommentId).toBe('author/previous')
  })

  it.each(['document', 'activity', 'directory'] as const)('extends a panel beside %s', (key) => {
    const route = {key, id: docId, panel: {key: 'comments' as const, id: docId, openComment: 'author/context'}}
    expect(getCommentSubmissionRoute(route, commentRecordId)).toMatchObject({
      key,
      id: docId,
      panel: {openComment: 'author/context', replyCommentId: commentRecordId},
    })
  })

  it('preserves a moved discussion when a delayed publication completes', () => {
    const submittedRoute = {key: 'comments' as const, id: docId, openComment: 'author/context'}
    const currentRoute = {
      key: 'document' as const,
      id: docId,
      panel: {key: 'comments' as const, id: docId, openComment: 'author/context'},
    }
    expect(getCommentSubmissionRoute(currentRoute, commentRecordId, submittedRoute)).toMatchObject({
      key: 'document',
      panel: {openComment: 'author/context', replyCommentId: commentRecordId},
    })
  })

  it('does not reopen a discussion after the user leaves during publication', () => {
    const submittedRoute = {key: 'comments' as const, id: docId, openComment: 'author/context'}
    expect(
      getCommentSubmissionRoute({...submittedRoute, openComment: 'author/other'}, commentRecordId, submittedRoute),
    ).toBeNull()
    expect(
      getCommentSubmissionRoute(
        {...submittedRoute, replyCommentId: 'author/other-target'},
        commentRecordId,
        submittedRoute,
      ),
    ).toBeNull()
  })

  it('does not change an unrelated view', () => {
    expect(getCommentSubmissionRoute({key: 'library'}, commentRecordId)).toBeNull()
    expect(
      getCommentSubmissionRoute({key: 'document', id: docId, panel: {key: 'activity', id: docId}}, commentRecordId),
    ).toBeNull()
  })
})

// ─── applyOptimisticComment ─────────────────────────────────────────────────

describe('applyOptimisticComment', () => {
  function createQueryClient() {
    return new QueryClient({defaultOptions: {queries: {retry: false}}})
  }

  it('replaces the pending version without duplicating a published comment', () => {
    const qc = createQueryClient()
    const pending = makeComment({version: 'optimistic-pending'})
    applyOptimisticComment(qc, docId, pending, authorMetadata)
    const published = {...pending, version: 'published-cid'}
    applyOptimisticComment(qc, docId, published, authorMetadata)
    expect(qc.getQueryData<HMListCommentsOutput>([queryKeys.DOCUMENT_COMMENTS, docId])?.comments).toEqual([published])
  })

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

  it('accepts the new QuotingTarget shape with a range', () => {
    const qc = createQueryClient()
    const comment = makeComment()
    const quoting = {blockId: 'blockXYZ', range: {start: 1, end: 4}}

    const blockTargetId = {...docId, blockRef: quoting.blockId}
    const blockKey = [queryKeys.BLOCK_DISCUSSIONS, blockTargetId]
    qc.setQueryData(blockKey, {comments: [], authors: {}})

    applyOptimisticComment(qc, docId, comment, authorMetadata, quoting)

    const blockData = qc.getQueryData<HMListCommentsOutput>(blockKey)
    expect(blockData?.comments).toHaveLength(1)
  })

  it('updates every cached range of the quoted block and restores each on rollback', () => {
    const qc = createQueryClient()
    const comment = makeComment()
    const targets = [
      {...docId, blockRef: 'blockXYZ', blockRange: {start: 1, end: 4}},
      {...docId, blockRef: 'blockXYZ', blockRange: {start: 20, end: 25}, version: 'older'},
    ]
    const keys = targets.map((target) => [queryKeys.BLOCK_DISCUSSIONS, target])
    for (const key of keys) qc.setQueryData(key, {comments: [], authors: {}})
    const rollback = applyOptimisticComment(qc, docId, comment, authorMetadata, {
      blockId: 'blockXYZ',
      range: {start: 1, end: 4},
    })
    for (const key of keys) {
      expect(qc.getQueryData<HMListCommentsOutput>(key)?.comments.map((c) => c.id)).toEqual([comment.id])
    }
    rollback()
    for (const key of keys) expect(qc.getQueryData<HMListCommentsOutput>(key)?.comments).toEqual([])
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
