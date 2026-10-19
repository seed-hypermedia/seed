import {describe, expect, it} from 'vitest'
import {calculateInteractionSummary} from '../interaction-summary'
import {hmId} from '../utils/entity-id-url'

// Minimal mock types matching proto Mention shape
function makeMention(
  source: string,
  sourceType: 'Ref' | 'Comment',
  author?: string,
  targetFragment?: string,
  sourceContext?: string,
) {
  return {
    source,
    sourceType,
    sourceContext: sourceContext ?? '',
    sourceBlob: author ? {author, createTime: undefined, cid: ''} : undefined,
    targetVersion: 'v1',
    targetFragment: targetFragment ?? '',
    isExactVersion: false,
  } as any
}

const targetDocId = hmId('owner-uid', {path: ['doc1']})
const emptyChanges: any[] = []

describe('calculateInteractionSummary', () => {
  it('returns empty authorUids when there are no mentions', () => {
    const result = calculateInteractionSummary([], emptyChanges, targetDocId)
    expect(result.authorUids).toEqual([])
  })

  it('collects author UIDs from comment mentions', () => {
    const mentions = [
      makeMention('hm://commenter-a/zComment1', 'Comment', 'commenter-a'),
      makeMention('hm://commenter-b/zComment2', 'Comment', 'commenter-b'),
    ]
    const result = calculateInteractionSummary(mentions, emptyChanges, targetDocId)
    expect(result.authorUids).toContain('commenter-a')
    expect(result.authorUids).toContain('commenter-b')
    expect(result.authorUids).toHaveLength(2)
  })

  it('collects author UIDs from document citations', () => {
    const mentions = [makeMention('hm://doc-author/doc2', 'Ref', 'doc-author')]
    const result = calculateInteractionSummary(mentions, emptyChanges, targetDocId)
    expect(result.authorUids).toContain('doc-author')
    expect(result.authorUids).toHaveLength(1)
  })

  it('deduplicates author UIDs across multiple mentions', () => {
    const mentions = [
      makeMention('hm://author-a/zComment1', 'Comment', 'author-a'),
      makeMention('hm://author-a/zComment2', 'Comment', 'author-a'),
      makeMention('hm://author-a/doc3', 'Ref', 'author-a'),
    ]
    const result = calculateInteractionSummary(mentions, emptyChanges, targetDocId)
    expect(result.authorUids).toEqual(['author-a'])
  })

  it('filters out undefined/null authors', () => {
    const mentions = [
      makeMention('hm://no-author/zComment1', 'Comment', undefined),
      makeMention('hm://has-author/zComment2', 'Comment', 'has-author'),
    ]
    const result = calculateInteractionSummary(mentions, emptyChanges, targetDocId)
    expect(result.authorUids).toEqual(['has-author'])
  })

  it('counts a document citation once per citing block, and the citing document once', () => {
    // A paper cites entry ref-14 from three paragraphs; ListCitations returns one row per citing block.
    const mentions = [
      makeMention('hm://owner-uid/paper', 'Ref', 'owner-uid', 'ref-14', 'p1'),
      makeMention('hm://owner-uid/paper', 'Ref', 'owner-uid', 'ref-14', 'p2'),
      makeMention('hm://owner-uid/paper', 'Ref', 'owner-uid', 'ref-14', 'p3'),
      makeMention('hm://owner-uid/paper', 'Ref', 'owner-uid', 'ref-15', 'p3'),
    ]
    const result = calculateInteractionSummary(mentions, emptyChanges, targetDocId)
    expect(result.blocks['ref-14']).toEqual({citations: 3, comments: 0})
    expect(result.blocks['ref-15']).toEqual({citations: 1, comments: 0})
    expect(result.citations).toBe(1)
  })

  it('collapses one citing block seen in several versions, and counts a comment once', () => {
    const mentions = [
      makeMention('hm://other/doc', 'Ref', 'other', 'b1', 'p1'),
      makeMention('hm://other/doc', 'Ref', 'other', 'b1', 'p1'),
      makeMention('hm://commenter/zComment1', 'Comment', 'commenter', 'b1', 'c1'),
      makeMention('hm://commenter/zComment1', 'Comment', 'commenter', 'b1', 'c2'),
    ]
    const result = calculateInteractionSummary(mentions, emptyChanges, targetDocId)
    expect(result.blocks['b1']).toEqual({citations: 1, comments: 1})
    expect(result.citations).toBe(1)
    expect(result.comments).toBe(1)
  })

  it('includes both comment and document citation authors', () => {
    const mentions = [
      makeMention('hm://commenter/zComment1', 'Comment', 'commenter'),
      makeMention('hm://citer/doc2', 'Ref', 'citer'),
    ]
    const result = calculateInteractionSummary(mentions, emptyChanges, targetDocId)
    expect(result.authorUids).toHaveLength(2)
    expect(result.authorUids).toContain('commenter')
    expect(result.authorUids).toContain('citer')
  })
})
