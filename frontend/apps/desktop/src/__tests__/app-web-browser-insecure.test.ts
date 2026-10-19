// @vitest-environment node
import {EventEmitter} from 'node:events'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import type {BrowserWindow} from 'electron'
// Plain http is never shown by accident: the encrypted address is tried before any http request,
// and the http page appears only behind the warning, after a real click, per origin and session.
const mocks = vi.hoisted(() => ({
  session: undefined as any,
  app: undefined as any,
  guests: [] as any[],
  nextGuestId: 7,
}))
vi.mock('node:dns/promises', () => ({lookup: vi.fn().mockResolvedValue([{address: '93.184.216.34', family: 4}])}))
vi.mock('../app-browser-agent', () => ({
  executeBrowserCommand: (_guest: unknown, command: {url: string}, options: {navigate: (url: string) => unknown}) =>
    options.navigate(command.url),
}))
vi.mock('../app-browser-favicon', () => ({readBrowserFavicons: async () => [], loadBrowserFavicon: async () => null}))
vi.mock('../app-store.mts', () => ({appStore: {get: vi.fn(), set: vi.fn()}}))
vi.mock('../agents-server-process', () => ({getLocalAgentsServerUrl: () => null}))
vi.mock('../browser-blocklist', async () => {
  const actual = await vi.importActual<typeof import('../browser-blocklist')>('../browser-blocklist')
  actual.browserBlocklist.load = vi.fn()
  actual.browserBlocklist.refresh = vi.fn().mockResolvedValue(undefined)
  return actual
})
vi.mock('../browser-content-blocker', async () => {
  const actual = await vi.importActual<typeof import('../browser-content-blocker')>('../browser-content-blocker')
  actual.browserContentBlocker.initialize = vi.fn()
  actual.browserContentBlocker.refresh = vi.fn().mockResolvedValue(undefined)
  return actual
})
vi.mock('electron', async () => {
  const {EventEmitter} = await import('node:events')
  mocks.session = Object.assign(new EventEmitter(), {
    webRequest: Object.fromEntries(
      ['onBeforeRequest', 'onBeforeSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onCompleted'].map(
        (name) => [name, vi.fn()],
      ),
    ),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined),
    clearAuthCache: vi.fn().mockResolvedValue(undefined),
    closeAllConnections: vi.fn().mockResolvedValue(undefined),
  })
  mocks.app = Object.assign(new EventEmitter(), {
    commandLine: {hasSwitch: () => false},
    getPath: () => '/unused',
    configureHostResolver: vi.fn(),
  })
  class WebContentsView {
    webContents = mocks.guests.shift()
    setBounds = vi.fn()
    setVisible = vi.fn()
  }
  return {
    app: mocks.app,
    BrowserWindow: {fromWebContents: () => null},
    dialog: {},
    nativeTheme: new EventEmitter(),
    shell: {openExternal: vi.fn()},
    session: {fromPartition: () => mocks.session},
    webContents: {getAllWebContents: () => []},
    WebContentsView,
  }
})
import {setupWebBrowser} from '../app-web-browser'
import {insecureOrigins} from '../browser-https-policy'
import {clearBrowserData} from '../browser-session-policy'

type Load = {url: string; resolve: () => void; reject: (error: Error) => void}

/** A guest whose page loads the test completes by hand, with the URL it is on. */
function makeGuest() {
  const loads: Load[] = []
  const guest = Object.assign(new EventEmitter(), {
    id: mocks.nextGuestId++,
    url: 'about:blank',
    loads,
    session: mocks.session,
    stop: vi.fn(),
    reload: vi.fn(),
    close: vi.fn(() => guest.emit('destroyed')),
    isDestroyed: (): boolean => false,
    getURL: (): string => guest.url,
    getTitle: () => 'Title',
    loadURL: vi.fn((url: string) => new Promise<void>((resolve, reject) => loads.push({url, resolve, reject}))),
    setWindowOpenHandler: vi.fn(),
    setWebRTCIPHandlingPolicy: vi.fn(),
    navigationHistory: {
      getActiveIndex: (): number => 0,
      length: (): number => 0,
      getEntryAtIndex: vi.fn(),
      goToIndex: vi.fn(),
    },
  })
  return guest
}

