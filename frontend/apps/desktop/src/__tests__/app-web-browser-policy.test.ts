// @vitest-environment node
import {EventEmitter} from 'node:events'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import type {BrowserWindow, WebContents} from 'electron'
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  publicUrl: vi.fn(),
  networkCallbacks: {} as Record<string, Function>,
  currentGuest: undefined as unknown,
  preferences: [] as Electron.WebPreferences[],
  session: undefined as any,
}))
vi.mock('../app-browser-agent', () => ({executeBrowserCommand: mocks.execute}))
vi.mock('../app-browser-favicon', () => ({readBrowserFavicons: async () => [], loadBrowserFavicon: async () => null}))
vi.mock('../browser-url-policy', async () => ({
  ...(await vi.importActual<typeof import('../browser-url-policy')>('../browser-url-policy')),
  assertPublicWebUrl: mocks.publicUrl,
}))
vi.mock('electron', async () => {
  const {EventEmitter} = await import('node:events')
  const session = Object.assign(new EventEmitter(), {
    webRequest: Object.fromEntries(
      ['onBeforeRequest', 'onBeforeSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onCompleted'].map(
        (name) => [
          name,
          (fn: Function) => {
            mocks.networkCallbacks[name] = fn
          },
        ],
      ),
    ),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  })
  mocks.session = session
  Object.assign(session, {
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn(),
    clearAuthCache: vi.fn(),
    closeAllConnections: vi.fn(),
  })
  class WebContentsView {
    constructor(options: {webPreferences: Electron.WebPreferences}) {
      mocks.preferences.push(options.webPreferences)
    }
    webContents = mocks.currentGuest
    setBounds = vi.fn()
    setVisible = vi.fn()
  }
  return {
    app: Object.assign(new EventEmitter(), {commandLine: {hasSwitch: () => false}}),
    nativeTheme: new EventEmitter(),
    session: {fromPartition: () => session},
    WebContentsView,
  }
})
import {setupWebBrowser} from '../app-web-browser'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

