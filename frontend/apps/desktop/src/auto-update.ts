import {AVOID_UPDATES, IS_PROD_DESKTOP, IS_PROD_DEV} from '@shm/shared/constants'
import {app, BrowserWindow, dialog, ipcMain, session, shell} from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {getAllWindows, getLastFocusedWindow} from './app-windows'
import * as log from './logger'
import {UpdateAsset, UpdateInfo} from './types/updater-types'
import {createActor} from 'xstate'
import {
  createAutoUpdateMachine,
  getAutoUpdateStatus,
  type AutoUpdateActor,
  type DownloadedUpdate,
  type UpdateDownloadCallbacks,
} from './auto-update-machine'
import {installUpdate} from './auto-update-installer'
import {updateChromiumPolicy} from './app-experiments'
import {
  DEV_UPDATE_PUBLIC_KEY,
  isUpdateDownload,
  PROD_UPDATE_PUBLIC_KEY,
  verifyUpdateAsset,
  verifyUpdateManifest,
} from './update-manifest'

/** Triggers a manual check using the shared desktop updater. */
export const checkForUpdates = customAutoUpdates

/** Initializes the desktop update mechanism for the current distribution. */
export default function autoUpdate() {
  console.log(`[AUTO-UPDATE] autoUpdate call INIT`, BrowserWindow.getFocusedWindow()?.id)

  if (!IS_PROD_DESKTOP || AVOID_UPDATES) {
    log.debug('[MAIN][AUTO-UPDATE]: Not available in development')
    return
  }

  // Check if running inside Flatpak
  if (isRunningInFlatpak()) {
    log.info('[AUTO-UPDATE] Running inside Flatpak - skipping custom auto-update setup')
    setTimeout(() => {
      handleFlatpakUpdates()
    }, 2000) // Brief delay to ensure UI is ready
    return
  }

  // Check if running as AppImage
  if (isRunningInAppImage()) {
    log.info('[AUTO-UPDATE] Running as AppImage - skipping custom auto-update setup')
    setTimeout(() => {
      handleAppImageUpdates()
    }, 2000) // Brief delay to ensure UI is ready
    return
  }

  setTimeout(() => {
    log.debug('[AUTO-UPDATE]: TIMEOUT 5000')
    customAutoUpdates(false)
  }, 5000)
}

function isRunningInFlatpak(): boolean {
  // Check for Flatpak environment indicators
  return (
    process.env.FLATPAK_ID !== undefined ||
    process.env.FLATPAK_SANDBOX_DIR !== undefined ||
    fs.existsSync('/.flatpak-info')
  )
}

function isRunningInAppImage(): boolean {
  // Check for AppImage environment indicator
  return process.env.APPIMAGE !== undefined
}

function handleFlatpakUpdates() {
  log.info('[AUTO-UPDATE] Running inside Flatpak - using native update mechanism')

  // Send notification to user about Flatpak updates
  const win = getLastFocusedWindow()
  if (win) {
    win.webContents.send('auto-update:status', {
      type: 'flatpak-info',
      message: 'Updates are handled by your system package manager. Use "flatpak update" or your software center.',
    })
  }
}

function handleAppImageUpdates() {
  log.info('[AUTO-UPDATE] Running as AppImage - using AppImage update mechanism')

  // Send notification to user about AppImage updates
  const win = getLastFocusedWindow()
  if (win) {
    win.webContents.send('auto-update:status', {
      type: 'appimage-info',
      message:
        'AppImage updates: Download the latest version from our website or use AppImageUpdate tool for efficient delta updates.',
    })
  }
}

/** Starts periodic update checks and requests the current update status. */
export function customAutoUpdates(manualCheck = true) {
  // Check if running inside Flatpak
  if (isRunningInFlatpak()) {
    handleFlatpakUpdates()
    return
  }

  // Check if running as AppImage
  if (isRunningInAppImage()) {
    handleAppImageUpdates()
    return
  }

  // if (!isAutoUpdateSupported()) {
  //   log.debug('[AUTO-UPDATE]: Auto-Update is not supported')
  //   return
  // }

  updater.startAutoCheck()
  log.info(`[AUTO-UPDATE] Starting auto-check on ${JSONUrl}`)
  updater.checkForUpdates(manualCheck)
}

/** Connects the update actor to Electron IPC, downloads, and periodic checks. */
export class AutoUpdater {
  private checkInterval: NodeJS.Timeout | null = null
  private readonly actor: AutoUpdateActor
  private readonly ipcHandlers: Record<string, (event: Electron.IpcMainEvent) => void>
  private readonly onQuit = () => this.dispose()

