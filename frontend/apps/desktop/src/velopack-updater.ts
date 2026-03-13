import {UpdateManager, UpdateInfo as VelopackUpdateInfo} from 'velopack'
import {app, ipcMain} from 'electron'
import {getLastFocusedWindow} from './app-windows'
import * as log from './logger'
import {UpdateInfo, UpdateStatus} from './types/updater-types'

/**
 * Velopack-based updater that emits the same IPC events as the legacy AutoUpdater,
 * so the renderer UI works unchanged.
 */
export class VelopackUpdater {
  private um: UpdateManager
  private checkInterval: NodeJS.Timeout | null = null
  private checkIntervalMs: number
  private currentUpdate: VelopackUpdateInfo | null = null
  private status: UpdateStatus = {type: 'idle'}

  constructor(updateUrl: string, checkIntervalMs: number = 600_000) {
    log.info(`[VELOPACK] Initializing with URL: ${updateUrl}`)
    this.um = new UpdateManager(updateUrl)
    this.checkIntervalMs = checkIntervalMs
    this.currentUpdate = null

    // Remove any existing handlers to prevent duplicates
    ipcMain.removeAllListeners('auto-update:download-and-install')
    ipcMain.removeAllListeners('auto-update:set-status')
    ipcMain.removeAllListeners('auto-update:release-notes')
    ipcMain.removeAllListeners('auto-update:check-for-updates')

    ipcMain.on('auto-update:download-and-install', () => {
      log.info('[VELOPACK] Received download-and-install request')
      if (this.currentUpdate) {
        this.downloadAndApply()
      } else {
        log.error('[VELOPACK] No update available for download')
      }
    })

    ipcMain.on('auto-update:set-status', (_, status: UpdateStatus) => {
      this.sendStatus(status)
    })

    ipcMain.on('auto-update:release-notes', () => {
      log.info('[VELOPACK] Release notes requested')
      // Velopack includes release notes in the update info
    })

    ipcMain.on('auto-update:check-for-updates', () => {
      log.info('[VELOPACK] Manual check requested')
      this.checkForUpdates()
    })

    log.info('[VELOPACK] Initialized')
  }

  private sendStatus(status: UpdateStatus) {
    this.status = status
    const win = getLastFocusedWindow()
    if (win) {
      try {
        win.webContents.send('auto-update:status', this.status)
      } catch (err) {
        log.error(`[VELOPACK] Failed to send status: ${err}`)
      }
    }
  }

  async checkForUpdates(): Promise<void> {
    log.info('[VELOPACK] Checking for updates...')
    log.info(`[VELOPACK] Current version: ${app.getVersion()}`)

    this.sendStatus({type: 'checking'})

    try {
      const update = await this.um.checkForUpdatesAsync()

      if (update) {
        const targetVersion = update.TargetFullRelease.Version
        log.info(`[VELOPACK] Update available: ${targetVersion}`)

        this.currentUpdate = update

        // Translate Velopack's UpdateInfo into our UpdateInfo shape for the renderer
        const updateInfo: UpdateInfo = {
          name: targetVersion,
          tag_name: targetVersion,
          release_notes: update.TargetFullRelease.NotesMarkdown || update.TargetFullRelease.NotesHtml || '',
          assets: {},
        }

        this.sendStatus({type: 'update-available', updateInfo})
      } else {
        log.info('[VELOPACK] No update available')
        this.currentUpdate = null
        this.sendStatus({type: 'idle'})
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      log.error(`[VELOPACK] Error checking for updates: ${errorMessage}`)
      this.currentUpdate = null
      this.sendStatus({type: 'error', error: errorMessage})
    }
  }

  private async downloadAndApply(): Promise<void> {
    if (!this.currentUpdate) return

    const targetVersion = this.currentUpdate.TargetFullRelease.Version
    log.info(`[VELOPACK] Downloading update ${targetVersion}...`)

    try {
      this.sendStatus({type: 'downloading', progress: 0})

      await this.um.downloadUpdateAsync(this.currentUpdate, (perc) => {
        this.sendStatus({type: 'downloading', progress: Math.round(perc)})
      })

      log.info('[VELOPACK] Download complete, applying update...')
      this.sendStatus({type: 'restarting'})

      // waitExitThenApplyUpdate spawns the updater process which waits for this app to exit,
      // then applies the update and restarts the app.
      this.um.waitExitThenApplyUpdate(this.currentUpdate)
      app.quit()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      log.error(`[VELOPACK] Error downloading/applying update: ${errorMessage}`)
      this.sendStatus({type: 'error', error: errorMessage})
    }
  }

  startAutoCheck(): void {
    log.info(`[VELOPACK] Starting auto-check with interval: ${this.checkIntervalMs}ms`)
    // Initial check after 5 seconds
    setTimeout(() => this.checkForUpdates(), 5000)
    this.checkInterval = setInterval(() => {
      this.checkForUpdates()
    }, this.checkIntervalMs)
  }

  stopAutoCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
      log.info('[VELOPACK] Auto-check stopped')
    }
  }
}
