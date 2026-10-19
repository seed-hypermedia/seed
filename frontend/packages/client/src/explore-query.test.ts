import {describe, expect, it} from 'vitest'
import {compileExploreQuery, parseExploreQuery, serializeExploreQuery} from './explore-query'

describe('explore-query', () => {
  it('compiles attribute conditions to a DocumentFilter in protobuf JSON', () => {
    const parsed = parseExploreQuery(
      '(in:alice OR in:bob) AND status="In Progress" priority>=3 NOT has:archived path:/specs/* kind:fort',
    )
    const {filter, diagnostics, textTerms} = compileExploreQuery(parsed, {type: 'node'})
    expect(diagnostics).toEqual([])
    expect(textTerms).toEqual([])
    expect(filter).toEqual({
      and: {
        filters: [
          {or: {filters: [{spaceMatch: {space: 'alice'}}, {spaceMatch: {space: 'bob'}}]}},
          {comparison: {key: 'status', operator: 'EQUAL', value: {stringValue: 'In Progress'}}},
          {comparison: {key: 'priority', operator: 'GREATER_THAN_OR_EQUAL', value: {intValue: 3}}},
          {not: {filter: {exists: {key: 'archived'}}}},
          {pathMatch: {path: '/specs', prefix: true}},
          {stringMatch: {key: 'kind', value: 'fort', caseSensitive: false, prefix: false}},
        ],
      },
    })
  })

  it('scopes a site context, reports text terms, and round-trips the query string', () => {
    const parsed = parseExploreQuery('kind=fortress Engelbart sort:-founded')
    const compiled = compileExploreQuery(parsed, {type: 'site', url: 'hm://alice/world'})
    expect(compiled.filter).toEqual({
      and: {
        filters: [
          {urlMatch: {url: 'hm://alice/world', prefix: true}},
          {comparison: {key: 'kind', operator: 'EQUAL', value: {stringValue: 'fortress'}}},
        ],
      },
    })
    expect(compiled.textTerms).toEqual([{value: 'Engelbart', phrase: false}])
    expect(compiled.presentation.sort).toEqual([{key: 'founded', direction: 'desc'}])
    expect(serializeExploreQuery(parsed)).toBe('kind=fortress AND Engelbart sort:-founded')
  })

  it('a query with no attribute condition compiles to no filter', () => {
    const compiled = compileExploreQuery(parseExploreQuery('just words'), {type: 'node'})
    expect(compiled.filter).toBeUndefined()
  })

  it('compiles author and time predicates to the built-in filters', () => {
    const parsed = parseExploreQuery('$author:z6MkAlice $created>=2026-09-01 $updated<2026-10-01')
    const {filter, diagnostics, documentPredicates} = compileExploreQuery(parsed, {type: 'node'})
    expect(diagnostics).toEqual([])
    expect(documentPredicates).toHaveLength(3)
    expect(filter).toEqual({
      and: {
        filters: [
          {authorMatch: {author: 'z6MkAlice'}},
          {timeRange: {field: 'CREATE_TIME', start: '2026-09-01T00:00:00.000Z'}},
          {timeRange: {field: 'UPDATE_TIME', end: '2026-10-01T00:00:00.000Z'}},
        ],
      },
    })
    expect(serializeExploreQuery(parsed)).toBe('$author:z6MkAlice AND $created>=2026-09-01 AND $updated<2026-10-01')
  })

  it('treats a bare date as a whole UTC day', () => {
    const range = (query: string) => compileExploreQuery(parseExploreQuery(query), {type: 'node'}).filter?.timeRange
    expect(range('$created>=2026-09-01')).toEqual({field: 'CREATE_TIME', start: '2026-09-01T00:00:00.000Z'})
    expect(range('$created>2026-09-01')).toEqual({field: 'CREATE_TIME', start: '2026-09-02T00:00:00.000Z'})
    expect(range('$created<2026-09-01')).toEqual({field: 'CREATE_TIME', end: '2026-09-01T00:00:00.000Z'})
    expect(range('$created<=2026-09-01')).toEqual({field: 'CREATE_TIME', end: '2026-09-02T00:00:00.000Z'})
  })

  it('compares a date-time to the millisecond', () => {
    const range = (query: string) => compileExploreQuery(parseExploreQuery(query), {type: 'node'}).filter?.timeRange
    expect(range('$updated>=2026-09-01T12:30:00Z')).toEqual({field: 'UPDATE_TIME', start: '2026-09-01T12:30:00.000Z'})
    expect(range('$updated<=2026-09-01T12:30:00Z')).toEqual({field: 'UPDATE_TIME', end: '2026-09-01T12:30:00.001Z'})
  })

  it('leaves unprefixed author, created and updated to user attributes', () => {
    const {documentPredicates, diagnostics} = compileExploreQuery(
      parseExploreQuery('author:eric created>=2026-09-01 updated:yesterday $db.isCollection:true'),
      {type: 'node'},
    )
    expect(diagnostics).toEqual([])
    expect(documentPredicates.map((predicate) => predicate.kind)).toEqual([
      'attribute',
      'attribute',
      'attribute',
      'attribute',
    ])
    expect(documentPredicates.map((predicate) => predicate.kind === 'attribute' && predicate.key)).toEqual([
      'author',
      'created',
      'updated',
      '$db.isCollection',
    ])
  })

  it('reports a time predicate it cannot use instead of searching for it as an attribute', () => {
    for (const query of ['$created>=yesterday', '$created:2026-09-01', '$updated=2026-09-01', '$created>=2026-13-45']) {
      const parsed = parseExploreQuery(query)
      expect(parsed.diagnostics.length, query).toBeGreaterThan(0)
      expect(compileExploreQuery(parsed, {type: 'node'}).filter, query).toBeUndefined()
    }
  })
})