function fixture() {
  const handlers = new Map<string, Function>()
  const ipc = Object.assign(new EventEmitter(), {handle: (name: string, fn: Function) => handlers.set(name, fn)})
  const host = Object.assign(new EventEmitter(), {
    ipc,
    mainFrame: {},
    isDestroyed: () => false,
    send: vi.fn(),
    getZoomFactor: () => 1,
  })
  const window = Object.assign(new EventEmitter(), {
    webContents: host,
    contentView: {addChildView: vi.fn(), removeChildView: vi.fn(), children: []},
    getContentSize: () => [1000, 700],
    isDestroyed: (): boolean => false,
  })
  setupWebBrowser(window as unknown as BrowserWindow, () => true)
  const event = {sender: host, senderFrame: host.mainFrame}
  const guest = makeGuest()
  mocks.guests.push(guest)
  expect(handlers.get('web-browser-create')!(event, {})).toEqual({browserId: guest.id})
  const events = () => host.send.mock.calls.map((call) => call[1])
  const locations = () => events().filter((sent) => sent.type === 'browser-location')
  const navigate = (url: string, requestId: number, historyIndex?: number) =>
    host.ipc.emit('web-browser-navigate', event, {browserId: guest.id, requestId, url, historyIndex})
  /** The page the guest was last asked to load; a Seed warning page is decoded for inspection. */
  const lastLoad = () => {
    const url = guest.loads.at(-1)!.url
    return url.startsWith('data:') ? decodeURIComponent(url.slice(url.indexOf(',') + 1)) : url
  }
  const commit = (url: string) => {
    guest.url = url
    guest.emit('did-navigate', {}, url)
  }
  const click = () => guest.emit('input-event', {}, {type: 'mouseDown'})
  const link = (url: string) => {
    const prevented = vi.fn()
    guest.emit('will-navigate', {preventDefault: prevented}, url, false, true)
    return prevented
  }
  const redirect = (url: string) => {
    const prevented = vi.fn()
    guest.emit('will-redirect', {preventDefault: prevented}, url, false, true)
    return prevented
  }
  return {handlers, event, host, guest, events, locations, navigate, lastLoad, commit, click, link, redirect}
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  insecureOrigins.normal.clear()
  insecureOrigins.private.clear()
})
afterEach(() => {
  vi.useRealTimers()
  mocks.guests.length = 0
})

