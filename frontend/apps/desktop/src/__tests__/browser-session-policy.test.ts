// @vitest-environment node
import {EventEmitter} from 'node:events'
import type {WebContents, WebPreferences} from 'electron'
import {afterEach, expect, it, vi} from 'vitest'
const mocks = vi.hoisted(() => ({
  app: undefined as any,
  session: undefined as any,
  sessions: new Map<string, any>(),
  contents: [] as any[],
  save: vi.fn(),
  message: vi.fn(),
}))
vi.mock('electron', async () => {
  const {EventEmitter} = await import('node:events')
  mocks.app = Object.assign(new EventEmitter(), {
    configureHostResolver: vi.fn(),
    commandLine: {hasSwitch: vi.fn(() => false)},
  })
  const makeSession = () =>
    Object.assign(new EventEmitter(), {
      webRequest: {
        onBeforeRequest: vi.fn(),
        onBeforeSendHeaders: vi.fn(),
        onHeadersReceived: vi.fn(),
        onResponseStarted: vi.fn(),
        onCompleted: vi.fn(),
      },
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      clearStorageData: vi.fn(),
      clearCache: vi.fn(),
      clearAuthCache: vi.fn(),
      closeAllConnections: vi.fn(),
    })
  mocks.session = makeSession()
  mocks.sessions.set('persist:seed-web-browser', mocks.session)
  return {
    app: mocks.app,
    BrowserWindow: {fromWebContents: () => null},
    dialog: {showSaveDialogSync: mocks.save, showMessageBoxSync: mocks.message},
    session: {
      fromPartition: (partition: string) => {
        if (!mocks.sessions.has(partition)) mocks.sessions.set(partition, makeSession())
        return mocks.sessions.get(partition)
      },
    },
    webContents: {getAllWebContents: () => mocks.contents},
  }
})
import {
  BrowserUserGesture,
  browserUserGesture,
  clearBrowserData,
  hardenBrowserPreferences,
  hardenGuestWebContents,
  isDangerousDownload,
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
    safeDialogsMessage: 'Prevent this page from showing more dialogs',
    disableHtmlFullscreenWindowResize: true,
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
it('refuses bad certificates for the browser partition only, sends GPC, and asks for encrypted DNS', () => {
  setupBrowserSessionPolicy()
  const event = {preventDefault: vi.fn()}
  const callback = vi.fn()
  mocks.app.emit('certificate-error', event, {session: {}}, 'https://a.example', 'ERR', {}, callback)
  expect(callback).not.toHaveBeenCalled()
  expect(event.preventDefault).not.toHaveBeenCalled()
  mocks.app.emit('certificate-error', event, {session: mocks.session}, 'https://a.example', 'ERR', {}, callback)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(callback).toHaveBeenCalledWith(false)
  const beforeSend = mocks.session.webRequest.onBeforeSendHeaders.mock.calls[0]![0]
  const respond = vi.fn()
  beforeSend({requestHeaders: {Accept: '*/*'}}, respond)
  expect(respond).toHaveBeenCalledWith({requestHeaders: {Accept: '*/*', 'Sec-GPC': '1'}})
  expect(mocks.app.configureHostResolver).toHaveBeenCalledWith({secureDnsMode: 'automatic'})
})
it('keeps WebRTC on the public interface for every guest', () => {
  const guest = {setWebRTCIPHandlingPolicy: vi.fn()} as unknown as WebContents
  hardenGuestWebContents(guest)
  expect(guest.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('default_public_interface_only')
})
it('asks twice before saving a file that can run programs', () => {
  expect(isDangerousDownload('setup.EXE')).toBe(true)
  expect(isDangerousDownload('notes.txt')).toBe(false)
  expect(isDangerousDownload('archive.tar.gz')).toBe(false)
  setupBrowserSessionPolicy()
  const contents = new EventEmitter() as WebContents
  browserUserGesture(contents)
  const event = {preventDefault: vi.fn()}
  const item = {getFilename: () => 'tool.dmg', getURL: () => 'https://downloads.example/tool.dmg', setSavePath: vi.fn()}
  mocks.message.mockReturnValue(0)
  mocks.save.mockClear()
  contents.emit('input-event', {}, {type: 'mouseDown'})
  mocks.session.emit('will-download', event, item, contents)
  expect(mocks.message).toHaveBeenCalledOnce()
  expect(mocks.message.mock.calls[0]![0].message).toContain('downloads.example')
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(mocks.save).not.toHaveBeenCalled()
  mocks.message.mockReturnValue(1)
  mocks.save.mockReturnValue('/chosen/tool.dmg')
  contents.emit('input-event', {}, {type: 'mouseDown'})
  mocks.session.emit('will-download', event, item, contents)
  expect(mocks.save).toHaveBeenCalledOnce()
  expect(item.setSavePath).toHaveBeenCalledWith('/chosen/tool.dmg')
})

it('installs identical policies once on both partitions and selects memory-only preferences', () => {
  setupBrowserSessionPolicy()
  setupBrowserSessionPolicy('seed-web-private')
  setupBrowserSessionPolicy('seed-web-private')
  const privateSession = mocks.sessions.get('seed-web-private')
  expect(privateSession).not.toBe(mocks.session)
  for (const session of [mocks.session, privateSession]) {
    expect(session.listenerCount('will-download')).toBe(1)
    expect(session.setPermissionRequestHandler).toHaveBeenCalledOnce()
    expect(session.setPermissionCheckHandler).toHaveBeenCalledOnce()
    expect(session.webRequest.onBeforeSendHeaders).toHaveBeenCalledOnce()
    expect(session.webRequest.onHeadersReceived).toHaveBeenCalledOnce()
    const callback = vi.fn()
    mocks.app.emit('certificate-error', {preventDefault: vi.fn()}, {session}, '', '', {}, callback)
    expect(callback).toHaveBeenCalledWith(false)
  }
  const preferences: WebPreferences = {}
  hardenBrowserPreferences(preferences, true)
  expect(preferences.partition).toBe('seed-web-private')
  expect(preferences.sandbox).toBe(true)
})

it('denies permissions by default, prompts for clipboard writes only after real guest input', async () => {
  setupBrowserSessionPolicy()
  const request = mocks.session.setPermissionRequestHandler.mock.calls[0][0]
  const check = mocks.session.setPermissionCheckHandler.mock.calls[0][0]
  const guest = Object.assign(new EventEmitter(), {
    getURL: () => 'https://example.com/page',
    isDestroyed: () => false,
  }) as unknown as WebContents
  browserUserGesture(guest)
  const callback = vi.fn()
  const details = {requestingUrl: 'https://example.com/page', isMainFrame: true}
  mocks.message.mockClear().mockReturnValue(1)
  for (const permission of ['fullscreen', 'geolocation', 'media', 'clipboard-read', 'clipboard-sanitized-write']) {
    request(guest, permission, callback, details)
    expect(callback).toHaveBeenLastCalledWith(false)
    expect(check(guest, permission)).toBe(false)
  }
  expect(mocks.message).not.toHaveBeenCalled()
  guest.emit('input-event', {}, {type: 'mouseDown'})
  request(guest, 'clipboard-sanitized-write', callback, details)
  expect(callback).toHaveBeenLastCalledWith(true)
  expect(mocks.message).toHaveBeenCalledWith(
    expect.objectContaining({message: 'Allow https://example.com to copy to your clipboard?'}),
  )
  request(guest, 'clipboard-sanitized-write', callback, details)
  expect(callback).toHaveBeenLastCalledWith(false)
  mocks.message.mockReturnValue(0)
  guest.emit('input-event', {}, {type: 'mouseDown'})
  request(guest, 'clipboard-sanitized-write', callback, details)
  expect(callback).toHaveBeenLastCalledWith(false)
  mocks.message.mockClear()
  await browserUserGesture(guest).runAgent(async () => {
    guest.emit('input-event', {}, {type: 'mouseDown'})
    request(guest, 'clipboard-sanitized-write', callback, details)
  })
  expect(callback).toHaveBeenLastCalledWith(false)
  expect(mocks.message).not.toHaveBeenCalled()
  guest.emit('input-event', {}, {type: 'mouseDown'})
  request(guest, 'fullscreen', callback, details)
  expect(callback).toHaveBeenLastCalledWith(false)
  expect(mocks.message).not.toHaveBeenCalled()
})
it.each([false, true])('checks the site isolation switch once (disabled=%s)', async (disabled) => {
  vi.resetModules()
  mocks.app.commandLine.hasSwitch.mockClear().mockReturnValue(disabled)
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const policy = await import('../browser-session-policy')
  policy.setupBrowserSessionPolicy()
  policy.setupBrowserSessionPolicy('seed-web-private')
  expect(mocks.app.commandLine.hasSwitch).toHaveBeenCalledExactlyOnceWith('disable-site-isolation-trials')
  expect(warning).toHaveBeenCalledTimes(disabled ? 1 : 0)
  warning.mockRestore()
})
