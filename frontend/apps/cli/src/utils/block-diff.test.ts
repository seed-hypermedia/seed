import {describe, test, expect} from 'bun:test'
import {
  createBlocksMap,
  matchBlockIds,
  computeReplaceOps,
  hmBlockNodeToBlockNode,
  type APIBlockNode,
} from './block-diff'
import type {BlockNode} from './markdown'
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

function newBlock(id: string, type: string, text = ''): BlockNode {
  return {
    block: {id, type, text, annotations: []},
    children: [],
  }
}

function newBlockWithChildren(id: string, type: string, text: string, children: BlockNode[]): BlockNode {
  return {
    block: {id, type, text, annotations: []},
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
    const fresh = [newBlock('new-1', 'Paragraph'), newBlock('new-2', 'Heading')]

    const matched = matchBlockIds(old, fresh)
    expect(matched[0].block.id).toBe('old-1')
    expect(matched[1].block.id).toBe('old-2')
  })

  test('different-type blocks get new IDs', () => {
    const old = [apiBlock('old-1', 'Paragraph')]
    const fresh = [newBlock('new-1', 'Heading')]

    const matched = matchBlockIds(old, fresh)
    expect(matched[0].block.id).toBe('new-1') // not reused
  })

  test('new blocks beyond old list length keep generated IDs', () => {
    const old = [apiBlock('old-1', 'Paragraph')]
    const fresh = [newBlock('new-1', 'Paragraph'), newBlock('new-2', 'Paragraph')]

    const matched = matchBlockIds(old, fresh)
    expect(matched[0].block.id).toBe('old-1')
    expect(matched[1].block.id).toBe('new-2')
  })

  test('nested children are matched recursively', () => {
    const old = [apiBlockWithChildren('h1', 'Heading', 'Title', [apiBlock('p1', 'Paragraph', 'Content')])]
    const fresh = [newBlockWithChildren('new-h', 'Heading', 'Title', [newBlock('new-p', 'Paragraph')])]

    const matched = matchBlockIds(old, fresh)
    expect(matched[0].block.id).toBe('h1')
    expect(matched[0].children[0].block.id).toBe('p1')
  })

  test('empty old list keeps all new IDs', () => {
    const fresh = [newBlock('a', 'Paragraph'), newBlock('b', 'Heading')]
    const matched = matchBlockIds([], fresh)
    expect(matched[0].block.id).toBe('a')
    expect(matched[1].block.id).toBe('b')
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
    const matched = [newBlock('a', 'Paragraph', 'Hello')]

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
    const matched = [newBlock('a', 'Paragraph', 'New text')]

    const ops = computeReplaceOps(map, matched)

    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(1)
  })

  test('new blocks produce ReplaceBlock and are included in MoveBlocks', () => {
    const old = [apiBlock('a', 'Paragraph', 'Existing')]
    const map = createBlocksMap(old)
    const matched = [newBlock('a', 'Paragraph', 'Existing'), newBlock('b', 'Paragraph', 'Brand new')]

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
    const matched = [newBlock('a', 'Paragraph', 'Keep')]

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
    const matched = [newBlock('a', 'Paragraph', 'New')]

    const ops = computeReplaceOps(map, matched)

    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(1)
    expect(ops.filter((o) => o.type === 'MoveBlocks')).toHaveLength(1)
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })

  test('nested children produce ops with correct parent', () => {
    const old = [apiBlockWithChildren('h1', 'Heading', 'Title', [apiBlock('p1', 'Paragraph', 'Old child')])]
    const map = createBlocksMap(old)
    const matched = [newBlockWithChildren('h1', 'Heading', 'Title', [newBlock('p1', 'Paragraph', 'New child')])]

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
    const matched: BlockNode[] = [{block: {id: 'a', type: 'Paragraph', text: 'bold', annotations: []}, children: []}]

    const ops = computeReplaceOps(map, matched)
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(1)
  })

  test('different block type triggers ReplaceBlock', () => {
    const old = [apiBlock('a', 'Paragraph', 'Text')]
    const map = createBlocksMap(old)
    // Same id but different type (would happen if matchBlockIds reused the id despite type mismatch)
    const matched: BlockNode[] = [{block: {id: 'a', type: 'Heading', text: 'Text', annotations: []}, children: []}]

    const ops = computeReplaceOps(map, matched)
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(1)
  })
})

// ── ID-based diffing (smart update flow) ─────────────────────────────────────

