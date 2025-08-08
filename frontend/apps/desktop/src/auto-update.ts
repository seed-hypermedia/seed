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
                  await fs.writeFile(
                    launchScriptPath,
                    `#!/bin/bash
sleep 1
open -n "/Applications/${appName}.app" --args --relaunch-after-update
`,
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
                    fs.writeFileSync(
                      launchScriptPath,
                      `#!/bin/bash
sleep 2
open "/Applications/${appName}.app" --args --relaunch-after-update
`,
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
                ).catch(() => '')
                if (currentVersion) {
                  log.info(`[AUTO-UPDATE] Current version: ${currentVersion}`)
                  await fs.writeFile(
                    path.join(backupPath, 'version.txt'),
                    currentVersion,
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
                  await fs.writeFile(
                    launchScriptPath,
                    `#!/bin/bash
sleep 1
${packageName}
`,
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
                  this.status = {
                    type: 'error',
                    error:
                      error instanceof Error ? error.message : String(error),
                  }
                  win?.webContents.send('auto-update:status', this.status)

                  // Attempt rollback if we have previous version info
                  try {
                    const versionFile = path.join(backupPath, 'version.txt')
                    if (
                      await fs
                        .access(versionFile)
                        .then(() => true)
                        .catch(() => false)
                    ) {
                      const oldVersion = await fs.readFile(versionFile, 'utf-8')
                      log.info(
                        `[AUTO-UPDATE] Rolling back to version: ${oldVersion}`,
                      )

                      // Remove failed new version
                      await execPromise(
                        `pkexec ${removeCmd} ${packageName}`,
                      ).catch(() => {})

                      // For DEB packages, we need to force old version installation
                      if (!isRpm) {
                        const oldVersionNumber = oldVersion.split(' ')[2] // Extract version from dpkg -l output
                        await execPromise(
                          `pkexec apt-get install ${packageName}=${oldVersionNumber}`,
                        )
                      }
                    }
                  } catch (rollbackError) {
                    log.error(`[AUTO-UPDATE] Rollback error: ${rollbackError}`)
                  }

                  // Clean up
                  await cleanup()
                }
              } catch (error) {
                log.error(`[AUTO-UPDATE] Error: ${error}`)
                this.status = {
                  type: 'error',
                  error: error instanceof Error ? error.message : String(error),
                }
                win?.webContents.send('auto-update:status', this.status)
              }
            }
            // log.info(`[AUTO-UPDATE] Download failed: ${state}`)
            // this.status = {type: 'error', error: 'Download failed'}
            // win.webContents.send('auto-update:status', this.status)
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
