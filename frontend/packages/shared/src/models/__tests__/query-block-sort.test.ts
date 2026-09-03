import {describe, expect, it} from 'vitest'
import {BuiltinSortAttribute} from '../../client/grpc-types'
import {queryToQueryDocumentsRequest, sortTermToDocumentSort} from '../query-block-sort'

describe('sortTermToDocumentSort', () => {
  it('maps builtin keys to the matching BuiltinSortAttribute', () => {
    expect(sortTermToDocumentSort('title', true)?.attribute).toBe(BuiltinSortAttribute.NAME)
    expect(sortTermToDocumentSort('path', true)?.attribute).toBe(BuiltinSortAttribute.PATH)
    expect(sortTermToDocumentSort('created', true)?.attribute).toBe(BuiltinSortAttribute.CREATE_TIME)
    expect(sortTermToDocumentSort('updated', true)?.attribute).toBe(BuiltinSortAttribute.UPDATE_TIME)
    expect(sortTermToDocumentSort('activity', true)?.attribute).toBe(BuiltinSortAttribute.ACTIVITY_TIME)
    expect(sortTermToDocumentSort('comments', true)?.attribute).toBe(BuiltinSortAttribute.COMMENT_COUNT)
  })

  it('honors the descending flag', () => {
    expect(sortTermToDocumentSort('updated', true)?.descending).toBe(true)
    expect(sortTermToDocumentSort('updated', false)?.descending).toBe(false)
  })

  it('maps metadata-prefixed keys to attribute keys', () => {
    const sort = sortTermToDocumentSort('metadata:status', false)
    expect(sort?.key).toBe('status')
    expect(sort?.attribute).toBe(BuiltinSortAttribute.UNSPECIFIED)
  })

  it('returns null for keys the server cannot sort by', () => {
    expect(sortTermToDocumentSort('children', false)).toBeNull()
    expect(sortTermToDocumentSort('citations', false)).toBeNull()
    expect(sortTermToDocumentSort('tags', false)).toBeNull()
    expect(sortTermToDocumentSort('authors', false)).toBeNull()
  })
})

describe('queryToQueryDocumentsRequest', () => {
  it('returns null when there is no target space', () => {
    expect(queryToQueryDocumentsRequest({includes: [{space: '', path: '', mode: 'Children'}]})).toBeNull()
  })

  it('builds a space+path subtree filter and maps sort keys', () => {
    const request = queryToQueryDocumentsRequest({
      includes: [{space: 'alice', path: 'projects', mode: 'AllDescendants'}],
      sort: [
        {term: 'updated', reverse: true},
        {term: 'metadata:status', reverse: false},
      ],
      limit: 5,
    })

    expect(request).not.toBeNull()
    const req = request!
    expect(req.filter?.filter.case).toBe('and')
    expect(req.sort).toHaveLength(2)
    expect(req.sort[0]?.attribute).toBe(BuiltinSortAttribute.UPDATE_TIME)
    expect(req.sort[0]?.descending).toBe(true)
    expect(req.sort[1]?.key).toBe('status')
  })

  it('omits sort keys the server cannot sort by', () => {
    const request = queryToQueryDocumentsRequest({
      includes: [{space: 'alice', path: '', mode: 'Children'}],
      sort: [{term: 'children', reverse: false}],
    })
    expect(request!.sort).toHaveLength(0)
  })

  it('normalizes legacy term-based sort entries', () => {
    const request = queryToQueryDocumentsRequest({
      includes: [{space: 'alice', path: '', mode: 'Children'}],
      sort: [{term: 'UpdateTime', reverse: false} as any],
    })
    expect(request!.sort).toHaveLength(1)
    expect(request!.sort[0]?.attribute).toBe(BuiltinSortAttribute.UPDATE_TIME)
    expect(request!.sort[0]?.descending).toBe(true)
  })
})
