// @vitest-environment node
import {EventEmitter} from 'node:events'
import type {WebContents, WebPreferences} from 'electron'
import {afterEach, expect, it, vi} from 'vitest'
const mocks = vi.hoisted(() => ({
  app: undefined as any,
  session: undefined as any,
  contents: [] as any[],
  save: vi.fn(),
}))
vi.mock('electron', async () => {
  const {EventEmitter} = await import('node:events')
  mocks.app = new EventEmitter()
  mocks.session = Object.assign(new EventEmitter(), {
    webRequest: {onBeforeRequest: vi.fn(), onResponseStarted: vi.fn(), onCompleted: vi.fn()},
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    clearStorageData: vi.fn(),
    clearCache: vi.fn(),
    clearAuthCache: vi.fn(),
    closeAllConnections: vi.fn(),
  })
  return {
    app: mocks.app,
    BrowserWindow: {fromWebContents: () => null},
    dialog: {showSaveDialogSync: mocks.save},
    session: {fromPartition: () => mocks.session},
    webContents: {getAllWebContents: () => mocks.contents},
  }
})
import {
  BrowserUserGesture,
  browserUserGesture,
  clearBrowserData,
  hardenBrowserPreferences,
  setupBrowserSessionPolicy,
} from '../browser-session-policy'

afterEach(() => vi.useRealTimers())
it('requires recent physical input and consumes it only once', () => {
  vi.useFakeTimers()
  const gesture = new BrowserUserGesture()
  expect(gesture.allowed()).toBe(false)
  gesture.record('mouseMove')
  expect(gesture.allowed()).toBe(false)
  gesture.record('touchStart')
  expect(gesture.consume()).toBe(true)
  expect(gesture.consume()).toBe(false)
  gesture.record('keyDown')
  vi.advanceTimersByTime(2001)
  expect(gesture.allowed()).toBe(false)
})
it('discards pre-existing and synthetic gestures during agent commands, including failures', async () => {
  const gesture = new BrowserUserGesture()
  gesture.record('mouseDown')
  await expect(
    gesture.runAgent(async () => {
      expect(gesture.allowed()).toBe(false)
      gesture.record('keyDown')
      expect(gesture.allowed()).toBe(false)
      throw new Error('command failed')
    }),
  ).rejects.toThrow('command failed')
  expect(gesture.allowed()).toBe(false)
  gesture.record('mouseDown')
  expect(gesture.allowed()).toBe(true)
})
it('removes every supplied preference before applying its allowlist', () => {
  const preferences = {
    preload: '/evil.js',
    additionalArguments: ['evil'],
    disableWebSecurity: true,
    experimentalFeatures: true,
    partition: 'persist:other',
    nodeIntegration: true,
  } as WebPreferences
  hardenBrowserPreferences(preferences)
  expect(preferences).toEqual({
    partition: 'persist:seed-web-browser',
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    safeDialogs: true,
  })
})
it('installs partition-scoped certificate rejection and gesture-gated native save dialogs once', () => {
  setupBrowserSessionPolicy()
  setupBrowserSessionPolicy()
  expect(mocks.session.listenerCount('will-download')).toBe(1)
  const event = {preventDefault: vi.fn()}
  const callback = vi.fn()
  mocks.app.emit('select-client-certificate', event, {session: {}}, '', [], callback)
  expect(callback).not.toHaveBeenCalled()
  mocks.app.emit('select-client-certificate', event, {session: mocks.session}, '', [{}], callback)
  expect(callback).toHaveBeenCalledWith()
  expect(event.preventDefault).toHaveBeenCalledOnce()
  const contents = new EventEmitter() as WebContents
  browserUserGesture(contents)
  const item = {getFilename: () => 'image.png', setSavePath: vi.fn()}
  mocks.save.mockReturnValue('/chosen/image.png')
  event.preventDefault.mockClear()
  mocks.session.emit('will-download', event, item, contents)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  contents.emit('input-event', {}, {type: 'mouseDown'})
  event.preventDefault.mockClear()
  mocks.session.emit('will-download', event, item, contents)
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(mocks.save).toHaveBeenCalledOnce()
  expect(item.setSavePath).toHaveBeenCalledWith('/chosen/image.png')
  mocks.session.emit('will-download', event, item, contents)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  contents.emit('input-event', {}, {type: 'mouseDown'})
  mocks.save.mockReturnValue(undefined)
  mocks.session.emit('will-download', event, item, contents)
  expect(event.preventDefault).toHaveBeenCalledTimes(2)
  expect(item.setSavePath).toHaveBeenCalledOnce()
})
it('clears only the browser partition and stops its active documents first', async () => {
  const guest = {session: mocks.session, stop: vi.fn(), loadURL: vi.fn(), navigationHistory: {clear: vi.fn()}}
  const host = {session: {}, stop: vi.fn(), loadURL: vi.fn()}
  mocks.contents = [guest, host]
  await clearBrowserData()
  expect(guest.stop).toHaveBeenCalledOnce()
  expect(guest.loadURL).toHaveBeenCalledWith('about:blank')
  expect(guest.navigationHistory.clear).toHaveBeenCalledOnce()
  expect(host.stop).not.toHaveBeenCalled()
  expect(mocks.session.clearStorageData).toHaveBeenCalledOnce()
  expect(mocks.session.clearCache).toHaveBeenCalledOnce()
})
