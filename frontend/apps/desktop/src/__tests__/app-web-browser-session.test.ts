// @vitest-environment node
import {EventEmitter} from 'node:events'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import type {BrowserWindow} from 'electron'
// The web pane costs nothing until a user opts in: no filter engine, no cache files, no feed
// fetches, no app-wide DNS change. These tests pin when the session policy is installed.
const mocks = vi.hoisted(() => ({
  order: [] as string[],
  session: undefined as any,
  app: undefined as any,
  currentGuest: undefined as unknown,
  blockerInitialize: vi.fn(),
  blockerRefresh: vi.fn().mockResolvedValue(undefined),
  blocklistLoad: vi.fn(),
  blocklistRefresh: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../app-browser-agent', () => ({executeBrowserCommand: vi.fn()}))
vi.mock('../app-browser-favicon', () => ({readBrowserFavicons: async () => [], loadBrowserFavicon: async () => null}))
vi.mock('../app-store.mts', () => ({appStore: {get: vi.fn(), set: vi.fn()}}))
vi.mock('../agents-server-process', () => ({getLocalAgentsServerUrl: () => null}))
vi.mock('../browser-blocklist', async () => {
  const actual = await vi.importActual<typeof import('../browser-blocklist')>('../browser-blocklist')
  actual.browserBlocklist.load = mocks.blocklistLoad
  actual.browserBlocklist.refresh = mocks.blocklistRefresh
  return actual
})
vi.mock('../browser-content-blocker', async () => {
  const actual = await vi.importActual<typeof import('../browser-content-blocker')>('../browser-content-blocker')
  actual.browserContentBlocker.initialize = mocks.blockerInitialize
  actual.browserContentBlocker.refresh = mocks.blockerRefresh
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
    setPermissionRequestHandler: vi.fn(() => mocks.order.push('policy')),
    setPermissionCheckHandler: vi.fn(),
  })
  mocks.app = Object.assign(new EventEmitter(), {
    commandLine: {hasSwitch: () => false},
    getPath: () => '/unused',
    configureHostResolver: vi.fn(),
  })
  class WebContentsView {
    constructor() {
      mocks.order.push('view')
    }
    webContents = mocks.currentGuest
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

function fixture(enabled: () => boolean) {
  const handlers = new Map<string, Function>()
  const ipc = Object.assign(new EventEmitter(), {handle: (name: string, fn: Function) => handlers.set(name, fn)})
  const host = Object.assign(new EventEmitter(), {
    ipc,
    mainFrame: {},
    isDestroyed: () => false,
    send: vi.fn(),
    getZoomFactor: () => 1,
  })
  const guest = Object.assign(new EventEmitter(), {
    id: 7,
    session: mocks.session,
    stop: vi.fn(),
    close: vi.fn(() => guest.emit('destroyed')),
    isDestroyed: (): boolean => false,
    getURL: (): string => 'about:blank',
    getTitle: () => '',
    loadURL: vi.fn().mockResolvedValue(undefined),
    setWindowOpenHandler: vi.fn(),
    setWebRTCIPHandlingPolicy: vi.fn(),
    navigationHistory: {getActiveIndex: () => 0, length: () => 0},
  })
  const window = Object.assign(new EventEmitter(), {
    webContents: host,
    contentView: {addChildView: vi.fn(), removeChildView: vi.fn(), children: []},
    getContentSize: () => [1000, 700],
    isDestroyed: (): boolean => false,
  })
  mocks.currentGuest = guest
  setupWebBrowser(window as unknown as BrowserWindow, enabled)
  const event = {sender: host, senderFrame: host.mainFrame}
  return {handlers, event, window, host}
}
function expectNothingInstalled() {
  expect(mocks.session.setPermissionRequestHandler).not.toHaveBeenCalled()
  expect(mocks.session.webRequest.onBeforeRequest).not.toHaveBeenCalled()
  expect(mocks.session.listenerCount('will-download')).toBe(0)
  expect(mocks.app.configureHostResolver).not.toHaveBeenCalled()
  expect(mocks.blocklistLoad).not.toHaveBeenCalled()
  expect(mocks.blocklistRefresh).not.toHaveBeenCalled()
  expect(mocks.blockerInitialize).not.toHaveBeenCalled()
  expect(mocks.blockerRefresh).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.order.length = 0
})
afterEach(() => vi.useRealTimers())

it('opens a window for a user who left the web browser off without touching the browser session', () => {
  let enabled = false
  const {handlers, event, window, host} = fixture(() => enabled)
  expectNothingInstalled()
  // The pane's IPC is wired so it can appear later, but asking for a page is refused and installs nothing.
  expect(() => handlers.get('web-browser-create')!(event, {})).toThrow('The web browser is disabled')
  expectNothingInstalled()
  // Leaving the web route and closing the window never assumed the policy was there.
  host.ipc.emit('windowNavState', {sender: host}, {routes: [{key: 'document'}], routeIndex: 0})
  window.emit('closed')
  expectNothingInstalled()
  expect(window.contentView.addChildView).not.toHaveBeenCalled()
  enabled = true
})

it('installs the session policy on the first page request, before the guest view exists', () => {
  let enabled = true
  const {handlers, event, window} = fixture(() => enabled)
  expectNothingInstalled()
  expect(handlers.get('web-browser-create')!(event, {})).toEqual({browserId: 7})
  expect(mocks.order).toEqual(['policy', 'view'])
  expect(mocks.session.webRequest.onBeforeRequest).toHaveBeenCalled()
  expect(mocks.app.configureHostResolver).toHaveBeenCalledWith({secureDnsMode: 'automatic'})
  expect(mocks.blocklistLoad).toHaveBeenCalledOnce()
  expect(mocks.blocklistRefresh).toHaveBeenCalledOnce()
  expect(mocks.blockerInitialize).toHaveBeenCalledOnce()
  expect(mocks.blockerRefresh).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(1)
  // A second page in the same partition reuses the installed policy.
  handlers.get('web-browser-create')!(event, {})
  expect(mocks.session.setPermissionRequestHandler).toHaveBeenCalledOnce()
  // Turning the browser off afterwards hides the guest without disturbing the installed policy.
  enabled = false
  expect(() => handlers.get('web-browser-create')!(event, {})).toThrow('The web browser is disabled')
  window.emit('closed')
})
