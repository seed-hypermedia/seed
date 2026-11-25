import {IS_PROD_DEV} from '@shm/shared/constants'
import {app} from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {getAllWindows} from './app-windows'
import {shutdownDaemonForUpdate} from './daemon'
import {stopApiServer} from './app-http-server'
import {stopLocalServer} from './local-server'
import * as log from './logger'

/** Runs the platform installer after the update actor has received restart consent. */
export async function installUpdate(filePath: string): Promise<void> {
  if (process.env.AUTO_UPDATE_TEST_MODE === 'true') {
    log.info('[AUTO-UPDATE] TEST MODE: Skipping installation and restart')
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
          await execPromise(`cp -R "${backupPath}/${appName}.app" "/Applications/"`)
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
        await fs.rm(tempPath, {recursive: true, force: true}).catch(() => {})
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
        await execPromise(`cp -R "/Applications/${appName}.app" "${backupPath}/"`)
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
      await execPromise(`chmod -R u+rwx "/Applications/${appName}.app"`)

      // Clean up
      await cleanup()

      log.info('[AUTO-UPDATE] Update completed successfully')

      // Start new version and quit current
      log.info('[AUTO-UPDATE] Starting new version...')
      try {
        // Create a temporary script to launch the new app after this one quits
        const launchScriptPath = path.join(app.getPath('temp'), 'launch-seed.sh')
        const scriptContent = `#!/bin/bash
sleep 1
open -n "/Applications/${appName}.app" --args --relaunch-after-update
`
        log.info(`[AUTO-UPDATE] Creating launch script at: ${launchScriptPath}`)
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
        log.error(`[AUTO-UPDATE] Error starting new version: ${startError}`)
        // If the first attempt fails, try one more time with direct approach
        try {
          const launchScriptPath = path.join(app.getPath('temp'), 'launch-seed-retry.sh')
          const retryScriptContent = `#!/bin/bash
sleep 2
open "/Applications/${appName}.app" --args --relaunch-after-update
`
          log.info(`[AUTO-UPDATE] Creating retry launch script at: ${launchScriptPath}`)
          log.info(`[AUTO-UPDATE] Retry script content: ${retryScriptContent}`)
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
          log.error(`[AUTO-UPDATE] Retry to start new version failed: ${retryError}`)
          throw new Error('Failed to start new version after update')
        }
      }
    } catch (error) {
      log.error(`[AUTO-UPDATE] Installation error: ${error}`)

      // Attempt rollback
      await rollback()
      // Clean up
      await cleanup()
      throw error
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
      const finalPackagePath = filePath.endsWith(fileExt) ? filePath : `${filePath}${fileExt}`

      // Rename the file if needed
      if (filePath !== finalPackagePath) {
        await fs.rename(filePath, finalPackagePath)
      }

      log.info(`[AUTO-UPDATE] Variables for Linux update:`)
      log.info(`[AUTO-UPDATE] - Package type: ${isRpm ? 'RPM' : 'DEB'}`)
      log.info(`[AUTO-UPDATE] - Package name: ${packageName}`)
      log.info(`[AUTO-UPDATE] - Remove command: ${removeCmd}`)
      log.info(`[AUTO-UPDATE] - Install command: ${installCmd}`)
      log.info(`[AUTO-UPDATE] - Temp path: ${tempPath}`)
      log.info(`[AUTO-UPDATE] - Backup path: ${backupPath}`)
      log.info(`[AUTO-UPDATE] - File path: ${finalPackagePath}`)

      const cleanup = async () => {
        log.info('[AUTO-UPDATE] Cleaning up...')
        try {
          await fs.rm(tempPath, {recursive: true, force: true}).catch(() => {})
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
          log.info('[AUTO-UPDATE] Validating Debian package format...')
          await execPromise(`dpkg-deb -I "${finalPackagePath}"`)
          log.info('[AUTO-UPDATE] Package format validation successful')
        } catch (error) {
          log.error(`[AUTO-UPDATE] Invalid Debian package format: ${error}`)
          throw new Error('Invalid Debian package format')
        }
      }

      // Save current package version for rollback
      const currentVersion = await execPromise(`${isRpm ? 'rpm -q' : 'dpkg -l'} ${packageName} | grep ${packageName}`)
        .then((result: any) => result.stdout.trim())
        .catch(() => '')

      if (currentVersion && currentVersion.length > 0) {
        log.info(`[AUTO-UPDATE] Current version: ${currentVersion}`)
        await fs.writeFile(path.join(backupPath, 'version.txt'), currentVersion)
      } else {
        log.warn('[AUTO-UPDATE] Could not detect current package version for rollback')
      }

      // Install new package
      log.info('[AUTO-UPDATE] Installing new package...')
      try {
        // Remove old package first (ignore errors as it might not exist)
        await execPromise(`pkexec ${removeCmd} ${packageName}`).catch(() => {})

        // Install new package
        const result = await execPromise(`pkexec ${installCmd} "${finalPackagePath}"`)
        log.info(`[AUTO-UPDATE] Installation output: ${result.stdout}`)

        // Verify installation
        const verifyCmd = isRpm ? `rpm -q ${packageName}` : `dpkg -l ${packageName}`
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
        log.info(`[AUTO-UPDATE] Creating Linux launch script at: ${launchScriptPath}`)
        log.info(`[AUTO-UPDATE] Linux script content: ${linuxScriptContent}`)

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
        const errorMessage = error instanceof Error ? error.message : String(error)
        log.error(`[AUTO-UPDATE] Installation error details: ${errorMessage}`)

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
            log.info(`[AUTO-UPDATE] Rolling back to version: ${oldVersion.trim()}`)

            // Remove failed new version
            await execPromise(`pkexec ${removeCmd} ${packageName}`).catch((removeError: any) => {
              log.warn(`[AUTO-UPDATE] Could not remove failed package: ${removeError}`)
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
                log.info(`[AUTO-UPDATE] Attempting to reinstall version: ${oldVersionNumber}`)
                if (isRpm) {
                  // For RPM, we would need the original package file
                  log.warn('[AUTO-UPDATE] RPM rollback requires original package file - not implemented')
                } else {
                  await execPromise(
                    `pkexec apt-get install ${packageName}=${oldVersionNumber} --allow-downgrades -y`,
                  ).catch((reinstallError: any) => {
                    log.error(`[AUTO-UPDATE] Could not reinstall old version: ${reinstallError}`)
                  })
                }
              } else {
                log.error('[AUTO-UPDATE] Could not parse old version number from backup')
              }
            }
          } else {
            log.warn('[AUTO-UPDATE] No version file found for rollback')
          }
        } catch (rollbackError) {
          log.error(`[AUTO-UPDATE] Rollback error: ${rollbackError}`)
        }

        // Clean up
        await cleanup()
        throw error
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error(`[AUTO-UPDATE] Linux update error: ${errorMessage}`)
      throw error
    }
  } else if (process.platform === 'win32') {
    log.info('[AUTO-UPDATE] Starting Windows update process')
    try {
      const {exec, spawn} = require('child_process')
      const util = require('util')
      const execPromise = util.promisify(exec)
      const fsPromises = require('fs/promises')

      const isExe = filePath.endsWith('.exe')
      const isMsi = filePath.endsWith('.msi')
      const appName = IS_PROD_DEV ? 'SeedDev' : 'Seed'
      const exeName = IS_PROD_DEV ? 'SeedDev.exe' : 'Seed.exe'
      const tempPath = path.join(app.getPath('temp'), 'SeedUpdate')

      log.info(`[AUTO-UPDATE] Windows update variables:`)
      log.info(`[AUTO-UPDATE] - Is EXE: ${isExe}`)
      log.info(`[AUTO-UPDATE] - Is MSI: ${isMsi}`)
      log.info(`[AUTO-UPDATE] - App name: ${appName}`)
      log.info(`[AUTO-UPDATE] - Exe name: ${exeName}`)
      log.info(`[AUTO-UPDATE] - Temp path: ${tempPath}`)
      log.info(`[AUTO-UPDATE] - File path: ${filePath}`)
      log.info(`[AUTO-UPDATE] - Current exe path: ${app.getPath('exe')}`)

      if (!isExe && !isMsi) {
        throw new Error('Unsupported Windows installer format. Expected .exe or .msi')
      }

      const cleanup = async () => {
        log.info('[AUTO-UPDATE] Cleaning up Windows update files...')
        try {
          await fsPromises.rm(tempPath, {recursive: true, force: true}).catch(() => {})
          await fsPromises.rm(filePath, {force: true}).catch(() => {})
        } catch (error) {
          log.error(`[AUTO-UPDATE] Error during Windows cleanup: ${error}`)
        }
      }

      // PHASE 1: Shutdown all app processes before running installer
      log.info('[AUTO-UPDATE] Phase 1: Shutting down app processes before update')

      // 1a. Shutdown the daemon (uses taskkill /F /T on Windows)
      log.info('[AUTO-UPDATE] Shutting down daemon...')
      await shutdownDaemonForUpdate()
      log.info('[AUTO-UPDATE] Daemon shut down')

      // 1b. Close all BrowserWindows
      log.info('[AUTO-UPDATE] Closing all windows...')
      const allWindows = getAllWindows()
      log.info(`[AUTO-UPDATE] Closing ${allWindows.size} windows`)
      allWindows.forEach((w) => {
        if (!w.isDestroyed()) {
          w.removeAllListeners('close')
          w.close()
        }
      })

      // 1c. Stop servers
      log.info('[AUTO-UPDATE] Stopping API server...')
      stopApiServer()
      log.info('[AUTO-UPDATE] Stopping local server...')
      stopLocalServer()

      // 1d. Wait for file handles to be released
      log.info('[AUTO-UPDATE] Waiting for file handles to release...')
      await new Promise((resolve) => setTimeout(resolve, 3000))

      // PHASE 2: Run the Squirrel installer
      log.info(`[AUTO-UPDATE] Phase 2: Installing Windows ${isExe ? 'EXE' : 'MSI'} package`)

      const installPromise = isExe
        ? new Promise<string>((resolve, reject) => {
            const installer = spawn(`"${filePath}"`, ['/S'], {
              shell: true,
              stdio: 'pipe',
            })
            let stdout = ''
            let stderr = ''
            installer.stdout?.on('data', (data: Buffer) => {
              stdout += data.toString()
            })
            installer.stderr?.on('data', (data: Buffer) => {
              stderr += data.toString()
            })
            installer.on('close', (code: number | null) => {
              if (code === 0) resolve(stdout)
              else reject(new Error(`Installer exited with code ${code}: ${stderr}`))
            })
            installer.on('error', reject)
          })
        : execPromise(`msiexec /i "${filePath}" /quiet /norestart`)

      const installTimeoutMs = 120_000
      const installResult = await Promise.race([
        installPromise,
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error('Installer timed out after ' + installTimeoutMs / 1000 + 's')),
            installTimeoutMs,
          ),
        ),
      ])
      log.info(`[AUTO-UPDATE] Installation complete: ${installResult}`)

      // PHASE 3: Cleanup and launch new version
      await cleanup()
      log.info('[AUTO-UPDATE] Windows update completed successfully')

      // PHASE 4: Launch the new version via Squirrel.Windows Update.exe stub
      // Squirrel.Windows installs a version-resolution stub at:
      //   %LOCALAPPDATA%\Seed\Update.exe
      // which is two levels up from app.getPath('exe')
      const squirrelRoot = path.resolve(app.getPath('exe'), '..', '..')
      const updateExePath = path.join(squirrelRoot, 'Update.exe')
      log.info(`[AUTO-UPDATE] Squirrel root: ${squirrelRoot}`)
      log.info(`[AUTO-UPDATE] Update.exe path: ${updateExePath}`)
      log.info(`[AUTO-UPDATE] Exe name for processStart: ${exeName}`)

      if (fs.existsSync(updateExePath)) {
        log.info(`[AUTO-UPDATE] Launching via Update.exe --processStart ${exeName}`)
        spawn(`"${updateExePath}"`, ['--processStart', exeName], {
          shell: true,
          detached: true,
          stdio: 'ignore',
        }).unref()
      } else {
        log.warn('[AUTO-UPDATE] Update.exe not found, falling back to direct launch path')
        // Fallback: try to find the correct launch shortcut or direct exe
        const startMenuPath = path.join(
          app.getPath('home'),
          'AppData',
          'Roaming',
          'Microsoft',
          'Windows',
          'Start Menu',
          'Programs',
          appName,
          `${appName}.lnk`,
        )
        log.info(`[AUTO-UPDATE] Trying Start Menu shortcut: ${startMenuPath}`)
        if (fs.existsSync(startMenuPath)) {
          spawn('cmd.exe', ['/c', 'start', '', `"${startMenuPath}"`], {
            detached: true,
            stdio: 'ignore',
          }).unref()
        } else {
          log.warn('[AUTO-UPDATE] Start Menu shortcut not found, launching exe directly')
          spawn(`"${app.getPath('exe')}"`, [], {
            shell: true,
            detached: true,
            stdio: 'ignore',
          }).unref()
        }
      }

      // Use app.exit() to exit immediately without triggering close handlers again
      log.info('[AUTO-UPDATE] Exiting app (app.exit(0))...')
      app.exit(0)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error(`[AUTO-UPDATE] Windows installation error: ${errorMessage}`)
      log.error(`[AUTO-UPDATE] Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`)
      throw error
    }
  } else {
    throw new Error(`Unsupported platform: ${process.platform}`)
  }
}
