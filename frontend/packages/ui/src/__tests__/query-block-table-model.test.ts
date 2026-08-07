import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {
  buildQueryTableColumns,
  filterQueryTableItems,
  inferAttributeType,
  moveQueryTableColumn,
  queryTableItemMatchesSearch,
} from '../query-block-table-model'

function item(name: string, metadata: Record<string, unknown>): HMDocumentInfo {
  return {
    type: 'document',
    id: {id: `hm://${name}`, uid: 'alice', path: [name]},
    path: [name],
    authors: ['alice'],
    createTime: '2026-01-01T00:00:00Z',
    updateTime: '2026-02-01T00:00:00Z',
    sortTime: new Date('2026-02-01'),
    genesis: 'genesis',
    version: 'version',
    breadcrumbs: [],
    activitySummary: {commentCount: 0, latestCommentTime: null},
    generationInfo: {},
    metadata: {name, ...metadata},
    visibility: 'PUBLIC',
  } as unknown as HMDocumentInfo
}

describe('query block table model', () => {
  it('orders discovered custom columns between title and default core columns', () => {
    const columns = buildQueryTableColumns([item('One', {priority: 2}), item('Two', {status: 'Draft'})])

    expect(columns.map((column) => [column.id, column.defaultVisible])).toEqual([
      ['title', true],
      ['metadata:priority', true],
      ['metadata:status', true],
      ['comments', true],
      ['citations', true],
      ['updated', true],
      ['authors', true],
      ['created', false],
      ['path', false],
      ['children', false],
    ])
  })

  it('infers consistent primitive types and falls back to text for mixed values', () => {
    expect(inferAttributeType([1, 2, null])).toBe('number')
    expect(inferAttributeType([true, false])).toBe('boolean')
    expect(inferAttributeType([['a'], ['b', 'c']])).toBe('list')
    expect(inferAttributeType(['2026-01-01', '2026-02-02'])).toBe('date')
    expect(inferAttributeType([1, 'high'])).toBe('text')
  })

  it('searches all row data, including values belonging to hidden columns', () => {
    expect(queryTableItemMatchesSearch(item('One', {secret: 'Needle'}), 'needle')).toBe(true)
  })

  it('searches rows containing BigInt-backed activity values without throwing', () => {
    const row = item('One', {secret: 'Needle'}) as HMDocumentInfo & {activitySummary: {commentCount: bigint}}
    ;(row as any).activitySummary = {commentCount: 1n}

    expect(() => queryTableItemMatchesSearch(row, 'needle')).not.toThrow()
    expect(queryTableItemMatchesSearch(row, 'needle')).toBe(true)
  })

  it('combines typed attribute filters with AND', () => {
    const items = [item('One', {priority: 2, status: 'Draft'}), item('Two', {priority: 5, status: 'Ready'})]

    expect(
      filterQueryTableItems(items, [
        {columnId: 'metadata:priority', operator: 'greaterThan', value: '3'},
        {columnId: 'metadata:status', operator: 'contains', value: 'read'},
      ]).map((result) => result.metadata.name),
    ).toEqual(['Two'])
  })

  it('moves a configured column without losing the others', () => {
    expect(moveQueryTableColumn(['title', 'metadata:status', 'updated'], 'metadata:status', -1)).toEqual([
      'metadata:status',
      'title',
      'updated',
    ])
  })
})
