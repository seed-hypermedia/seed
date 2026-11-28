import {describe, expect, it} from 'vitest'
import {hmId} from '../utils/entity-id-url'
import {
  ALL_DOCUMENTS_DEFAULT_ORDER,
  allDocumentsRouteFromState,
  allDocumentsStateFromRoute,
  parseAllDocumentsSearchParams,
  type AllDocumentsViewState,
} from '../utils/all-documents-view'

const siteId = hmId('site')

describe('parseAllDocumentsSearchParams', () => {
  it('parses valid params from a URLSearchParams', () => {
    const params = new URLSearchParams('view=tree&type=collections&sort=updated&order=asc&q=setup')
    expect(parseAllDocumentsSearchParams(params)).toEqual({
      view: 'tree',
      type: 'collections',
      sort: 'updated',
      order: 'asc',
      q: 'setup',
    })
  })

  it('parses valid params from a record', () => {
    expect(
      parseAllDocumentsSearchParams({view: 'list', type: 'documents', sort: 'title', order: 'desc', q: 'x'}),
    ).toEqual({
      view: 'list',
      type: 'documents',
      sort: 'title',
      order: 'desc',
      q: 'x',
    })
  })

  it('drops invalid values', () => {
    const params = new URLSearchParams('view=grid&type=agents&sort=size&order=up&q=x')
    expect(parseAllDocumentsSearchParams(params)).toEqual({q: 'x'})
  })

  it('omits empty q', () => {
    expect(parseAllDocumentsSearchParams({q: ''})).toEqual({})
  })
})

describe('allDocumentsStateFromRoute', () => {
  it('fills defaults for an empty route', () => {
    expect(allDocumentsStateFromRoute({key: 'all-documents', id: siteId})).toEqual({
      view: 'list',
      tab: 'all',
      sort: 'location',
      order: 'asc',
      q: '',
    })
  })

  it('maps route fields to state fields', () => {
    expect(
      allDocumentsStateFromRoute({
        key: 'all-documents',
        id: siteId,
        view: 'tree',
        type: 'collections',
        sort: 'updated',
        order: 'desc',
        q: 'setup',
      }),
    ).toEqual({view: 'tree', tab: 'collections', sort: 'updated', order: 'desc', q: 'setup'})
  })

  it('resolves the default order for the active sort when order is absent', () => {
    const state = allDocumentsStateFromRoute({key: 'all-documents', id: siteId, sort: 'updated'})
    expect(state.order).toBe(ALL_DOCUMENTS_DEFAULT_ORDER.updated)
  })
})

describe('allDocumentsRouteFromState', () => {
  it('omits defaults from the route', () => {
    expect(
      allDocumentsRouteFromState(siteId, {view: 'list', tab: 'all', sort: 'location', order: 'asc', q: ''}),
    ).toEqual({key: 'all-documents', id: siteId})
  })

  it('encodes non-default values', () => {
    expect(
      allDocumentsRouteFromState(siteId, {view: 'tree', tab: 'collections', sort: 'updated', order: 'asc', q: 'x'}),
    ).toEqual({
      key: 'all-documents',
      id: siteId,
      view: 'tree',
      type: 'collections',
      sort: 'updated',
      order: 'asc',
      q: 'x',
    })
  })

  it('omits order when it matches the column default', () => {
    const route = allDocumentsRouteFromState(siteId, {view: 'list', tab: 'all', sort: 'updated', order: 'desc', q: ''})
    expect(route.order).toBeUndefined()
  })

  it('keeps order when it differs from the column default', () => {
    const route = allDocumentsRouteFromState(siteId, {view: 'list', tab: 'all', sort: 'updated', order: 'asc', q: ''})
    expect(route.order).toBe('asc')
  })
})

describe('round trip state ↔ route', () => {
  it('round trips a fully-specified state', () => {
    const state: AllDocumentsViewState = {view: 'tree', tab: 'collections', sort: 'updated', order: 'asc', q: 'setup'}
    const route = allDocumentsRouteFromState(siteId, state)
    const back = allDocumentsStateFromRoute(route)
    expect(back).toEqual(state)
  })

  it('round trips the default state', () => {
    const state: AllDocumentsViewState = {view: 'list', tab: 'all', sort: 'location', order: 'asc', q: ''}
    const route = allDocumentsRouteFromState(siteId, state)
    const back = allDocumentsStateFromRoute(route)
    expect(back).toEqual(state)
  })
})
