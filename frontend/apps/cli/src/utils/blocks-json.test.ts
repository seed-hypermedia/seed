import {describe, test, expect} from 'bun:test'
import {parseBlocksJson, hmBlockNodesToOperations} from './blocks-json'
import type {HMBlockNode} from '@shm/shared/hm-types'

const para = (id: string, text: string): HMBlockNode => ({
  block: {type: 'Paragraph', id, text, annotations: [], attributes: {}},
})

const heading = (id: string, text: string, children: HMBlockNode[] = []): HMBlockNode => ({
  block: {type: 'Heading', id, text, annotations: [], attributes: {childrenType: 'Group'}},
  children,
})

describe('parseBlocksJson', () => {
  test('parses valid HMBlockNode[] JSON', () => {
    const json = JSON.stringify([
      {block: {type: 'Paragraph', id: 'abc', text: 'Hello world', annotations: [], attributes: {}}},
    ])
    const result = parseBlocksJson(json)
    expect(result).toHaveLength(1)
    expect(result[0].block.id).toBe('abc')
    expect(result[0].block.type).toBe('Paragraph')
  })

  test('parses nested blocks', () => {
    const json = JSON.stringify([
      heading('h1', 'Section', [para('p1', 'Content')]),
    ])
    const result = parseBlocksJson(json)
    expect(result).toHaveLength(1)
    expect(result[0].children).toHaveLength(1)
    expect(result[0].children![0].block.id).toBe('p1')
  })

  test('throws on invalid JSON', () => {
    expect(() => parseBlocksJson('not json')).toThrow()
  })

  test('throws on invalid block structure', () => {
    const json = JSON.stringify([{notABlock: true}])
    expect(() => parseBlocksJson(json)).toThrow()
  })

  test('parses empty array', () => {
    const result = parseBlocksJson('[]')
    expect(result).toHaveLength(0)
  })
})

describe('hmBlockNodesToOperations', () => {
  test('flat list produces ReplaceBlock + MoveBlocks', () => {
    const nodes = [para('a', 'First'), para('b', 'Second')]
    const ops = hmBlockNodesToOperations(nodes)

    expect(ops).toEqual([
      {type: 'ReplaceBlock', block: nodes[0].block},
      {type: 'ReplaceBlock', block: nodes[1].block},
      {type: 'MoveBlocks', blocks: ['a', 'b'], parent: ''},
    ])
  })

  test('nested blocks produce correct parent relationships', () => {
    const nodes = [heading('h1', 'Title', [para('p1', 'Content')])]
    const ops = hmBlockNodesToOperations(nodes)

    expect(ops).toEqual([
      {type: 'ReplaceBlock', block: nodes[0].block},
      {type: 'ReplaceBlock', block: nodes[0].children![0].block},
      {type: 'MoveBlocks', blocks: ['p1'], parent: 'h1'},
      {type: 'MoveBlocks', blocks: ['h1'], parent: ''},
    ])
  })

  test('empty array produces no operations', () => {
    const ops = hmBlockNodesToOperations([])
    expect(ops).toEqual([])
  })

  test('respects custom parentId', () => {
    const nodes = [para('x', 'Child')]
    const ops = hmBlockNodesToOperations(nodes, 'parent-id')

    expect(ops).toEqual([
      {type: 'ReplaceBlock', block: nodes[0].block},
      {type: 'MoveBlocks', blocks: ['x'], parent: 'parent-id'},
    ])
  })
})
