import {shell, type BrowserWindow, type Session, type WebContents} from 'electron'
import {EventEmitter} from 'node:events'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  installAppSessionGuards,
  installWindowGuards,
  openAppExternalLink,
  recentInputWindow,
} from '../app-window-security'
import type {AppWindowPolicy} from '../app-window-policy'

vi.mock('electron', () => ({shell: {openExternal: vi.fn()}}))

const policy: AppWindowPolicy = {
  appOrigin: 'http://localhost:17654',
  daemonOrigin: 'http://localhost:56001',
  fileOrigin: 'http://localhost:56001',
  connectOrigins: [],
  development: false,
}

function install(activated = false) {
  const session = {
    setPermissionCheckHandler: vi.fn<Session['setPermissionCheckHandler']>(),
    setPermissionRequestHandler: vi.fn<Session['setPermissionRequestHandler']>(),
    webRequest: {onHeadersReceived: vi.fn()},
  }
  const contents = {
    getURL: () => `${policy.appOrigin}/index.html`,
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValue(activated),
  }
  installAppSessionGuards(session as unknown as Session, policy)
  return {
    contents: contents as unknown as WebContents,
    check: session.setPermissionCheckHandler.mock.calls[0]![0]!,
    request: session.setPermissionRequestHandler.mock.calls[0]![0]!,
    headers: session.webRequest.onHeadersReceived.mock.calls[0]![0],
  }
}

describe('default-session permissions', () => {
  it.each(['mediaKeySystem', 'media', 'notifications', 'geolocation', 'midi', 'pointerLock'] as const)(
    'denies %s even for an activated app main frame',
    (permission) => {
      const {contents, check, request} = install(true)
      const details = {isMainFrame: true, requestingUrl: contents.getURL()}
      expect(check(contents, permission, policy.appOrigin!, details)).toBe(false)
      const callback = vi.fn()
      request(contents, permission, callback, details)
      expect(callback).toHaveBeenCalledWith(false)
    },
  )

  it('requires app main-frame activation for clipboard reads and external protocols', async () => {
    for (const activated of [false, true]) {
      const {contents, request} = install(activated)
      for (const isMainFrame of [false, true]) {
        const details = {isMainFrame, requestingUrl: contents.getURL()}
        const clipboard = await new Promise<boolean>((resolve) => request(contents, 'clipboard-read', resolve, details))
        expect(clipboard).toBe(activated && isMainFrame)
        for (const externalURL of [
          'https://example.com',
          'http://example.com',
          'mailto:a@example.com',
          'file:///tmp/a',
          'custom:launch',
        ]) {
          const allowed = await new Promise<boolean>((resolve) =>
            request(contents, 'openExternal', resolve, {...details, externalURL}),
          )
          expect(allowed).toBe(activated && isMainFrame && /^(https?:|mailto:)/.test(externalURL))
        }
      }
    }
  })

  it('denies hostile permissions even inside an app window, but preserves supported fullscreen', () => {
    const {contents, check, request} = install(true)
    const callback = vi.fn()
    request(contents, 'clipboard-read', callback, {
      isMainFrame: false,
      requestingUrl: 'https://www.youtube.com/embed/1',
    })
    expect(callback).toHaveBeenCalledWith(false)
    expect(check(contents, 'fullscreen', 'https://www.youtube.com', {isMainFrame: false})).toBe(true)
    expect(check(contents, 'fullscreen', 'https://evil.example/youtube.com', {isMainFrame: false})).toBe(false)
    expect(check(null, 'fullscreen', 'https://www.youtube.com', {isMainFrame: false})).toBe(false)
  })
})

it('changes response headers only at the exact app origin', () => {
  const {headers} = install()
  for (const url of [
    `${policy.appOrigin}/index.html`,
    'http://localhost:17655/index.html',
    'https://evil.example/localhost',
    'http://localhost.evil.example:17654',
  ]) {
    const callback = vi.fn()
    headers({url, resourceType: 'mainFrame', responseHeaders: {'x-FRAME-options': ['DENY']}}, callback)
    const result = callback.mock.calls[0]![0].responseHeaders
    if (new URL(url).origin === policy.appOrigin) {
      expect(result['x-FRAME-options']).toBeUndefined()
      expect(result['Content-Security-Policy'][0]).toContain("script-src 'self'")
    } else {
      expect(result).toEqual({'x-FRAME-options': ['DENY']})
    }
  }
})

describe('openAppExternalLink', () => {
  function appWindow(activated: boolean) {
    const contents = Object.assign(new EventEmitter(), {
      getURL: () => `${policy.appOrigin}/index.html`,
      isDestroyed: () => false,
      mainFrame: {},
      executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValue(activated),
      setWindowOpenHandler: vi.fn(),
    })
    installWindowGuards({webContents: contents} as unknown as BrowserWindow, policy)
    return contents as unknown as WebContents & EventEmitter
  }
  const url = 'https://example.com/article'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(shell.openExternal).mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('opens with live activation and refuses with none, reporting the outcome', async () => {
    await expect(openAppExternalLink(appWindow(true), url, policy)).resolves.toBe(true)
    expect(shell.openExternal).toHaveBeenCalledWith(url)
    await expect(openAppExternalLink(appWindow(false), url, policy)).resolves.toBe(false)
    await expect(openAppExternalLink(appWindow(false), url, policy, true, true)).resolves.toBe(false)
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('lets an app-initiated open follow the last click or key press for a minute', async () => {
    const contents = appWindow(false)
    contents.emit('input-event', {}, {type: 'mouseMove'})
    await expect(openAppExternalLink(contents, url, policy, true, true)).resolves.toBe(false)
    contents.emit('input-event', {}, {type: 'keyDown'})
    vi.advanceTimersByTime(recentInputWindow - 1000)
    await expect(openAppExternalLink(contents, url, policy, true, true)).resolves.toBe(true)
    // Page-driven opens (navigation, window.open) still need live activation.
    await expect(openAppExternalLink(contents, url, policy)).resolves.toBe(false)
    vi.advanceTimersByTime(2000)
    await expect(openAppExternalLink(contents, url, policy, true, true)).resolves.toBe(false)
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('still rejects bad links and foreign pages after recent input', async () => {
    const contents = appWindow(false)
    contents.emit('input-event', {}, {type: 'mouseDown'})
    await expect(openAppExternalLink(contents, 'file:///etc/passwd', policy, true, true)).resolves.toBe(false)
    await expect(openAppExternalLink(contents, 'not a url', policy, true, true)).resolves.toBe(false)
    ;(contents as any).getURL = () => 'https://evil.example/'
    await expect(openAppExternalLink(contents, url, policy, true, true)).resolves.toBe(false)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})
