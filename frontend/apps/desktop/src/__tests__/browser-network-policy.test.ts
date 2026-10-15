// @vitest-environment node
import {EventEmitter} from 'node:events'
import type {Session, WebContents} from 'electron'
import {afterEach, expect, it, vi} from 'vitest'
vi.mock('node:dns/promises', () => ({lookup: vi.fn()}))
import {lookup} from 'node:dns/promises'
import {
  isGuestOnPrivateNetwork,
  navigatePublicBrowser,
  setupBrowserNetworkPolicy,
  trackBrowserNetwork,
} from '../browser-network-policy'

let nextGuest = 100
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn())
  vi.mocked(lookup).mockReset()
})
function fixture() {
  let index = 0
  const guest = Object.assign(new EventEmitter(), {
    id: ++nextGuest,
    getURL: () => 'https://www.example.com/',
    navigationHistory: {getActiveIndex: () => index},
    loadURL: vi.fn(),
  }) as unknown as WebContents
  trackBrowserNetwork(guest)
  cleanup.push(() => guest.emit('destroyed'))
  const handlers: Record<string, Function> = {}
  const session = {
    webRequest: Object.fromEntries(
      ['onBeforeRequest', 'onBeforeSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onCompleted'].map(
        (name) => [
          name,
          (fn: Function) => {
            handlers[name] = fn
          },
        ],
      ),
    ),
  } as unknown as Session
  setupBrowserNetworkPolicy(session)
  const response = (id: number, url: string, ip?: string, resourceType = 'mainFrame') => ({
    id,
    url,
    ip,
    resourceType,
    webContentsId: guest.id,
  })
  const begin = (id: number, url: string) => {
    guest.emit('did-start-navigation', {}, url, false, true)
    handlers.onBeforeRequest!(response(id, url), vi.fn())
  }
  const commit = (url: string, entry: number) => {
    index = entry
    guest.emit('did-navigate', {}, url)
  }
  return {guest, handlers, response, begin, commit}
}

it('blocks a rebound public hostname before commit and preserves the mark through same-document navigation', () => {
  const {guest, handlers, response, begin, commit} = fixture()
  const url = 'https://public.example/article'
  begin(1, url)
  handlers.onResponseStarted!(response(1, url, '127.0.0.1'))
  expect(isGuestOnPrivateNetwork(guest.id)).toBe(true)
  commit(url, 0)
  handlers.onCompleted!(response(1, url))
  guest.emit('did-start-navigation', {}, url + '#section', true, true)
  expect(isGuestOnPrivateNetwork(guest.id)).toBe(true)
  guest.emit('destroyed')
  expect(isGuestOnPrivateNetwork(guest.id)).toBe(false)
})
it('isolates guests and ignores subresources, stale completions and literal private hosts', () => {
  const {guest, handlers, response, begin, commit} = fixture()
  const other = fixture()
  const url = 'https://public.example/'
  begin(1, url)
  handlers.onResponseStarted!(response(1, url, '192.168.1.1', 'image'))
  expect(isGuestOnPrivateNetwork(guest.id)).toBe(false)
  handlers.onResponseStarted!(response(1, url, '192.168.1.1'))
  commit(url, 0)
  expect(isGuestOnPrivateNetwork(other.guest.id)).toBe(false)
  begin(2, 'https://other.example/')
  handlers.onResponseStarted!(response(2, 'https://other.example/', '8.8.8.8'))
  commit('https://other.example/', 1)
  handlers.onCompleted!(response(1, url, '192.168.1.1'))
  expect(isGuestOnPrivateNetwork(guest.id)).toBe(false)
  begin(3, 'http://127.0.0.1/')
  handlers.onResponseStarted!(response(3, 'http://127.0.0.1/', '127.0.0.1'))
  commit('http://127.0.0.1/', 2)
  expect(isGuestOnPrivateNetwork(guest.id)).toBe(false)
  // Back/forward cache restoration may not generate a new network response.
  begin(4, url)
  commit(url, 0)
  expect(isGuestOnPrivateNetwork(guest.id)).toBe(true)
})
it.each(['10.0.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', 'fe80::1'])(
  'records private peer %s reported on completion',
  (ip) => {
    const {guest, handlers, response, begin, commit} = fixture()
    const url = 'https://public.example/'
    begin(1, url)
    handlers.onResponseStarted!(response(1, url))
    commit(url, 0)
    handlers.onCompleted!(response(1, url, ip))
    expect(isGuestOnPrivateNetwork(guest.id)).toBe(true)
  },
)
it('checks redirect DNS before making another request, rejecting private redirects', async () => {
  const {guest} = fixture()
  const prevented = vi.fn()
  vi.mocked(lookup).mockResolvedValueOnce([{address: '10.0.0.1', family: 4}] as never)
  vi.mocked(guest.loadURL).mockImplementation(async () => {
    guest.emit('will-redirect', {preventDefault: prevented}, 'https://private.example/', false, true)
    throw new Error('ERR_ABORTED')
  })
  await expect(navigatePublicBrowser(guest, 'https://8.8.8.8/', () => {})).rejects.toThrow('private')
  expect(prevented).toHaveBeenCalledOnce()
  expect(guest.loadURL).toHaveBeenCalledTimes(1)
  expect(guest.listenerCount('will-redirect')).toBe(0)
})
it('follows validated public redirects and bounds redirect loops', async () => {
  const {guest} = fixture()
  vi.mocked(guest.loadURL)
    .mockImplementationOnce(async () => {
      guest.emit('will-redirect', {preventDefault: vi.fn()}, 'https://8.8.4.4/', false, true)
      throw new Error('ERR_ABORTED')
    })
    .mockResolvedValueOnce(undefined)
  await navigatePublicBrowser(guest, 'https://8.8.8.8/', () => {})
  expect(guest.loadURL).toHaveBeenLastCalledWith('https://8.8.4.4/')
  vi.mocked(guest.loadURL).mockImplementation(async () => {
    guest.emit('will-redirect', {preventDefault: vi.fn()}, 'https://8.8.8.8/', false, true)
    throw new Error('ERR_ABORTED')
  })
  await expect(navigatePublicBrowser(guest, 'https://8.8.8.8/', () => {})).rejects.toThrow('Too many')
})