  constructor(
    private updateUrl: string,
    private checkIntervalMs: number = 600_000,
  ) {
    this.actor = createActor(
      createAutoUpdateMachine({
        checkForUpdates: (signal) => this.fetchUpdate(signal),
        downloadUpdate: (updateInfo, callbacks) => this.downloadUpdate(updateInfo, callbacks),
        verifyUpdate: (download) => this.verifyDownload(download),
        installUpdate,
        usesExternalDownload: () => process.platform === 'linux',
        openDownloadPage: () => {
          shell.openExternal('https://seed.hyper.media/hm/download').catch((error) => log.error(String(error)))
        },
      }),
    )
    this.actor.start()
    this.actor.subscribe((snapshot) => {
      const status = getAutoUpdateStatus(snapshot)
      getAllWindows().forEach((window) => {
        if (window.isDestroyed() || window.webContents.isDestroyed()) return
        try {
          window.webContents.send('auto-update:status', status)
        } catch (error) {
          log.error(`[AUTO-UPDATE] Failed to send status: ${error}`)
        }
      })
    })
    this.ipcHandlers = {
      'auto-update:download': () => this.actor.send({type: 'download.requested'}),
      'auto-update:restart': () => this.actor.send({type: 'restart.requested'}),
      'auto-update:dismiss': () => this.actor.send({type: 'dismiss'}),
      'auto-update:get-status': (event) =>
        event.sender.send('auto-update:status', getAutoUpdateStatus(this.actor.getSnapshot())),
      'auto-update:release-notes': () => this.showReleaseNotes(),
      'auto-update:check-for-updates': () => this.checkForUpdates(true),
    }
    for (const [channel, handler] of Object.entries(this.ipcHandlers)) {
      ipcMain.removeAllListeners(channel)
      ipcMain.on(channel, handler)
    }
    app.once('will-quit', this.onQuit)
  }

  private showReleaseNotes() {
    const {updateInfo} = this.actor.getSnapshot().context
    if (updateInfo?.release_notes) {
      dialog.showMessageBoxSync({
        type: 'info',
        title: 'Update Available',
        message: updateInfo.name,
        detail: updateInfo.release_notes,
        buttons: ['OK'],
      })
    }
  }

  /** Requests a check without interrupting an active download or pending restart. */
  checkForUpdates(manualCheck = false): void {
    this.actor.send({type: 'check.requested', manual: manualCheck})
  }

  private async fetchUpdate(signal: AbortSignal): Promise<UpdateInfo | null> {
    log.info(`[AUTO-UPDATE] Fetching update info from: ${this.updateUrl}`)
    const response = await fetch(this.updateUrl, {signal})
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)

