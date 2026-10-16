// @vitest-environment node
import {FiltersEngine} from '@ghostery/adblocker'
import type {Session, WebContents} from 'electron'
import {EventEmitter} from 'node:events'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, expect, it, vi} from 'vitest'
import {BrowserContentBlocker, type BrowserBlockedCount} from '../browser-content-blocker'
import {browserListRefreshInterval} from '../browser-blocklist'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, {recursive: true, force: true})))
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'seed-content-blocker-'))
  directories.push(path)
  const session = {} as Session
  const appSession = {} as Session
  const saved = new Map<string, unknown>()
  const store = {
    get: (key: string) => saved.get(key),
    set: (key: string, value: unknown) => {
      saved.set(key, value)
    },
  }
  const engine = FiltersEngine.parse(
    '||tracker.example^$third-party\n@@||tracker.example/allowed.js$script\n/fixture-tracker.js$script',
    {loadCosmeticFilters: false},
  )
  const blocker = new BrowserContentBlocker(engine)
  const protectedOrigins = ['https://daemon.example', 'https://agents.example']
  blocker.initialize(session, path, store, () => protectedOrigins)
  const events: BrowserBlockedCount[] = []
  let url = 'https://site.example/page'
  const guest = Object.assign(new EventEmitter(), {id: 42, session, getURL: () => url}) as unknown as WebContents
  blocker.track(guest, (event) => events.push(event))
  const navigate = (target: string, inPlace = false) => {
    url = target
    guest.emit('did-start-navigation', {}, url, inPlace, true)
    guest.emit('did-navigate', {}, url)
  }
  const request = (target = 'https://tracker.example/pixel', source = url, type = 'image') =>
    ({
      id: 1,
      webContentsId: 42,
      url: target,
      resourceType: type,
      referrer: source,
      frame: {url: source, top: {url}},
    }) as Electron.OnBeforeRequestListenerDetails
  return {blocker, session, appSession, store, path, guest, events, navigate, request, engine, protectedOrigins}
}
it('uses real filter semantics, counts blocked requests and scopes rules to browser guests', () => {
  const f = fixture()
  expect(f.blocker.shouldBlock(f.appSession, f.request())).toBe(false)
  expect(f.blocker.shouldBlock(f.session, {...f.request(), webContentsId: 99})).toBe(false)
  expect(f.blocker.shouldBlock(f.session, f.request(undefined, undefined, 'mainFrame'))).toBe(false)
  expect(f.blocker.shouldBlock(f.session, f.request('https://tracker.example/allowed.js', undefined, 'script'))).toBe(
    false,
  )
  expect(f.blocker.shouldBlock(f.session, f.request(undefined, 'https://tracker.example/'))).toBe(false)
  expect(f.blocker.shouldBlock(f.session, f.request())).toBe(true)
  expect(f.events.at(-1)).toMatchObject({browserId: 42, count: 1, allowed: false})
  f.navigate('https://site.example/page#section', true)
  expect(f.events.at(-1)?.count).toBe(1)
  f.navigate('https://site.example/next')
  expect(f.events.at(-1)?.count).toBe(0)
  f.guest.emit('destroyed')
  expect(f.blocker.shouldBlock(f.session, f.request())).toBe(false)
})
it('exempts protected destinations and pages, including dynamically configured agent servers', () => {
  const f = fixture()
  expect(
    f.blocker.shouldBlock(f.session, f.request('https://daemon.example/fixture-tracker.js', undefined, 'script')),
  ).toBe(false)
  f.navigate('https://agents.example/')
  expect(f.blocker.shouldBlock(f.session, f.request())).toBe(false)
  f.navigate('https://new-agent.example/')
  f.protectedOrigins.push('https://new-agent.example')
  expect(f.blocker.shouldBlock(f.session, f.request())).toBe(false)
})
it('persists exact-origin exceptions, applies them to subframes, and rejects stale toggles', () => {
  const f = fixture()
  expect(() => f.blocker.setAllowed(f.guest, 'https://other.example', true)).toThrow('changed')
  f.blocker.setAllowed(f.guest, 'https://site.example', true)
  expect(f.blocker.shouldBlock(f.session, f.request(undefined, 'https://iframe.example/'))).toBe(false)
  const restarted = new BrowserContentBlocker(f.engine)
  restarted.initialize(f.session, f.path, f.store, () => [])
  restarted.track(f.guest, () => {})
  expect(restarted.shouldBlock(f.session, f.request())).toBe(false)
  f.navigate('http://site.example/')
  expect(f.blocker.shouldBlock(f.session, f.request())).toBe(true)
  f.navigate('https://site.example:8443/')
  expect(f.blocker.shouldBlock(f.session, f.request())).toBe(true)
  f.navigate('https://site.example/')
  f.blocker.setAllowed(f.guest, 'https://site.example', false)
  expect(f.blocker.shouldBlock(f.session, f.request())).toBe(true)
})
it('keeps old-document requests out of the new page count', () => {
  const f = fixture()
  const old = f.request()
  f.navigate('https://agents.example/next')
  // A pending exempt navigation must not exempt the old document's requests.
  expect(f.blocker.shouldBlock(f.session, old)).toBe(true)
  expect(f.events.at(-1)?.count).toBe(0)
})
it('starts offline, caps daily refreshes across restarts and retains the engine on oversized updates', async () => {
  const f = fixture()
  const fetchFeed = vi.fn<typeof fetch>()
  await f.blocker.refresh(fetchFeed)
  expect(fetchFeed).not.toHaveBeenCalled()
  const now = Date.now() + browserListRefreshInterval + 100
  fetchFeed.mockImplementation(async () => new Response('[Adblock Plus 2.0]\n||new-tracker.example^'))
  await f.blocker.refresh(fetchFeed, now)
  expect(fetchFeed).toHaveBeenCalledTimes(2)
  expect(f.blocker.shouldBlock(f.session, f.request('https://new-tracker.example/'))).toBe(true)
  const restarted = new BrowserContentBlocker(f.engine)
  restarted.initialize(f.session, f.path, f.store, () => [])
  restarted.track(f.guest, () => {})
  await restarted.refresh(fetchFeed, now + 1)
  expect(fetchFeed).toHaveBeenCalledTimes(2)
  fetchFeed.mockResolvedValueOnce(new Response('oversized', {headers: {'Content-Length': String(8 * 1024 * 1024 + 1)}}))
  await restarted.refresh(fetchFeed, now + browserListRefreshInterval)
  expect(restarted.shouldBlock(f.session, f.request('https://new-tracker.example/'))).toBe(true)
  await restarted.refresh(fetchFeed, now + browserListRefreshInterval + 1)
  expect(fetchFeed).toHaveBeenCalledTimes(3)
  expect(JSON.parse(readFileSync(join(f.path, 'browser/content-blocker.json'), 'utf8')).checkedAt).toBe(
    now + browserListRefreshInterval,
  )
})
it('recovers from incompatible cache bytes with the bundled engine', () => {
  const f = fixture()
  writeFileSync(join(f.path, 'browser/content-blocker.json'), JSON.stringify({checkedAt: 0, engine: 'broken'}))
  const restarted = new BrowserContentBlocker(f.engine)
  restarted.initialize(f.session, f.path, f.store, () => [])
  restarted.track(f.guest, () => {})
  expect(restarted.shouldBlock(f.session, f.request())).toBe(true)
})