it('retains known private peer provenance when a cached reload omits the IP', () => {
  const {guest, handlers, response, begin, commit} = fixture()
  const url = 'https://public.example/'
  begin(1, url)
  handlers.onResponseStarted!(response(1, url, '127.0.0.1'))
  commit(url, 0)
  begin(2, url)
  handlers.onResponseStarted!(response(2, url))
  commit(url, 0)
  expect(isGuestOnPrivateNetwork(guest.id)).toBe(true)
  begin(3, url)
  handlers.onResponseStarted!(response(3, url, '8.8.8.8'))
  commit(url, 1)
  expect(isGuestOnPrivateNetwork(guest.id)).toBe(false)
  begin(4, url)
  handlers.onResponseStarted!(response(4, url))
  commit(url, 1)
  expect(isGuestOnPrivateNetwork(guest.id)).toBe(true)
})

it.each([
  ['https://tracker.test/pixel', 'image', false],
  ['https://cdn.example.com/file', 'script', true],
  ['https://login.identity.test/authorize', 'mainFrame', true],
  ['https://www.example.com/callback?code=oauth', 'mainFrame', true],
])('filters cookie headers for %s (%s)', (url, resourceType, keepsCookies) => {
  const {guest, handlers} = fixture()
  const details = {
    url,
    resourceType,
    webContentsId: guest.id,
    // An embedded tracker must not become its own first-party context.
    frame: {url: 'https://tracker.test/frame'},
    requestHeaders: {cOoKiE: 'session=secret', Accept: '*/*'},
    responseHeaders: {'sEt-CoOkIe': ['session=new'], Location: ['https://www.example.com/callback']},
  }
  const sent = vi.fn()
  const received = vi.fn()
  handlers.onBeforeSendHeaders!(details, sent)
  handlers.onHeadersReceived!(details, received)
  expect(sent.mock.calls[0]![0].requestHeaders).toEqual({
    Accept: '*/*',
    'Sec-GPC': '1',
    ...(keepsCookies ? {cOoKiE: 'session=secret'} : {}),
  })
  expect(received.mock.calls[0]![0].responseHeaders).toEqual({
    Location: ['https://www.example.com/callback'],
    ...(keepsCookies ? {'sEt-CoOkIe': ['session=new']} : {}),
  })
})
it.each([
  ['https://www.example.co.uk', 'https://cdn.example.co.uk', true],
  ['https://a.co.uk', 'https://b.co.uk', false],
  ['https://alice.github.io', 'https://bob.github.io', false],
  ['http://127.0.0.1:3000', 'http://127.0.0.1:4000', true],
  ['http://127.0.0.1', 'http://127.0.0.2', false],
  ['http://[::1]:3000', 'http://[::1]:4000', true],
  ['https://example.com.', 'https://cdn.example.com', true],
])('compares top-level sites %s and %s', (top, url, keep) => {
  const {handlers} = fixture()
  const callback = vi.fn()
  handlers.onBeforeSendHeaders!(
    {url, resourceType: 'xhr', frame: {url: 'https://tracker.test', top: {url: top}}, requestHeaders: {Cookie: 'a=b'}},
    callback,
  )
  expect(callback.mock.calls[0]![0].requestHeaders.Cookie).toBe(keep ? 'a=b' : undefined)
})
it('preserves cookies on unattributed main-process fetches', () => {
  const {handlers} = fixture()
  const callback = vi.fn()
  handlers.onBeforeSendHeaders!(
    {url: 'https://example.com', resourceType: 'xhr', requestHeaders: {Cookie: 'a=b'}},
    callback,
  )
  expect(callback).toHaveBeenCalledWith({requestHeaders: {Cookie: 'a=b', 'Sec-GPC': '1'}})
})
