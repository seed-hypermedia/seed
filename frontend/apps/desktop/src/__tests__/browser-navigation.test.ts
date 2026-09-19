import {describe, expect, it} from 'vitest'
import {navRouteSchema} from '@shm/shared/routes'
import {navStateReducer, type NavState} from '@shm/shared/utils/navigation'
import {reconcileBrowserNavigation, type BrowserLocation} from '../browser-navigation'

const first: BrowserLocation = {browserId: 1, historyIndex: 1, url: 'https://example.com/a', title: 'A'}
const second: BrowserLocation = {...first, historyIndex: 2, url: 'https://example.com/b', title: 'B'}
const initial: NavState = {
  routes: [{key: 'contacts'}, {key: 'web', url: first.url}],
  routeIndex: 1,
  lastAction: 'push',
  sidebarWidth: 20,
  selectedIdentity: 'alice',
}

describe('integrated browser history', () => {
  it('restores a mixed Seed and web history in both directions', () => {
    let state = reconcileBrowserNavigation(initial, first, true)
    state = reconcileBrowserNavigation(state, second, false)
    state = navStateReducer(state, {type: 'push', route: {key: 'contacts'}})
    state = navStateReducer(state, {type: 'pop'})
    state = reconcileBrowserNavigation(state, second, true)
    expect(state.routeIndex).toBe(2)
    expect(state.routes).toHaveLength(4)
    state = navStateReducer(state, {type: 'pop'})
    state = reconcileBrowserNavigation(state, first, true)
    state = navStateReducer(state, {type: 'pop'})
    expect(state.routes[state.routeIndex].key).toBe('contacts')
    state = navStateReducer(state, {type: 'forward'})
    state = reconcileBrowserNavigation(state, first, true)
    expect(state.routes).toHaveLength(4)
    expect(state.sidebarWidth).toBe(20)
    expect(state.selectedIdentity).toBe('alice')
  })

  it('replaces redirects and page titles without discarding forward history', () => {
    let state = reconcileBrowserNavigation(initial, first, true)
    state = reconcileBrowserNavigation(state, second, false)
    state = navStateReducer(state, {type: 'pop'})
    state = reconcileBrowserNavigation(state, {...first, title: 'Updated'}, false)
    expect(state.routes).toHaveLength(3)
    expect(state.routes[1]).toMatchObject({title: 'Updated'})
    const redirect = reconcileBrowserNavigation(initial, {...first, url: 'https://example.com/final'}, true)
    expect(redirect.routes).toHaveLength(2)
    expect(redirect.routes[1]).toMatchObject({url: 'https://example.com/final'})
  })

  it('truncates the abandoned branch when Chromium reuses its history index', () => {
    let state = reconcileBrowserNavigation(initial, first, true)
    state = reconcileBrowserNavigation(state, second, false)
    state = navStateReducer(state, {type: 'push', route: {key: 'contacts'}})
    state = navStateReducer(navStateReducer(state, {type: 'pop'}), {type: 'pop'})
    state = reconcileBrowserNavigation(state, {...second, url: 'https://example.com/c'}, false)
    expect(state.routeIndex).toBe(2)
    expect(state.routes).toHaveLength(3)
    expect(state.routes[2]).toMatchObject({url: 'https://example.com/c'})
  })

  it('handles in-page back and replacement while ignoring background page events on native routes', () => {
    let state = reconcileBrowserNavigation(initial, first, true)
    state = reconcileBrowserNavigation(state, second, false)
    state = reconcileBrowserNavigation(state, first, false)
    expect(state.routeIndex).toBe(1)
    state = reconcileBrowserNavigation(state, {...first, url: 'https://example.com/replaced'}, false)
    expect(state.routes).toHaveLength(3)
    expect(state.routes[1]).toMatchObject({url: 'https://example.com/replaced'})
    state = navStateReducer(state, {type: 'push', route: {key: 'contacts'}})
    expect(reconcileBrowserNavigation(state, second, false)).toBe(state)
  })

  it('only persists HTTP and HTTPS browser routes', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,test', 'hm://alice']) {
      expect(navRouteSchema.safeParse({key: 'web', url}).success).toBe(false)
    }
    expect(navRouteSchema.parse({key: 'web', ...first})).toEqual({key: 'web', ...first})
  })
})
