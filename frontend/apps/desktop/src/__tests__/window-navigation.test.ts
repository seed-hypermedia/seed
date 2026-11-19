import {describe, expect, it} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {navRouteSchema, type NavRoute} from '@shm/shared/routes'
import type {NavState} from '@shm/shared/utils/navigation'
import {getRouteWindowResourceKeys} from '../utils/route-window-identity'
import {reconcileSavedWindows} from '../utils/window-session'
import {createWindowNavigation} from '../window-navigation-machine'

const doc = (name: string, version?: string): NavRoute => ({
  key: 'document',
  id: hmId('alice', {path: [name], version}),
})
const state = (...routes: NavRoute[]): NavState => ({routes, routeIndex: routes.length - 1, lastAction: 'push'})
const draft = {id: 'd1', editUid: 'alice', editPath: ['one']}
const lookup = (id: string) => (id === 'd1' ? draft : undefined)

describe('window resource identity', () => {
  it('aliases versions, edit drafts, and draft placeholders', () => {
    expect(getRouteWindowResourceKeys(doc('one', 'v1'), lookup)).toEqual(['doc:hm://alice/one'])
    expect(getRouteWindowResourceKeys({key: 'draft', id: 'd1'}, lookup)).toEqual(['draft:d1', 'doc:hm://alice/one'])
    expect(getRouteWindowResourceKeys(doc('-private-d2'), lookup)).toEqual(['draft:d2'])
  })
  it('claims the same resource for document-shell tabs and edit-draft placeholders', () => {
    const id = hmId('alice', {path: ['one']})
    for (const key of [
      'metadata',
      'comments',
      'activity',
      'directory',
      'collaborators',
      'site-profile',
      'all-documents',
    ] as const) {
      expect(getRouteWindowResourceKeys(navRouteSchema.parse({key, id, tab: 'profile'}), lookup)).toEqual([
        'doc:hm://alice/one',
      ])
    }
    expect(getRouteWindowResourceKeys(doc('-d1'), lookup)).toEqual(['draft:d1', 'doc:hm://alice/one'])
  })
  it('does not claim library or document history', () => {
    expect(getRouteWindowResourceKeys({key: 'library'}, lookup)).toEqual([])
  })
  it('refuses unresolved bare drafts', () => {
    expect(() => getRouteWindowResourceKeys({key: 'draft', id: 'missing'}, lookup)).toThrow('draft')
  })
})

describe('saved window reconciliation', () => {
  it('drops obsolete history entries without moving away from the surviving active route', () => {
    const obsolete = {key: 'removed-page'} as unknown as NavRoute
    const result = reconcileSavedWindows({a: state(doc('one'), obsolete, doc('two')), b: state(obsolete)}, lookup)
    expect(result.windows.a.routes).toEqual([doc('one'), doc('two')])
    expect(result.windows.a.routeIndex).toBe(1)
    expect(result.windows.b).toBeUndefined()
  })
  it('keeps the most recently focused owner with its history and layout', () => {
    const recent = {...state(doc('previous'), doc('one', 'v2')), lastFocusedAt: 20, sidebarWidth: 31}
    const windows = {a: {...state(doc('one')), lastFocusedAt: 10}, b: recent, c: state(doc('two'))}
    const result = reconcileSavedWindows(windows, lookup)
    expect(Object.keys(result.windows)).toEqual(['b', 'c'])
    expect(result.windows.b).toEqual(recent)
    expect(result.removed).toEqual(['a'])
    expect(windows.a).toBeDefined()
    expect(reconcileSavedWindows(result.windows, lookup).removed).toEqual([])
  })
  it('collapses a draft alias that connects two earlier candidates', () => {
    const result = reconcileSavedWindows(
      {
        a: state(doc('one')),
        b: state(doc('-d1')),
        z: state({key: 'draft', id: 'd1'}),
      },
      lookup,
    )
    expect(Object.keys(result.windows)).toEqual(['a'])
  })
  it('deduplicates aliases but leaves unrestricted pages and historical entries alone', () => {
    const result = reconcileSavedWindows(
      {
        z: state({key: 'draft', id: 'd1'}),
        a: state(doc('one')),
        b: state(doc('one'), doc('two')),
        c: state({key: 'library'}),
        d: state({key: 'library'}),
      },
      lookup,
    )
    expect(Object.keys(result.windows)).toEqual(['a', 'b', 'c', 'd'])
    expect(result.removed).toEqual(['z'])
  })
})

function fixture() {
  const sent: Array<{windowId: string; requestId: number; state: NavState}> = []
  const focused: string[] = []
  const committed: string[] = []
  const nav = createWindowNavigation({
    getDraft: lookup,
    apply: (windowId, requestId, next) => sent.push({windowId, requestId, state: next}),
    focus: (id) => focused.push(id),
    commit: (id) => committed.push(id),
    close: () => {},
    error: () => {},
  })
  const register = (id: string, initial: NavState, ready = true) => {
    nav.register(id, initial)
    if (ready) nav.ready(id)
  }
  const ack = () => {
    const last = sent.at(-1)!
    nav.acknowledge(last.windowId, last.requestId)
  }
  return {nav, sent, focused, committed, register, ack}
}

