import type {Session, WebContents} from 'electron'
import {describe, expect, it, vi} from 'vitest'
import {installAppSessionGuards} from '../app-window-security'
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
