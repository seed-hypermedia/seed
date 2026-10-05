// @vitest-environment node
import {EventEmitter} from 'node:events'
import {beforeEach, expect, it, vi} from 'vitest'
import type {BrowserWindow, WebContents} from 'electron'
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  publicUrl: vi.fn(),
  networkCallbacks: {} as Record<string, Function>,
  currentGuest: undefined as unknown,
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
      ['onBeforeRequest', 'onBeforeSendHeaders', 'onResponseStarted', 'onCompleted'].map((name) => [
        name,
        (fn: Function) => {
          mocks.networkCallbacks[name] = fn
        },
      ]),
    ),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  })
  class WebContentsView {
    webContents = mocks.currentGuest
    setBounds = vi.fn()
    setVisible = vi.fn()
  }
  return {
    app: new EventEmitter(),
    nativeTheme: new EventEmitter(),
    session: {fromPartition: () => session},
    WebContentsView,
  }
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
    setWebRTCIPHandlingPolicy: vi.fn(),
    navigationHistory: {getActiveIndex: () => 0, length: () => 0},
  })
  const window = Object.assign(new EventEmitter(), {
    webContents: host,
    contentView: {addChildView: vi.fn(), removeChildView: vi.fn(), children: []},
    getContentSize: () => [1000, 700],
    isDestroyed: () => false,
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
    origins: [{origin: 'https://example.com', level: 'act'}],
  })
  guest.loadURL.mockClear()
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

it('allows reading and scrolling but refuses every action until upgraded', async () => {
  const {handlers, event} = fixture()
  const grant = {connectionId: 'test', browserId: 42, accountUid: 'alice', enabled: true}
  const access = handlers.get('browser-agent-access')!
  const execute = handlers.get('browser-agent-execute')!
  access(event, {...grant, origins: [{origin: 'https://example.com', level: 'read'}]})
  mocks.execute.mockResolvedValue({ok: true})
  for (const action of ['snapshot', 'screenshot', 'scroll']) {
    await expect(execute(event, {connectionId: 'test', command: {action}})).resolves.toEqual({ok: true})
  }
  mocks.execute.mockClear()
  for (const action of ['click', 'type', 'press', 'navigate', 'archive']) {
    await expect(execute(event, {connectionId: 'test', command: {action}})).rejects.toThrow(
      'The user allowed reading this website but not acting on it; ask them to allow actions',
    )
  }
  expect(mocks.execute).not.toHaveBeenCalled()
  access(event, {...grant, origins: [{origin: 'https://example.com', level: 'act'}]})
  await expect(execute(event, {connectionId: 'test', command: {action: 'click'}})).resolves.toEqual({ok: true})
})

it('can open an approved read-only destination without granting actions there', async () => {
  const {handlers, event, guest} = fixture()
  handlers.get('browser-agent-access')!(event, {
    connectionId: 'test',
    browserId: 42,
    accountUid: 'alice',
    enabled: true,
    origins: [
      {origin: 'https://example.com', level: 'act'},
      {origin: 'https://other.example', level: 'read'},
    ],
  })
  mocks.execute.mockImplementation(async (_guest, _command, options) => {
    options.assertOrigin('https://other.example')
    guest.getURL = () => 'https://other.example'
    options.assertActive()
    return {ok: true}
  })
  const execute = handlers.get('browser-agent-execute')!
  await expect(execute(event, {connectionId: 'test', command: {action: 'navigate'}})).resolves.toEqual({ok: true})
  await expect(execute(event, {connectionId: 'test', command: {action: 'click'}})).rejects.toThrow('not acting on it')
})