function fixture() {
  const handlers = new Map<string, Function>()
  const ipc = Object.assign(new EventEmitter(), {handle: (name: string, fn: Function) => handlers.set(name, fn)})
  const host = Object.assign(new EventEmitter(), {ipc, mainFrame: {}, isDestroyed: () => false, send: vi.fn()})
  const guest = Object.assign(new EventEmitter(), {
    id: 42,
    session: mocks.session,
    stop: vi.fn(),
    reload: vi.fn(),
    executeJavaScript: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(() => guest.emit('destroyed')),
    isDestroyed: (): boolean => false,
    getURL: () => 'https://example.com',
    getTitle: () => 'Example',
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
  setupWebBrowser(window as unknown as BrowserWindow, () => true)
  const event = {sender: host, senderFrame: host.mainFrame}
  expect(handlers.get('web-browser-create')!(event)).toEqual({browserId: 42})
  expect(window.contentView.addChildView).toHaveBeenCalledOnce()
  ipc.emit('web-browser-navigate', event, {browserId: 42, requestId: 1, url: 'https://example.com'})
  handlers.get('browser-agent-access')!(event, {
    connectionId: 'test',
    browserId: 42,
    accountUid: 'alice',
    enabled: true,
    origins: ['https://example.com'],
  })
  guest.loadURL.mockClear()
  cleanup.push(async () => {
    window.emit('closed')
    await handlers.get('web-browser-destroy')!(event, {browserId: -1})
  })
  return {
    host,
    guest,
    handlers,
    event,
    window,
    execute: () => handlers.get('browser-agent-execute')!(event, {connectionId: 'test', command: {action: 'snapshot'}}),
  }
}
beforeEach(() => vi.clearAllMocks())
it('silently cancels automatic native navigations and redirects; accepts a recent click', () => {
  const {host, guest} = fixture()
  const event = {preventDefault: vi.fn()}
  guest.emit('will-navigate', event, 'hm://alice/docs')
  guest.emit('will-redirect', event, 'hm://alice/docs')
  expect(event.preventDefault).toHaveBeenCalledTimes(2)
  expect(host.send).not.toHaveBeenCalled()
  guest.emit('input-event', {}, {type: 'mouseDown'})
  guest.emit('will-navigate', event, 'hm://alice/docs')
  expect(host.send).toHaveBeenCalledWith('appWindowEvent', {
    type: 'browser-open-url',
    browserId: 42,
    url: 'hm://alice/docs',
  })
})
it('denies popups without input, including popups and native routes during agent execution', async () => {
  const {host, guest, execute} = fixture()
  const popup = guest.setWindowOpenHandler.mock.calls[0]![0]
  expect(popup({url: 'https://example.com/popup'})).toEqual({action: 'deny'})
  expect(host.send).not.toHaveBeenCalled()
  guest.emit('before-input-event', {preventDefault: vi.fn()}, {type: 'keyDown', key: 'Enter'})
  mocks.execute.mockImplementation(async () => {
    guest.emit('input-event', {}, {type: 'keyDown'})
    popup({url: 'hm://alice/docs'})
    guest.emit('will-redirect', {preventDefault: vi.fn()}, 'hm://alice/docs')
  })
  await execute()
  expect(host.send).not.toHaveBeenCalled()
  guest.emit('input-event', {}, {type: 'mouseDown'})
  popup({url: 'https://example.com/popup'})
  expect(host.send).toHaveBeenCalledOnce()
})
it('awaits public URL validation before issuing an agent navigation', async () => {
  const {guest, execute} = fixture()
  mocks.execute.mockImplementation((_guest: WebContents, _command, options) =>
    options.navigate('https://example.com/next'),
  )
  mocks.publicUrl.mockRejectedValueOnce(new Error('private'))
  await expect(execute()).rejects.toThrow('private')
  expect(guest.loadURL).not.toHaveBeenCalled()
  mocks.publicUrl.mockResolvedValueOnce(undefined)
  await execute()
  expect(guest.loadURL).toHaveBeenCalledWith('https://example.com/next')
})
it('only the host main frame can create a guest, and one guest serves the window', () => {
  const {host, handlers, event, window} = fixture()
  expect(() => handlers.get('web-browser-create')!({sender: host, senderFrame: {}})).toThrow('Invalid browser host')
  expect(handlers.get('web-browser-create')!(event)).toEqual({browserId: 42})
  expect(window.contentView.addChildView).toHaveBeenCalledOnce()
})

it('refuses commands and in-flight results from a rebound document', async () => {
  const {guest, execute} = fixture()
  const markPrivate = () => {
    const response = {id: 77, webContentsId: 42, resourceType: 'mainFrame', url: 'https://example.com', ip: '127.0.0.1'}
    guest.emit('did-start-navigation', {}, response.url, false, true)
    mocks.networkCallbacks.onBeforeRequest!(response, () => {})
    mocks.networkCallbacks.onResponseStarted!(response)
    guest.emit('did-navigate', {}, response.url)
  }
  mocks.execute.mockImplementation(async () => {
    markPrivate()
    return {text: 'private page contents'}
  })
  await expect(execute()).rejects.toThrow('private network')
  mocks.execute.mockClear()
  await expect(execute()).rejects.toThrow('private network')
  expect(mocks.execute).not.toHaveBeenCalled()
})

it('keeps public pages off the local network, while local pages may link locally', () => {
  const {host, guest} = fixture()
  const event = {preventDefault: vi.fn()}
  guest.emit('will-navigate', event, 'http://127.0.0.1:5173/admin')
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(host.send).toHaveBeenCalledWith(
    'appWindowEvent',
    expect.objectContaining({type: 'browser-load-error', description: expect.stringContaining('private network')}),
  )
  const cancel = vi.fn()
  mocks.networkCallbacks.onBeforeRequest!(
    {id: 1, url: 'http://192.168.1.1/pixel.png', frame: {url: 'https://example.com/'}, resourceType: 'image'},
    cancel,
  )
  expect(cancel).toHaveBeenCalledWith({cancel: true})
  const allow = vi.fn()
  mocks.networkCallbacks.onBeforeRequest!(
    {id: 2, url: 'http://192.168.1.1/pixel.png', frame: {url: 'http://localhost:3000/'}, resourceType: 'image'},
    allow,
  )
  expect(allow).toHaveBeenCalledWith({})
  const typed = vi.fn()
  mocks.networkCallbacks.onBeforeRequest!(
    {id: 3, url: 'http://127.0.0.1:3000/', frame: {url: 'https://example.com/'}, resourceType: 'mainFrame'},
    typed,
  )
  expect(typed).toHaveBeenCalledWith({})
  ;(guest as {getURL: () => string}).getURL = () => 'http://localhost:3000/'
  event.preventDefault.mockClear()
  guest.emit('will-navigate', event, 'http://localhost:3000/next')
  expect(event.preventDefault).not.toHaveBeenCalled()
})

it('keeps one private guest per window, erases it on close, and preserves the normal guest', async () => {
  const {guest, handlers, event, host} = fixture()
  const privateGuest = Object.assign(new EventEmitter(), guest, {id: 43})
  privateGuest.removeAllListeners()
  privateGuest.close = vi.fn(() => privateGuest.emit('destroyed'))
  mocks.currentGuest = privateGuest
  expect(await handlers.get('web-browser-create')!(event, {private: true})).toEqual({browserId: 43})
  expect(await handlers.get('web-browser-create')!(event, {private: true})).toEqual({browserId: 43})
  expect(mocks.preferences.at(-1)?.partition).toBe('seed-web-private')
  expect(handlers.get('web-browser-create')!(event)).toEqual({browserId: 42})
  await handlers.get('web-browser-destroy')!(event, {browserId: 43})
  expect(privateGuest.close).toHaveBeenCalledWith({waitForBeforeUnload: false})
  expect(mocks.session.clearStorageData).toHaveBeenCalledOnce()
  expect(guest.close).not.toHaveBeenCalled()
  expect(() => handlers.get('web-browser-destroy')!({sender: host, senderFrame: {}}, {browserId: 42})).toThrow(
    'Invalid browser host',
  )
})
it('destroys a private guest when the window leaves the web route', async () => {
  const {guest, handlers, event, host} = fixture()
  const privateGuest = Object.assign(new EventEmitter(), guest, {id: 43})
  privateGuest.removeAllListeners()
  privateGuest.close = vi.fn(() => privateGuest.emit('destroyed'))
  mocks.currentGuest = privateGuest
  await handlers.get('web-browser-create')!(event, {private: true})
  host.ipc.emit('windowNavState', event, {routes: [{key: 'contacts'}], routeIndex: 0})
  await handlers.get('web-browser-destroy')!(event, {browserId: 43})
  expect(privateGuest.close).toHaveBeenCalledOnce()
  expect(mocks.session.clearStorageData).toHaveBeenCalledOnce()
})

it('reports the native dialog origin and preserves Electron dialog handling', () => {
  const {guest, host} = fixture()
  const callback = vi.fn()
  guest.emit('-run-dialog', {frame: {origin: 'https://iframe.example'}, dialogType: 'alert'}, callback)
  expect(host.send).toHaveBeenCalledWith('appWindowEvent', {
    type: 'browser-dialog',
    browserId: 42,
    origin: 'https://iframe.example',
  })
  expect(callback).not.toHaveBeenCalled()
})
it('exits unexpected HTML fullscreen without expanding the guest', () => {
  const {guest, host, window} = fixture()
  const view = window.contentView.addChildView.mock.calls[0]![0]
  const boundsCalls = view.setBounds.mock.calls.length
  guest.emit('enter-html-full-screen')
  expect(view.setVisible).toHaveBeenLastCalledWith(false)
  expect(view.setBounds).toHaveBeenCalledTimes(boundsCalls)
  expect(guest.executeJavaScript).toHaveBeenCalledWith('document.exitFullscreen()')
  expect(host.send).toHaveBeenCalledWith(
    'appWindowEvent',
    expect.objectContaining({type: 'browser-load-error', description: expect.stringContaining('Fullscreen')}),
  )
})
it('reports a renderer crash without reloading until the user asks', () => {
  const {guest, host, event} = fixture()
  guest.emit('render-process-gone', {}, {reason: 'crashed'})
  expect(guest.reload).not.toHaveBeenCalled()
  expect(guest.loadURL).not.toHaveBeenCalled()
  expect(host.send).toHaveBeenCalledWith('appWindowEvent', expect.objectContaining({type: 'browser-load-error'}))
  host.ipc.emit('web-browser-control', event, {browserId: 42, action: 'reload'})
  expect(guest.reload).toHaveBeenCalledOnce()
})
it('refuses another guest while two views still occupy the window', async () => {
  const {guest, handlers, event, window} = fixture()
  const privateGuest = Object.assign(new EventEmitter(), guest, {id: 43})
  privateGuest.removeAllListeners()
  privateGuest.close = vi.fn(() => privateGuest.emit('destroyed'))
  mocks.currentGuest = privateGuest
  await handlers.get('web-browser-create')!(event, {private: true})
  // A destroyed renderer can still have a view awaiting its destroyed notification.
  guest.isDestroyed = () => true
  expect(() => handlers.get('web-browser-create')!(event)).toThrow('at most two browser pages')
  expect(window.contentView.addChildView).toHaveBeenCalledTimes(2)
  await handlers.get('web-browser-destroy')!(event, {browserId: 43})
})

it('waits for private storage erasure before reopening', async () => {
  const {guest, handlers, event, window} = fixture()
  const privateGuest = Object.assign(new EventEmitter(), guest, {id: 43})
  privateGuest.removeAllListeners()
  privateGuest.close = vi.fn(() => privateGuest.emit('destroyed'))
  mocks.currentGuest = privateGuest
  await handlers.get('web-browser-create')!(event, {private: true})
  let finish!: () => void
  mocks.session.clearStorageData.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve
    }),
  )
  const closed = handlers.get('web-browser-destroy')!(event, {browserId: 43})
  const reopened = Object.assign(new EventEmitter(), guest, {id: 44})
  reopened.removeAllListeners()
  reopened.close = vi.fn(() => reopened.emit('destroyed'))
  mocks.currentGuest = reopened
  const created = handlers.get('web-browser-create')!(event, {private: true})
  await Promise.resolve()
  expect(window.contentView.addChildView).toHaveBeenCalledTimes(2)
  finish()
  await closed
  expect(await created).toEqual({browserId: 44})
})
it('cancels pending private creation when the user leaves the web route', async () => {
  const {handlers, event, host, window} = fixture()
  const pending = handlers.get('web-browser-create')!(event, {private: true})
  host.ipc.emit('windowNavState', event, {routes: [{key: 'contacts'}], routeIndex: 0})
  await expect(pending).rejects.toThrow('private page was closed')
  expect(window.contentView.addChildView).toHaveBeenCalledOnce()
})
