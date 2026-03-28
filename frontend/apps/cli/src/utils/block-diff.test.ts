import {describe, test, expect} from 'bun:test'
import {
  createBlocksMap,
  matchBlockIds,
  computeReplaceOps,
  type APIBlockNode,
} from './block-diff'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function apiBlock(id: string, type: string, text = ''): APIBlockNode {
  return {
    block: {id, type, text, link: '', annotations: [], attributes: {}},
    children: [],
  }
}

function apiBlockWithChildren(id: string, type: string, text: string, children: APIBlockNode[]): APIBlockNode {
  return {
    block: {id, type, text, link: '', annotations: [], attributes: {}},
    children,
  }
}

function hmBlock(id: string, type: string, text = '', extra?: Record<string, unknown>): HMBlockNode {
  return {
    block: {type, id, text, annotations: [], attributes: {}, ...extra} as any,
  }
}

function hmBlockWithChildren(id: string, type: string, text: string, children: HMBlockNode[]): HMBlockNode {
  return {
    block: {type, id, text, annotations: [], attributes: {}} as any,
    children,
  }
}

// ── createBlocksMap ──────────────────────────────────────────────────────────

describe('createBlocksMap', () => {
  test('flat list produces correct parent and left fields', () => {
    const nodes = [
      apiBlock('a', 'Paragraph', 'First'),
      apiBlock('b', 'Paragraph', 'Second'),
      apiBlock('c', 'Heading', 'Third'),
    ]
    const map = createBlocksMap(nodes)

    expect(map['a']).toEqual({parent: '', left: '', block: nodes[0].block})
    expect(map['b']).toEqual({parent: '', left: 'a', block: nodes[1].block})
    expect(map['c']).toEqual({parent: '', left: 'b', block: nodes[2].block})
  })

  test('nested children produce correct parent relationships', () => {
    const child1 = apiBlock('c1', 'Paragraph', 'Child 1')
    const child2 = apiBlock('c2', 'Paragraph', 'Child 2')
    const parent = apiBlockWithChildren('p1', 'Heading', 'Parent', [child1, child2])
    const map = createBlocksMap([parent])

    expect(map['p1'].parent).toBe('')
    expect(map['c1'].parent).toBe('p1')
    expect(map['c1'].left).toBe('')
    expect(map['c2'].parent).toBe('p1')
    expect(map['c2'].left).toBe('c1')
  })

  test('empty input returns empty map', () => {
    expect(createBlocksMap([])).toEqual({})
  })

  test('custom parent ID', () => {
    const nodes = [apiBlock('x', 'Paragraph')]
    const map = createBlocksMap(nodes, 'custom-parent')
    expect(map['x'].parent).toBe('custom-parent')
  })

  test('skips nodes without block id', () => {
    const nodes: APIBlockNode[] = [
      {block: {id: '', type: 'Paragraph', text: '', link: '', annotations: [], attributes: {}}, children: []},
    ]
    const map = createBlocksMap(nodes)
    expect(Object.keys(map)).toHaveLength(0)
  })
})

// ── matchBlockIds ────────────────────────────────────────────────────────────

describe('matchBlockIds', () => {
  test('same-type blocks at same position reuse old IDs', () => {
    const old = [apiBlock('old-1', 'Paragraph'), apiBlock('old-2', 'Heading')]
    const fresh = [hmBlock('new-1', 'Paragraph'), hmBlock('new-2', 'Heading')]

    const matched = matchBlockIds(old, fresh)
    expect((matched[0].block as any).id).toBe('old-1')
    expect((matched[1].block as any).id).toBe('old-2')
  })

  test('different-type blocks get new IDs', () => {
    const old = [apiBlock('old-1', 'Paragraph')]
    const fresh = [hmBlock('new-1', 'Heading')]

    const matched = matchBlockIds(old, fresh)
    expect((matched[0].block as any).id).toBe('new-1') // not reused
  })

  test('new blocks beyond old list length keep generated IDs', () => {
    const old = [apiBlock('old-1', 'Paragraph')]
    const fresh = [hmBlock('new-1', 'Paragraph'), hmBlock('new-2', 'Paragraph')]

    const matched = matchBlockIds(old, fresh)
    expect((matched[0].block as any).id).toBe('old-1')
    expect((matched[1].block as any).id).toBe('new-2')
  })

  test('nested children are matched recursively', () => {
    const old = [apiBlockWithChildren('h1', 'Heading', 'Title', [apiBlock('p1', 'Paragraph', 'Content')])]
    const fresh = [hmBlockWithChildren('new-h', 'Heading', 'Title', [hmBlock('new-p', 'Paragraph')])]

    const matched = matchBlockIds(old, fresh)
    expect((matched[0].block as any).id).toBe('h1')
    expect((matched[0].children![0].block as any).id).toBe('p1')
  })

  test('empty old list keeps all new IDs', () => {
    const fresh = [hmBlock('a', 'Paragraph'), hmBlock('b', 'Heading')]
    const matched = matchBlockIds([], fresh)
    expect((matched[0].block as any).id).toBe('a')
    expect((matched[1].block as any).id).toBe('b')
  })

  test('empty new list returns empty array', () => {
    const old = [apiBlock('a', 'Paragraph')]
    expect(matchBlockIds(old, [])).toEqual([])
  })
})