describe('computeReplaceOps — ID-based diff (no matchBlockIds)', () => {
  test('blocks with matching IDs: unchanged content produces no ReplaceBlock', () => {
    // Simulates: user exports doc, makes no changes, re-imports
    const old = [apiBlock('abc12345', 'Paragraph', 'Hello world')]
    const map = createBlocksMap(old)
    // Input has the same ID from <!-- id:abc12345 --> comment
    const input: BlockNode[] = [newBlock('abc12345', 'Paragraph', 'Hello world')]

    const ops = computeReplaceOps(map, input)
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(0)
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })

  test('blocks with matching IDs: changed text produces ReplaceBlock only for changed block', () => {
    // Simulates: user exports doc, edits one paragraph, re-imports
    const old = [
      apiBlock('blk-aaa', 'Paragraph', 'First paragraph'),
      apiBlock('blk-bbb', 'Paragraph', 'Second paragraph'),
      apiBlock('blk-ccc', 'Paragraph', 'Third paragraph'),
    ]
    const map = createBlocksMap(old)
    const input: BlockNode[] = [
      newBlock('blk-aaa', 'Paragraph', 'First paragraph'),
      newBlock('blk-bbb', 'Paragraph', 'EDITED second paragraph'),
      newBlock('blk-ccc', 'Paragraph', 'Third paragraph'),
    ]

    const ops = computeReplaceOps(map, input)
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(1)
    expect((replaceOps[0] as any).block.id).toBe('blk-bbb')
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })

  test('mix of known and unknown IDs: known blocks are diffed, unknown are new', () => {
    // Simulates: user exports doc, adds a new paragraph (no ID comment)
    const old = [
      apiBlock('blk-aaa', 'Paragraph', 'Existing paragraph'),
      apiBlock('blk-bbb', 'Heading', 'Existing heading'),
    ]
    const map = createBlocksMap(old)
    const input: BlockNode[] = [
      newBlock('blk-aaa', 'Paragraph', 'Existing paragraph'), // unchanged
      newBlock('random99', 'Paragraph', 'A brand new paragraph'), // new block, ID not in old
      newBlock('blk-bbb', 'Heading', 'Existing heading'), // unchanged
    ]

    const ops = computeReplaceOps(map, input)
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    // Only the new block should get ReplaceBlock
    expect(replaceOps).toHaveLength(1)
    expect((replaceOps[0] as any).block.id).toBe('random99')
    // No deletes — all old blocks are still present
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })

  test('no matching IDs: full body replacement', () => {
    // Simulates: user writes fresh markdown without ID comments
    const old = [apiBlock('old-aaa', 'Paragraph', 'Old content'), apiBlock('old-bbb', 'Heading', 'Old heading')]
    const map = createBlocksMap(old)
    const input: BlockNode[] = [
      newBlock('gen-111', 'Paragraph', 'Entirely new content'),
      newBlock('gen-222', 'Heading', 'New heading'),
    ]

    const ops = computeReplaceOps(map, input)
    // All input blocks are new → ReplaceBlock for each
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(2)
    // All old blocks are deleted
    const deleteOps = ops.filter((o) => o.type === 'DeleteBlocks')
    expect(deleteOps).toHaveLength(1)
    expect((deleteOps[0] as any).blocks).toContain('old-aaa')
    expect((deleteOps[0] as any).blocks).toContain('old-bbb')
  })

  test('removed blocks are deleted, remaining blocks are preserved', () => {
    // Simulates: user exports doc, removes a paragraph, re-imports
    const old = [
      apiBlock('blk-aaa', 'Paragraph', 'Keep this'),
      apiBlock('blk-bbb', 'Paragraph', 'Delete this'),
      apiBlock('blk-ccc', 'Paragraph', 'Keep this too'),
    ]
    const map = createBlocksMap(old)
    const input: BlockNode[] = [
      newBlock('blk-aaa', 'Paragraph', 'Keep this'),
      newBlock('blk-ccc', 'Paragraph', 'Keep this too'),
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
    // Swap order
    const input: BlockNode[] = [newBlock('blk-bbb', 'Paragraph', 'Second'), newBlock('blk-aaa', 'Paragraph', 'First')]

    const ops = computeReplaceOps(map, input)
    const moveOps = ops.filter((o) => o.type === 'MoveBlocks')
    expect(moveOps).toHaveLength(1)
    expect((moveOps[0] as any).blocks).toEqual(['blk-bbb', 'blk-aaa'])
    // No content changes
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(0)
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })

  test('nested children with known IDs are diffed correctly', () => {
    const oldChild = apiBlock('child-1', 'Paragraph', 'Original child text')
    const oldParent = apiBlockWithChildren('parent-1', 'Heading', 'Parent', [oldChild])
    const map = createBlocksMap([oldParent])

    const newChild = newBlock('child-1', 'Paragraph', 'Modified child text')
    const inputParent = newBlockWithChildren('parent-1', 'Heading', 'Parent', [newChild])

    const ops = computeReplaceOps(map, [inputParent])
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    // Only the child text changed
    expect(replaceOps).toHaveLength(1)
    expect((replaceOps[0] as any).block.id).toBe('child-1')
    // Parent is unchanged
    expect(replaceOps.some((o: any) => o.block.id === 'parent-1')).toBe(false)
  })

  test('new child block added to existing parent', () => {
    const oldChild = apiBlock('child-1', 'Paragraph', 'Existing child')
    const oldParent = apiBlockWithChildren('parent-1', 'Heading', 'Parent', [oldChild])
    const map = createBlocksMap([oldParent])

    const newChildren = [
      newBlock('child-1', 'Paragraph', 'Existing child'),
      newBlock('child-new', 'Paragraph', 'New child'),
    ]
    const inputParent = newBlockWithChildren('parent-1', 'Heading', 'Parent', newChildren)

    const ops = computeReplaceOps(map, [inputParent])
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(1)
    expect((replaceOps[0] as any).block.id).toBe('child-new')
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })
})

// ── hmBlockNodeToBlockNode ──────────────────────────────────────────────────

describe('hmBlockNodeToBlockNode', () => {
  test('converts basic paragraph', () => {
    const hm: HMBlockNode = {
      block: {
        type: 'Paragraph',
        id: 'abc123',
        text: 'Hello world',
        annotations: [{type: 'Bold', starts: [0], ends: [5]}],
        attributes: {},
      },
      children: [],
    }

    const result = hmBlockNodeToBlockNode(hm)
    expect(result.block.type).toBe('Paragraph')
    expect(result.block.id).toBe('abc123')
    expect(result.block.text).toBe('Hello world')
    expect(result.block.annotations).toEqual([{type: 'Bold', starts: [0], ends: [5]}])
    expect(result.children).toEqual([])
  })

  test('extracts childrenType from attributes', () => {
    const hm: HMBlockNode = {
      block: {
        type: 'Paragraph',
        id: 'list1',
        text: 'Item',
        attributes: {childrenType: 'Ordered'},
      },
    }

    const result = hmBlockNodeToBlockNode(hm)
    expect(result.block.childrenType).toBe('Ordered')
  })

  test('extracts language from attributes (code block)', () => {
    const hm: HMBlockNode = {
      block: {
        type: 'Code',
        id: 'code1',
        text: 'const x = 1',
        attributes: {language: 'typescript'},
      },
    }

    const result = hmBlockNodeToBlockNode(hm)
    expect(result.block.language).toBe('typescript')
  })

  test('preserves link field', () => {
    const hm: HMBlockNode = {
      block: {
        type: 'Image',
        id: 'img1',
        text: '',
        link: 'ipfs://bafy...',
        attributes: {},
      },
    }

    const result = hmBlockNodeToBlockNode(hm)
    expect(result.block.link).toBe('ipfs://bafy...')
  })

  test('converts children recursively', () => {
    const hm: HMBlockNode = {
      block: {type: 'Heading', id: 'h1', text: 'Title', attributes: {}},
      children: [
        {
          block: {type: 'Paragraph', id: 'p1', text: 'Child 1', attributes: {}},
          children: [],
        },
        {
          block: {type: 'Paragraph', id: 'p2', text: 'Child 2', attributes: {}},
        },
      ],
    }

    const result = hmBlockNodeToBlockNode(hm)
    expect(result.children).toHaveLength(2)
    expect(result.children[0].block.id).toBe('p1')
    expect(result.children[0].block.text).toBe('Child 1')
    expect(result.children[1].block.id).toBe('p2')
    expect(result.children[1].block.text).toBe('Child 2')
  })

  test('handles missing optional fields gracefully', () => {
    const hm: HMBlockNode = {
      block: {type: 'Paragraph', id: 'min', text: '', attributes: {}},
    }

    const result = hmBlockNodeToBlockNode(hm)
    expect(result.block.type).toBe('Paragraph')
    expect(result.block.id).toBe('min')
    expect(result.block.text).toBe('')
    expect(result.block.annotations).toEqual([])
    expect(result.children).toEqual([])
    expect(result.block.childrenType).toBeUndefined()
    expect(result.block.language).toBeUndefined()
    expect(result.block.link).toBeUndefined()
  })

  test('converted HMBlockNode works with computeReplaceOps for smart diff', () => {
    // End-to-end: existing doc → JSON input with IDs → diff
    const existingDoc: APIBlockNode[] = [
      apiBlock('blk-1', 'Paragraph', 'First paragraph'),
      apiBlock('blk-2', 'Paragraph', 'Second paragraph'),
    ]
    const oldMap = createBlocksMap(existingDoc)

    // JSON input: user modified second paragraph and added a third
    const jsonInput: HMBlockNode[] = [
      {block: {type: 'Paragraph', id: 'blk-1', text: 'First paragraph', attributes: {}}, children: []},
      {block: {type: 'Paragraph', id: 'blk-2', text: 'EDITED second', attributes: {}}, children: []},
      {block: {type: 'Paragraph', id: 'new-blk', text: 'Brand new', attributes: {}}, children: []},
    ]

    const tree = jsonInput.map(hmBlockNodeToBlockNode)
    const ops = computeReplaceOps(oldMap, tree)

    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    // blk-2 changed, new-blk is new
    expect(replaceOps).toHaveLength(2)
    const replacedIds = replaceOps.map((o: any) => o.block.id)
    expect(replacedIds).toContain('blk-2')
    expect(replacedIds).toContain('new-blk')
    // blk-1 unchanged — no ReplaceBlock
    expect(replacedIds).not.toContain('blk-1')
    // No deletes
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })
})
