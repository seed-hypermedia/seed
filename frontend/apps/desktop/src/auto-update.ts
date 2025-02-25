import {IS_PROD_DEV} from '@shm/shared/constants'
import {app, BrowserWindow, ipcMain, session} from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as log from './logger'
import {UpdateAsset, UpdateInfo, UpdateStatus} from './types/updater-types'

import {
  autoUpdater as defaultAutoUpdater,
  dialog,
  MessageBoxOptions,
} from 'electron'
import {updateElectronApp, UpdateSourceType} from 'update-electron-app'
import {APP_AUTO_UPDATE_PREFERENCE} from './app-settings'
import {appStore} from './app-store'

export function defaultCheckForUpdates() {
  log.debug('[MAIN][AUTO-UPDATE]: checking for Updates')
  // ipcMain.emit(ipcMainEvents.CHECK_FOR_UPDATES_START)
  try {
    defaultAutoUpdater.checkForUpdates()
  } catch (error) {
    log.error(`[MAIN][AUTO-UPDATE]: error checking for updates: ${error}`)
  }

  // ipcMain.emit(ipcMainEvents.CHECK_FOR_UPDATES_END)
  log.debug('[MAIN][AUTO-UPDATE]: checking for Updates END')
}

export const checkForUpdates =
  process.platform == 'win32' ? defaultCheckForUpdates : customAutoUpdates

export default function autoUpdate() {
  if (!IS_PROD_DESKTOP) {
    log.debug('[MAIN][AUTO-UPDATE]: Not available in development')
    return
  }
  if (!isAutoUpdateSupported()) {
    log.debug('[MAIN][AUTO-UPDATE]: Auto-Update is not supported')
    return
  }

  if (process.platform == 'win32') {
    setup()
  }

  // Listen for when the window is ready
  app.on('browser-window-created', (_, window) => {
    window.once('show', () => {
      log.debug('[MAIN][AUTO-UPDATE]: Window is ready, starting update check')
      // Initial check after window is ready
      setTimeout(() => {
        checkForUpdates()
      }, 5_000)

      // Set up periodic checks
      setInterval(checkForUpdates, 3_600_000) // every 1 hour
    })
  })
}

// ======================================

// let feedback = false

function isAutoUpdateSupported() {
  // TODO: we need to enable a setting so people can disable auto-updates
  log.info(
    `[AUTO-UPDATE] isAutoUpdateSupported: ${appStore.get(
      APP_AUTO_UPDATE_PREFERENCE,
    )}`,
  )
  return appStore.get(APP_AUTO_UPDATE_PREFERENCE) || 'true' === 'true'
}

function setup() {
  if (IS_PROD_DEV) {
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.StaticStorage,
        baseUrl: `https://seedappdev.s3.eu-west-2.amazonaws.com/dev/${process.platform}/${process.arch}`,
      },
      logger: {
        log: log.debug,
        info: log.info,
        error: log.error,
        warn: log.warn,
      },
    })
  } else {
    // this was the old way of doing it
    const updateUrl = `https://update.electronjs.org/seed-hypermedia/seed/${
      process.platform
    }-${process.arch}/${app.getVersion()}`

    defaultAutoUpdater.setFeedURL({url: updateUrl})
  }

  defaultAutoUpdater.on('error', (message) => {
    log.error(
      `[MAIN][AUTO-UPDATE]: There was a problem updating the application: ${message}`,
    )
  })

  defaultAutoUpdater.on('update-available', async () => {
    log.debug(`[MAIN][AUTO-UPDATE]: update available, download will start`)
    try {
    } catch (error) {}
  })

  defaultAutoUpdater.on(
    'update-downloaded',
    (event, releaseNotes, releaseName) => {
      log.debug('[MAIN][AUTO-UPDATE]: New version downloaded')
      const dialogOpts: MessageBoxOptions = {
        type: 'info',
        buttons: ['Restart', 'Later'],
        title: 'Application Update',
        message: process.platform == 'win32' ? releaseNotes : releaseName,
        detail:
          'A new version has been downloaded. Restart the application to apply the updates.',
      }

      dialog.showMessageBox(dialogOpts).then((returnValue: any) => {
        if (returnValue.response === 0) {
          log.debug('[MAIN][AUTO-UPDATE]: Quit and Install')
          defaultAutoUpdater.quitAndInstall()
        }
      })
    },
  )

  defaultAutoUpdater.on('update-not-available', (event: any) => {
    log.debug('[MAIN][AUTO-UPDATE]: update not available', event)
  })
}

