import type {EditorBlock} from '@seed-hypermedia/client/editor-types'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {compareBlocksWithMap, createBlocksMap, deduplicateBlockIds, getDocAttributeChanges} from './document-changes'

function para(id: string, children: EditorBlock[] = []): EditorBlock {
  return {
    type: 'paragraph',
    id,
    props: {},
    content: [],
    children,
  } as EditorBlock
}

function paraWithText(id: string, text: string, children: EditorBlock[] = []): EditorBlock {
  return {
    type: 'paragraph',
    id,
    props: {},
    content: [{type: 'text', text, styles: {}}],
    children,
  } as EditorBlock
}

function publishedNode(id: string, text = '', children: HMBlockNode[] = []): HMBlockNode {
  return {
    block: {
      id,
      type: 'Paragraph',
      text,
      attributes: {},
      annotations: [],
    } as HMBlockNode['block'],
    children,
  }
}

describe('getDocAttributeChanges', () => {
  it('emits document childrenType metadata changes', () => {
    const changes = getDocAttributeChanges({childrenType: 'Ordered'})

    expect(changes).toHaveLength(1)
    expect(changes[0]!.op.case).toBe('setAttribute')
    if (changes[0]!.op.case !== 'setAttribute') throw new Error('expected setAttribute')
    expect(changes[0]!.op.value.blockId).toBe('')
    expect(changes[0]!.op.value.key).toEqual(['childrenType'])
    expect(changes[0]!.op.value.value.case).toBe('stringValue')
    expect(changes[0]!.op.value.value.value).toBe('Ordered')
  })
})

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

  it('replaces empty/missing IDs with fresh ones', () => {
    const blocks = [para(''), para(''), para('keep')]
    const result = deduplicateBlockIds(blocks)
    expect(result[0]!.id).not.toBe('')
    expect(result[1]!.id).not.toBe('')
    expect(result[0]!.id).not.toBe(result[1]!.id)
    expect(result[2]!.id).toBe('keep')
  })

  it('retries the generate factory on collision', () => {
    const sequence = ['dup', 'dup', 'fresh']
    let i = 0
    const generate = () => sequence[i++] ?? 'fallback'
    const blocks = [para('dup'), para('dup')]
    const result = deduplicateBlockIds(blocks, new Set(), generate)
    expect(result[0]!.id).toBe('dup')
    expect(result[1]!.id).toBe('fresh')
  })
})

describe('compareBlocksWithMap (publish-diff path)', () => {
  it('never emits moveBlock with blockId === leftSibling for duplicate sibling subtrees', () => {
    const base: HMBlockNode[] = [publishedNode('parent', '', [publishedNode('dup', 'base child')])]
    const draft: EditorBlock[] = [
      paraWithText('parent', '', [paraWithText('dup', 'first copy'), paraWithText('dup', 'second copy')]),
    ]

    const blocksMap = createBlocksMap(base, '')
    const {changes} = compareBlocksWithMap(blocksMap, draft, '')

    const selfMoves = changes.filter((change) => {
      if (change.op?.case !== 'moveBlock') return false
      const move = change.op.value
      return move.blockId === move.leftSibling
    })

    expect(selfMoves).toEqual([])
  })

  it('does not emit self-moves when duplicate sibling IDs appear at top level', () => {
    const draft: EditorBlock[] = [paraWithText('a', 'one'), paraWithText('a', 'two'), paraWithText('a', 'three')]

    const {changes} = compareBlocksWithMap({}, draft, '')

    const selfMoves = changes.filter((change) => {
      if (change.op?.case !== 'moveBlock') return false
      const move = change.op.value
      return move.blockId === move.leftSibling
    })

    expect(selfMoves).toEqual([])
  })

  // Regression for issue #807: an unknown/corrupt block type used to throw
  // "Unsupported block type unknown" here, crashing the publish/change-count UI.
  it('does not crash and emits no replaceBlock for an unchanged unknown block', () => {
    const unknownServerBlock = {
      id: 'empty',
      type: '',
      revision: '',
      text: '',
      link: '',
      annotations: [],
    }
    const base: HMBlockNode[] = [{block: unknownServerBlock as HMBlockNode['block'], children: []}]
    const unknownEditorBlock = {
      id: 'empty',
      type: 'unknown',
      props: {originalType: '', originalData: JSON.stringify(unknownServerBlock)},
      content: [],
      children: [],
    } as unknown as EditorBlock

    const blocksMap = createBlocksMap(base, '')

    let changes: ReturnType<typeof compareBlocksWithMap>['changes'] = []
    expect(() => {
      changes = compareBlocksWithMap(blocksMap, [unknownEditorBlock], '').changes
    }).not.toThrow()

    const replaces = changes.filter((change) => change.op?.case === 'replaceBlock')
    expect(replaces).toEqual([])
  })
})