describe('window navigation coordinator', () => {
  it('serializes competing requests and keeps the redirected source history unchanged', () => {
    const f = fixture()
    f.register('a', state(doc('one')))
    f.register('b', state(doc('two')))
    f.nav.request('a', {type: 'push', route: doc('three')})
    f.nav.request('b', {type: 'push', route: doc('three')})
    expect(f.sent).toHaveLength(1)
    expect(f.nav.owner(doc('one'))).toBe('a')
    expect(f.nav.owner(doc('three'))).toBe('a')
    f.ack()
    expect(f.sent).toHaveLength(1)
    expect(f.focused).toContain('a')
    expect(f.nav.state('b')).toEqual(state(doc('two')))
    expect(f.nav.owner(doc('one'))).toBeUndefined()
  })
  it('routes Back to another owner without moving the source cursor', () => {
    const f = fixture()
    f.register('a', state(doc('one')))
    f.register('b', state(doc('one'), doc('two')))
    f.nav.request('b', {type: 'pop'})
    expect(f.focused).toEqual(['a'])
    expect(f.sent).toHaveLength(0)
    expect(f.nav.state('b')?.routeIndex).toBe(1)
  })
  it.each(['push', 'replace', 'backplace'] as const)('deduplicates %s to a different version in the owner', (type) => {
    const f = fixture()
    f.register('a', state(doc('one')))
    f.register('b', state(doc('two')))
    f.nav.request('b', {type, route: doc('one', 'v2')})
    expect(f.sent.at(-1)?.windowId).toBe('a')
    f.ack()
    expect(f.nav.state('a')?.routes.at(-1)).toEqual(doc('one', 'v2'))
    expect(f.nav.state('b')).toEqual(state(doc('two')))
  })
  it('checks Forward and browser-to-document resolution against the same owner', () => {
    const f = fixture()
    f.register('a', state(doc('one')))
    f.register('b', {...state(doc('two'), doc('one')), routeIndex: 0})
    f.register('browser', state({key: 'web', url: 'https://example.com'}))
    f.nav.request('b', {type: 'forward'})
    f.nav.request('browser', {type: 'resolveBrowser', url: 'https://example.com', route: doc('one')})
    expect(f.focused).toEqual(['a', 'a'])
    expect(f.nav.state('b')?.routeIndex).toBe(0)
    expect(f.nav.state('browser')?.routes[0]?.key).toBe('web')
    expect(f.sent).toHaveLength(0)
  })
  it('preserves history movement between identical entries within the same window', () => {
    const f = fixture()
    f.register('a', state(doc('one'), doc('one')))
    f.nav.request('a', {type: 'pop'})
    f.ack()
    expect(f.nav.state('a')?.routeIndex).toBe(0)
  })
  it('does not apply an outdated browser resolution after navigating away', () => {
    const f = fixture()
    f.register('a', state(doc('one')))
    f.nav.request('a', {type: 'resolveBrowser', url: 'https://old.example', route: doc('two')})
    expect(f.sent).toHaveLength(0)
    expect(f.nav.owner(doc('one'))).toBe('a')
  })
  it('waits for the renderer and ignores stale acknowledgements', () => {
    const f = fixture()
    f.register('a', state(doc('one')), false)
    f.nav.request('a', {type: 'push', route: doc('one', 'v2')})
    expect(f.sent).toHaveLength(0)
    f.nav.ready('a')
    expect(f.sent).toHaveLength(1)
    f.nav.acknowledge('a', -1)
    expect(f.committed).toHaveLength(0)
    f.ack()
    expect(f.committed).toEqual(['a'])
  })
  it('retains ownership while disconnected and replays the same authorized state on reconnect', () => {
    const f = fixture()
    f.register('a', state(doc('one')))
    f.nav.request('a', {type: 'replace', route: doc('two')})
    f.nav.disconnected('a')
    expect(f.nav.owner(doc('one'))).toBe('a')
    expect(f.nav.owner(doc('two'))).toBe('a')
    f.nav.ready('a')
    expect(f.sent).toHaveLength(2)
    expect(f.sent[0]).toEqual(f.sent[1])
    f.ack()
    expect(f.nav.owner(doc('one'))).toBeUndefined()
  })
  it('keeps cached claims after an edit draft leaves the index', () => {
    let available = true
    const f = createWindowNavigation({
      getDraft: () => (available ? draft : undefined),
      apply: () => {},
      focus: () => {},
      commit: () => {},
      close: () => {},
      error: () => {},
    })
    f.register('a', state({key: 'draft', id: 'd1'}))
    available = false
    expect(f.owner(doc('one'))).toBe('a')
  })
  it('releases claims only on confirmed close and continues queued navigation', () => {
    const f = fixture()
    f.register('a', state(doc('one')))
    f.register('b', state(doc('two')))
    f.nav.request('a', {type: 'push', route: doc('three')})
    f.nav.request('b', {type: 'push', route: doc('three')})
    f.nav.closed('a')
    expect(f.sent.at(-1)?.windowId).toBe('b')
    f.ack()
    expect(f.nav.owner(doc('three'))).toBe('b')
  })
})