export function customAutoUpdates() {
  log.info('[AUTO-UPDATE]: checking for Updates')

  if (!isAutoUpdateSupported()) {
    log.debug('[AUTO-UPDATE]: Auto-Update is not supported')
    return
  }

  const updater = new AutoUpdater(
    IS_PROD_DEV
      ? 'https://seedappdev.s3.eu-west-2.amazonaws.com/dev/latest.json'
      : 'https://seedreleases.s3.eu-west-2.amazonaws.com/prod/latest.json',
  )
  updater.startAutoCheck()
  updater.checkForUpdates()
}

export class AutoUpdater {
  private checkInterval: NodeJS.Timeout | null = null
  private updateUrl: string
  private checkIntervalMs: number
  private currentUpdateInfo: UpdateInfo | null = null
  private status: UpdateStatus = {type: 'idle'}

  constructor(updateUrl: string, checkIntervalMs: number = 3600000) {
    // 1 hour default
    this.updateUrl = updateUrl
    this.checkIntervalMs = checkIntervalMs
    this.currentUpdateInfo = null
    this.status = {type: 'idle'}

    // Listen for download and install request from renderer
    ipcMain.on('auto-update:download-and-install', () => {
      log.info('[AUTO-UPDATE] Received download and install request')
      if (this.currentUpdateInfo) {
        const asset = this.getAssetForCurrentPlatform(this.currentUpdateInfo)
        if (asset?.download_url) {
          this.downloadAndInstall(asset.download_url)
        } else {
          log.error('[AUTO-UPDATE] No compatible update found for download')
        }
      } else {
        log.error('[AUTO-UPDATE] No update info available for download')
      }
    })

    ipcMain.on('auto-update:set-status', (_, status: UpdateStatus) => {
      this.status = status
      const win = BrowserWindow.getFocusedWindow()
      if (win) {
        win.webContents.send('auto-update:status', this.status)
      }
    })

    ipcMain.on('auto-update:release-notes', () => {
      log.info('[AUTO-UPDATE] Received release notes request')
      if (this.currentUpdateInfo) {
        this.showReleaseNotes()
      }
    })
  }

  private showReleaseNotes() {
    log.info('[AUTO-UPDATE] Showing release notes')
    if (this.currentUpdateInfo?.release_notes) {
      dialog.showMessageBoxSync({
        type: 'info',
        title: 'Update Available',
        message: `${this.currentUpdateInfo?.name}`,
        detail:
          this.currentUpdateInfo.release_notes || 'No release notes available',
        buttons: ['OK'],
      })
    } else {
      log.info('[AUTO-UPDATE] No release notes available')
    }
  }

