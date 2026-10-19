import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {filterQueryBlockDocuments, getQueryBlockFilterOptions, matchesQueryFilterEquality} from '../query-block-filter'

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

describe('collection equality', () => {
  it.each([
    ['Ready', 'ready', true],
    [['Draft', 'Ready'], 'READY', true],
    [['Draft', 'Ready'], 'Draft, Ready', false],
    [false, 'false', true],
    [0, '0', true],
    [undefined, 'Ready', false],
    [null, 'Ready', false],
    [[], 'Ready', false],
    [{status: 'Ready'}, 'Ready', false],
  ])('compares %j with %s', (value, expected, matches) => {
    expect(matchesQueryFilterEquality(value, expected)).toBe(matches)
  })

  it('inverts array equality and includes missing values with AND conditions', () => {
    const items = [
      item('Ready', {status: ['Draft', 'READY']}),
      item('Draft', {status: 'Draft'}),
      item('Missing'),
      item('Null', {status: null}),
      item('Empty', {status: []}),
    ]
    expect(
      filterQueryBlockDocuments(items, {
        filters: [
          {columnId: 'metadata:status', operator: 'notEquals', value: 'ready'},
          {columnId: 'title', operator: 'notEquals', value: 'draft'},
        ],
      }).map((entry) => entry.metadata.name),
    ).toEqual(['Missing', 'Null', 'Empty'])
  })
})

describe('getQueryBlockFilterOptions', () => {
  it('extracts scalar options, preserves spelling, and omits reserved metadata', () => {
    const options = getQueryBlockFilterOptions([
      item('One', {
        status: ['Ready', 'Draft', null, '', '  ', {}, 0, false],
        priority: 0,
        enabled: false,
        due: '2026-01-01',
      }),
      item('Two', {status: ['ready', 'Done'], priority: 2, enabled: true, due: '2026-02-01'}),
    ])
    expect(options['metadata:status']).toEqual({type: 'list', values: ['Ready', 'Draft', '0', 'false', 'Done']})
    expect(options['metadata:priority']).toEqual({type: 'number', values: ['0', '2']})
    expect(options['metadata:enabled']).toEqual({type: 'boolean', values: ['false', 'true']})
    expect(options['metadata:due']).toEqual({type: 'date', values: ['2026-01-01', '2026-02-01']})
    expect(options['metadata:name']).toBeUndefined()
    expect(options.title?.values).toEqual(['One', 'Two'])
  })

  it('offers each comma-separated tag as an equality choice', () => {
    const docs = [item('One', {tags: 'Research, Design'})]
    expect(getQueryBlockFilterOptions(docs).tags).toEqual({type: 'list', values: ['Research', 'Design']})
    expect(
      filterQueryBlockDocuments(docs, {filters: [{columnId: 'tags', operator: 'equals', value: 'design'}]}),
    ).toEqual(docs)
  })

  it('uses selectable ISO values for timestamp columns', () => {
    const doc = {...item('One'), createTime: {seconds: 1, nanos: 0}}
    const options = getQueryBlockFilterOptions([doc])
    expect(options.created).toEqual({type: 'date', values: ['1970-01-01T00:00:01.000Z']})
    expect(
      filterQueryBlockDocuments([doc], {
        filters: [{columnId: 'created', operator: 'equals', value: options.created!.values[0]!}],
      }),
    ).toEqual([doc])
  })
})