it('tries https before a typed http address and shows the warning only when that fails', async () => {
  const {guest, host, navigate, lastLoad, commit, click, link, locations} = fixture()
  navigate('http://insecure.example/page?x=1', 1)
  expect(guest.loads.map((load) => load.url)).toEqual(['https://insecure.example/page?x=1'])
  // The failed attempt is not an error the user sees.
  guest.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'https://insecure.example/page?x=1', true)
  expect(host.send).not.toHaveBeenCalledWith('appWindowEvent', expect.objectContaining({type: 'browser-load-error'}))
  guest.loads[0]!.reject(new Error('ERR_CONNECTION_REFUSED (-102) loading'))
  await flush()
  expect(guest.loads).toHaveLength(2)
  expect(lastLoad()).toContain('insecure.example is not encrypted')
  expect(guest.loadURL).not.toHaveBeenCalledWith('http://insecure.example/page?x=1')
  // The warning stands in for the http address, and the pane is told the page is insecure.
  commit(guest.loads[1]!.url)
  expect(locations().at(-1)).toMatchObject({url: 'http://insecure.example/page?x=1', requestId: 1, insecure: true})
  // The button only works from the warning page after a real click.
  expect(link('seed-browser://allow-insecure')).toHaveBeenCalledOnce()
  expect(guest.loads).toHaveLength(2)
  click()
  expect(link('seed-browser://allow-insecure')).toHaveBeenCalledOnce()
  expect(guest.loads).toHaveLength(3)
  expect(lastLoad()).toBe('http://insecure.example/page?x=1')
  guest.loads[2]!.resolve()
  commit('http://insecure.example/page?x=1')
  expect(locations().at(-1)).toMatchObject({url: 'http://insecure.example/page?x=1', insecure: true})
  // The origin is remembered for the session: typed, linked, or restored pages load as http.
  navigate('http://insecure.example/other', 2)
  expect(lastLoad()).toBe('http://insecure.example/other')
  expect(link('http://insecure.example/third')).not.toHaveBeenCalled()
  // Another origin, and the same host on another port, still need their own consent.
  expect(link('http://other.example/')).toHaveBeenCalledOnce()
  expect(lastLoad()).toBe('https://other.example/')
  navigate('http://insecure.example:8080/', 3)
  expect(lastLoad()).toBe('https://insecure.example:8080/')
  // Clearing browsing data forgets the consent, even for a history entry.
  await clearBrowserData()
  guest.navigationHistory.length = () => 2
  guest.navigationHistory.getEntryAtIndex.mockReturnValue({url: 'http://insecure.example/page?x=1'})
  navigate('http://insecure.example/page?x=1', 4, 1)
  expect(guest.navigationHistory.goToIndex).not.toHaveBeenCalled()
  expect(lastLoad()).toBe('https://insecure.example/page?x=1')
})

it('never marks an http address that ends on https, and loads loopback and https as they are', async () => {
  const {guest, navigate, lastLoad, commit, locations} = fixture()
  navigate('http://redirecting.example/', 1)
  expect(lastLoad()).toBe('https://redirecting.example/')
  guest.loads[0]!.resolve()
  commit('https://www.redirecting.example/home')
  await flush()
  expect(guest.loads).toHaveLength(1)
  expect(locations().at(-1)).toMatchObject({url: 'https://www.redirecting.example/home', requestId: 1, insecure: false})
  navigate('http://localhost:3000/', 2)
  expect(lastLoad()).toBe('http://localhost:3000/')
  commit('http://localhost:3000/')
  expect(locations().at(-1)).toMatchObject({url: 'http://localhost:3000/', insecure: false})
  navigate('https://secure.example/', 3)
  expect(lastLoad()).toBe('https://secure.example/')
})

it('treats an encrypted attempt that redirects back to http as failed, without looping', async () => {
  const {guest, link, redirect, lastLoad} = fixture()
  guest.url = 'https://site.example/'
  expect(link('http://insecure.example/')).toHaveBeenCalledOnce()
  expect(lastLoad()).toBe('https://insecure.example/')
  expect(redirect('http://insecure.example/')).toHaveBeenCalledOnce()
  expect(lastLoad()).toContain('insecure.example is not encrypted')
  // The abandoned attempt's failure adds nothing.
  guest.loads[0]!.reject(new Error('ERR_ABORTED (-3) loading'))
  await flush()
  expect(guest.loads).toHaveLength(2)
})

it('gives an encrypted attempt ten seconds, then shows the warning', async () => {
  const {guest, navigate, lastLoad} = fixture()
  navigate('http://slow.example/', 1)
  await vi.advanceTimersByTimeAsync(9_000)
  expect(guest.loads).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(guest.stop).toHaveBeenCalledOnce()
  expect(lastLoad()).toContain('slow.example is not encrypted')
  guest.loads[0]!.reject(new Error('ERR_FAILED (-2) loading'))
  await flush()
  expect(guest.loads).toHaveLength(2)
})

