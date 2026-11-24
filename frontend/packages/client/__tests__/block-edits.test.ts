import {describe, expect, it} from 'vitest'
import {computeReplaceOps, createBlocksMap, hmBlockNodeToBlockNode, toAPIBlockNode} from '../src/block-diff'
import {applyBlockEdits, BlockEditError} from '../src/block-edits'
import type {HMBlockNode} from '../src/hm-types'
import {parseMarkdown, type BlockNode} from '../src/markdown-to-blocks'

const node = (block: Record<string, unknown>, children: HMBlockNode[] = []): HMBlockNode =>
  ({block: {text: '', annotations: [], attributes: {}, ...block}, children}) as unknown as HMBlockNode
const paragraph = (id: string, text: string, attributes: Record<string, unknown> = {}, children: HMBlockNode[] = []) =>
  node({type: 'Paragraph', id, text, attributes}, children)

const stored: HMBlockNode[] = [
  node({type: 'Heading', id: 'h', text: 'Title', attributes: {childrenType: 'Group'}}, [
    paragraph('a', 'alpha'),
    paragraph('list', '', {childrenType: 'Unordered'}, [paragraph('i1', 'one'), paragraph('i2', 'two')]),
    paragraph('b', 'beta', {childrenType: 'Group'}, [paragraph('b1', 'under beta')]),
  ]),
  paragraph('z', 'omega'),
]

const parse = (markdown: string) => parseMarkdown(markdown).tree
const outline = (nodes: BlockNode[]): unknown[] =>
  nodes.map((n) => (n.children.length ? [n.block.text, outline(n.children)] : n.block.text))

function edit(edits: unknown) {
  const result = applyBlockEdits(stored.map(hmBlockNodeToBlockNode), edits, parse)
  const ops = computeReplaceOps(createBlocksMap(stored.map(toAPIBlockNode)), result.tree)
  return {...result, ops}
}

describe('block edits', () => {
  it('replaces one block and stores only that block', () => {
    const {ops, tree} = edit([{replace: 'a', content: 'alpha **changed**'}])
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({type: 'ReplaceBlock', block: {id: 'a', text: 'alpha changed'}})
    expect(outline(tree)).toEqual([
      ['Title', ['alpha changed', ['', ['one', 'two']], ['beta', ['under beta']]]],
      'omega',
    ])
  })

  it('keeps the children of a replaced block', () => {
    const {ops, tree} = edit([{replace: 'b', content: 'beta again'}])
    expect(ops).toEqual([expect.objectContaining({type: 'ReplaceBlock'})])
    expect(ops[0]).toMatchObject({block: {id: 'b', childrenType: 'Group'}})
    expect(outline(tree)[0]).toEqual(['Title', ['alpha', ['', ['one', 'two']], ['beta again', ['under beta']]]])
  })

  it('turns one block into several', () => {
    const {tree, written} = edit([{replace: 'a', content: 'first\n\nsecond'}])
    expect(outline(tree)[0]).toEqual(['Title', ['first', 'second', ['', ['one', 'two']], ['beta', ['under beta']]]])
    expect(written.map((n) => n.block.id)[0]).toBe('a')
  })

  it('adds blocks beside a block and inside one', () => {
    const {tree} = edit([
      {after: 'a', content: 'after alpha'},
      {before: 'a', content: 'before alpha'},
      {into: 'h', content: 'end of section'},
      {after: 'h', content: '# Next'},
    ])
    expect(outline(tree)).toEqual([
      [
        'Title',
        ['before alpha', 'alpha', 'after alpha', ['', ['one', 'two']], ['beta', ['under beta']], 'end of section'],
      ],
      'Next',
      'omega',
    ])
  })

  it('adds list items to a list, with or without the marker', () => {
    const {tree, ops} = edit([
      {after: 'i1', content: '- one and a half'},
      {into: 'list', content: 'three'},
    ])
    expect(outline(tree)[0]).toEqual([
      'Title',
      ['alpha', ['', ['one', 'one and a half', 'two', 'three']], ['beta', ['under beta']]],
    ])
    expect(ops.filter((op) => op.type === 'ReplaceBlock')).toHaveLength(2)
  })

  it('starts a list under a paragraph', () => {
    const {tree} = edit([{into: 'a', content: '- x\n- y'}])
    const a = tree[0]!.children[0]!
    expect(a.block.childrenType).toBe('Unordered')
    expect(outline([a])).toEqual([['alpha', ['x', 'y']]])
  })

  it('moves a block with its children and deletes blocks', () => {
    const {tree, ops} = edit([{move: 'b', before: 'h'}, {delete: ['a', 'i2']}])
    expect(outline(tree)).toEqual([['beta', ['under beta']], ['Title', [['', ['one']]]], 'omega'])
    expect(ops.find((op) => op.type === 'DeleteBlocks')).toMatchObject({blocks: ['a', 'i2']})
    expect(ops.some((op) => op.type === 'ReplaceBlock')).toBe(false)
  })

  it('stores nothing when edits cancel out', () => {
    expect(
      edit([
        {move: 'a', after: 'list'},
        {move: 'a', before: 'list'},
      ]).ops,
    ).toEqual([])
  })

  it.each([
    [[{replace: 'nope', content: 'x'}], 'no block with id "nope"'],
    [[{replace: 'b', content: 'beta\n\n  child'}], 'has children'],
    [[{replace: 'a', content: ''}], 'use {delete: ID}'],
    [[{move: 'h', into: 'a'}], 'cannot move into itself'],
    [[{delete: 'a'}, {replace: 'a', content: 'x'}], 'Edit 2'],
    [[{after: 'a', content: 'copy <!-- id:z -->'}], 'twice'],
    [[{replace: 'a', after: 'b', content: 'x'}], 'Add blocks with a separate edit'],
    [[{rename: 'a'}], 'an edit is one of'],
    [[], 'edits must be a list'],
  ])('refuses %j', (edits, message) => {
    expect(() => edit(edits)).toThrow(BlockEditError)
    expect(() => edit(edits)).toThrow(message)
  })
})
