import type {NavRoute} from '@shm/shared/routes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it} from 'vitest'
import {
  getRouteWindowResourceKeys,
  routesShareWindowResource,
  routeUsesWindowDedupe,
} from '../utils/route-window-identity'

describe('getRouteWindowResourceKeys', () => {
  it('identifies a document by its version-independent id', () => {
    const route = {key: 'document', id: hmId('alice', {path: ['doc']})} as const
    expect(getRouteWindowResourceKeys(route)).toEqual(['doc:hm://alice/doc'])
  })

  it('ignores the version, so pinned and latest views of a document share a window', () => {
    const route = {key: 'document', id: hmId('alice', {path: ['doc'], version: 'bafyv1'})} as const
    expect(getRouteWindowResourceKeys(route)).toEqual(['doc:hm://alice/doc'])
  })

  it('identifies a draft placeholder document by its draft id', () => {
    const route = {key: 'document', id: hmId('alice', {path: ['docs', '-d1']})} as const
    expect(getRouteWindowResourceKeys(route)).toEqual(['draft:d1'])
  })

  it('identifies a private draft placeholder by its draft id', () => {
    const route = {key: 'document', id: hmId('alice', {path: ['docs', '-private-d2']})} as const
    expect(getRouteWindowResourceKeys(route)).toEqual(['draft:d2'])
  })

  it('refuses an unresolved bare draft route', () => {
    const route = {key: 'draft', id: 'd1'} as const
    expect(() => getRouteWindowResourceKeys(route)).toThrow('Cannot resolve window identity for draft d1')
  })

  it('adds the edited document key for edit drafts', () => {
    const route: NavRoute = {key: 'draft', id: 'd1', editUid: 'alice', editPath: ['doc']}
    expect(getRouteWindowResourceKeys(route)).toEqual(['draft:d1', 'doc:hm://alice/doc'])
  })

  it('resolves bare draft routes through the draft lookup', () => {
    const route = {key: 'draft', id: 'd1'} as const
    const keys = getRouteWindowResourceKeys(route, (id) =>
      id === 'd1' ? {id: 'd1', editUid: 'alice', editPath: ['doc']} : undefined,
    )
    expect(keys).toEqual(['draft:d1', 'doc:hm://alice/doc'])
  })

  it('adds no document key for location drafts because the placeholder is the draft id itself', () => {
    const route: NavRoute = {key: 'draft', id: 'd1', locationUid: 'alice', locationPath: ['docs']}
    expect(getRouteWindowResourceKeys(route)).toEqual(['draft:d1'])
  })

  it('identifies singleton routes by their key', () => {
    expect(getRouteWindowResourceKeys({key: 'settings'})).toEqual(['route:settings'])
    expect(getRouteWindowResourceKeys({key: 'contacts'})).toEqual(['route:contacts'])
  })

  it('distinguishes unrestricted pages from document tabs', () => {
    expect(getRouteWindowResourceKeys({key: 'library'})).toEqual([])
    expect(getRouteWindowResourceKeys({key: 'drafts'})).toEqual([])
    expect(getRouteWindowResourceKeys({key: 'comments', id: hmId('alice')})).toEqual(['doc:hm://alice'])
  })
})

describe('routesShareWindowResource', () => {
  it('shares a window for the same document at different versions', () => {
    const a = {key: 'document', id: hmId('alice', {path: ['doc']})} as const
    const b = {key: 'document', id: hmId('alice', {path: ['doc'], version: 'bafyv2'})} as const
    expect(routesShareWindowResource(a, b)).toBe(true)
  })

  it('does not share a window for different documents', () => {
    const a = {key: 'document', id: hmId('alice', {path: ['doc']})} as const
    const b = {key: 'document', id: hmId('alice', {path: ['other']})} as const
    expect(routesShareWindowResource(a, b)).toBe(false)
  })

  it('shares a window between a draft route and its document placeholder', () => {
    const draft = {key: 'draft', id: 'd1'} as const
    const doc = {key: 'document', id: hmId('alice', {path: ['docs', '-d1']})} as const
    expect(routesShareWindowResource(draft, doc, (id) => ({id, locationUid: 'alice', locationPath: ['docs']}))).toBe(
      true,
    )
  })

  it('shares a window between an edit draft and the published document', () => {
    const draft: NavRoute = {key: 'draft', id: 'd1', editUid: 'alice', editPath: ['doc']}
    const doc = {key: 'document', id: hmId('alice', {path: ['doc']})} as const
    expect(routesShareWindowResource(draft, doc)).toBe(true)
  })
})

describe('routeUsesWindowDedupe', () => {
  it('dedupes documents, drafts, and singleton routes', () => {
    expect(routeUsesWindowDedupe({key: 'document', id: hmId('alice')})).toBe(true)
    expect(routeUsesWindowDedupe({key: 'draft', id: 'd1'})).toBe(true)
    expect(routeUsesWindowDedupe({key: 'settings'})).toBe(true)
  })

  it('dedupes document tabs but leaves onboarding unrestricted', () => {
    expect(routeUsesWindowDedupe({key: 'onboarding'})).toBe(false)
    expect(routeUsesWindowDedupe({key: 'comments', id: hmId('alice')})).toBe(true)
  })
})
