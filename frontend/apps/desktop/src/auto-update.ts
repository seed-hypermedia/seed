import {IS_PROD_DESKTOP, IS_PROD_DEV, VERSION} from '@shm/shared'

import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  MessageBoxOptions,
  shell,
} from 'electron'
import {updateElectronApp, UpdateSourceType} from 'update-electron-app'
import * as log from './logger'

export function defaultCheckForUpdates() {
  log.debug('[MAIN][AUTO-UPDATE]: checking for Updates')
  // ipcMain.emit(ipcMainEvents.CHECK_FOR_UPDATES_START)

  autoUpdater.checkForUpdates()

  // ipcMain.emit(ipcMainEvents.CHECK_FOR_UPDATES_END)
  log.debug('[MAIN][AUTO-UPDATE]: checking for Updates END')
}

export const checkForUpdates =
  process.platform == 'linux' ? linuxCheckForUpdates : defaultCheckForUpdates

export default function autoUpdate() {
  if (!IS_PROD_DESKTOP) {
    log.debug('[MAIN][AUTO-UPDATE]: Not available in development')
    return
  }
  if (!isAutoUpdateSupported()) {
    log.debug('[MAIN][AUTO-UPDATE]: Auto-Update is not supported')
    return
  }

  if (process.platform != 'linux') {
    setup()
  }

  setTimeout(() => {
    // we are doing this after 2 seconds of startup so the app will not have to deal with this on startup.
    // copied from Electron Fiddle :)
    checkForUpdates()
  }, 2_000)

  setInterval(checkForUpdates, 600_000) // every 10 minutes
}

// ======================================

// let feedback = false

function isAutoUpdateSupported() {
  // TODO: we need to enable a setting so people can disable auto-updates
  return true
}

function setup() {
  /**
   * - disables autoDownload
   * - enables autoInstall and app  quit
   * - sets the logger
   * - adopt the `feedback` variable to show/hide dialogs
   */

  log.debug(`== [MAIN][AUTO-UPDATE]: IS_PROD_DEV + VERSION:`, {
    VERSION,
    IS_PROD_DEV,
  })

  updateElectronApp({
    updateSource: IS_PROD_DEV
      ? {
          type: UpdateSourceType.StaticStorage,
          baseUrl: `https://seedappdev.s3.eu-west-2.amazonaws.com/dev/${process.platform}/${process.arch}`,
        }
      : {
          type: UpdateSourceType.ElectronPublicUpdateService,
          repo: 'seed-hypermedia/seed',
        },
    logger: {log: log.debug, info: log.info, error: log.error, warn: log.warn},
  })

  // const updateUrl = `https://update.electronjs.org/seed-hypermedia/seed/${
  //   process.platform
  // }-${process.arch}/${app.getVersion()}`

  // autoUpdater.setFeedURL({url: updateUrl})

  autoUpdater.on('error', (message) => {
    log.error(
      `[MAIN][AUTO-UPDATE]: There was a problem updating the application: ${message}`,
    )
  })

  autoUpdater.on('update-available', async () => {
    log.debug(`[MAIN][AUTO-UPDATE]: update available, download will start`)
    try {
    } catch (error) {}
  })

  autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
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
        autoUpdater.quitAndInstall()
      }
    })
  })

  autoUpdater.on('update-not-available', (event: any) => {
    log.debug('[MAIN][AUTO-UPDATE]: update not available', event)
  })
}

export function linuxCheckForUpdates() {
  const UPDATE_URL = IS_PROD_DEV
    ? `https://seedappdev.s3.eu-west-2.amazonaws.com/dev/${process.platform}/${
        process.arch
      }/${app.getVersion()}`
    : `https://update.electronjs.org/seed-hypermedia/seed/${process.platform}-${
        process.arch
      }/${app.getVersion()}`

  log.debug('[MAIN][AUTO-UPDATE]: checking for Updates', UPDATE_URL)

  // ipcMain.emit(ipcMainEvents.CHECK_FOR_UPDATES_START)
  try {
    // TODO: change this to fetch THE LATEST version and compare it with `app.getVersion()`
    fetch(UPDATE_URL).then((res) => {
      log.debug('[MAIN][AUTO-UPDATE]: LINUX FETCH RES', res)
      if ('name' in res && res.name) {
        log.debug('[MAIN][AUTO-UPDATE]: LINUX NEED TO UPDATE', res)
        const dialogOpts: MessageBoxOptions = {
          type: 'info',
          buttons: ['Go and Download', 'Close'],
          title: 'Application Update',
          message: 'New release available',
          detail:
            'A new version is available. Go and Download the new version!',
        }

        let win = BrowserWindow.getFocusedWindow()

        if (win) {
          dialog.showMessageBox(win, dialogOpts).then((returnValue: any) => {
            log.debug('[MAIN][AUTO-UPDATE]: Quit and Install')
            if (returnValue.response === 0)
              shell.openExternal(
                'https://github.com/seed-hypermedia/seed/releases/latest',
              )
          })
        } else {
          dialog.showMessageBox(dialogOpts).then((returnValue: any) => {
            log.debug('[MAIN][AUTO-UPDATE]: Quit and Install')
            if (returnValue.response === 0)
              shell.openExternal(
                'https://github.com/seed-hypermedia/seed/releases/latest',
              )
          })
        }
      } else {
        log.debug('[MAIN][AUTO-UPDATE]: LINUX IS UPDATED', res)
      }
    })
  } catch (error) {}
  // ipcMain.emit(ipcMainEvents.CHECK_FOR_UPDATES_END)
}