// ── computeReplaceOps ────────────────────────────────────────────────────────

describe('computeReplaceOps', () => {
  test('unchanged blocks produce no ReplaceBlock ops', () => {
    const old = [apiBlock('a', 'Paragraph', 'Hello')]
    const map = createBlocksMap(old)
    const matched = [hmBlock('a', 'Paragraph', 'Hello')]

    const ops = computeReplaceOps(map, matched)

    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(0)
    // Should still have MoveBlocks
    const moveOps = ops.filter((o) => o.type === 'MoveBlocks')
    expect(moveOps.length).toBeGreaterThanOrEqual(1)
  })

  test('changed text produces ReplaceBlock', () => {
    const old = [apiBlock('a', 'Paragraph', 'Old text')]
    const map = createBlocksMap(old)
    const matched = [hmBlock('a', 'Paragraph', 'New text')]

    const ops = computeReplaceOps(map, matched)

    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(1)
  })

  test('new blocks produce ReplaceBlock and are included in MoveBlocks', () => {
    const old = [apiBlock('a', 'Paragraph', 'Existing')]
    const map = createBlocksMap(old)
    const matched = [hmBlock('a', 'Paragraph', 'Existing'), hmBlock('b', 'Paragraph', 'Brand new')]

    const ops = computeReplaceOps(map, matched)

    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(1) // Only 'b' is new
    expect((replaceOps[0] as any).block.id).toBe('b')

    const moveOps = ops.filter((o) => o.type === 'MoveBlocks')
    expect(moveOps.some((o: any) => o.blocks.includes('b'))).toBe(true)
  })

  test('removed blocks produce DeleteBlocks', () => {
    const old = [apiBlock('a', 'Paragraph', 'Keep'), apiBlock('b', 'Paragraph', 'Remove')]
    const map = createBlocksMap(old)
    const matched = [hmBlock('a', 'Paragraph', 'Keep')]

    const ops = computeReplaceOps(map, matched)

    const deleteOps = ops.filter((o) => o.type === 'DeleteBlocks')
    expect(deleteOps).toHaveLength(1)
    expect((deleteOps[0] as any).blocks).toContain('b')
  })

  test('empty matched tree produces DeleteBlocks for all old blocks', () => {
    const old = [apiBlock('a', 'Paragraph'), apiBlock('b', 'Paragraph')]
    const map = createBlocksMap(old)

    const ops = computeReplaceOps(map, [])

    const deleteOps = ops.filter((o) => o.type === 'DeleteBlocks')
    expect(deleteOps).toHaveLength(1)
    expect((deleteOps[0] as any).blocks).toContain('a')
    expect((deleteOps[0] as any).blocks).toContain('b')
  })

  test('empty old map with new blocks produces ReplaceBlock + MoveBlocks', () => {
    const map = createBlocksMap([])
    const matched = [hmBlock('a', 'Paragraph', 'New')]

    const ops = computeReplaceOps(map, matched)

    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(1)
    expect(ops.filter((o) => o.type === 'MoveBlocks')).toHaveLength(1)
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })

  test('nested children produce ops with correct parent', () => {
    const old = [apiBlockWithChildren('h1', 'Heading', 'Title', [apiBlock('p1', 'Paragraph', 'Old child')])]
    const map = createBlocksMap(old)
    const matched = [hmBlockWithChildren('h1', 'Heading', 'Title', [hmBlock('p1', 'Paragraph', 'New child')])]

    const ops = computeReplaceOps(map, matched)

    // p1 changed text
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps.some((o: any) => o.block.id === 'p1')).toBe(true)

    // MoveBlocks for children should have parent 'h1'
    const childMoves = ops.filter((o) => o.type === 'MoveBlocks' && (o as any).parent === 'h1')
    expect(childMoves).toHaveLength(1)
    expect((childMoves[0] as any).blocks).toContain('p1')
  })

  test('different annotation counts trigger ReplaceBlock', () => {
    const old: APIBlockNode[] = [
      {
        block: {
          id: 'a',
          type: 'Paragraph',
          text: 'bold',
          link: '',
          annotations: [{type: 'Bold', starts: [0], ends: [4]}],
          attributes: {},
        },
        children: [],
      },
    ]
    const map = createBlocksMap(old)
    const matched: HMBlockNode[] = [
      {block: {type: 'Paragraph', id: 'a', text: 'bold', annotations: [], attributes: {}} as any},
    ]

    const ops = computeReplaceOps(map, matched)
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(1)
  })

  test('different block type triggers ReplaceBlock', () => {
    const old = [apiBlock('a', 'Paragraph', 'Text')]
    const map = createBlocksMap(old)
    const matched: HMBlockNode[] = [
      {block: {type: 'Heading', id: 'a', text: 'Text', annotations: [], attributes: {}} as any},
    ]

    const ops = computeReplaceOps(map, matched)
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(1)
  })

  test('changed link triggers ReplaceBlock', () => {
    const old: APIBlockNode[] = [
      {
        block: {id: 'img1', type: 'Image', text: 'alt', link: 'ipfs://old-cid', annotations: [], attributes: {}},
        children: [],
      },
    ]
    const map = createBlocksMap(old)
    const matched: HMBlockNode[] = [
      {block: {type: 'Image', id: 'img1', text: 'alt', link: 'ipfs://new-cid', annotations: [], attributes: {}} as any},
    ]

    const ops = computeReplaceOps(map, matched)
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(1)
  })

  test('changed childrenType in attributes triggers ReplaceBlock', () => {
    const old: APIBlockNode[] = [
      {
        block: {id: 'a', type: 'Paragraph', text: '', link: '', annotations: [], attributes: {childrenType: 'Ordered'}},
        children: [],
      },
    ]
    const map = createBlocksMap(old)
    const matched: HMBlockNode[] = [
      {block: {type: 'Paragraph', id: 'a', text: '', annotations: [], attributes: {childrenType: 'Unordered'}} as any},
    ]

    const ops = computeReplaceOps(map, matched)
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(1)
  })
})