    const updateInfo = verifyUpdateManifest(
      await response.json(),
      IS_PROD_DEV ? DEV_UPDATE_PUBLIC_KEY : PROD_UPDATE_PUBLIC_KEY,
      (message) => log.warn(message),
    )
    updateChromiumPolicy(updateInfo)
    return this.shouldUpdate(updateInfo.name) ? updateInfo : null
  }

  private shouldUpdate(newVersion: string): boolean {
    const currentVersion = app.getVersion()
    const shouldUpdate = this.compareVersions(newVersion, currentVersion) > 0
    log.info(`[AUTO-UPDATE] Update needed: ${shouldUpdate}`)
    return shouldUpdate
  }

  private compareVersions(v1: string, v2: string): number {
    log.info(`[AUTO-UPDATE] Comparing versions: ${v1} vs ${v2}`)

    // Split version and dev suffix
    const [v1Base, v1Dev] = v1.split('-dev.')
    const [v2Base, v2Dev] = v2.split('-dev.')

    // Compare main version numbers first (2025.2.8)
    const v1Parts = v1Base.split('.').map(Number)
    const v2Parts = v2Base.split('.').map(Number)

    // Compare year.month.patch
    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const v1Part = v1Parts[i] || 0
      const v2Part = v2Parts[i] || 0
      if (v1Part > v2Part) return 1
      if (v1Part < v2Part) return -1
    }

    // If base versions are equal, compare dev versions
    if (v1Base === v2Base) {
      // If one is dev and other isn't, non-dev is newer
      if (!v1Dev && v2Dev) return 1
      if (v1Dev && !v2Dev) return -1
      // If both are dev versions, compare dev numbers
      if (v1Dev && v2Dev) {
        const v1DevNum = parseInt(v1Dev)
        const v2DevNum = parseInt(v2Dev)
        return v1DevNum - v2DevNum
      }
      return 0
    }

    // If we get here, base versions were different
    return 0
  }

  private getAssetForCurrentPlatform(updateInfo: UpdateInfo): UpdateAsset | null {
    log.info(`[AUTO-UPDATE] Getting asset for platform: ${process.platform}`)
    if (process.platform === 'linux') {
      const isRpm = fs.existsSync('/etc/redhat-release')
      log.info(`[AUTO-UPDATE] Linux package type: ${isRpm ? 'RPM' : 'DEB'}`)
      return isRpm ? updateInfo.assets.linux?.rpm || null : updateInfo.assets.linux?.deb || null
    } else if (process.platform === 'darwin') {
      log.info('[AUTO-UPDATE] Platform: macOS')
      log.info(`[AUTO-UPDATE] Architecture: ${process.arch}`)
      return updateInfo.assets.macos?.[process.arch as 'x64' | 'arm64'] || null
    } else if (process.platform === 'win32') {
      log.info('[AUTO-UPDATE] Platform: Windows')
      log.info(`[AUTO-UPDATE] Architecture: ${process.arch}`)
      return updateInfo.assets.win32?.[process.arch as 'x64'] || null
    }
    log.warn('[AUTO-UPDATE] Platform not supported')
    return null
  }

  private downloadUpdate(updateInfo: UpdateInfo, callbacks: UpdateDownloadCallbacks): () => void {
    let downloadItem: Electron.DownloadItem | null = null
    let finished = false
    let filePath: string
    const asset = this.getAssetForCurrentPlatform(updateInfo)
    const downloadUrl = process.platform === 'darwin' ? asset?.zip_url : asset?.download_url
    const expectedSha256 = process.platform === 'darwin' ? asset?.zip_sha256 : asset?.sha256

    const onUpdated = (_event: Electron.Event, state: string) => {
      if (state !== 'progressing' || !downloadItem || downloadItem.isPaused()) return
      const total = downloadItem.getTotalBytes()
      if (total > 0) callbacks.onProgress(Math.round((downloadItem.getReceivedBytes() / total) * 100))
    }
    const onDone = (_event: Electron.Event, state: string) => {
      finished = true
      if (state === 'completed') {
        callbacks.onComplete({filePath, expectedSha256})
      } else {
        callbacks.onError(new Error(`Download failed: ${state}`))
      }
    }
    const onDownload = (_event: Electron.Event, item: Electron.DownloadItem) => {
      if (!downloadUrl || !isUpdateDownload(item.getURLChain()[0] ?? '', downloadUrl)) return
      session.defaultSession.removeListener('will-download', onDownload)
      downloadItem = item
      try {
        const fileName = item.getFilename()
        if (!fileName) throw new Error('No filename available from download item')
        filePath = path.join(app.getPath('downloads'), fileName)
        item.setSavePath(filePath)
        item.on('updated', onUpdated)
        item.once('done', onDone)
      } catch (error) {
        callbacks.onError(error)
      }
    }

    try {
      if (!downloadUrl) throw new Error('No compatible update found for download')
      session.defaultSession.on('will-download', onDownload)
      session.defaultSession.downloadURL(downloadUrl)
    } catch (error) {
      callbacks.onError(error)
    }

    return () => {
      session.defaultSession.removeListener('will-download', onDownload)
      if (downloadItem) {
        downloadItem.removeListener('updated', onUpdated)
        downloadItem.removeListener('done', onDone)
        if (!finished) downloadItem.cancel()
      }
    }
  }

  private async verifyDownload(download: DownloadedUpdate): Promise<void> {
    try {
      const stats = await fs.promises.stat(download.filePath)
      if (stats.size === 0) throw new Error('Downloaded file is empty')
      await verifyUpdateAsset(download.filePath, download.expectedSha256)
    } catch (error) {
      await fs.promises.rm(download.filePath, {force: true}).catch(() => {})
      throw new Error(`Download verification failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Starts one periodic check source; the actor decides when a check is permitted. */
  startAutoCheck(): void {
    if (this.checkInterval) return
    this.checkInterval = setInterval(() => this.checkForUpdates(), this.checkIntervalMs)
  }

  /** Stops periodic checks without discarding a downloaded update. */
  stopAutoCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  /** Changes the cadence of future background checks. */
  setCheckInterval(ms: number): void {
    this.checkIntervalMs = ms
    if (this.checkInterval) {
      this.stopAutoCheck()
      this.startAutoCheck()
    }
  }

  /** Releases downloads, timers, and IPC listeners when the coordinator shuts down. */
  dispose(): void {
    this.stopAutoCheck()
    this.actor.stop()
    for (const [channel, handler] of Object.entries(this.ipcHandlers)) ipcMain.removeListener(channel, handler)
    app.removeListener('will-quit', this.onQuit)
  }
}

const JSONUrl =
  process.env.AUTO_UPDATE_TEST_URL ||
  (IS_PROD_DEV
    ? 'https://seedappdev.s3.eu-west-2.amazonaws.com/dev/latest.json'
    : 'https://seedreleases.s3.eu-west-2.amazonaws.com/prod/latest.json')

const updater = new AutoUpdater(JSONUrl)