  async checkForUpdates(): Promise<void> {
    log.info('[AUTO-UPDATE] Checking for updates...')
    const win = BrowserWindow.getFocusedWindow()
    if (!win) {
      log.error('[AUTO-UPDATE] No window found')
      return
    }

    this.status = {type: 'checking'}
    win.webContents.send('auto-update:status', this.status)

    try {
      const response = await fetch(this.updateUrl)
      const updateInfo: UpdateInfo = await response.json()
      log.info(
        `[AUTO-UPDATE] Current version: ${app.getVersion()}, Latest version: ${
          updateInfo.name
        }`,
      )

      if (this.shouldUpdate(updateInfo.name)) {
        log.info(
          '[AUTO-UPDATE] New version available, initiating update process',
        )
        this.status = {type: 'update-available', updateInfo: updateInfo}
        win.webContents.send('auto-update:status', this.status)
        this.currentUpdateInfo = updateInfo // Store the update info
        await this.handleUpdate(updateInfo)
      } else {
        log.info('[AUTO-UPDATE] Application is up to date')
        this.status = {type: 'idle'}
        win.webContents.send('auto-update:status', this.status)
        this.currentUpdateInfo = null
      }
    } catch (error) {
      log.error(`[AUTO-UPDATE] Error checking for updates: ${error}`)
      this.status = {type: 'error', error: JSON.stringify(error)}
      win.webContents.send('auto-update:status', this.status)
      this.currentUpdateInfo = null
    }
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

  private async handleUpdate(updateInfo: UpdateInfo): Promise<void> {
    log.info('[AUTO-UPDATE] Handling update process')
    const asset = this.getAssetForCurrentPlatform(updateInfo)
    if (!asset?.download_url) {
      log.error('[AUTO-UPDATE] No compatible update found')
      return
    }

    log.info('[AUTO-UPDATE] Sending event to renderer')
    const win = BrowserWindow.getFocusedWindow()
    if (!win) {
      log.error('[AUTO-UPDATE] No window found')
      return
    }

    win.webContents.send('auto-update:update-available', updateInfo)

    // const dialogResult = await dialog.showMessageBox({
    //   type: 'info',
    //   title: 'Update Available',
    //   message: `Version ${updateInfo.name} is available. Would you like to update now?`,
    //   detail: updateInfo.release_notes || 'No release notes available',
    //   buttons: ['Yes', 'No'],
    // })

    // this.downloadAndInstall(asset.download_url)

    // if (dialogResult.response === 0) {
    //   await this.downloadAndInstall(asset.download_url)
    // }
  }

  private getAssetForCurrentPlatform(
    updateInfo: UpdateInfo,
  ): UpdateAsset | null {
    log.info(`[AUTO-UPDATE] Getting asset for platform: ${process.platform}`)
    if (process.platform === 'linux') {
      const isRpm = fs.existsSync('/etc/redhat-release')
      log.info(`[AUTO-UPDATE] Linux package type: ${isRpm ? 'RPM' : 'DEB'}`)
      return isRpm
        ? updateInfo.assets.linux?.rpm || null
        : updateInfo.assets.linux?.deb || null
    } else if (process.platform === 'darwin') {
      log.info('[AUTO-UPDATE] Platform: macOS')
      log.info(`[AUTO-UPDATE] Architecture: ${process.arch}`)
      return updateInfo.assets.macos?.[process.arch as 'x64' | 'arm64'] || null
    }
    log.warn('[AUTO-UPDATE] Platform not supported')
    return null
  }

  private async downloadAndInstall(downloadUrl: string): Promise<void> {
    log.info(`[AUTO-UPDATE] Starting download from: ${downloadUrl}`)
    const tempPath = path.join(app.getPath('temp'), 'update')

    if (!fs.existsSync(tempPath)) {
      fs.mkdirSync(tempPath, {recursive: true})
    }

    console.log(`== [AUTO-UPDATE] downloadAndInstall ~ tempPath:`, tempPath)

    const win = BrowserWindow.getFocusedWindow()

    console.log(`== [AUTO-UPDATE] downloadAndInstall ~ win:`, win?.id)
    if (!win) return

    try {
      log.info('[AUTO-UPDATE] Downloading update...')
      this.status = {type: 'downloading', progress: 0}
      win.webContents.send('auto-update:status', this.status)
      session.defaultSession.downloadURL(downloadUrl)
      session.defaultSession.on('will-download', (event: any, item: any) => {
        // Set download path

        const filePath = path.join(app.getPath('downloads'), item.getFilename())
        item.setSavePath(filePath)

        // Monitor download progress
        item.on('updated', (_event: any, state: any) => {
          if (state === 'progressing') {
            if (item.isPaused()) {
              log.info('[AUTO-UPDATE] Download paused')
            } else {
              const received = item.getReceivedBytes()
              const total = item.getTotalBytes()
              const progress = Math.round((received / total) * 100)
              log.info(`[AUTO-UPDATE] Download progress: ${progress}%`)
              this.status = {type: 'downloading', progress: progress}
              win.webContents.send('auto-update:status', this.status)
            }
          }
        })

        // Download complete
        item.once('done', async (event: any, state: any) => {
          if (state === 'completed') {
            this.status = {type: 'restarting'}
            win.webContents.send('auto-update:status', this.status)
            log.info(`[AUTO-UPDATE] Download successfully saved to ${filePath}`)

            if (process.platform === 'darwin') {
              const {exec} = require('child_process')
              const util = require('util')
              const execPromise = util.promisify(exec)
              const fs = require('fs/promises') // Use promises version of fs

              const volumePath = '/Volumes/Seed'
              const appName = IS_PROD_DEV ? 'SeedDev.app' : 'Seed.app'
              const tempPath = path.join(app.getPath('temp'), 'SeedUpdate')
              try {
                // Ensure temp directory exists
                log.info(
                  `[AUTO-UPDATE] Creating temp directory at: ${tempPath}`,
                )
                try {
                  await fs.mkdir(tempPath, {recursive: true})
                } catch (err) {
                  log.error(
                    `[AUTO-UPDATE] Error creating temp directory: ${err}`,
                  )
                  throw err
                }

                // Mount the DMG
                log.info('[AUTO-UPDATE] Mounting DMG...')
                await execPromise(`hdiutil attach "${filePath}"`)

                // Create update script
                const scriptPath = path.join(tempPath, 'update.sh')
                log.info(
                  `[AUTO-UPDATE] Creating update script at: ${scriptPath}`,
                )

                const scriptContent = `#!/bin/bash
                  sleep 2
                  # rm -rf "/Applications/${appName}"
                  # cp -R "${tempPath}/${appName}" "/Applications/"
                  # rm -rf "${tempPath}"
                  open "/Applications/${appName}"
                `

                try {
                  await fs.writeFile(scriptPath, scriptContent, {mode: 0o755}) // Set executable permissions
                  log.info('[AUTO-UPDATE] Update script created successfully')
                } catch (err) {
                  log.error(
                    `[AUTO-UPDATE] Error creating update script: ${err}`,
                  )
                  throw err
                }

                // Execute the update script and quit
                log.info('[AUTO-UPDATE] Executing update script...')
                exec(`"${scriptPath}"`, {detached: true, stdio: 'ignore'})
                app.quit()
              } catch (error) {
                log.error(`[AUTO-UPDATE] Installation error: ${error}`)
                // Clean up if possible
                try {
                  await execPromise(`hdiutil detach "${volumePath}" || true`)
                } catch (cleanupError) {
                  log.error(`[AUTO-UPDATE] Cleanup error: ${cleanupError}`)
                }
              }
            } else if (process.platform === 'linux') {
              try {
                const {exec} = require('child_process')
                const util = require('util')
                const execPromise = util.promisify(exec)
                const fs = require('fs/promises')

                // Determine package type and commands
                const isRpm = filePath.endsWith('.rpm')
                const packageName = IS_PROD_DEV ? 'seed-dev' : 'seed' // Replace with your actual package name
                const removeCmd = isRpm ? 'rpm -e' : 'dpkg -r'
                const installCmd = isRpm ? 'rpm -U' : 'dpkg -i'

                // Create temp directory for the update script
                const tempPath = path.join(app.getPath('temp'), 'SeedUpdate')
                await fs.mkdir(tempPath, {recursive: true})

                // Create update script
                const scriptPath = path.join(tempPath, 'update.sh')
                log.info(
                  `[AUTO-UPDATE] Creating update script at: ${scriptPath}`,
                )

                const scriptContent = `#!/bin/bash
                  sleep 2
                  # Remove existing package
                  pkexec ${removeCmd} ${packageName}
                  
                  # Install new package
                  pkexec ${installCmd} "${filePath}"
                  
                  # Clean up
                  rm -rf "${tempPath}"
                  rm -f "${filePath}"
                  
                  # Start the new version
                  seed
                `

                try {
                  await fs.writeFile(scriptPath, scriptContent, {mode: 0o755})
                  log.info('[AUTO-UPDATE] Update script created successfully')
                } catch (err) {
                  log.error(
                    `[AUTO-UPDATE] Error creating update script: ${err}`,
                  )
                  throw err
                }

                // Execute the update script and quit
                log.info('[AUTO-UPDATE] Executing update script...')
                exec(`"${scriptPath}"`, {detached: true, stdio: 'ignore'})
                app.quit()
              } catch (error) {
                log.error(`[AUTO-UPDATE] Installation error: ${error}`)
                this.status = {type: 'error', error: 'Installation error'}
                win.webContents.send('auto-update:status', this.status)
              }
            }
            log.info(`[AUTO-UPDATE] Download failed: ${state}`)
            this.status = {type: 'error', error: 'Download failed'}
            win.webContents.send('auto-update:status', this.status)
          }
        })
      })
    } catch (error) {
      this.status = {type: 'error', error: 'Download error'}
      win.webContents.send('auto-update:status', this.status)
      log.error(`[AUTO-UPDATE] Download error: ${error}`)
    }
  }

  startAutoCheck(): void {
    log.info(
      `[AUTO-UPDATE] Starting auto-check with interval: ${this.checkIntervalMs}ms`,
    )
    this.checkInterval = setInterval(() => {
      this.checkForUpdates()
    }, this.checkIntervalMs)
  }

  stopAutoCheck(): void {
    log.info('[AUTO-UPDATE] Stopping auto-check')
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  setCheckInterval(ms: number): void {
    log.info(`[AUTO-UPDATE] Setting new check interval: ${ms}ms`)
    this.checkIntervalMs = ms
    if (this.checkInterval) {
      this.stopAutoCheck()
      this.startAutoCheck()
    }
  }
}