// ── ID-based diffing (smart update flow) ─────────────────────────────────────

describe('computeReplaceOps — ID-based diff (no matchBlockIds)', () => {
  test('blocks with matching IDs: unchanged content produces no ReplaceBlock', () => {
    const old = [apiBlock('abc12345', 'Paragraph', 'Hello world')]
    const map = createBlocksMap(old)
    const input: HMBlockNode[] = [hmBlock('abc12345', 'Paragraph', 'Hello world')]

    const ops = computeReplaceOps(map, input)
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(0)
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })

  test('blocks with matching IDs: changed text produces ReplaceBlock only for changed block', () => {
    const old = [
      apiBlock('blk-aaa', 'Paragraph', 'First paragraph'),
      apiBlock('blk-bbb', 'Paragraph', 'Second paragraph'),
      apiBlock('blk-ccc', 'Paragraph', 'Third paragraph'),
    ]
    const map = createBlocksMap(old)
    const input: HMBlockNode[] = [
      hmBlock('blk-aaa', 'Paragraph', 'First paragraph'),
      hmBlock('blk-bbb', 'Paragraph', 'EDITED second paragraph'),
      hmBlock('blk-ccc', 'Paragraph', 'Third paragraph'),
    ]

    const ops = computeReplaceOps(map, input)
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(1)
    expect((replaceOps[0] as any).block.id).toBe('blk-bbb')
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })

  test('mix of known and unknown IDs: known blocks are diffed, unknown are new', () => {
    const old = [
      apiBlock('blk-aaa', 'Paragraph', 'Existing paragraph'),
      apiBlock('blk-bbb', 'Heading', 'Existing heading'),
    ]
    const map = createBlocksMap(old)
    const input: HMBlockNode[] = [
      hmBlock('blk-aaa', 'Paragraph', 'Existing paragraph'),
      hmBlock('random99', 'Paragraph', 'A brand new paragraph'),
      hmBlock('blk-bbb', 'Heading', 'Existing heading'),
    ]

    const ops = computeReplaceOps(map, input)
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(1)
    expect((replaceOps[0] as any).block.id).toBe('random99')
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })

  test('no matching IDs: full body replacement', () => {
    const old = [apiBlock('old-aaa', 'Paragraph', 'Old content'), apiBlock('old-bbb', 'Heading', 'Old heading')]
    const map = createBlocksMap(old)
    const input: HMBlockNode[] = [
      hmBlock('gen-111', 'Paragraph', 'Entirely new content'),
      hmBlock('gen-222', 'Heading', 'New heading'),
    ]

    const ops = computeReplaceOps(map, input)
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(2)
    const deleteOps = ops.filter((o) => o.type === 'DeleteBlocks')
    expect(deleteOps).toHaveLength(1)
    expect((deleteOps[0] as any).blocks).toContain('old-aaa')
    expect((deleteOps[0] as any).blocks).toContain('old-bbb')
  })

  test('removed blocks are deleted, remaining blocks are preserved', () => {
    const old = [
      apiBlock('blk-aaa', 'Paragraph', 'Keep this'),
      apiBlock('blk-bbb', 'Paragraph', 'Delete this'),
      apiBlock('blk-ccc', 'Paragraph', 'Keep this too'),
    ]
    const map = createBlocksMap(old)
    const input: HMBlockNode[] = [
      hmBlock('blk-aaa', 'Paragraph', 'Keep this'),
      hmBlock('blk-ccc', 'Paragraph', 'Keep this too'),
    ]

    const ops = computeReplaceOps(map, input)
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(0)
    const deleteOps = ops.filter((o) => o.type === 'DeleteBlocks')
    expect(deleteOps).toHaveLength(1)
    expect((deleteOps[0] as any).blocks).toContain('blk-bbb')
    expect((deleteOps[0] as any).blocks).not.toContain('blk-aaa')
    expect((deleteOps[0] as any).blocks).not.toContain('blk-ccc')
  })

  test('reordered blocks produce MoveBlocks with correct order', () => {
    const old = [apiBlock('blk-aaa', 'Paragraph', 'First'), apiBlock('blk-bbb', 'Paragraph', 'Second')]
    const map = createBlocksMap(old)
    const input: HMBlockNode[] = [
      hmBlock('blk-bbb', 'Paragraph', 'Second'),
      hmBlock('blk-aaa', 'Paragraph', 'First'),
    ]

    const ops = computeReplaceOps(map, input)
    const moveOps = ops.filter((o) => o.type === 'MoveBlocks')
    expect(moveOps).toHaveLength(1)
    expect((moveOps[0] as any).blocks).toEqual(['blk-bbb', 'blk-aaa'])
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(0)
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })

  test('nested children with known IDs are diffed correctly', () => {
    const oldChild = apiBlock('child-1', 'Paragraph', 'Original child text')
    const oldParent = apiBlockWithChildren('parent-1', 'Heading', 'Parent', [oldChild])
    const map = createBlocksMap([oldParent])

    const newChild = hmBlock('child-1', 'Paragraph', 'Modified child text')
    const inputParent = hmBlockWithChildren('parent-1', 'Heading', 'Parent', [newChild])

    const ops = computeReplaceOps(map, [inputParent])
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(1)
    expect((replaceOps[0] as any).block.id).toBe('child-1')
    expect(replaceOps.some((o: any) => o.block.id === 'parent-1')).toBe(false)
  })

  test('new child block added to existing parent', () => {
    const oldChild = apiBlock('child-1', 'Paragraph', 'Existing child')
    const oldParent = apiBlockWithChildren('parent-1', 'Heading', 'Parent', [oldChild])
    const map = createBlocksMap([oldParent])

    const newChildren = [
      hmBlock('child-1', 'Paragraph', 'Existing child'),
      hmBlock('child-new', 'Paragraph', 'New child'),
    ]
    const inputParent = hmBlockWithChildren('parent-1', 'Heading', 'Parent', newChildren)

    const ops = computeReplaceOps(map, [inputParent])
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(1)
    expect((replaceOps[0] as any).block.id).toBe('child-new')
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })

  test('HMBlockNode works directly with computeReplaceOps for smart diff', () => {
    const existingDoc: APIBlockNode[] = [
      apiBlock('blk-1', 'Paragraph', 'First paragraph'),
      apiBlock('blk-2', 'Paragraph', 'Second paragraph'),
    ]
    const oldMap = createBlocksMap(existingDoc)

    const input: HMBlockNode[] = [
      {block: {type: 'Paragraph', id: 'blk-1', text: 'First paragraph', attributes: {}} as any},
      {block: {type: 'Paragraph', id: 'blk-2', text: 'EDITED second', attributes: {}} as any},
      {block: {type: 'Paragraph', id: 'new-blk', text: 'Brand new', attributes: {}} as any},
    ]

    const ops = computeReplaceOps(oldMap, input)

    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(2)
    const replacedIds = replaceOps.map((o: any) => o.block.id)
    expect(replacedIds).toContain('blk-2')
    expect(replacedIds).toContain('new-blk')
    expect(replacedIds).not.toContain('blk-1')
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })
})
