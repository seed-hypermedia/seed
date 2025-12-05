import {
  AVOID_UPDATES,
  IS_PROD_DESKTOP,
  IS_PROD_DEV,
} from '@shm/shared/constants'
import {app, BrowserWindow, ipcMain, session, shell} from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {getLastFocusedWindow} from './app-windows'
import * as log from './logger'
import {UpdateAsset, UpdateInfo, UpdateStatus} from './types/updater-types'

import {
  autoUpdater as defaultAutoUpdater,
  dialog,
  MessageBoxOptions,
} from 'electron'
import {updateElectronApp, UpdateSourceType} from 'update-electron-app'

export function defaultCheckForUpdates() {
  log.debug('[MAIN][AUTO-UPDATE]: checking for Updates')

  try {
    defaultAutoUpdater.checkForUpdates()
  } catch (error) {
    log.error(`[MAIN][AUTO-UPDATE]: error checking for updates: ${error}`)
  }

  log.debug('[MAIN][AUTO-UPDATE]: checking for Updates END')
}

export const checkForUpdates =
  process.platform == 'win32' ? defaultCheckForUpdates : customAutoUpdates

export default function autoUpdate() {
  console.log(
    `[AUTO-UPDATE] autoUpdate call INIT`,
    BrowserWindow.getFocusedWindow()?.id,
  )

  if (!IS_PROD_DESKTOP || AVOID_UPDATES) {
    log.debug('[MAIN][AUTO-UPDATE]: Not available in development')
    return
  }

  // Check if running inside Flatpak
  if (isRunningInFlatpak()) {
    log.info(
      '[AUTO-UPDATE] Running inside Flatpak - skipping custom auto-update setup',
    )
    setTimeout(() => {
      handleFlatpakUpdates()
    }, 2000) // Brief delay to ensure UI is ready
    return
  }

  // Check if running as AppImage
  if (isRunningInAppImage()) {
    log.info(
      '[AUTO-UPDATE] Running as AppImage - skipping custom auto-update setup',
    )
    setTimeout(() => {
      handleAppImageUpdates()
    }, 2000) // Brief delay to ensure UI is ready
    return
  }

  // if (!isAutoUpdateSupported()) {
  //   log.debug('[MAIN][AUTO-UPDATE]: Auto-Update is not supported')
  //   return
  // }

  if (process.platform == 'win32') {
    setup()
  }

  // Listen for when the window is ready

  setTimeout(() => {
    log.debug('[AUTO-UPDATE]: TIMEOUT 5000')
    checkForUpdates()
  }, 5000)

  if (process.platform === 'win32') {
    // Set up periodic checks
    setInterval(checkForUpdates, 600_000) // every 10 mins
  }
}

// ======================================

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
    (_event, releaseNotes, releaseName) => {
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

  defaultAutoUpdater.on('update-not-available', () => {
    log.debug('[AUTO-UPDATE]: update not available')
  })
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
  log.info(
    '[AUTO-UPDATE] Running inside Flatpak - using native update mechanism',
  )

  // Send notification to user about Flatpak updates
  const win = getLastFocusedWindow()
  if (win) {
    win.webContents.send('auto-update:status', {
      type: 'flatpak-info',
      message:
        'Updates are handled by your system package manager. Use "flatpak update" or your software center.',
    })
  }
}

