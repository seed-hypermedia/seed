// Type declarations
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string | undefined

// Environment variables type declaration
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test'
      SENTRY_DESKTOP_DSN: string
      SEED_NO_DAEMON_SPAWN?: string
      VITE_DESKTOP_HTTP_PORT?: string
      VITE_DESKTOP_GRPC_PORT?: string
      VITE_DESKTOP_P2P_PORT?: string
      CI?: string
    }
  }
}
import * as Sentry from '@sentry/electron/main'
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  OpenDialogOptions,
  shell,
} from 'electron'
import {performance} from 'perf_hooks'

import contextMenu from 'electron-context-menu'
import squirrelStartup from 'electron-squirrel-startup'
import fs from 'fs'
import mime from 'mime'
import path from 'node:path'

import {
  dispatchFocusedWindowAppEvent,
  handleSecondInstance,
  handleUrlOpen,
  openInitialWindows,
  trpc,
} from './app-api'
import {grpcClient} from './app-grpc'
import {appInvalidateQueries} from './app-invalidation'
import {createAppMenu} from './app-menu'
import {initPaths} from './app-paths'
import autoUpdate from './auto-update'
import {startMainDaemon} from './daemon'
import * as logger from './logger'
import {saveCidAsFile} from './save-cid-as-file'
import {saveMarkdownFile} from './save-markdown-file'
import {getFocusedWindow} from './window-manager'

import {BIG_INT, IS_PROD_DESKTOP, VERSION} from '@shm/shared/constants'
import {defaultRoute} from '@shm/shared/routes'
import {setupOnboardingHandlers} from './app-onboarding-store'

const OS_REGISTER_SCHEME = 'hm'
// @ts-ignore
global.electronTRPC = {}

// Core initialization
initPaths()

app.whenReady().then(() => {
  logger.debug('[MAIN]: Seed ready')

  // Check if app was launched after update
  const isRelaunchAfterUpdate = process.argv.includes('--relaunch-after-update')
  if (isRelaunchAfterUpdate) {
    logger.info('[MAIN]: App relaunched after update, ensuring window opens')
    // Force open a window
    openInitialWindows()
    // Remove the flag from argv to prevent issues on subsequent launches
    process.argv = process.argv.filter(
      (arg) => arg !== '--relaunch-after-update',
    )
  } else {
    openInitialWindows()
  }

  autoUpdate()
})

contextMenu({
  showInspectElement: !IS_PROD_DESKTOP,
})

Menu.setApplicationMenu(createAppMenu())

if (IS_PROD_DESKTOP) {
  if (squirrelStartup) {
    app.quit()
  }

  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(OS_REGISTER_SCHEME, process.execPath, [
        path.resolve(process.argv[1]!),
      ])
    }
  } else {
    app.setAsDefaultProtocolClient(OS_REGISTER_SCHEME)
  }

  Sentry.init({
    debug: false,
    release: VERSION,
    environment: process.env.NODE_ENV || 'development',
    dsn: process.env.SENTRY_DESKTOP_DSN,
    transportOptions: {
      maxQueueAgeDays: 30,
      maxQueueCount: 30,
      queuedLengthChanged: (length: number) => {
        logger.debug('[MAIN]: Sentry queue changed ' + length)
      },
    },
  })
}

contextMenu({
  showInspectElement: !IS_PROD_DESKTOP,
})

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  logger.debug('[MAIN]: Another Seed already running. Quitting..')
  app.quit()
}

app.on('will-finish-launching', () => {
  logger.info(`[APP-EVENT]: will-finish-launching`)
})

app.whenReady().then(() => {
  if (!IS_PROD_DESKTOP) {
    performance.mark('app-ready-start')
  }

  // Register global shortcuts
  globalShortcut.register('CommandOrControl+N', () => {
    ipcMain.emit('new_window')
  })

  autoUpdate()
  openInitialWindows()

  // Initialize IPC handlers after the app is ready
  initializeIpcHandlers()

  startMainDaemon(() => {
    logger.info('DaemonStarted')
    initAccountSubscriptions()
      .then(() => {
        logger.info('InitAccountSubscriptionsComplete')
      })
      .catch((e) => {
        logger.error('InitAccountSubscriptionsError ' + e.message)
      })
  })

  if (!IS_PROD_DESKTOP) {
    performance.mark('app-ready-end')
    performance.measure('app-ready', 'app-ready-start', 'app-ready-end')
  }
})

