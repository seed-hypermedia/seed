// @vitest-environment node
import {EventEmitter} from 'node:events'
import type {Session, WebContents} from 'electron'
import {afterEach, expect, it, vi} from 'vitest'
vi.mock('node:dns/promises', () => ({lookup: vi.fn()}))
import {lookup} from 'node:dns/promises'
import {
  attributeGuestFetch,
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
it('cancels listed main frames but leaves subresources to the content policy', () => {
  const {handlers, response} = fixture()
  const callback = vi.fn()
  handlers.onBeforeRequest!(response(1, 'https://malware.testing.google.test/'), callback)
  expect(callback).toHaveBeenCalledWith({cancel: true})
  callback.mockClear()
  handlers.onBeforeRequest!(response(2, 'https://malware.testing.google.test/', undefined, 'image'), callback)
  expect(callback).toHaveBeenCalledWith({})
})
it('refuses agent navigation to a listed host before DNS or loadURL', async () => {
  const {guest} = fixture()
  await expect(navigatePublicBrowser(guest, 'https://malware.testing.google.test/', () => {})).rejects.toThrow(
    'Website blocked',
  )
  expect(lookup).not.toHaveBeenCalled()
  expect(guest.loadURL).not.toHaveBeenCalled()
})

it('tries https before an agent http navigation and refuses when only plain http answers', async () => {
  const {guest} = fixture()
  vi.mocked(lookup).mockResolvedValue([{address: '93.184.216.34', family: 4}] as never)
  const refused: string[] = []
  const insecure = {
    allows: () => false,
    refuse: (url: string): never => {
      refused.push(url)
      throw new Error(`${url} needs the user's consent`)
    },
  }
  vi.mocked(guest.loadURL).mockResolvedValueOnce(undefined)
  await navigatePublicBrowser(guest, 'http://example.com/a', () => {}, undefined, insecure)
  expect(guest.loadURL).toHaveBeenCalledTimes(1)
  expect(guest.loadURL).toHaveBeenLastCalledWith('https://example.com/a')
  vi.mocked(guest.loadURL).mockRejectedValueOnce(new Error('ERR_CONNECTION_REFUSED (-102)'))
  await expect(navigatePublicBrowser(guest, 'http://example.com/b', () => {}, undefined, insecure)).rejects.toThrow(
    'needs the user',
  )
  expect(refused).toEqual(['http://example.com/b'])
  expect(guest.loadURL).toHaveBeenCalledTimes(2)
  expect(guest.loadURL).not.toHaveBeenCalledWith('http://example.com/b')
  // An origin the user accepted the warning for loads as plain http.
  vi.mocked(guest.loadURL).mockResolvedValueOnce(undefined)
  await navigatePublicBrowser(guest, 'http://example.com/c', () => {}, undefined, {...insecure, allows: () => true})
  expect(guest.loadURL).toHaveBeenLastCalledWith('http://example.com/c')
})
it('refuses an agent navigation whose encrypted attempt redirects back to plain http', async () => {
  const {guest} = fixture()
  vi.mocked(lookup).mockResolvedValue([{address: '93.184.216.34', family: 4}] as never)
  const refused: string[] = []
  const insecure = {
    allows: () => false,
    refuse: (url: string): never => {
      refused.push(url)
      throw new Error('consent')
    },
  }
  vi.mocked(guest.loadURL).mockImplementationOnce(async () => {
    guest.emit('will-redirect', {preventDefault: vi.fn()}, 'http://example.com/login', false, true)
    throw new Error('ERR_ABORTED')
  })
  await expect(navigatePublicBrowser(guest, 'http://example.com/', () => {}, undefined, insecure)).rejects.toThrow(
    'consent',
  )
  expect(refused).toEqual(['http://example.com/login'])
  expect(guest.loadURL).toHaveBeenCalledTimes(1)
  expect(guest.listenerCount('will-redirect')).toBe(0)
})

const privateTargets = [
  'http://localhost:5000/x',
  'http://192.168.1.2/x',
  'http://169.254.1.1/',
  'http://printer.local/',
]
it.each([
  ['a public page', {frame: {url: 'https://public.example/'}}, true],
  ['a page opened at a local address', {frame: {url: 'http://localhost:3000/'}}, false],
  [
    'an about:srcdoc frame inside a public page',
    {frame: {url: 'about:srcdoc', parent: {url: 'https://public.example/'}}},
    true,
  ],
  [
    'an about:blank frame inside a local page',
    {frame: {url: 'about:blank', parent: {url: 'http://localhost:3000/'}}},
    false,
  ],
  ['a blob: frame of a public page', {frame: {url: 'blob:https://public.example/4f1c'}}, true],
  ['a blob: frame of a local page', {frame: {url: 'blob:http://127.0.0.1:8080/4f1c'}}, false],
  ['no frame and a public referrer', {referrer: 'https://public.example/'}, true],
  ['no frame and a local referrer', {referrer: 'http://localhost:3000/'}, false],
  ['no frame and no referrer', {}, true],
])('judges private sub-requests by their initiator: %s', (_label, initiator, cancelled) => {
  const {handlers} = fixture()
  for (const url of privateTargets) {
    const callback = vi.fn()
    handlers.onBeforeRequest!({id: 9, url, resourceType: 'image', ...initiator}, callback)
    expect(callback, url).toHaveBeenCalledWith(cancelled ? {cancel: true} : {})
  }
  // Public targets are never affected by this rule.
  const callback = vi.fn()
  handlers.onBeforeRequest!({id: 9, url: 'https://cdn.example/a.png', resourceType: 'image', ...initiator}, callback)
  expect(callback).toHaveBeenCalledWith({})
})
it('leaves main-frame navigations and public websockets alone, but cancels private websockets', () => {
  const {guest, handlers} = fixture()
  const callback = vi.fn()
  handlers.onBeforeRequest!(
    {id: 1, url: 'http://localhost:3000/', resourceType: 'mainFrame', webContentsId: guest.id},
    callback,
  )
  expect(callback).toHaveBeenCalledWith({})
  const frame = {url: 'https://public.example/'}
  handlers.onBeforeRequest!({id: 2, url: 'wss://public.example/socket', resourceType: 'webSocket', frame}, callback)
  expect(callback).toHaveBeenLastCalledWith({})
  handlers.onBeforeRequest!({id: 3, url: 'ws://localhost:3000/socket', resourceType: 'webSocket', frame}, callback)
  expect(callback).toHaveBeenLastCalledWith({cancel: true})
  // A guest with no frame attribution answers for its own page.
  handlers.onBeforeRequest!(
    {id: 4, url: 'http://localhost:3000/img', resourceType: 'other', webContentsId: guest.id},
    callback,
  )
  expect(callback).toHaveBeenLastCalledWith({cancel: true})
})

it('attributes an announced main-process fetch to its guest page, across redirects, until released', () => {
  const {guest, handlers} = fixture()
  const page = 'http://127.0.0.1:5000/first'
  ;(guest as any).getURL = () => page
  const icon = 'http://127.0.0.1:5000/icons/site.svg'
  const request = (id: number, url: string) => {
    const callback = vi.fn()
    handlers.onBeforeRequest!({id, url, resourceType: 'other'}, callback)
    return callback.mock.calls[0]![0]
  }
  expect(request(1, icon)).toEqual({cancel: true})
  const release = attributeGuestFetch(guest, icon)
  expect(request(2, icon)).toEqual({})
  // The redirect hop keeps the request id and so the page, even to another local URL.
  expect(request(2, 'http://127.0.0.1:5000/icons/final.svg')).toEqual({})
  // Other unattributed requests gain nothing from the announcement.
  expect(request(3, 'http://127.0.0.1:5000/icons/final.svg')).toEqual({cancel: true})
  release()
  expect(request(4, icon)).toEqual({cancel: true})
  expect(request(2, 'http://127.0.0.1:5000/icons/again.svg')).toEqual({cancel: true})
  // A guest on a public page cannot reach the local network through its own fetches either.
  ;(guest as any).getURL = () => 'https://public.example/'
  const releasePublic = attributeGuestFetch(guest, icon)
  expect(request(5, icon)).toEqual({cancel: true})
  releasePublic()
})
