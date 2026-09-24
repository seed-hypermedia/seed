// @vitest-environment node
import {EventEmitter} from 'node:events'
import {beforeEach, expect, it, vi} from 'vitest'
import type {BrowserWindow, WebContents} from 'electron'
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  publicUrl: vi.fn(),
  networkCallbacks: {} as Record<string, Function>,
}))
vi.mock('../app-browser-agent', () => ({executeBrowserCommand: mocks.execute}))
vi.mock('../app-browser-favicon', () => ({readBrowserFavicons: async () => [], loadBrowserFavicon: async () => null}))
vi.mock('../browser-url-policy', () => ({assertPublicWebUrl: mocks.publicUrl, isPrivateHost: () => false}))
vi.mock('electron', async () => {
  const {EventEmitter} = await import('node:events')
  const session = Object.assign(new EventEmitter(), {
    webRequest: Object.fromEntries(
      ['onBeforeRequest', 'onResponseStarted', 'onCompleted'].map((name) => [
        name,
        (fn: Function) => {
          mocks.networkCallbacks[name] = fn
        },
      ]),
    ),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  })
  return {app: new EventEmitter(), nativeTheme: new EventEmitter(), session: {fromPartition: () => session}}
})
import {setupWebBrowser} from '../app-web-browser'

function fixture() {
  const handlers = new Map<string, Function>()
  const ipc = Object.assign(new EventEmitter(), {handle: (name: string, fn: Function) => handlers.set(name, fn)})
  const host = Object.assign(new EventEmitter(), {ipc, mainFrame: {}, isDestroyed: () => false, send: vi.fn()})
  const guest = Object.assign(new EventEmitter(), {
    id: 42,
    isDestroyed: () => false,
    getURL: () => 'https://example.com',
    getTitle: () => 'Example',
    loadURL: vi.fn().mockResolvedValue(undefined),
    setWindowOpenHandler: vi.fn(),
    navigationHistory: {getActiveIndex: () => 0, length: () => 0},
  })
  setupWebBrowser({webContents: host} as unknown as BrowserWindow, () => true)
  host.emit('did-attach-webview', {}, guest)
  const event = {sender: host, senderFrame: host.mainFrame}
  ipc.emit('web-browser-navigate', event, {browserId: 42, requestId: 1, url: 'https://example.com'})
  handlers.get('browser-agent-access')!(event, {
    connectionId: 'test',
    browserId: 42,
    accountUid: 'alice',
    enabled: true,
  })
  guest.loadURL.mockClear()
  return {
    host,
    guest,
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
it('rejects attaching frames other than the host main frame when exposed', () => {
  const {host} = fixture()
  const event = {preventDefault: vi.fn(), senderFrame: {}}
  host.emit('will-attach-webview', event, {}, {partition: 'persist:seed-web-browser', src: 'about:blank'})
  expect(event.preventDefault).toHaveBeenCalledOnce()
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
