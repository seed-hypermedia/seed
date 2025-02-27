import {IS_PROD_DESKTOP, IS_PROD_DEV} from '@shm/shared/constants'
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

  if (!IS_PROD_DESKTOP) {
    log.debug('[MAIN][AUTO-UPDATE]: Not available in development')
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

// let feedback = false

function isAutoUpdateSupported() {
  // TODO: we need to enable a setting so people can disable auto-updates
  return true
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

  defaultAutoUpdater.on('update-not-available', () => {
    log.debug('[AUTO-UPDATE]: update not available')
  })
}

export function customAutoUpdates() {
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
      const win = BrowserWindow.getFocusedWindow()
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
    return v1 === v2 ? 0 : 1
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
              const fs = require('fs/promises')

              const appName = IS_PROD_DEV ? 'SeedDev' : 'Seed'
              const volumePath = `/Volumes/${appName}`
              const tempPath = path.join(app.getPath('temp'), 'SeedUpdate')
              const scriptPath = path.join(tempPath, 'update.sh')

              log.info(`[AUTO-UPDATE] Variables for macOS update:`)
              log.info(`[AUTO-UPDATE] - volumePath: ${volumePath}`)
              log.info(`[AUTO-UPDATE] - appName: ${appName}`)
              log.info(`[AUTO-UPDATE] - tempPath: ${tempPath}`)
              log.info(`[AUTO-UPDATE] - IS_PROD_DEV: ${IS_PROD_DEV}`)

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
                log.info(
                  `[AUTO-UPDATE] Creating update script at: ${scriptPath}`,
                )

                const scriptContent = `#!/bin/bash
                  set -e  # Exit on any error
                  
                  echo "[UPDATE] Starting macOS update process..."
                  
                  # Wait for any file operations to complete
                  sleep 2
                  
                  # Check if the DMG is properly mounted and find the actual mount point
                  MOUNT_POINT=$(hdiutil info | grep "${volumePath}" | awk '{print $1}')
                  if [ -z "$MOUNT_POINT" ]; then
                    echo "[UPDATE] Error: DMG not properly mounted"
                    exit 1
                  fi
                  
                  # Check if the new app exists in the DMG
                  if [ ! -d "${volumePath}/${appName}.app" ]; then
                    echo "[UPDATE] Error: New app not found in DMG at ${volumePath}/${appName}.app"
                    ls -la "${volumePath}" || true
                    exit 1
                  fi
                  
                  echo "[UPDATE] Removing existing app..."
                  # Remove existing app (with sudo if needed)
                  if [ -d "/Applications/${appName}.app" ]; then
                    rm -rf "/Applications/${appName}.app" || sudo rm -rf "/Applications/${appName}.app"
                  fi
                  
                  echo "[UPDATE] Installing new version..."
                  # Copy new app from mounted DMG to Applications
                  cp -R "${volumePath}/${appName}.app" "/Applications/" || sudo cp -R "${volumePath}/${appName}.app" "/Applications/"
                  
                  # Verify the copy was successful
                  if [ ! -d "/Applications/${appName}.app" ]; then
                    echo "[UPDATE] Error: Failed to copy new app to Applications"
                    exit 1
                  fi
                  
                  echo "[UPDATE] Cleaning up..."
                  # Unmount the DMG
                  hdiutil detach "$MOUNT_POINT" -force || true
                  
                  # Clean up
                  rm -rf "${tempPath}"
                  rm -f "${filePath}"
                  
                  echo "[UPDATE] Starting new version..."
                  # Open the new app
                  open "/Applications/${appName}.app"
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
                // Remove quotes around scriptPath and use absolute path
                exec(scriptPath, {detached: true, stdio: 'inherit'})
                setTimeout(() => {
                  log.info('[AUTO-UPDATE] Quitting app...')
                  app.quit()
                }, 10) // Give the script a chance to start
              } catch (error) {
                log.error(`[AUTO-UPDATE] Installation error: ${error}`)
                // Clean up if possible
                try {
                  log.info('[AUTO-UPDATE] Detaching DMG...')
                  await execPromise(`hdiutil detach "${volumePath}" || true`)
                } catch (cleanupError) {
                  log.error(`[AUTO-UPDATE] Cleanup error: ${cleanupError}`)
                }
              }
            } else if (process.platform === 'linux') {
              try {
                const {exec} = require('child_process')
                const fs = require('fs/promises')

                // Determine package type and commands
                const isRpm = filePath.endsWith('.rpm')
                const appName = IS_PROD_DEV ? 'seed-dev' : 'seed'
                const removeCmd = isRpm ? 'rpm -e' : 'dpkg -r'
                const installCmd = isRpm ? 'rpm -U' : 'dpkg -i'
                const tempPath = path.join(app.getPath('temp'), 'SeedUpdate')
                const scriptPath = path.join(tempPath, 'update.sh')

                log.info(`[AUTO-UPDATE] Variables for Linux update:`)
                log.info(
                  `[AUTO-UPDATE] - Package type: ${isRpm ? 'RPM' : 'DEB'}`,
                )
                log.info(`[AUTO-UPDATE] - App name: ${appName}`)
                log.info(`[AUTO-UPDATE] - Remove command: ${removeCmd}`)
                log.info(`[AUTO-UPDATE] - Install command: ${installCmd}`)
                log.info(`[AUTO-UPDATE] - Temp path: ${tempPath}`)
                log.info(`[AUTO-UPDATE] - IS_PROD_DEV: ${IS_PROD_DEV}`)
                log.info(`[AUTO-UPDATE] - File path: ${filePath}`)

                const scriptContent = `#!/bin/bash
                  set -e  # Exit on any error
                  
                  echo "[UPDATE] Starting Linux update process..."
                  
                  
                  echo "[UPDATE] Removing existing package..."
                  # Remove existing package with error handling
                  if command -v pkexec > /dev/null; then
                    if ! pkexec ${removeCmd} ${appName}; then
                      echo "[UPDATE] Warning: Failed to remove old package, continuing anyway..."
                    fi
                  else
                    echo "[UPDATE] Error: pkexec not found, trying with sudo..."
                    if ! sudo ${removeCmd} ${appName}; then
                      echo "[UPDATE] Warning: Failed to remove old package, continuing anyway..."
                    fi
                  fi
                  
                  echo "[UPDATE] Installing new package..."
                  # Install new package
                  if command -v pkexec > /dev/null; then
                    
                    if ! sudo ${installCmd} "${filePath}"; then
                      echo "[UPDATE] Error: Failed to install new package"
                      exit 1
                    fi
                  fi
                  
                  echo "[UPDATE] Verifying installation..."
                  # Verify the installation
                  if ! command -v ${appName} > /dev/null; then
                    echo "[UPDATE] Error: New version not properly installed"
                    dpkg -l ${appName} || rpm -q ${appName} || true
                    exit 1
                  fi
                  
                  echo "[UPDATE] Cleaning up..."
                  # Clean up
                  rm -rf "${tempPath}"
                  rm -f "${filePath}"
                  echo "[UPDATE] Cleanup completed"
                  
                  echo "[UPDATE] Starting new version..."
                  # Start the new version using nohup to keep it running
                  ( nohup ${appName} > /dev/null 2>&1 & )
                  
                  echo "[UPDATE] Update completed successfully"
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
                // Remove quotes around scriptPath and use absolute path
                exec(scriptPath, {detached: true, stdio: 'inherit'})
                app.quit() // Give the script a chance to start
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

const JSONUrl = IS_PROD_DEV
  ? 'https://seedappdev.s3.eu-west-2.amazonaws.com/dev/latest.json'
  : 'https://seedreleases.s3.eu-west-2.amazonaws.com/prod/latest.json'

const updater = new AutoUpdater(JSONUrl)
