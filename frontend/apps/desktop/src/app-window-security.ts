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

/** Open a renderer link only from the app's main frame with live user activation. */
export async function openAppExternalLink(
  contents: WebContents,
  value: string,
  policy: AppWindowPolicy,
  allowMailto = true,
): Promise<void> {
  if (typeof value !== 'string') return
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return
  }
  if (!parseWebURL(value) && !(allowMailto && url.protocol === 'mailto:')) return
  const sourceURL = contents.getURL()
  if (!policy.appOrigin || parseWebURL(sourceURL)?.origin !== policy.appOrigin) return
  if (await hasMainFrameActivation(contents, sourceURL)) {
    await shell.openExternal(url.href)
  }
}

/** Install the same navigation guards on app windows and the hostile-page fixture. */
export function installWindowGuards(window: BrowserWindow, policy: AppWindowPolicy): void {
  const contents = window.webContents
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
