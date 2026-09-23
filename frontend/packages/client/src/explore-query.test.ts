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
})
