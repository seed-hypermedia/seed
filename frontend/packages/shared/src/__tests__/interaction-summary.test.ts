import {describe, expect, it} from 'vitest'
import {calculateInteractionSummary} from '../interaction-summary'
import {hmId} from '../utils/entity-id-url'

// Minimal mock types matching proto Mention shape
function makeMention(source: string, sourceType: 'Ref' | 'Comment', author?: string, targetFragment?: string) {
  return {
    source,
    sourceType,
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
      makeMention('hm://commenter-a/c/comment1', 'Comment', 'commenter-a'),
      makeMention('hm://commenter-b/c/comment2', 'Comment', 'commenter-b'),
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
      makeMention('hm://author-a/c/comment1', 'Comment', 'author-a'),
      makeMention('hm://author-a/c/comment2', 'Comment', 'author-a'),
      makeMention('hm://author-a/doc3', 'Ref', 'author-a'),
    ]
    const result = calculateInteractionSummary(mentions, emptyChanges, targetDocId)
    expect(result.authorUids).toEqual(['author-a'])
  })

  it('filters out undefined/null authors', () => {
    const mentions = [
      makeMention('hm://no-author/c/comment1', 'Comment', undefined),
      makeMention('hm://has-author/c/comment2', 'Comment', 'has-author'),
    ]
    const result = calculateInteractionSummary(mentions, emptyChanges, targetDocId)
    expect(result.authorUids).toEqual(['has-author'])
  })

  it('includes both comment and document citation authors', () => {
    const mentions = [
      makeMention('hm://commenter/c/comment1', 'Comment', 'commenter'),
      makeMention('hm://citer/doc2', 'Ref', 'citer'),
    ]
    const result = calculateInteractionSummary(mentions, emptyChanges, targetDocId)
    expect(result.authorUids).toHaveLength(2)
    expect(result.authorUids).toContain('commenter')
    expect(result.authorUids).toContain('citer')
  })
})
