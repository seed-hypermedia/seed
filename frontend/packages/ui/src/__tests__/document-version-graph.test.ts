import {describe, expect, it} from 'vitest'
import {buildDocumentVersionGraph} from '../document-version-graph'

describe('buildDocumentVersionGraph', () => {
  it('lays out a linear change history from newest to genesis', () => {
    const graph = buildDocumentVersionGraph({
      changes: [
        {id: 'bafy-a', deps: [], author: 'alice', createTime: '2024-01-01T00:00:00Z'},
        {id: 'bafy-b', deps: ['bafy-a'], author: 'alice', createTime: '2024-01-02T00:00:00Z'},
        {id: 'bafy-c', deps: ['bafy-b'], author: 'bob', createTime: '2024-01-03T00:00:00Z'},
      ],
      latestVersion: 'bafy-c',
    })

    expect(graph.nodes.map((node) => ({id: node.id, depth: node.depth, lane: node.lane, isHead: node.isHead}))).toEqual(
      [
        {id: 'bafy-c', depth: 2, lane: 0, isHead: true},
        {id: 'bafy-b', depth: 1, lane: 0, isHead: false},
        {id: 'bafy-a', depth: 0, lane: 0, isHead: false},
      ],
    )
    expect(graph.edges).toEqual([
      {from: 'bafy-b', to: 'bafy-c'},
      {from: 'bafy-a', to: 'bafy-b'},
    ])
    expect(graph.heads).toEqual(['bafy-c'])
    expect(graph.maxLane).toBe(0)
  })

  it('assigns branch lanes and marks merge changes', () => {
    const graph = buildDocumentVersionGraph({
      changes: [
        {id: 'root', deps: [], author: 'alice'},
        {id: 'left', deps: ['root'], author: 'alice'},
        {id: 'right', deps: ['root'], author: 'bob'},
        {id: 'merge', deps: ['left', 'right'], author: 'carol'},
      ],
      latestVersion: 'merge',
    })

    expect(graph.nodes.map((node) => ({id: node.id, lane: node.lane, isMerge: node.isMerge}))).toEqual([
      {id: 'merge', lane: 0, isMerge: true},
      {id: 'left', lane: 0, isMerge: false},
      {id: 'right', lane: 1, isMerge: false},
      {id: 'root', lane: 0, isMerge: false},
    ])
    expect(graph.maxLane).toBe(1)
  })

  it('uses dot-separated latest versions as concurrent heads', () => {
    const graph = buildDocumentVersionGraph({
      changes: [
        {id: 'root', deps: []},
        {id: 'left', deps: ['root']},
        {id: 'right', deps: ['root']},
      ],
      latestVersion: 'left.right',
    })

    expect(graph.heads).toEqual(['left', 'right'])
    expect(graph.nodes.filter((node) => node.isHead).map((node) => node.id)).toEqual(['left', 'right'])
  })

  it('creates placeholder nodes for missing dependencies', () => {
    const graph = buildDocumentVersionGraph({
      changes: [{id: 'child', deps: ['missing-parent']}],
      latestVersion: 'child',
    })

    expect(graph.nodes.map((node) => ({id: node.id, isMissing: node.isMissing}))).toEqual([
      {id: 'child', isMissing: false},
      {id: 'missing-parent', isMissing: true},
    ])
    expect(graph.edges).toEqual([{from: 'missing-parent', to: 'child'}])
  })
})