app.on('activate', () => {
  logger.debug('[MAIN]: Seed Active (activate)')
  if (BrowserWindow.getAllWindows().length === 0) {
    logger.debug('[MAIN]: no windows found. will open the home window')
    trpc.createAppWindow({
      routes: [defaultRoute],
    })
  }
})

app.on('window-all-closed', () => {
  logger.debug('[MAIN]: window-all-closed')
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') {
    logger.debug('[MAIN]: will quit the app')
    app.quit()
  }
})

app.on('second-instance', handleSecondInstance)
app.on('open-url', (_event, url) => handleUrlOpen(url))

async function initAccountSubscriptions() {
  logger.info('InitAccountSubscriptions')
  const keys = await grpcClient.daemon.listKeys({})
  const subs = await grpcClient.subscriptions.listSubscriptions({
    pageSize: BIG_INT,
  })
  const recursiveSubs = new Set(
    subs.subscriptions
      .map((sub) => {
        if (sub.path !== '/' || !sub.recursive) return null
        return sub.account
      })
      .filter((s) => !!s),
  )
  const keysToSubscribeTo = keys.keys.filter((key) => {
    if (recursiveSubs.has(key.accountId)) return false
    return true
  })

  for (const key of keysToSubscribeTo) {
    logger.debug('WillInitAccountSubscriptions')
    await grpcClient.subscriptions.subscribe({
      account: key.accountId,
      recursive: true,
      path: '',
    })
  }
}

