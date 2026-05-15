import type {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {describe, expect, it} from 'vitest'
import {deduplicateBlockIds} from './document-changes'

function para(id: string, children: EditorBlock[] = []): EditorBlock {
  return {
    type: 'paragraph',
    id,
    props: {},
    content: [],
    children,
  } as EditorBlock
}

describe('deduplicateBlockIds', () => {
  it('returns blocks unchanged when no duplicates', () => {
    const blocks = [para('a'), para('b'), para('c')]
    const result = deduplicateBlockIds(blocks)
    expect(result.map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })

  it('assigns new ID to duplicate sibling', () => {
    const blocks = [para('a'), para('a')]
    const result = deduplicateBlockIds(blocks)
    expect(result[0]!.id).toBe('a')
    expect(result[1]!.id).not.toBe('a')
    expect(result[1]!.id.length).toBe(8)
  })

  it('assigns new ID to duplicate in nested children', () => {
    const blocks = [para('a', [para('b')]), para('b')]
    const result = deduplicateBlockIds(blocks)
    expect(result[0]!.id).toBe('a')
    expect(result[0]!.children[0]!.id).toBe('b')
    expect(result[1]!.id).not.toBe('b')
  })

  it('handles triple duplicates', () => {
    const blocks = [para('x'), para('x'), para('x')]
    const result = deduplicateBlockIds(blocks)
    const ids = result.map((b) => b.id)
    expect(ids[0]).toBe('x')
    expect(new Set(ids).size).toBe(3)
  })

  it('deduplicates deeply nested blocks', () => {
    const blocks = [para('a', [para('b', [para('c')])]), para('c')]
    const result = deduplicateBlockIds(blocks)
    expect(result[0]!.children[0]!.children[0]!.id).toBe('c')
    expect(result[1]!.id).not.toBe('c')
  })

  it('never produces block==left scenario', () => {
    const blocks = [para('a'), para('a'), para('b'), para('b')]
    const result = deduplicateBlockIds(blocks)
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.id).not.toBe(result[i - 1]!.id)
    }
  })

  describe('published ID protection', () => {
    it('never renames a published block on first encounter', () => {
      const published = new Set(['a', 'b'])
      const blocks = [para('a'), para('b'), para('a')]
      const result = deduplicateBlockIds(blocks, published)
      expect(result[0]!.id).toBe('a')
      expect(result[1]!.id).toBe('b')
      expect(result[2]!.id).not.toBe('a')
    })

    it('renames non-published block that collides with published ID', () => {
      const published = new Set(['x'])
      const blocks = [para('x'), para('x')]
      const result = deduplicateBlockIds(blocks, published)
      expect(result[0]!.id).toBe('x')
      expect(result[1]!.id).not.toBe('x')
    })

    it('keeps published IDs even without duplicates', () => {
      const published = new Set(['a', 'b'])
      const blocks = [para('a'), para('b'), para('c')]
      const result = deduplicateBlockIds(blocks, published)
      expect(result.map((b) => b.id)).toEqual(['a', 'b', 'c'])
    })

    it('renames new block whose ID matches published ID in nested children', () => {
      const published = new Set(['x'])
      const blocks = [para('a', [para('x')]), para('x')]
      const result = deduplicateBlockIds(blocks, published)
      expect(result[0]!.children[0]!.id).toBe('x')
      expect(result[1]!.id).not.toBe('x')
    })
  })
})
