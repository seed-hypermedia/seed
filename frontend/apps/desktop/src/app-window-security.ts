import {shell, type BrowserWindow, type Session, type WebContents} from 'electron'
import {appContentSecurityPolicy, isAllowedFrameURL, parseWebURL, type AppWindowPolicy} from './app-window-policy'

// This world is separate from both page scripts and the preload bridge. Never pass
// userGesture=true: doing so would manufacture the authorization being checked.
async function hasMainFrameActivation(contents: WebContents, expectedURL: string): Promise<boolean> {
  try {
    const active = await contents.executeJavaScriptInIsolatedWorld(1001, [{code: 'navigator.userActivation.isActive'}])
    return active === true && !contents.isDestroyed() && contents.getURL() === expectedURL
  } catch {
    return false
  }
}

/** How long after the user's last click or key press an app-initiated open may still follow. */
export const recentInputWindow = 60_000
const lastInput = new WeakMap<WebContents, number>()

/** Whether the user pressed a key or button in this window within `recentInputWindow`. */
function hadRecentInput(contents: WebContents, expectedURL: string): boolean {
  const at = lastInput.get(contents)
  return (
    at !== undefined &&
    Date.now() - at <= recentInputWindow &&
    !contents.isDestroyed() &&
    contents.getURL() === expectedURL
  )
}

/**
 * Open a renderer link only from the app's main frame, and only for the user: with live
 * activation, or (`afterRecentInput`, for the app's own explicit opens such as the omnibar, whose
 * address lookup can outlast Chromium's five-second activation) within a minute of the last click
 * or key press. Returns whether the link was opened, in Seed or outside it.
 */
export async function openAppExternalLink(
  contents: WebContents,
  value: string,
  policy: AppWindowPolicy,
  allowMailto = true,
  afterRecentInput = false,
): Promise<boolean> {
  if (typeof value !== 'string') return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (!parseWebURL(value) && !(allowMailto && url.protocol === 'mailto:')) return false
  const sourceURL = contents.getURL()
  if (!policy.appOrigin || parseWebURL(sourceURL)?.origin !== policy.appOrigin) return false
  const activated =
    (await hasMainFrameActivation(contents, sourceURL)) || (afterRecentInput && hadRecentInput(contents, sourceURL))
  if (!activated) return false
  if (policy.openInApp?.(url.href, contents)) return true
  await shell.openExternal(url.href)
  return true
}

/** Install the same navigation guards on app windows and the hostile-page fixture. */
export function installWindowGuards(window: BrowserWindow, policy: AppWindowPolicy): void {
  const contents = window.webContents
  contents.on('input-event', (_event, input) => {
    if (['mouseDown', 'keyDown', 'rawKeyDown', 'touchStart'].includes(input.type)) lastInput.set(contents, Date.now())
  })
  contents.setWindowOpenHandler(({url, disposition, referrer}) => {
    // Disposition/referrer are filters, not evidence of a gesture. Electron 39
    // has no userGesture field here, so also check Chromium's isolated-world
    // activation and fail closed if window.open has already consumed it.
    if (
      ['foreground-tab', 'background-tab', 'new-window'].includes(disposition) &&
      policy.appOrigin &&
      parseWebURL(referrer.url)?.origin === policy.appOrigin
    ) {
      void openAppExternalLink(contents, url, policy, false).catch(console.warn)
    }
    return {action: 'deny'}
  })

  contents.on('will-navigate', (event) => {
    if (!policy.appOrigin || parseWebURL(event.url)?.origin !== policy.appOrigin) {
      event.preventDefault()
      if (event.initiator === contents.mainFrame) {
        void openAppExternalLink(contents, event.url, policy).catch(console.warn)
      }
    }
  })
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !isAllowedFrameURL(event.url, policy)) event.preventDefault()
  })
  contents.on('will-redirect', (event) => {
    const allowed = event.isMainFrame
      ? !!policy.appOrigin && parseWebURL(event.url)?.origin === policy.appOrigin
      : isAllowedFrameURL(event.url, policy)
    if (!allowed) event.preventDefault()
  })
  contents.on('did-create-window', (child) => child.close())
}

/** Deny session capabilities by default and constrain app response headers. */
export function installAppSessionGuards(session: Session, policy: AppWindowPolicy): void {
  session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    const appMainFrame =
      !!contents &&
      !!policy.appOrigin &&
      details.isMainFrame &&
      parseWebURL(contents.getURL())?.origin === policy.appOrigin &&
      parseWebURL(requestingOrigin)?.origin === policy.appOrigin
    // Async reads and openExternal must reach the request handler, which checks
    // activation. Normal copy buttons use sanitized clipboard writes.
    if (permission === 'clipboard-sanitized-write') return appMainFrame
    return (
      permission === 'fullscreen' &&
      !!contents &&
      !!policy.appOrigin &&
      parseWebURL(contents.getURL())?.origin === policy.appOrigin &&
      isAllowedFrameURL(requestingOrigin, policy)
    )
  })
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const sourceURL = contents.getURL()
    const appMainFrame =
      !!policy.appOrigin &&
      details.isMainFrame &&
      parseWebURL(sourceURL)?.origin === policy.appOrigin &&
      parseWebURL(details.requestingUrl)?.origin === policy.appOrigin
    if (permission === 'fullscreen') {
      callback(
        !!policy.appOrigin &&
          parseWebURL(sourceURL)?.origin === policy.appOrigin &&
          isAllowedFrameURL(details.requestingUrl, policy),
      )
      return
    }
    if (permission === 'clipboard-sanitized-write') {
      callback(appMainFrame)
      return
    }
    if (appMainFrame && permission === 'clipboard-read') {
      void hasMainFrameActivation(contents, sourceURL).then(callback)
      return
    }
    if (appMainFrame && permission === 'openExternal' && 'externalURL' in details && details.externalURL) {
      let external: URL
      try {
        external = new URL(details.externalURL)
      } catch {
        callback(false)
        return
      }
      if (['http:', 'https:', 'mailto:'].includes(external.protocol)) {
        void hasMainFrameActivation(contents, sourceURL).then(callback)
        return
      }
    }
    callback(false)
  })
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = {...details.responseHeaders}
    if (policy.appOrigin && parseWebURL(details.url)?.origin === policy.appOrigin) {
      for (const key of Object.keys(responseHeaders)) {
        if (key.toLowerCase() === 'x-frame-options') delete responseHeaders[key]
      }
      if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
        // React Refresh injects an inline bootstrap in development. Report it
        // without weakening the enforced packaged policy with unsafe-inline.
        responseHeaders[policy.development ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy'] = [
          appContentSecurityPolicy(policy),
        ]
      }
    }
    callback({responseHeaders})
  })
}
