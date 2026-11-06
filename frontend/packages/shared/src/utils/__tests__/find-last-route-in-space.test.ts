import {describe, expect, it} from 'vitest'
import {hmId} from '../entity-id-url'
import {findLastRouteInSpace, type NavState} from '../navigation'
import type {NavRoute} from '../../routes'

function history(routes: NavRoute[], routeIndex = routes.length - 1): NavState {
  return {routes, routeIndex, lastAction: 'push'}
}

const settings: NavRoute = {key: 'site-settings', id: hmId('space'), tab: 'general'}

describe('findLastRouteInSpace', () => {
  it('finds the page right before settings', () => {
    const doc: NavRoute = {key: 'document', id: hmId('space', {path: ['notes']})}
    expect(findLastRouteInSpace(history([doc, settings]), 'space')).toEqual({index: 0, route: doc})
  })

  it('skips pages from other spaces and earlier settings visits', () => {
    const doc: NavRoute = {key: 'document', id: hmId('space', {path: ['notes']})}
    const elsewhere: NavRoute = {key: 'document', id: hmId('other')}
    const result = findLastRouteInSpace(history([doc, settings, elsewhere, settings]), 'space')
    expect(result).toEqual({index: 0, route: doc})
  })

  it('ignores pages after the current one, which were left by going back', () => {
    const doc: NavRoute = {key: 'document', id: hmId('space')}
    const later: NavRoute = {key: 'document', id: hmId('space', {path: ['later']})}
    expect(findLastRouteInSpace(history([doc, settings, later], 1), 'space')).toEqual({index: 0, route: doc})
  })

  it('returns null when the space was never visited', () => {
    expect(findLastRouteInSpace(history([{key: 'document', id: hmId('other')}, settings]), 'space')).toBeNull()
  })
})
