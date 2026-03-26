import {describe, it, expect} from 'vitest'
import {createBlocksMap, matchBlockIds, computeReplaceOps} from '../src/block-diff'
import type {APIBlockNode} from '../src/block-diff'
import type {HMBlockNode} from '../src/hm-types'

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
  it('flat list produces correct parent and left fields', () => {
    const nodes = [apiBlock('a', 'Paragraph', 'First'), apiBlock('b', 'Paragraph', 'Second')]
    const map = createBlocksMap(nodes)

    expect(map['a']).toEqual({parent: '', left: '', block: nodes[0]!.block})
    expect(map['b']).toEqual({parent: '', left: 'a', block: nodes[1]!.block})
  })

  it('nested children produce correct parent relationships', () => {
    const child1 = apiBlock('c1', 'Paragraph', 'Child 1')
    const child2 = apiBlock('c2', 'Paragraph', 'Child 2')
    const parent = apiBlockWithChildren('p1', 'Heading', 'Parent', [child1, child2])
    const map = createBlocksMap([parent])

    expect(map['c1']!.parent).toBe('p1')
    expect(map['c2']!.parent).toBe('p1')
    expect(map['c2']!.left).toBe('c1')
  })

  it('empty input returns empty map', () => {
    expect(createBlocksMap([])).toEqual({})
  })
})

// ── matchBlockIds ────────────────────────────────────────────────────────────

describe('matchBlockIds', () => {
  it('same-type blocks at same position reuse old IDs', () => {
    const old = [apiBlock('old-1', 'Paragraph'), apiBlock('old-2', 'Heading')]
    const fresh = [hmBlock('new-1', 'Paragraph'), hmBlock('new-2', 'Heading')]

    const matched = matchBlockIds(old, fresh)
    expect((matched[0]!.block as any).id).toBe('old-1')
    expect((matched[1]!.block as any).id).toBe('old-2')
  })

  it('different-type blocks keep new IDs', () => {
    const old = [apiBlock('old-1', 'Paragraph')]
    const fresh = [hmBlock('new-1', 'Heading')]

    const matched = matchBlockIds(old, fresh)
    expect((matched[0]!.block as any).id).toBe('new-1')
  })
})

// ── computeReplaceOps ────────────────────────────────────────────────────────

describe('computeReplaceOps', () => {
  it('unchanged blocks produce no ReplaceBlock ops', () => {
    const old = [apiBlock('a', 'Paragraph', 'Hello')]
    const map = createBlocksMap(old)
    const input = [hmBlock('a', 'Paragraph', 'Hello')]

    const ops = computeReplaceOps(map, input)
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(0)
  })

  it('changed text produces ReplaceBlock', () => {
    const old = [apiBlock('a', 'Paragraph', 'Old text')]
    const map = createBlocksMap(old)
    const input = [hmBlock('a', 'Paragraph', 'New text')]

    const ops = computeReplaceOps(map, input)
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(1)
  })

  it('new blocks produce ReplaceBlock', () => {
    const old = [apiBlock('a', 'Paragraph', 'Existing')]
    const map = createBlocksMap(old)
    const input = [hmBlock('a', 'Paragraph', 'Existing'), hmBlock('b', 'Paragraph', 'Brand new')]

    const ops = computeReplaceOps(map, input)
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(1)
    expect((replaceOps[0] as any).block.id).toBe('b')
  })

  it('removed blocks produce DeleteBlocks', () => {
    const old = [apiBlock('a', 'Paragraph', 'Keep'), apiBlock('b', 'Paragraph', 'Remove')]
    const map = createBlocksMap(old)
    const input = [hmBlock('a', 'Paragraph', 'Keep')]

    const ops = computeReplaceOps(map, input)
    const deleteOps = ops.filter((o) => o.type === 'DeleteBlocks')
    expect(deleteOps).toHaveLength(1)
    expect((deleteOps[0] as any).blocks).toContain('b')
  })
})

// ── ID-based diffing (smart update flow) ─────────────────────────────────────

describe('computeReplaceOps — ID-based diff', () => {
  it('mix of known and unknown IDs: known blocks are diffed, unknown are new', () => {
    const old = [apiBlock('blk-aaa', 'Paragraph', 'Existing'), apiBlock('blk-bbb', 'Heading', 'Heading')]
    const map = createBlocksMap(old)
    const input: HMBlockNode[] = [
      hmBlock('blk-aaa', 'Paragraph', 'Existing'),
      hmBlock('random99', 'Paragraph', 'New paragraph'),
      hmBlock('blk-bbb', 'Heading', 'Heading'),
    ]

    const ops = computeReplaceOps(map, input)
    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(1)
    expect((replaceOps[0] as any).block.id).toBe('random99')
    expect(ops.filter((o) => o.type === 'DeleteBlocks')).toHaveLength(0)
  })

  it('no matching IDs: full body replacement', () => {
    const old = [apiBlock('old-aaa', 'Paragraph', 'Old'), apiBlock('old-bbb', 'Heading', 'Old')]
    const map = createBlocksMap(old)
    const input = [hmBlock('gen-111', 'Paragraph', 'New'), hmBlock('gen-222', 'Heading', 'New')]

    const ops = computeReplaceOps(map, input)
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(2)
    const deleteOps = ops.filter((o) => o.type === 'DeleteBlocks')
    expect(deleteOps).toHaveLength(1)
    expect((deleteOps[0] as any).blocks).toContain('old-aaa')
    expect((deleteOps[0] as any).blocks).toContain('old-bbb')
  })

  it('reordered blocks produce MoveBlocks with correct order', () => {
    const old = [apiBlock('blk-aaa', 'Paragraph', 'First'), apiBlock('blk-bbb', 'Paragraph', 'Second')]
    const map = createBlocksMap(old)
    const input = [hmBlock('blk-bbb', 'Paragraph', 'Second'), hmBlock('blk-aaa', 'Paragraph', 'First')]

    const ops = computeReplaceOps(map, input)
    const moveOps = ops.filter((o) => o.type === 'MoveBlocks')
    expect(moveOps).toHaveLength(1)
    expect((moveOps[0] as any).blocks).toEqual(['blk-bbb', 'blk-aaa'])
    expect(ops.filter((o) => o.type === 'ReplaceBlock')).toHaveLength(0)
  })

  it('HMBlockNode works directly with computeReplaceOps', () => {
    const existingDoc = [apiBlock('blk-1', 'Paragraph', 'First'), apiBlock('blk-2', 'Paragraph', 'Second')]
    const oldMap = createBlocksMap(existingDoc)

    const input: HMBlockNode[] = [
      {block: {type: 'Paragraph', id: 'blk-1', text: 'First', attributes: {}} as any},
      {block: {type: 'Paragraph', id: 'blk-2', text: 'EDITED', attributes: {}} as any},
      {block: {type: 'Paragraph', id: 'new-blk', text: 'Brand new', attributes: {}} as any},
    ]

    const ops = computeReplaceOps(oldMap, input)

    const replaceOps = ops.filter((o) => o.type === 'ReplaceBlock')
    expect(replaceOps).toHaveLength(2)
    const replacedIds = replaceOps.map((o: any) => o.block.id)
    expect(replacedIds).toContain('blk-2')
    expect(replacedIds).toContain('new-blk')
    expect(replacedIds).not.toContain('blk-1')
  })
})
