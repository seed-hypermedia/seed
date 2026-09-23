import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {filterQueryBlockDocuments} from '../query-block-filter'

function item(name: string, metadata: Record<string, unknown> = {}): HMDocumentInfo {
  return {
    type: 'document',
    id: {id: `hm://alice/docs/${name}`, uid: 'alice', path: ['docs', name]},
    path: ['docs', name],
    authors: [],
    createTime: '2026-01-01T00:00:00Z',
    updateTime: '2026-02-01T00:00:00Z',
    metadata: {name, ...metadata},
    activitySummary: {commentCount: 0, childrenCount: 0},
  } as unknown as HMDocumentInfo
}

describe('filterQueryBlockDocuments', () => {
  it('searches names, paths, tags, and primitive metadata without matching case', () => {
    const items = [
      item('Alpha', {status: 'READY'}),
      item('Beta', {tags: ['Research', 'Design']}),
      item('Gamma', {priority: 3}),
    ]

    expect(filterQueryBlockDocuments(items, {search: 'ready'}).map((entry) => entry.metadata.name)).toEqual(['Alpha'])
    expect(filterQueryBlockDocuments(items, {search: 'research'}).map((entry) => entry.metadata.name)).toEqual(['Beta'])
    expect(filterQueryBlockDocuments(items, {search: 'docs/gamma'}).map((entry) => entry.metadata.name)).toEqual([
      'Gamma',
    ])
  })

  it('combines typed filters with AND and ignores empty conditions', () => {
    const items = [item('One', {status: 'Draft', priority: 2}), item('Two', {status: 'Ready', priority: 5})]

    expect(
      filterQueryBlockDocuments(items, {
        filters: [
          {columnId: 'metadata:priority', operator: 'greaterThan', value: '3'},
          {columnId: 'metadata:status', operator: 'contains', value: 'read'},
          {columnId: 'title', operator: 'contains', value: '   '},
        ],
      }).map((entry) => entry.metadata.name),
    ).toEqual(['Two'])
  })
})