it('matches iframe requests against their parent and blocks websocket trackers', () => {
  const f = fixture()
  const iframe = f.request('https://tracker.example/frame', 'https://site.example/page', 'subFrame')
  iframe.frame = {
    url: 'https://tracker.example/frame',
    parent: {url: 'https://site.example/page'},
    top: {url: 'https://site.example/page'},
  } as Electron.WebFrameMain
  expect(f.blocker.shouldBlock(f.session, iframe)).toBe(true)
  expect(f.blocker.shouldBlock(f.session, f.request('wss://tracker.example/socket', undefined, 'webSocket'))).toBe(true)
  expect(f.blocker.shouldBlock(f.session, f.request('wss://daemon.example/socket', undefined, 'webSocket'))).toBe(false)
})

it('applies both refreshed lists together and keeps old rules when either feed is invalid', async () => {
  const f = fixture()
  const fetchFeed = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('[Adblock Plus 2.0]\n||new-tracker.example^'))
    .mockResolvedValueOnce(new Response('<html>Service unavailable</html>'))
  const now = Date.now() + browserListRefreshInterval + 100
  await f.blocker.refresh(fetchFeed, now)
  expect(f.blocker.shouldBlock(f.session, f.request())).toBe(true)
  expect(f.blocker.shouldBlock(f.session, f.request('https://new-tracker.example/'))).toBe(false)
})

it('loads the bundled snapshot and protects the first page without fetching lists', async () => {
  const f = fixture()
  const blocker = new BrowserContentBlocker()
  blocker.initialize(f.session, join(f.path, 'first-run'), f.store, () => [])
  blocker.track(f.guest, () => {})
  // A request the shipped EasyPrivacy snapshot blocks; the list changes, so pick a long-lived rule.
  expect(
    blocker.shouldBlock(f.session, f.request('https://www.google-analytics.com/analytics.js', undefined, 'script')),
  ).toBe(true)
  const fetchFeed = vi.fn<typeof fetch>()
  await blocker.refresh(fetchFeed)
  expect(fetchFeed).not.toHaveBeenCalled()
})
