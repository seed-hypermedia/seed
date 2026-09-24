import {app, BrowserWindow, dialog, session, webContents} from 'electron'
import type {WebContents, WebPreferences} from 'electron'
import {basename} from 'node:path'
import {setupBrowserNetworkPolicy} from './browser-network-policy'

/** Dedicated persistent session for untrusted integrated websites. */
export const browserPartition = 'persist:seed-web-browser'

/** A short-lived user gesture that agent execution cannot create or inherit. */
export class BrowserUserGesture {
  private lastInput = -Infinity
  private executing = 0
  /** Records native input only while the agent is idle. */
  record(type: string) {
    if (!this.executing && ['mouseDown', 'keyDown', 'rawKeyDown', 'touchStart'].includes(type))
      this.lastInput = Date.now()
  }
  /** Whether the last native input can authorize a privileged transition. */
  allowed() {
    return !this.executing && Date.now() - this.lastInput <= 2000
  }
  /** Spends the gesture on one popup, native route or download. */
  consume() {
    const allowed = this.allowed()
    this.lastInput = -Infinity
    return allowed
  }
  /** Suppresses inherited and injected gestures until all agent commands finish. */
  async runAgent<T>(command: () => Promise<T>): Promise<T> {
    this.lastInput = -Infinity
    this.executing++
    try {
      return await command()
    } finally {
      this.executing--
    }
  }
}

const gestures = new WeakMap<WebContents, BrowserUserGesture>()

/** Shares the guest's gesture gate with session-level download handling. */
export function browserUserGesture(guest: WebContents): BrowserUserGesture {
  let gesture = gestures.get(guest)
  if (!gesture) {
    gesture = new BrowserUserGesture()
    gestures.set(guest, gesture)
    guest.on('input-event', (_event, input) => gesture!.record(input.type))
    guest.on('before-input-event', (_event, input) => gesture!.record(input.type))
  }
  return gesture
}

/** Replaces all renderer-supplied preferences with the browser's explicit allowlist. */
export function hardenBrowserPreferences(preferences: WebPreferences) {
  for (const key of Object.keys(preferences)) delete (preferences as Record<string, unknown>)[key]
  Object.assign(preferences, {
    partition: browserPartition,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    safeDialogs: true,
  } satisfies WebPreferences)
}

let installed = false
/** Installs partition-scoped permission, certificate and download rules once per process. */
export function setupBrowserSessionPolicy() {
  if (installed) return
  installed = true
  const browserSession = session.fromPartition(browserPartition)
  setupBrowserNetworkPolicy(browserSession)
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  browserSession.setPermissionCheckHandler(() => false)
  app.on('select-client-certificate', (event, contents, _url, _certificates, callback) => {
    if (contents.session !== browserSession) return
    event.preventDefault()
    callback()
  })
  browserSession.on('will-download', (event, item, contents) => {
    if (!contents || !gestures.get(contents)?.consume()) {
      event.preventDefault()
      return
    }
    // Resolve synchronously inside will-download so Chromium cannot pick a path first.
    const options: Electron.SaveDialogOptions = {
      title: 'Save browser download',
      defaultPath: basename(item.getFilename()),
      properties: ['showOverwriteConfirmation'],
    }
    const owner = BrowserWindow.fromWebContents(contents)
    const path = owner ? dialog.showSaveDialogSync(owner, options) : dialog.showSaveDialogSync(options)
    if (!path) event.preventDefault()
    else item.setSavePath(path)
  })
}

/** Clears only website session data, stopping guests before removing their storage. */
export async function clearBrowserData() {
  const browserSession = session.fromPartition(browserPartition)
  await Promise.all(
    webContents
      .getAllWebContents()
      .filter((contents) => contents.session === browserSession)
      .map(async (contents) => {
        contents.stop()
        await contents.loadURL('about:blank')
        contents.navigationHistory.clear()
      }),
  )
  await browserSession.clearStorageData()
  await browserSession.clearCache()
  await browserSession.clearAuthCache()
  await browserSession.closeAllConnections()
}
