import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {
  filterQueryBlockDocuments,
  getQueryBlockFilterOptions,
  getQueryBlockRefKey,
  matchesQueryFilterEquality,
} from '../query-block-filter'

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

describe('getQueryBlockRefKey', () => {
  it.each([
    ['hm://owneruid', 'hm://owneruid'],
    ['hm://owneruid?v=abc123', 'hm://owneruid'],
    ['hm://owneruid/:profile', 'hm://owneruid'],
    ['hm://docuid/a/b', 'hm://docuid/a/b'],
    ['hm://docuid/a/b?v=abc123#block1', 'hm://docuid/a/b'],
  ])('canonicalizes %s to %s', (value, expected) => {
    expect(getQueryBlockRefKey(value)).toBe(expected)
  })

  it.each([['plain text'], ['123'], [undefined], [null], [{uid: 'x'}], [['hm://owneruid']]])(
    'returns null for non-reference %j',
    (value) => {
      expect(getQueryBlockRefKey(value)).toBeNull()
    },
  )

  it('rejects gateway URLs unless allowed', () => {
    expect(getQueryBlockRefKey('https://hyper.media/hm/owneruid')).toBeNull()
    expect(getQueryBlockRefKey('https://hyper.media/hm/owneruid', {allowWebUrls: true})).toBe('hm://owneruid')
    expect(getQueryBlockRefKey('https://hyper.media/hm/docuid/a/b?v=x', {allowWebUrls: true})).toBe('hm://docuid/a/b')
    expect(getQueryBlockRefKey('https://hyper.media/other/path', {allowWebUrls: true})).toBeNull()
  })
})

describe('reference labels in search and filters', () => {
  const labels = new Map([
    ['hm://owneruid', 'horacio'],
    ['hm://docuid/spec/one', 'Spec Document'],
  ])

  it('matches the search against resolved reference names', () => {
    const items = [item('One', {owner: 'hm://owneruid'}), item('Two', {owner: 'hm://otheruid'})]
    expect(filterQueryBlockDocuments(items, {search: 'horac'}, labels).map((entry) => entry.metadata.name)).toEqual([
      'One',
    ])
  })

  it('matches reference searches by ref key for hm://, versioned, and gateway URLs', () => {
    const items = [item('One', {owner: 'hm://owneruid'}), item('Two', {owner: 'hm://otheruid'})]
    for (const search of ['hm://owneruid', 'hm://owneruid?v=abc', 'https://hyper.media/hm/owneruid']) {
      expect(filterQueryBlockDocuments(items, {search}, labels).map((entry) => entry.metadata.name)).toEqual(['One'])
    }
  })

  it('matches reference searches only by exact ref key, never as a substring', () => {
    const items = [
      item('Owner', {owner: 'hm://owneruid'}),
      item('Spec', {spec: 'hm://owneruid/docs/x'}),
      item('Plain', {}),
    ]
    expect(
      filterQueryBlockDocuments(items, {search: 'hm://owneruid'}, labels).map((entry) => entry.metadata.name),
    ).toEqual(['Owner'])
    expect(
      filterQueryBlockDocuments(items, {search: 'hm://owneruid/docs/x?v=1'}, labels).map(
        (entry) => entry.metadata.name,
      ),
    ).toEqual(['Spec'])
  })

  it('matches document reference labels inside array attributes', () => {
    const items = [item('One', {specs: ['hm://docuid/spec/one', 'Draft']}), item('Two', {specs: ['Other']})]
    expect(filterQueryBlockDocuments(items, {search: 'spec doc'}, labels).map((entry) => entry.metadata.name)).toEqual([
      'One',
    ])
    expect(
      filterQueryBlockDocuments(items, {search: 'hm://docuid/spec/one?v=z'}, labels).map(
        (entry) => entry.metadata.name,
      ),
    ).toEqual(['One'])
  })

  it('matches contains filters against reference labels and ref keys', () => {
    const items = [item('One', {owner: 'hm://owneruid'}), item('Two', {owner: 'hm://otheruid'})]
    expect(
      filterQueryBlockDocuments(
        items,
        {filters: [{columnId: 'metadata:owner', operator: 'contains', value: 'horac'}]},
        labels,
      ).map((entry) => entry.metadata.name),
    ).toEqual(['One'])
    expect(
      filterQueryBlockDocuments(
        items,
        {filters: [{columnId: 'metadata:owner', operator: 'contains', value: 'hm://owneruid?v=x'}]},
        labels,
      ).map((entry) => entry.metadata.name),
    ).toEqual(['One'])
  })

  it('keeps equals comparisons on raw values', () => {
    const items = [item('One', {owner: 'hm://owneruid'})]
    expect(
      filterQueryBlockDocuments(
        items,
        {filters: [{columnId: 'metadata:owner', operator: 'equals', value: 'hm://owneruid'}]},
        labels,
      ),
    ).toEqual(items)
    expect(
      filterQueryBlockDocuments(
        items,
        {filters: [{columnId: 'metadata:owner', operator: 'equals', value: 'horacio'}]},
        labels,
      ),
    ).toEqual([])
  })

  it('adds resolved labels to filter options', () => {
    const options = getQueryBlockFilterOptions([item('One', {owner: 'hm://owneruid', status: 'Ready'})], labels)
    expect(options['metadata:owner']).toEqual({
      type: 'text',
      values: ['hm://owneruid'],
      labels: {'hm://owneruid': 'horacio'},
    })
    expect(options['metadata:status']).toEqual({type: 'text', values: ['Ready']})
  })
})
