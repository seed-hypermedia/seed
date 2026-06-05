import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {describe, expect, test} from 'vitest'
import {buildDocumentTree, flattenTree} from '../utils/all-documents-tree'

function makeDoc(path: string[], name?: string): HMDocumentInfo {
  return {
    type: 'document',
    id: {
      id: `hm://site/${path.join('/')}`,
      uid: 'site',
      path,
      scheme: null,
      hostname: null,
      version: null,
      latest: true,
    },
    path,
    authors: [],
    createTime: {seconds: 0, nanos: 0},
    updateTime: {seconds: 0, nanos: 0},
    sortTime: new Date(0),
    genesis: '',
    version: '',
    breadcrumbs: [],
    activitySummary: {commentCount: 0, changeCount: 0},
    generationInfo: {},
    metadata: {name: name ?? path[path.length - 1] ?? 'Home'},
    visibility: 'PUBLIC',
  } as unknown as HMDocumentInfo
}

describe('all documents tree', () => {
  test('builds tree from flat docs', () => {
    const tree = buildDocumentTree([makeDoc(['docs'], 'Docs'), makeDoc(['docs', 'api'], 'API')])
    expect(tree).toHaveLength(1)
    expect(tree[0]?.doc.path).toEqual(['docs'])
    expect(tree[0]?.children).toHaveLength(1)
    expect(tree[0]?.children[0]?.doc.path).toEqual(['docs', 'api'])
  })

  test('excludes root doc', () => {
    const tree = buildDocumentTree([makeDoc([], 'Home'), makeDoc(['docs'], 'Docs')])
    expect(tree.map((node) => node.doc.path)).toEqual([['docs']])
  })

  test('sorts children alphabetically by name', () => {
    const tree = buildDocumentTree([makeDoc(['z'], 'Zulu'), makeDoc(['a'], 'Alpha'), makeDoc(['m'], 'Mike')])
    expect(tree.map((node) => node.doc.metadata.name)).toEqual(['Alpha', 'Mike', 'Zulu'])
  })

  test('handles orphaned docs by attaching to nearest existing ancestor', () => {
    const tree = buildDocumentTree([makeDoc(['docs'], 'Docs'), makeDoc(['docs', 'api', 'endpoints'], 'Endpoints')])
    expect(tree[0]?.doc.path).toEqual(['docs'])
    expect(tree[0]?.children[0]?.doc.path).toEqual(['docs', 'api', 'endpoints'])
    expect(tree[0]?.children[0]?.depth).toBe(1)
  })

  test('supports multiple nesting levels', () => {
    const tree = buildDocumentTree([
      makeDoc(['a'], 'A'),
      makeDoc(['a', 'b'], 'B'),
      makeDoc(['a', 'b', 'c'], 'C'),
      makeDoc(['a', 'b', 'c', 'd'], 'D'),
    ])
    expect(tree[0]?.depth).toBe(0)
    expect(tree[0]?.children[0]?.depth).toBe(1)
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2)
    expect(tree[0]?.children[0]?.children[0]?.children[0]?.depth).toBe(3)
  })

  test('shows only top-level when nothing is expanded', () => {
    const rows = flattenTree(
      buildDocumentTree([makeDoc(['docs']), makeDoc(['docs', 'api']), makeDoc(['blog'])]),
      new Set(),
    )
    expect(rows.map((row) => row.pathKey)).toEqual(['blog', 'docs'])
  })

  test('expands children when path is in expanded set', () => {
    const rows = flattenTree(
      buildDocumentTree([makeDoc(['docs']), makeDoc(['docs', 'api']), makeDoc(['docs', 'api', 'endpoints'])]),
      new Set(['docs', 'docs/api']),
    )
    expect(rows.map((row) => row.pathKey)).toEqual(['docs', 'docs/api', 'docs/api/endpoints'])
  })

  test('collapsed parent hides children', () => {
    const rows = flattenTree(
      buildDocumentTree([makeDoc(['docs']), makeDoc(['docs', 'api']), makeDoc(['blog'])]),
      new Set(),
    )
    expect(rows.every((row) => row.depth === 0)).toBe(true)
  })
})
