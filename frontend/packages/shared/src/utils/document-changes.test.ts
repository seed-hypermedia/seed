import type {EditorBlock} from '@seed-hypermedia/client/editor-types'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {
  compareBlocksWithMap,
  createBlocksMap,
  deduplicateBlockIds,
  expandObjectRemovals,
  getDocAttributeChanges,
} from './document-changes'

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

  it('emits setAttribute ops for arbitrary custom metadata keys and nested objects', () => {
    const changes = getDocAttributeChanges({
      customText: 'hi',
      customCount: 3,
      customFlag: true,
      nested: {inner: 'deep'},
    } as Record<string, unknown>)

    const byKey = new Map(
      changes.map((change) => {
        if (change.op.case !== 'setAttribute') throw new Error('expected setAttribute')
        return [change.op.value.key.join('.'), change.op.value.value]
      }),
    )
    expect(byKey.get('customText')).toMatchObject({case: 'stringValue', value: 'hi'})
    expect(byKey.get('customCount')).toMatchObject({case: 'intValue', value: 3n})
    expect(byKey.get('customFlag')).toMatchObject({case: 'boolValue', value: true})
    // nested objects are flattened into keyed attribute paths
    expect(byKey.get('nested.inner')).toMatchObject({case: 'stringValue', value: 'deep'})
  })

  const nullKeys = (changes: ReturnType<typeof getDocAttributeChanges>) =>
    changes
      .filter((c) => c.op.case === 'setAttribute' && c.op.value.value.case === 'nullValue')
      .map((c) => (c.op.case === 'setAttribute' ? c.op.value.key.join('.') : ''))

  it('deleting an object field emits a null removal for the key', () => {
    // Row "Remove" stages { obj: null }.
    const changes = getDocAttributeChanges({name: 'x', obj: null} as Record<string, unknown>)
    expect(nullKeys(changes)).toContain('obj')
  })

  it('an emptied object (all children removed) emits a null removal instead of nothing', () => {
    // With no leaves there is no attribute op to represent it, so it must clear.
    expect(nullKeys(getDocAttributeChanges({obj: {}} as Record<string, unknown>))).toContain('obj')
    expect(nullKeys(getDocAttributeChanges({obj: {nested: {}}} as Record<string, unknown>))).toContain('obj.nested')
  })

  it('removing object children emits per-leaf null removals', () => {
    const changes = getDocAttributeChanges({obj: {a: null, b: null}} as Record<string, unknown>)
    expect(nullKeys(changes)).toEqual(expect.arrayContaining(['obj.a', 'obj.b']))
  })

  it('expandObjectRemovals turns an object tombstone into a per-leaf null publish', () => {
    // Draft removed the object (staged { test: null }); published doc has it.
    const draft = {test: null} as never
    const published = {name: 'Doc', test: {b: 'beee', number: 123, toggle: false}} as never
    const expanded = expandObjectRemovals(draft, published) as Record<string, unknown>
    // Every leaf is explicitly nulled (so publish doesn't rely on a parent-null).
    expect(expanded.test).toEqual({b: null, number: null, toggle: null})
    // Un-edited keys (e.g. name) are not introduced/touched.
    expect('name' in expanded).toBe(false)
    // Publishing yields a null op per leaf.
    expect(nullKeys(getDocAttributeChanges(expanded as never))).toEqual(
      expect.arrayContaining(['test.b', 'test.number', 'test.toggle']),
    )
  })

  it('expandObjectRemovals leaves non-removal edits and scalar tombstones alone', () => {
    const published = {a: 'x', obj: {k: 1}} as never
    // scalar removal stays a plain null; a normal value passes through
    expect(expandObjectRemovals({a: null, keep: 'v'} as never, published)).toEqual({a: null, keep: 'v'})
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