function initializeIpcHandlers() {
  setupOnboardingHandlers()

  // Window management handlers
  ipcMain.on('invalidate_queries', (_event, info) => {
    appInvalidateQueries(info)
  })

  ipcMain.on('focusedWindowAppEvent', (_event, info) => {
    dispatchFocusedWindowAppEvent(info)
  })

  ipcMain.on('new_window', () => {
    trpc.createAppWindow({routes: [defaultRoute]})
  })

  ipcMain.on('minimize_window', (_event, _info) => {
    getFocusedWindow()?.minimize()
  })

  ipcMain.on('maximize_window', (_event, _info) => {
    const window = getFocusedWindow()
    if (window?.isMaximized()) {
      window.unmaximize()
    } else {
      window?.maximize()
    }
  })

  ipcMain.on('close_window', (_event, _info) => {
    getFocusedWindow()?.close()
  })

  ipcMain.on('find_in_page_query', (_event, _info) => {
    getFocusedWindow()?.webContents?.findInPage(_info.query, {
      findNext: _info.findNext,
      forward: _info.forward,
    })
  })

  // Dark mode handlers
  ipcMain.handle('dark-mode:toggle', () => {
    if (nativeTheme.shouldUseDarkColors) {
      nativeTheme.themeSource = 'light'
    } else {
      nativeTheme.themeSource = 'dark'
    }
    return nativeTheme.shouldUseDarkColors
  })

  ipcMain.handle('dark-mode:system', () => {
    nativeTheme.themeSource = 'system'
  })

  // File and system operation handlers
  ipcMain.on('save-file', saveCidAsFile)
  ipcMain.on('export-document', saveMarkdownFile)
  ipcMain.on('quit_app', () => app.quit())
  ipcMain.on('open_path', (event, path) => shell.openPath(path))
  ipcMain.on('open-external-link', (_event, linkUrl) =>
    shell.openExternal(linkUrl),
  )
  ipcMain.on('open-directory', (_event, directory) => shell.openPath(directory))

  // Markdown file handlers
  ipcMain.on('open-markdown-directory', async (event, accountId: string) => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (!focusedWindow) {
      console.error('No focused window found.')
      return
    }

    const options: OpenDialogOptions = {
      title: 'Select directories containing Markdown files',
      properties: [
        'openDirectory',
        'multiSelections',
      ] as OpenDialogOptions['properties'],
    }

    try {
      const result = await dialog.showOpenDialog(focusedWindow, options)
      if (!result.canceled && result.filePaths.length > 0) {
        const directories = result.filePaths
        const validDocuments = []

        const docMap = new Map<
          string,
          {relativePath?: string; name: string; path: string}
        >()

        for (const dirPath of directories) {
          const files = fs.readdirSync(dirPath)
          const isDirectory = fs.lstatSync(dirPath).isDirectory()

          const markdownFiles = files.filter((file) => file.endsWith('.md'))
          if (markdownFiles.length > 0 && isDirectory) {
            for (const markdownFile of markdownFiles) {
              const markdownFilePath = path.join(dirPath, markdownFile)
              const markdownContent = fs.readFileSync(markdownFilePath, 'utf-8')

              const fileName = path.basename(markdownFile, '.md')
              const title = formatTitle(fileName)

              docMap.set('./' + markdownFile, {
                name: title,
                path: path.join(
                  accountId,
                  title.toLowerCase().replace(/\s+/g, '-'),
                ),
              })

              validDocuments.push({
                markdownContent,
                title,
                directoryPath: dirPath,
              })
            }
          }
        }

        event.sender.send('directories-content-response', {
          success: true,
          result: {
            documents: validDocuments,
            docMap: docMap,
          },
        })
      } else {
        event.sender.send('directories-content-response', {
          success: false,
          error: 'Directory selection was canceled',
        })
      }
    } catch (err: unknown) {
      console.error('Error selecting directories:', err)
      event.sender.send('directories-content-response', {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error occurred',
      })
    }
  })

  ipcMain.on('open-markdown-file', async (event, accountId: string) => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (!focusedWindow) {
      console.error('No focused window found.')
      return
    }

    const options: OpenDialogOptions = {
      title: 'Select Markdown files',
      properties: ['openFile', 'multiSelections'],
      filters: [{name: 'Markdown Files', extensions: ['md']}],
    }

    try {
      const result = await dialog.showOpenDialog(focusedWindow, options)
      if (!result.canceled && result.filePaths.length > 0) {
        const files = result.filePaths
        const validDocuments = []
        const docMap = new Map<
          string,
          {relativePath?: string; name: string; path: string}
        >()

        for (const filePath of files) {
          const stats = fs.lstatSync(filePath)
          if (stats.isFile() && filePath.endsWith('.md')) {
            const markdownContent = fs.readFileSync(filePath, 'utf-8')
            const dirName = path.basename(filePath)
            const title = formatTitle(dirName)

            docMap.set('./' + dirName, {
              name: title,
              path: path.join(
                accountId,
                title.toLowerCase().replace(/\s+/g, '-'),
              ),
            })

            validDocuments.push({
              markdownContent,
              title,
              directoryPath: path.dirname(filePath),
            })
          }
        }

        event.sender.send('files-content-response', {
          success: true,
          result: {documents: validDocuments, docMap: docMap},
        })
      } else {
        event.sender.send('files-content-response', {
          success: false,
          error: 'File selection was canceled',
        })
      }
    } catch (err: unknown) {
      console.error('Error selecting file:', err)
      event.sender.send('files-content-response', {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error occurred',
      })
    }
  })

  ipcMain.on('read-media-file', async (event, filePath) => {
    try {
      const absoluteFilePath = path.resolve(filePath)

      const fileContent = fs.readFileSync(absoluteFilePath)
      const mimeType = mime.getType(filePath)
      const fileName = path.basename(filePath)
      event.sender.send('media-file-content', {
        success: true,
        filePath,
        content: Buffer.from(fileContent).toString('base64'),
        mimeType,
        fileName,
      })
    } catch (error: unknown) {
      console.error('Error reading media file:', error)
      event.sender.send('media-file-content', {
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  })

  logger.debug('[MAIN]: IPC handlers initialized')
}

const formatTitle = (fileName: string) => {
  return fileName
    .replace(/\.md$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
