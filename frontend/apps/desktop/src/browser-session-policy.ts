import {app, BrowserWindow, dialog, session, webContents} from 'electron'
import type {WebContents, WebPreferences} from 'electron'
import {basename} from 'node:path'
import {setupBrowserNetworkPolicy} from './browser-network-policy'

/** Dedicated persistent session for untrusted integrated websites. */
export const browserPartition = 'persist:seed-web-browser'

/** Memory-only session for private pages; never uses Chromium's persistent profile. */
export const privateBrowserPartition = 'seed-web-private'

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
export function hardenBrowserPreferences(preferences: WebPreferences, privatePage = false) {
  for (const key of Object.keys(preferences)) delete (preferences as Record<string, unknown>)[key]
  Object.assign(preferences, {
    partition: privatePage ? privateBrowserPartition : browserPartition,
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
  } satisfies WebPreferences)
}

/** File types that run code when opened; a download of one needs a second, explicit confirmation. */
const DANGEROUS_EXTENSIONS = new Set([
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'ps1',
  'vbs',
  'js',
  'jse',
  'wsf',
  'hta',
  'reg',
  'dmg',
  'pkg',
  'app',
  'command',
  'sh',
  'bash',
  'zsh',
  'run',
  'bin',
  'deb',
  'rpm',
  'appimage',
  'jar',
  'apk',
  'iso',
  'img',
  'lnk',
  'url',
  'desktop',
])
/** Whether a downloaded file can execute programs when opened. */
export function isDangerousDownload(filename: string): boolean {
  const extension = filename.toLowerCase().split('.').pop() ?? ''
  return DANGEROUS_EXTENSIONS.has(extension)
}

const installed = new Set<string>()
let checkedSiteIsolation = false
/** Installs partition-scoped permission, certificate and download rules once per process. */
export function setupBrowserSessionPolicy(partition = browserPartition) {
  if (!checkedSiteIsolation) {
    checkedSiteIsolation = true
    if (app.commandLine.hasSwitch('disable-site-isolation-trials')) {
      console.warn(
        'Browser site isolation is disabled by --disable-site-isolation-trials. Remove this switch to isolate websites.',
      )
    }
  }
  if (installed.has(partition)) return
  installed.add(partition)
  const browserSession = session.fromPartition(partition)
  setupBrowserNetworkPolicy(browserSession)
  browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    // A WebContentsView must never fullscreen: Seed's origin and navigation controls
    // must stay visible. All other permissions also default to deny.
    if (permission !== 'clipboard-sanitized-write' || !contents || !gestures.get(contents)?.consume()) {
      callback(false)
      return
    }
    let origin: string
    try {
      const url = new URL(details.requestingUrl)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Not a website')
      origin = url.origin
    } catch {
      callback(false)
      return
    }
    const documentUrl = contents.getURL()
    const options: Electron.MessageBoxSyncOptions = {
      type: 'question',
      buttons: ['Deny', 'Allow'],
      defaultId: 0,
      cancelId: 0,
      title: 'Copy to clipboard?',
      message: `Allow ${origin} to copy to your clipboard?`,
    }
    const owner = BrowserWindow.fromWebContents(contents)
    const answer = owner ? dialog.showMessageBoxSync(owner, options) : dialog.showMessageBoxSync(options)
    callback(answer === 1 && !contents.isDestroyed() && contents.getURL() === documentUrl)
  })
  // Do not cache clipboard grants: every write must pass the gesture gate and prompt.
  browserSession.setPermissionCheckHandler(() => false)
  app.on('select-client-certificate', (event, contents, _url, _certificates, callback) => {
    if (!contents || contents.session !== browserSession) return
    event.preventDefault()
    callback()
  })
  // Chromium already refuses bad certificates; saying so here keeps a future "proceed anyway" from
  // being added by accident, and keeps the rule testable.
  app.on('certificate-error', (event, contents, _url, _error, _certificate, callback) => {
    if (!contents || contents.session !== browserSession) return
    event.preventDefault()
    callback(false)
  })
  // Encrypted DNS when the resolver supports it; the whole app shares Chromium's resolver.
  try {
    app.configureHostResolver({secureDnsMode: 'automatic'})
  } catch {
    // Older builds or test doubles without the API keep the system resolver.
  }
  browserSession.on('will-download', (event, item, contents) => {
    if (!contents || !gestures.get(contents)?.consume()) {
      event.preventDefault()
      return
    }
    const owner = contents ? BrowserWindow.fromWebContents(contents) : null
    if (isDangerousDownload(item.getFilename())) {
      const warning: Electron.MessageBoxSyncOptions = {
        type: 'warning',
        buttons: ['Cancel', 'Download anyway'],
        defaultId: 0,
        cancelId: 0,
        title: 'This file can run programs on your computer',
        message: `"${item.getFilename()}" is a type of file that can run programs. Only download it if you trust ${
          new URL(item.getURL()).host
        }.`,
      }
      const choice = owner ? dialog.showMessageBoxSync(owner, warning) : dialog.showMessageBoxSync(warning)
      if (choice !== 1) {
        event.preventDefault()
        return
      }
    }
    // Resolve synchronously inside will-download so Chromium cannot pick a path first.
    const options: Electron.SaveDialogOptions = {
      title: 'Save browser download',
      defaultPath: basename(item.getFilename()),
      properties: ['showOverwriteConfirmation'],
    }
    const path = owner ? dialog.showSaveDialogSync(owner, options) : dialog.showSaveDialogSync(options)
    if (!path) event.preventDefault()
    else item.setSavePath(path)
  })
}

/** Per-guest settings that are not web preferences: WebRTC must not reveal local network addresses. */
export function hardenGuestWebContents(guest: WebContents) {
  guest.setWebRTCIPHandlingPolicy('default_public_interface_only')
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