function handleAppImageUpdates() {
  log.info(
    '[AUTO-UPDATE] Running as AppImage - using AppImage update mechanism',
  )

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

export function customAutoUpdates() {
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
  updater.checkForUpdates()
}

export class AutoUpdater {
  private checkInterval: NodeJS.Timeout | null = null
  private updateUrl: string
  private checkIntervalMs: number
  private currentUpdateInfo: UpdateInfo | null = null
  private status: UpdateStatus = {type: 'idle'}

  constructor(updateUrl: string, checkIntervalMs: number = 600_000) {
    console.log(`[AUTO-UPDATE] AutoUpdater constructor call START`)
    // 1 hour default
    this.updateUrl = updateUrl
    this.checkIntervalMs = checkIntervalMs
    this.currentUpdateInfo = null
    this.status = {type: 'idle'}

    // Remove any existing handlers to prevent duplicates
    ipcMain.removeAllListeners('auto-update:download-and-install')
    ipcMain.removeAllListeners('auto-update:set-status')
    ipcMain.removeAllListeners('auto-update:release-notes')
    ipcMain.removeAllListeners('auto-update:check-for-updates')

    // Listen for download and install request from renderer
    ipcMain.on('auto-update:download-and-install', () => {
      log.info(
        `[AUTO-UPDATE] Received download and install request (platform: ${process.platform})`,
      )
      if (this.currentUpdateInfo) {
        // For Linux, open GitHub release page instead of downloading
        if (process.platform === 'linux') {
          log.info(`[AUTO-UPDATE] Opening Seed Hypermedia Download page`)
          shell.openExternal('https://seed.hyper.media/hm/download')
          log.info(
            '[AUTO-UPDATE] Linux download request completed - browser opened',
          )
          return
        }

        const asset = this.getAssetForCurrentPlatform(this.currentUpdateInfo)
        if (process.platform === 'darwin') {
          if (asset?.zip_url) {
            this.downloadAndInstall(asset.zip_url)
          } else {
            log.error('[AUTO-UPDATE] No compatible update found for download')
          }
        } else {
          if (asset?.download_url) {
            this.downloadAndInstall(asset.download_url)
          } else {
            log.error('[AUTO-UPDATE] No compatible update found for download')
          }
        }
      } else {
        log.error('[AUTO-UPDATE] No update info available for download')
      }
    })

    ipcMain.on('auto-update:set-status', (_, status: UpdateStatus) => {
      const win = getLastFocusedWindow()
      if (win) {
        this.status = status
        win.webContents.send('auto-update:status', this.status)
      }
    })

    ipcMain.on('auto-update:release-notes', () => {
      log.info('[AUTO-UPDATE] Received release notes request')
      if (this.currentUpdateInfo) {
        this.showReleaseNotes()
      }
    })

    ipcMain.on('auto-update:check-for-updates', () => {
      log.info('[AUTO-UPDATE] Received check for updates request')
      this.checkForUpdates()
    })

    console.log(`[AUTO-UPDATE] AutoUpdater constructor call FINISH`)
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
    log.info('[AUTO-UPDATE] Checking for updates START')
    log.info(`[AUTO-UPDATE] Update URL: ${this.updateUrl}`)
    log.info(`[AUTO-UPDATE] Current app version: ${app.getVersion()}`)
    log.info(
      `[AUTO-UPDATE] Platform: ${process.platform}, Architecture: ${process.arch}`,
    )

    const win = getLastFocusedWindow()
    if (!win) {
      log.error('[AUTO-UPDATE] No window found')
      return
    }

    this.status = {type: 'checking'}
    try {
      win.webContents.send('auto-update:status', this.status)
    } catch (sendError) {
      log.error(`[AUTO-UPDATE] Failed to send checking status: ${sendError}`)
    }

    try {
      log.info(`[AUTO-UPDATE] Fetching update info from: ${this.updateUrl}`)
      const response = await fetch(this.updateUrl)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        log.warn(`[AUTO-UPDATE] Unexpected content type: ${contentType}`)
      }

      const updateInfo: UpdateInfo = await response.json()
      log.info(
        `[AUTO-UPDATE] Received update info for version: ${updateInfo.name}`,
      )
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
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      log.error(`[AUTO-UPDATE] Error checking for updates: ${errorMessage}`)
      log.error(
        `[AUTO-UPDATE] Error stack: ${
          error instanceof Error ? error.stack : 'No stack trace'
        }`,
      )

      this.status = {type: 'error', error: errorMessage}

      try {
        win.webContents.send('auto-update:status', this.status)
      } catch (sendError) {
        log.error(`[AUTO-UPDATE] Failed to send error status: ${sendError}`)
      }

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
    // @ts-ignore
    const v1Parts = v1Base.split('.').map(Number)
    // @ts-ignore
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

    // For all platforms, send update info to renderer to show the popup
    log.info('[AUTO-UPDATE] Sending event to renderer')
    const win = getLastFocusedWindow()
    if (!win) {
      log.error('[AUTO-UPDATE] No window found')
      return
    }

    this.status = {type: 'update-available', updateInfo: updateInfo}
    win.webContents.send('auto-update:status', this.status)
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

    // Validate download URL
    if (!downloadUrl || typeof downloadUrl !== 'string') {
      log.error(`[AUTO-UPDATE] Invalid download URL: ${downloadUrl}`)
      throw new Error('Invalid download URL')
    }

    const tempPath = path.join(app.getPath('temp'), 'update')
    log.info(`[AUTO-UPDATE] Using temp path: ${tempPath}`)

    try {
      if (!fs.existsSync(tempPath)) {
        log.info(`[AUTO-UPDATE] Creating temp directory: ${tempPath}`)
        fs.mkdirSync(tempPath, {recursive: true})
      }
    } catch (error) {
      log.error(`[AUTO-UPDATE] Failed to create temp directory: ${error}`)
      throw new Error(`Failed to create temp directory: ${error}`)
    }

    const win = getLastFocusedWindow()
    log.info(`[AUTO-UPDATE] Active window ID: ${win?.id || 'none'}`)

    if (!win) {
      log.error('[AUTO-UPDATE] No active window found')
      throw new Error('No active window found')
    }

    try {
      log.info('[AUTO-UPDATE] Downloading update...')
      this.status = {type: 'downloading', progress: 0}
      win.webContents.send('auto-update:status', this.status)
      log.info(`[AUTO-UPDATE] Initiating download for: ${downloadUrl}`)
      session.defaultSession.downloadURL(downloadUrl)

      session.defaultSession.on('will-download', (_event: any, item: any) => {
        log.info(
          `[AUTO-UPDATE] Download started for file: ${
            item?.getFilename() || 'unknown'
          }`,
        )
        // Set download path
        let filePath: string
        try {
          const fileName = item.getFilename()
          if (!fileName) {
            throw new Error('No filename available from download item')
          }
          filePath = path.join(app.getPath('downloads'), fileName)
          log.info(`[AUTO-UPDATE] Setting download path to: ${filePath}`)
          item.setSavePath(filePath)
        } catch (error) {
          log.error(`[AUTO-UPDATE] Failed to set download path: ${error}`)
          this.status = {type: 'error', error: 'Failed to set download path'}
          win.webContents.send('auto-update:status', this.status)
          return
        }

        // Monitor download progress
        item.on('updated', (_event: any, state: any) => {
          try {
            if (state === 'progressing') {
              if (item.isPaused()) {
                log.info('[AUTO-UPDATE] Download paused')
              } else {
                const received = item.getReceivedBytes()
                const total = item.getTotalBytes()
                if (total > 0) {
                  const progress = Math.round((received / total) * 100)
                  log.info(
                    `[AUTO-UPDATE] Download progress: ${progress}% (${received}/${total} bytes)`,
                  )
                  this.status = {type: 'downloading', progress: progress}
                  win.webContents.send('auto-update:status', this.status)
                } else {
                  log.warn('[AUTO-UPDATE] Total download size is 0')
                }
              }
            } else {
              log.info(`[AUTO-UPDATE] Download state changed to: ${state}`)
            }
          } catch (error) {
            log.error(
              `[AUTO-UPDATE] Error during download progress update: ${error}`,
            )
          }
        })

        // Download complete
        item.once('done', async (_event: any, state: any) => {
          log.info(`[AUTO-UPDATE] Download completed with state: ${state}`)

          if (state === 'completed') {
            try {
              // Verify the file exists and has content
              const stats = await require('fs/promises').stat(filePath)
              log.info(
                `[AUTO-UPDATE] Downloaded file size: ${stats.size} bytes`,
              )

              if (stats.size === 0) {
                throw new Error('Downloaded file is empty')
              }

              this.status = {type: 'restarting'}
              win.webContents.send('auto-update:status', this.status)
              log.info(
                `[AUTO-UPDATE] Download successfully saved to ${filePath}`,
              )

              // Test mode - skip actual installation
              if (process.env.AUTO_UPDATE_TEST_MODE === 'true') {
                log.info(
                  '[AUTO-UPDATE] TEST MODE: Skipping installation and restart',
                )
                this.status = {type: 'idle'}
                win.webContents.send('auto-update:status', this.status)
                return
              }
            } catch (verifyError) {
              log.error(
                `[AUTO-UPDATE] Download verification failed: ${verifyError}`,
              )
              this.status = {
                type: 'error',
                error: 'Download verification failed',
              }
              win.webContents.send('auto-update:status', this.status)
              return
            }

            if (process.platform === 'darwin') {
              const {exec} = require('child_process')
              const util = require('util')
              const execPromise = util.promisify(exec)
              const fs = require('fs/promises')

              const appName = IS_PROD_DEV ? 'SeedDev' : 'Seed'
              const tempPath = path.join(app.getPath('temp'), 'SeedUpdate')
              const backupPath = path.join(tempPath, 'backup')
              const unzipPath = path.join(tempPath, 'unzip')

              log.info(`[AUTO-UPDATE] Variables for macOS update:`)
              log.info(`[AUTO-UPDATE] - App name: ${appName}`)
              log.info(`[AUTO-UPDATE] - Temp path: ${tempPath}`)
              log.info(`[AUTO-UPDATE] - Backup path: ${backupPath}`)
              log.info(`[AUTO-UPDATE] - Unzip path: ${unzipPath}`)
              log.info(`[AUTO-UPDATE] - File path: ${filePath}`)

              const rollback = async () => {
                log.info('[AUTO-UPDATE] Rolling back changes...')
                try {
                  // If backup exists, restore it
                  if (
                    await fs
                      .access(backupPath)
                      .then(() => true)
                      .catch(() => false)
                  ) {
                    log.info('[AUTO-UPDATE] Restoring backup...')
                    // Remove failed new version if it exists
                    await fs
                      .rm(`/Applications/${appName}.app`, {
                        recursive: true,
                        force: true,
                      })
                      .catch(() => {})
                    // Restore backup
                    await execPromise(
                      `cp -R "${backupPath}/${appName}.app" "/Applications/"`,
                    )
                    log.info('[AUTO-UPDATE] Backup restored successfully')
                  }
                } catch (error) {
                  log.error(`[AUTO-UPDATE] Error during rollback: ${error}`)
                }
              }

              const cleanup = async () => {
                log.info('[AUTO-UPDATE] Cleaning up...')
                try {
                  // Remove temp directories and downloaded file
                  await fs
                    .rm(tempPath, {recursive: true, force: true})
                    .catch(() => {})
                  await fs.rm(filePath, {force: true}).catch(() => {})
                } catch (error) {
                  log.error(`[AUTO-UPDATE] Error during cleanup: ${error}`)
                }
              }

              try {
                // Create temp directories
                await fs.mkdir(tempPath, {recursive: true})
                await fs.mkdir(backupPath, {recursive: true})
                await fs.mkdir(unzipPath, {recursive: true})

                // Backup existing app if it exists
                if (
                  await fs
                    .access(`/Applications/${appName}.app`)
                    .then(() => true)
                    .catch(() => false)
                ) {
                  log.info('[AUTO-UPDATE] Backing up existing app...')
                  await execPromise(
                    `cp -R "/Applications/${appName}.app" "${backupPath}/"`,
                  )
                }

                // Unzip new version
                log.info('[AUTO-UPDATE] Unzipping update...')
                await execPromise(`unzip -o "${filePath}" -d "${unzipPath}"`)

                // Verify the unzipped app exists
                const unzippedAppPath = path.join(unzipPath, `${appName}.app`)
                if (
                  !(await fs
                    .access(unzippedAppPath)
                    .then(() => true)
                    .catch(() => false))
                ) {
                  throw new Error('Unzipped app not found')
                }

                // Remove existing app
                log.info('[AUTO-UPDATE] Removing existing app...')
                await fs
                  .rm(`/Applications/${appName}.app`, {
                    recursive: true,
                    force: true,
                  })
                  .catch(() => {})

                // Install new version
                log.info('[AUTO-UPDATE] Installing new version...')
                await execPromise(`cp -R "${unzippedAppPath}" "/Applications/"`)

                // Verify installation
                if (
                  !(await fs
                    .access(`/Applications/${appName}.app`)
                    .then(() => true)
                    .catch(() => false))
                ) {
                  throw new Error('New version not installed correctly')
                }

                // Set permissions
                log.info('[AUTO-UPDATE] Setting permissions...')
                await execPromise(
                  `chmod -R u+rwx "/Applications/${appName}.app"`,
                )

                // Clean up
                await cleanup()

                log.info('[AUTO-UPDATE] Update completed successfully')

                // Start new version and quit current
                log.info('[AUTO-UPDATE] Starting new version...')
                try {
                  // Create a temporary script to launch the new app after this one quits
                  const launchScriptPath = path.join(
                    app.getPath('temp'),
                    'launch-seed.sh',
                  )
                  const scriptContent = `#!/bin/bash
sleep 1
open -n "/Applications/${appName}.app" --args --relaunch-after-update
`
                  log.info(
                    `[AUTO-UPDATE] Creating launch script at: ${launchScriptPath}`,
                  )
                  log.info(`[AUTO-UPDATE] Script content: ${scriptContent}`)
                  await fs.writeFile(
                    launchScriptPath,
                    scriptContent,
                    {mode: 0o755}, // Make executable
                  )

                  // Execute the script in the background
                  exec(`"${launchScriptPath}"`, {
                    detached: true,
                    stdio: 'ignore',
                  })

                  // Quit the current app
                  log.info('[AUTO-UPDATE] Quitting current version...')

                  app.quit()
                } catch (startError) {
                  log.error(
                    `[AUTO-UPDATE] Error starting new version: ${startError}`,
                  )
                  // If the first attempt fails, try one more time with direct approach
                  try {
                    const launchScriptPath = path.join(
                      app.getPath('temp'),
                      'launch-seed-retry.sh',
                    )
                    const retryScriptContent = `#!/bin/bash
sleep 2
open "/Applications/${appName}.app" --args --relaunch-after-update
`
                    log.info(
                      `[AUTO-UPDATE] Creating retry launch script at: ${launchScriptPath}`,
                    )
                    log.info(
                      `[AUTO-UPDATE] Retry script content: ${retryScriptContent}`,
                    )
                    fs.writeFileSync(
                      launchScriptPath,
                      retryScriptContent,
                      {mode: 0o755}, // Make executable
                    )

                    exec(`"${launchScriptPath}"`, {
                      detached: true,
                      stdio: 'ignore',
                    })

                    app.quit()
                  } catch (retryError) {
                    log.error(
                      `[AUTO-UPDATE] Retry to start new version failed: ${retryError}`,
                    )
                    throw new Error('Failed to start new version after update')
                  }
                }
              } catch (error) {
                log.error(`[AUTO-UPDATE] Installation error: ${error}`)
                this.status = {
                  type: 'error',
                  error: error instanceof Error ? error.message : String(error),
                }
                win?.webContents.send('auto-update:status', this.status)

                // Attempt rollback
                await rollback()
                // Clean up
                await cleanup()
              }
            } else if (process.platform === 'linux') {
              log.info('[AUTO-UPDATE] Starting Linux update process')
              try {
                const {exec} = require('child_process')
                const util = require('util')
                const execPromise = util.promisify(exec)
                const fs = require('fs/promises')

                // Determine package type and commands
                const isRpm = filePath.endsWith('.rpm')
                const packageName = IS_PROD_DEV ? 'seed-dev' : 'seed'
                const removeCmd = isRpm ? 'rpm -e' : 'dpkg -r'
                const installCmd = isRpm ? 'rpm -U' : 'dpkg -i'
                const tempPath = path.join(app.getPath('temp'), 'SeedUpdate')
                const backupPath = path.join(tempPath, 'backup')

                // Ensure the downloaded file has the correct extension
                const fileExt = isRpm ? '.rpm' : '.deb'
                const finalPackagePath = filePath.endsWith(fileExt)
                  ? filePath
                  : `${filePath}${fileExt}`

                // Rename the file if needed
                if (filePath !== finalPackagePath) {
                  await fs.rename(filePath, finalPackagePath)
                }

                log.info(`[AUTO-UPDATE] Variables for Linux update:`)
                log.info(
                  `[AUTO-UPDATE] - Package type: ${isRpm ? 'RPM' : 'DEB'}`,
                )
                log.info(`[AUTO-UPDATE] - Package name: ${packageName}`)
                log.info(`[AUTO-UPDATE] - Remove command: ${removeCmd}`)
                log.info(`[AUTO-UPDATE] - Install command: ${installCmd}`)
                log.info(`[AUTO-UPDATE] - Temp path: ${tempPath}`)
                log.info(`[AUTO-UPDATE] - Backup path: ${backupPath}`)
                log.info(`[AUTO-UPDATE] - File path: ${finalPackagePath}`)

                const cleanup = async () => {
                  log.info('[AUTO-UPDATE] Cleaning up...')
                  try {
                    await fs
                      .rm(tempPath, {recursive: true, force: true})
                      .catch(() => {})
                    await fs.rm(finalPackagePath, {force: true}).catch(() => {})
                  } catch (error) {
                    log.error(`[AUTO-UPDATE] Error during cleanup: ${error}`)
                  }
                }

                // Create temp directories
                await fs.mkdir(tempPath, {recursive: true})
                await fs.mkdir(backupPath, {recursive: true})

                // Validate package format before installation
                if (!isRpm) {
                  try {
                    log.info(
                      '[AUTO-UPDATE] Validating Debian package format...',
                    )
                    await execPromise(`dpkg-deb -I "${finalPackagePath}"`)
                    log.info(
                      '[AUTO-UPDATE] Package format validation successful',
                    )
                  } catch (error) {
                    log.error(
                      `[AUTO-UPDATE] Invalid Debian package format: ${error}`,
                    )
                    throw new Error('Invalid Debian package format')
                  }
                }

                // Save current package version for rollback
                const currentVersion = await execPromise(
                  `${
                    isRpm ? 'rpm -q' : 'dpkg -l'
                  } ${packageName} | grep ${packageName}`,
                )
                  .then((result: any) => result.stdout.trim())
                  .catch(() => '')

                if (currentVersion && currentVersion.length > 0) {
                  log.info(`[AUTO-UPDATE] Current version: ${currentVersion}`)
                  await fs.writeFile(
                    path.join(backupPath, 'version.txt'),
                    currentVersion,
                  )
                } else {
                  log.warn(
                    '[AUTO-UPDATE] Could not detect current package version for rollback',
                  )
                }

                // Install new package
                log.info('[AUTO-UPDATE] Installing new package...')
                try {
                  // Remove old package first (ignore errors as it might not exist)
                  await execPromise(`pkexec ${removeCmd} ${packageName}`).catch(
                    () => {},
                  )

                  // Install new package
                  const result = await execPromise(
                    `pkexec ${installCmd} "${finalPackagePath}"`,
                  )
                  log.info(
                    `[AUTO-UPDATE] Installation output: ${result.stdout}`,
                  )

                  // Verify installation
                  const verifyCmd = isRpm
                    ? `rpm -q ${packageName}`
                    : `dpkg -l ${packageName}`
                  const verifyResult = await execPromise(verifyCmd)
                  if (!verifyResult.stdout.includes(packageName)) {
                    throw new Error('Package verification failed')
                  }

                  // Clean up
                  await cleanup()

                  log.info('[AUTO-UPDATE] Update completed successfully')

                  // Start new version and quit current
                  log.info('[AUTO-UPDATE] Starting new version...')

                  // Create a temporary script to launch the new app after this one quits
                  const launchScriptPath = path.join(tempPath, 'launch-seed.sh')
                  const linuxScriptContent = `#!/bin/bash
sleep 1
${packageName}
`
                  log.info(
                    `[AUTO-UPDATE] Creating Linux launch script at: ${launchScriptPath}`,
                  )
                  log.info(
                    `[AUTO-UPDATE] Linux script content: ${linuxScriptContent}`,
                  )

                  // Create temp directory if it doesn't exist
                  if (!fs.existsSync(tempPath)) {
                    await fs.mkdir(tempPath, {recursive: true})
                  }

                  await fs.writeFile(
                    launchScriptPath,
                    linuxScriptContent,
                    {mode: 0o755}, // Make executable
                  )

                  // Execute the script in the background
                  exec(`"${launchScriptPath}"`, {
                    detached: true,
                    stdio: 'ignore',
                  })

                  // Quit current app

                  log.info('[AUTO-UPDATE] Quitting app...')
                  app.quit()
                } catch (error) {
                  log.error(`[AUTO-UPDATE] Installation error: ${error}`)
                  const errorMessage =
                    error instanceof Error ? error.message : String(error)
                  log.error(
                    `[AUTO-UPDATE] Installation error details: ${errorMessage}`,
                  )
                  this.status = {
                    type: 'error',
                    error: errorMessage,
                  }
                  win?.webContents.send('auto-update:status', this.status)

                  // Attempt rollback if we have previous version info
                  try {
                    log.info('[AUTO-UPDATE] Attempting rollback...')
                    const versionFile = path.join(backupPath, 'version.txt')
                    if (
                      await fs
                        .access(versionFile)
                        .then(() => true)
                        .catch(() => false)
                    ) {
                      const oldVersion = await fs.readFile(versionFile, 'utf-8')
                      log.info(
                        `[AUTO-UPDATE] Rolling back to version: ${oldVersion.trim()}`,
                      )

                      // Remove failed new version
                      await execPromise(
                        `pkexec ${removeCmd} ${packageName}`,
                      ).catch((removeError: any) => {
                        log.warn(
                          `[AUTO-UPDATE] Could not remove failed package: ${removeError}`,
                        )
                      })

                      // For DEB packages, we need to force old version installation
                      if (!isRpm) {
                        // Parse version from command output
                        let oldVersionNumber = ''
                        if (isRpm) {
                          // rpm -q output: "package-version-release"
                          oldVersionNumber = oldVersion.trim()
                        } else {
                          // dpkg -l output: "ii  package  version  architecture  description"
                          const parts = oldVersion.trim().split(/\s+/)
                          if (parts.length >= 3) {
                            oldVersionNumber = parts[2]
                          }
                        }

                        if (oldVersionNumber) {
                          log.info(
                            `[AUTO-UPDATE] Attempting to reinstall version: ${oldVersionNumber}`,
                          )
                          if (isRpm) {
                            // For RPM, we would need the original package file
                            log.warn(
                              '[AUTO-UPDATE] RPM rollback requires original package file - not implemented',
                            )
                          } else {
                            await execPromise(
                              `pkexec apt-get install ${packageName}=${oldVersionNumber} --allow-downgrades -y`,
                            ).catch((reinstallError: any) => {
                              log.error(
                                `[AUTO-UPDATE] Could not reinstall old version: ${reinstallError}`,
                              )
                            })
                          }
                        } else {
                          log.error(
                            '[AUTO-UPDATE] Could not parse old version number from backup',
                          )
                        }
                      }
                    } else {
                      log.warn(
                        '[AUTO-UPDATE] No version file found for rollback',
                      )
                    }
                  } catch (rollbackError) {
                    log.error(`[AUTO-UPDATE] Rollback error: ${rollbackError}`)
                  }

                  // Clean up
                  await cleanup()
                }
              } catch (error) {
                const errorMessage =
                  error instanceof Error ? error.message : String(error)
                log.error(`[AUTO-UPDATE] Linux update error: ${errorMessage}`)
                this.status = {
                  type: 'error',
                  error: errorMessage,
                }
                win?.webContents.send('auto-update:status', this.status)
              }
            } else if (process.platform === 'win32') {
              log.info('[AUTO-UPDATE] Starting Windows update process')
              try {
                const {exec} = require('child_process')
                const util = require('util')
                const execPromise = util.promisify(exec)
                const fs = require('fs/promises')

                // Windows installer should be .exe or .msi
                const isExe = filePath.endsWith('.exe')
                const isMsi = filePath.endsWith('.msi')
                const appName = IS_PROD_DEV ? 'SeedDev' : 'Seed'
                const tempPath = path.join(app.getPath('temp'), 'SeedUpdate')
                const backupPath = path.join(tempPath, 'backup')

                log.info(`[AUTO-UPDATE] Variables for Windows update:`)
                log.info(`[AUTO-UPDATE] - Is EXE: ${isExe}`)
                log.info(`[AUTO-UPDATE] - Is MSI: ${isMsi}`)
                log.info(`[AUTO-UPDATE] - App name: ${appName}`)
                log.info(`[AUTO-UPDATE] - Temp path: ${tempPath}`)
                log.info(`[AUTO-UPDATE] - Backup path: ${backupPath}`)
                log.info(`[AUTO-UPDATE] - File path: ${filePath}`)

                const cleanup = async () => {
                  log.info('[AUTO-UPDATE] Cleaning up Windows update files...')
                  try {
                    await fs
                      .rm(tempPath, {recursive: true, force: true})
                      .catch(() => {})
                    await fs.rm(filePath, {force: true}).catch(() => {})
                  } catch (error) {
                    log.error(
                      `[AUTO-UPDATE] Error during Windows cleanup: ${error}`,
                    )
                  }
                }

                // Create temp directories
                await fs.mkdir(tempPath, {recursive: true})
                await fs.mkdir(backupPath, {recursive: true})

                if (isExe || isMsi) {
                  log.info(
                    `[AUTO-UPDATE] Installing Windows ${
                      isExe ? 'EXE' : 'MSI'
                    } package...`,
                  )

                  // For EXE installers, run silently
                  if (isExe) {
                    const installResult = await execPromise(`"${filePath}" /S`)
                    log.info(
                      `[AUTO-UPDATE] EXE installation output: ${installResult.stdout}`,
                    )
                  } else if (isMsi) {
                    // For MSI installers, use msiexec
                    const installResult = await execPromise(
                      `msiexec /i "${filePath}" /quiet /norestart`,
                    )
                    log.info(
                      `[AUTO-UPDATE] MSI installation output: ${installResult.stdout}`,
                    )
                  }

                  // Clean up
                  await cleanup()

                  log.info(
                    '[AUTO-UPDATE] Windows update completed successfully',
                  )

                  // Create a temporary batch script to restart the app
                  const launchScriptPath = path.join(
                    tempPath,
                    'launch-seed.bat',
                  )
                  const windowsScriptContent = `@echo off
timeout /t 2 /nobreak >nul
start "" "${app.getPath('exe')}"
`

                  log.info(
                    `[AUTO-UPDATE] Creating Windows launch script at: ${launchScriptPath}`,
                  )
                  log.info(
                    `[AUTO-UPDATE] Windows script content: ${windowsScriptContent}`,
                  )

                  // Recreate temp directory for the script
                  await fs.mkdir(tempPath, {recursive: true})
                  await fs.writeFile(launchScriptPath, windowsScriptContent)

                  // Execute the script in the background
                  exec(`"${launchScriptPath}"`, {
                    detached: true,
                    stdio: 'ignore',
                  })

                  // Quit current app
                  log.info('[AUTO-UPDATE] Quitting Windows app...')
                  app.quit()
                } else {
                  throw new Error(
                    'Unsupported Windows installer format. Expected .exe or .msi',
                  )
                }
              } catch (error) {
                const errorMessage =
                  error instanceof Error ? error.message : String(error)
                log.error(
                  `[AUTO-UPDATE] Windows installation error: ${errorMessage}`,
                )
                this.status = {
                  type: 'error',
                  error: errorMessage,
                }
                win?.webContents.send('auto-update:status', this.status)
              }
            } else {
              log.error(
                `[AUTO-UPDATE] Unsupported platform: ${process.platform}`,
              )
              this.status = {
                type: 'error',
                error: `Unsupported platform: ${process.platform}`,
              }
              win?.webContents.send('auto-update:status', this.status)
            }
          } else {
            log.error(`[AUTO-UPDATE] Download failed with state: ${state}`)
            this.status = {type: 'error', error: `Download failed: ${state}`}
            win?.webContents.send('auto-update:status', this.status)
          }
        })
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      log.error(`[AUTO-UPDATE] Download initiation error: ${errorMessage}`)
      log.error(
        `[AUTO-UPDATE] Error stack: ${
          error instanceof Error ? error.stack : 'No stack trace'
        }`,
      )

      this.status = {
        type: 'error',
        error: `Download error: ${errorMessage}`,
      }

      try {
        win.webContents.send('auto-update:status', this.status)
      } catch (sendError) {
        log.error(
          `[AUTO-UPDATE] Failed to send error status to renderer: ${sendError}`,
        )
      }
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

const JSONUrl =
  process.env.AUTO_UPDATE_TEST_URL ||
  (IS_PROD_DEV
    ? 'https://seedappdev.s3.eu-west-2.amazonaws.com/dev/latest.json'
    : 'https://seedreleases.s3.eu-west-2.amazonaws.com/prod/latest.json')

const updater = new AutoUpdater(JSONUrl)