it('shows no warning when the user stops or replaces the attempt', async () => {
  const {guest, host, event, navigate, lastLoad} = fixture()
  navigate('http://slow.example/', 1)
  host.ipc.emit('web-browser-control', event, {browserId: guest.id, action: 'stop'})
  guest.loads[0]!.reject(new Error('ERR_FAILED (-2) loading'))
  await flush()
  expect(guest.loads).toHaveLength(1)
  navigate('http://another.example/', 2)
  navigate('https://secure.example/', 3)
  guest.loads[1]!.reject(new Error('ERR_ABORTED (-3) loading'))
  await flush()
  expect(guest.loads).toHaveLength(3)
  expect(lastLoad()).toBe('https://secure.example/')
})

it('keeps private pages consent apart from normal pages', async () => {
  const {guest, handlers, event, host, click, link, lastLoad} = fixture()
  const privateGuest = makeGuest()
  mocks.guests.push(privateGuest)
  await expect(handlers.get('web-browser-create')!(event, {private: true})).resolves.toEqual({
    browserId: privateGuest.id,
  })
  // The normal page accepted the warning; the private page has not.
  host.ipc.emit('web-browser-navigate', event, {browserId: guest.id, requestId: 1, url: 'http://insecure.example/'})
  guest.loads[0]!.reject(new Error('ERR_CONNECTION_REFUSED'))
  await flush()
  guest.url = guest.loads[1]!.url
  click()
  link('seed-browser://allow-insecure')
  expect(lastLoad()).toBe('http://insecure.example/')
  host.ipc.emit('web-browser-navigate', event, {
    browserId: privateGuest.id,
    requestId: 2,
    url: 'http://insecure.example/',
  })
  expect(privateGuest.loads.at(-1)!.url).toBe('https://insecure.example/')
  privateGuest.loads.at(-1)!.reject(new Error('ERR_CONNECTION_REFUSED'))
  await flush()
  privateGuest.url = privateGuest.loads.at(-1)!.url
  privateGuest.emit('input-event', {}, {type: 'mouseDown'})
  privateGuest.emit('will-navigate', {preventDefault: vi.fn()}, 'seed-browser://allow-insecure', false, true)
  expect(privateGuest.loads.at(-1)!.url).toBe('http://insecure.example/')
  expect(insecureOrigins.private.allows('http://insecure.example/')).toBe(true)
  // Closing the private page erases its consent with the rest of its data.
  await handlers.get('web-browser-destroy')!(event, {browserId: privateGuest.id})
  expect(insecureOrigins.private.allows('http://insecure.example/')).toBe(false)
  expect(insecureOrigins.normal.allows('http://insecure.example/')).toBe(true)
})

it('refuses an agent navigation that would land on the warning, and shows it to the user', async () => {
  const {guest, handlers, event, navigate, lastLoad, commit} = fixture()
  navigate('https://site.example/', 1)
  guest.loads[0]!.resolve()
  commit('https://site.example/')
  const connectionId = 'c1'
  await handlers.get('browser-agent-access')!(event, {
    connectionId,
    browserId: guest.id,
    accountUid: 'a',
    enabled: true,
    origins: [
      {origin: 'https://site.example', level: 'act'},
      {origin: 'https://insecure.example', level: 'act'},
      {origin: 'http://insecure.example', level: 'act'},
    ],
  })
  const execution = handlers.get('browser-agent-execute')!(event, {
    connectionId,
    command: {action: 'navigate', document: 'd', url: 'http://insecure.example/'},
  })
  await vi.waitFor(() => expect(guest.loads).toHaveLength(2))
  expect(lastLoad()).toBe('https://insecure.example/')
  guest.loads[1]!.reject(new Error('ERR_CONNECTION_REFUSED'))
  await expect(execution).rejects.toThrow('allow the insecure site first')
  expect(lastLoad()).toContain('insecure.example is not encrypted')
  expect(guest.loadURL).not.toHaveBeenCalledWith('http://insecure.example/')
})
