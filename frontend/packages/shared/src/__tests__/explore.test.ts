import {describe, expect, test} from 'vitest'
import {DocumentFilter_Comparison_Operator} from '../client/grpc-types'
import {
  buildExploreDocumentFilter,
  documentInfoToExploreResultDocument,
  parseExploreQuery,
  searchResultItemToExploreResult,
} from '../explore'
import {hmId} from '../utils/entity-id-url'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import type {SearchResultItem} from '../models/search'

function searchItem(overrides: Partial<SearchResultItem>): SearchResultItem {
  return {
    id: hmId('alice', {path: ['roadmap']}),
    title: 'Roadmap match',
    icon: '',
    parentNames: ['Docs'],
    searchQuery: 'roadmap',
    type: 'document',
    ...overrides,
  }
}

describe('parseExploreQuery', () => {
  test('parses free text, quoted phrases, type filters, context hints, and attributes', () => {
    const parsed = parseExploreQuery('roadmap "search API" type:block in:site status:active has:owner estimate>=3')

    expect(parsed.text).toBe('roadmap "search API"')
    expect(parsed.phrases).toEqual(['search API'])
    expect(parsed.types).toEqual(['block'])
    expect(parsed.context).toBe('site')
    expect(parsed.attributes).toEqual([
      {key: 'status', operator: 'contains', value: 'active'},
      {key: 'owner', operator: 'exists'},
      {key: 'estimate', operator: '>=', value: 3},
    ])
  })

  test('parses missing and not-equal attribute qualifiers', () => {
    const parsed = parseExploreQuery('missing:status priority!="low"')

    expect(parsed.text).toBe('')
    expect(parsed.attributes).toEqual([
      {key: 'status', operator: 'missing'},
      {key: 'priority', operator: '!=', value: 'low'},
    ])
  })
})

describe('buildExploreDocumentFilter', () => {
  test('combines attribute filters with a site url prefix', () => {
    const filter = buildExploreDocumentFilter(parseExploreQuery('status:active has:owner'), {
      type: 'site',
      id: hmId('alice', {path: ['docs']}),
    })

    expect(filter?.filter.case).toBe('and')
    const children = filter?.filter.case === 'and' ? filter.filter.value.filters : []
    expect(children.map((child) => child.filter.case)).toEqual(['urlMatch', 'stringMatch', 'exists'])
    expect(children[0]?.filter.case === 'urlMatch' ? children[0].filter.value.url : '').toBe('hm://alice/docs')
    expect(children[0]?.filter.case === 'urlMatch' ? children[0].filter.value.prefix : false).toBe(true)
  })

  test('compiles numeric comparisons to typed comparison filters', () => {
    const filter = buildExploreDocumentFilter(parseExploreQuery('estimate>=3'), {type: 'node'})

    expect(filter?.filter.case).toBe('comparison')
    if (filter?.filter.case !== 'comparison') throw new Error('expected comparison')
    expect(filter.filter.value.key).toBe('estimate')
    expect(filter.filter.value.operator).toBe(DocumentFilter_Comparison_Operator.GREATER_THAN_OR_EQUAL)
    expect(filter.filter.value.value?.value.case).toBe('intValue')
    expect(filter.filter.value.value?.value.value).toBe(BigInt(3))
  })
})

describe('searchResultItemToExploreResult', () => {
  test('maps document search items without block refs to document results', () => {
    expect(searchResultItemToExploreResult(searchItem({type: 'document'}))).toMatchObject({
      type: 'document',
      matchText: 'Roadmap match',
    })
  })

  test('maps document search items with block refs to block results', () => {
    const id = hmId('alice', {path: ['roadmap'], blockRef: 'block-1', blockRange: {start: 2, end: 6}})

    expect(searchResultItemToExploreResult(searchItem({id, type: 'document'}))).toMatchObject({
      type: 'block',
      id: {blockRef: 'block-1', blockRange: {start: 2, end: 6}},
    })
  })

  test('maps comment search items to comment results', () => {
    expect(searchResultItemToExploreResult(searchItem({type: 'comment', commentId: 'comment-1'}))).toMatchObject({
      type: 'comment',
      commentId: 'comment-1',
      documentId: {uid: 'alice'},
    })
  })

  test('excludes contact search items', () => {
    expect(searchResultItemToExploreResult(searchItem({type: 'contact'}))).toBe(null)
  })
})

describe('documentInfoToExploreResultDocument', () => {
  test('maps document info to a document explore result', () => {
    const document = {
      type: 'document',
      id: hmId('alice', {path: ['roadmap']}),
      path: ['roadmap'],
      metadata: {name: 'Roadmap'},
      updateTime: '2026-01-01T00:00:00.000Z',
      breadcrumbs: [{id: hmId('alice'), name: 'Home'}],
    } as unknown as HMDocumentInfo

    expect(documentInfoToExploreResultDocument(document)).toMatchObject({
      type: 'document',
      id: {uid: 'alice', path: ['roadmap']},
      breadcrumb: ['Home'],
      versionTime: '2026-01-01T00:00:00.000Z',
    })
  })
})
