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
  OpenDialogOptions,
  session,
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
import {
  AppWindow,
  closeLoadingWindow,
  createLoadingWindow,
  deleteWindowsState,
  getAllWindows,
  getFocusedWindow,
  getLastFocusedWindow,
  getWindowNavState,
} from './app-windows'
import autoUpdate from './auto-update'
import {startMainDaemon, subscribeDaemonState} from './daemon'
import {startLocalServer, stopLocalServer} from './local-server'
import * as logger from './logger'
import {saveCidAsFile} from './save-cid-as-file'
import {saveMarkdownFile} from './save-markdown-file'

import {State} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {
  BIG_INT,
  IS_PROD_DESKTOP,
  OS_PROTOCOL_SCHEME,
  VERSION,
} from '@shm/shared/constants'
import {defaultRoute} from '@shm/shared/routes'
import {initCommentDrafts} from './app-comments'
import {initDrafts} from './app-drafts'
import {
  getOnboardingState,
  setInitialAccountIdCount,
  setupOnboardingHandlers,
} from './app-onboarding-store'
import {memoryMonitor, setupMemoryMonitorLifecycle} from './memory-monitor'
import {getSubscriptionCount, getDiscoveryStreamCount} from './app-sync'
import {
  isProfilerEnabled,
  createProfilerWindow,
  setupProfilerQuitHandler,
  logWindowOpen,
  logWindowClose,
} from './memory-profiler-window'

// Use 'hm' in production for OS protocol registration
const OS_REGISTER_SCHEME = OS_PROTOCOL_SCHEME
// @ts-ignore
global.electronTRPC = {}

// Track startup phase to prevent premature quit when loading window closes
let isStartingUp = true

// Store deep link URL from cold start (passed via process.argv)
let coldStartDeepLinkUrl: string | null = null

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

// Core initialization
initPaths()

// Memory monitoring setup
setupMemoryMonitorLifecycle()

contextMenu({
  showInspectElement: !IS_PROD_DESKTOP,
  // prepend: (defaultActions, params, browserWindow) => {
  //   console.log('context menu triggered at', params.x, params.y)
  //   return []
  // },
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
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  logger.debug('[MAIN]: Another Seed already running. Quitting..')
  app.quit()
}

// Check process.argv for deep link URL on cold start
// On macOS/Windows, when app is launched via protocol handler while not running,
// the URL is passed as an argument
for (const arg of process.argv) {
  if (arg.startsWith(`${OS_PROTOCOL_SCHEME}://`)) {
    coldStartDeepLinkUrl = arg
    logger.info(`[MAIN]: Cold start deep link detected: ${arg}`)
    break
  }
}

app.on('will-finish-launching', () => {
  app.on('open-url', (_event, url) => handleUrlOpen(url))
  logger.info(`[APP-EVENT]: will-finish-launching`)
})

app.on('before-quit', () => {
  logger.info('[MAIN]: App before-quit - starting cleanup')

  // Stop local server when app quits
  stopLocalServer()

  // Stop memory monitoring
  memoryMonitor.stopTracking()

  // Unregister all global shortcuts
  globalShortcut.unregisterAll()

  logger.info('[MAIN]: App before-quit - cleanup complete')
})

/**
 * Starts the daemon with conditional loading window display.
 * Shows loading window only if first daemon getInfo() returns NOT ACTIVE.
 * Can be forced to show with VITE_FORCE_LOADING_WINDOW env var for testing.
 */
async function startDaemonWithLoadingWindow(): Promise<void> {
  const forceLoadingWindow =
    typeof __FORCE_LOADING_WINDOW__ !== 'undefined' &&
    __FORCE_LOADING_WINDOW__ === 'true'
  let loadingWindowShown = false
  let unsubscribe: (() => void) | null = null
  let daemonIsPolling = false

  logger.info(
    `[MAIN]: __FORCE_LOADING_WINDOW__ = ${
      typeof __FORCE_LOADING_WINDOW__ !== 'undefined'
        ? __FORCE_LOADING_WINDOW__
        : 'undefined'
    }`,
  )
  logger.info(`[MAIN]: forceLoadingWindow = ${forceLoadingWindow}`)

  // Subscribe to daemon state changes to show/hide loading window
  unsubscribe = subscribeDaemonState((state) => {
    // First 'ready' event: daemon gRPC started, check if ACTIVE
    if (state.t === 'ready' && !daemonIsPolling && !forceLoadingWindow) {
      daemonIsPolling = true
      logger.info('[MAIN]: Daemon gRPC ready, checking initial state...')

      grpcClient.daemon
        .getInfo({})
        .then((info) => {
          if (info.state !== State.ACTIVE) {
            // Not ACTIVE yet, show loading window
            loadingWindowShown = true
            createLoadingWindow()
            logger.info(
              `[MAIN]: Daemon not ACTIVE (state: ${info.state}), showing loading window`,
            )
          } else {
            logger.info(
              '[MAIN]: Daemon already ACTIVE, skipping loading window',
            )
          }
        })
        .catch((err) => {
          logger.error('[MAIN]: Error checking initial daemon state:', err)
        })
    }
    // Second 'ready' event: daemon became ACTIVE, unsubscribe but keep loading window open
    // Loading window will be closed when main windows are about to open
    else if (
      state.t === 'ready' &&
      daemonIsPolling &&
      loadingWindowShown &&
      !forceLoadingWindow
    ) {
      logger.info(
        '[MAIN]: Daemon is ACTIVE, keeping loading window until main window opens',
      )
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
    }
  })

  try {
    // Start daemon - this spawns the process and polls until ACTIVE
    // Daemon will send state updates (startup, migrating, etc) to loading window
    await startMainDaemon()
    logger.info('[MAIN]: Daemon is ACTIVE')
  } finally {
    // Cleanup: unsubscribe if still subscribed
    if (unsubscribe) {
      unsubscribe()
    }
  }

  // If forced, show loading window and wait forever for debug button
  if (forceLoadingWindow) {
    loadingWindowShown = true
    createLoadingWindow()
    logger.info(
      '[MAIN]: VITE_FORCE_LOADING_WINDOW enabled - daemon started, showing loading window and waiting for debug button',
    )
    // Return a promise that never resolves - wait for debug button click
    return new Promise(() => {})
  }
}

app.whenReady().then(async () => {
  logger.debug('[MAIN]: Seed ready')

  // Memory profiler mode - opens dedicated profiler window
  if (isProfilerEnabled()) {
    logger.info('[MAIN]: Memory profiler mode enabled')
    createProfilerWindow()
    setupProfilerQuitHandler()
  }

  // Register memory monitor resource counters
  memoryMonitor.registerResourceCounter('windows', () => getAllWindows().size)
  memoryMonitor.registerResourceCounter('subscriptions', getSubscriptionCount)
  memoryMonitor.registerResourceCounter(
    'discoveryStreams',
    getDiscoveryStreamCount,
  )

  // Start local server in production to avoid file:// protocol issues with iframes
  if (IS_PROD_DESKTOP && !MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    try {
      const staticPath = path.join(__dirname, '../renderer')
      const port = await startLocalServer(staticPath)
      ;(global as any).localServerPort = port
      logger.info(`[MAIN]: Local server started on port ${port}`)
    } catch (err) {
      logger.error(
        '[MAIN]: Failed to start local server: ' + (err as Error).message,
      )
    }
  }

  // Remove X-Frame-Options header to allow embeds
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders || {}

    // Remove X-Frame-Options from our app responses to allow embeds
    if (
      details.url.includes('localhost') ||
      details.url.includes('127.0.0.1')
    ) {
      delete responseHeaders['X-Frame-Options']
      delete responseHeaders['x-frame-options']
    }

    callback({
      responseHeaders,
    })
  })

  // Check if app was launched after update
  const isRelaunchAfterUpdate = process.argv.includes('--relaunch-after-update')
  if (isRelaunchAfterUpdate) {
    logger.info('[MAIN]: App relaunched after update, ensuring window opens')
    // Force open a window
    // Remove the flag from argv to prevent issues on subsequent launches
    process.argv = process.argv.filter(
      (arg) => arg !== '--relaunch-after-update',
    )
  }

  if (!IS_PROD_DESKTOP) {
    performance.mark('app-ready-start')
  }

  // Initialize IPC handlers early so loading window can use them
  initializeIpcHandlers()

  startDaemonWithLoadingWindow()
    .then(() => {
      logger.info('DaemonStarted')
      return Promise.all([
        initDrafts().then(() => {
          logger.info('Drafts ready')
        }),
        initCommentDrafts().then(() => {
          logger.info('Comment Drafts ready')
        }),
      ])
    })
    .then(() => {
      initAccountSubscriptions()
        .then(() => {
          logger.info('InitAccountSubscriptionsComplete')
        })
        .catch((e) => {
          logger.error('InitAccountSubscriptionsError ' + e.message)
        })

      grpcClient.daemon.listKeys({}).then(async (response) => {
        const onboardingState = getOnboardingState()
        setInitialAccountIdCount(response.keys.length)

        // Close loading window right before opening main windows
        closeLoadingWindow()
        logger.debug('[MAIN]: Loading window closed, opening main windows')

        if (
          response.keys.length === 0 &&
          !onboardingState.hasCompletedOnboarding &&
          !onboardingState.hasSkippedOnboarding
        ) {
          deleteWindowsState().then(() => {
            trpc.createAppWindow({routes: [defaultRoute]})
            isStartingUp = false
            logger.debug('[MAIN]: Startup complete, main window created')
            // Process cold start deep link if present
            if (coldStartDeepLinkUrl) {
              logger.info(
                `[MAIN]: Processing cold start deep link: ${coldStartDeepLinkUrl}`,
              )
              handleUrlOpen(coldStartDeepLinkUrl)
              coldStartDeepLinkUrl = null
            }
          })
        } else {
          await openInitialWindows()
          isStartingUp = false
          logger.debug('[MAIN]: Startup complete, initial windows opened')
          // Process cold start deep link if present
          if (coldStartDeepLinkUrl) {
            logger.info(
              `[MAIN]: Processing cold start deep link: ${coldStartDeepLinkUrl}`,
            )
            handleUrlOpen(coldStartDeepLinkUrl)
            coldStartDeepLinkUrl = null
          }
        }
      })

      autoUpdate()

      if (!IS_PROD_DESKTOP) {
        performance.mark('app-ready-end')
        performance.measure('app-ready', 'app-ready-start', 'app-ready-end')
      }
    })
    .catch((e) => {
      logger.error('App startup error', {error: e.message})
      app.quit()
    })
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
  // Don't quit during startup (loading window closing before main window opens)
  if (isStartingUp) {
    logger.debug('[MAIN]: Ignoring window-all-closed during startup')
    return
  }
  if (process.platform !== 'darwin') {
    logger.debug('[MAIN]: will quit the app')
    app.quit()
  }
})

app.on('second-instance', handleSecondInstance)

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

  // Debug: force active state from loading window (continue app startup)
  ipcMain.on('forceActiveState', () => {
    logger.info('[MAIN]: Force active state requested from loading window')

    // Close loading window
    closeLoadingWindow()
    logger.info('[MAIN]: Loading window closed from debug button')

    // Continue with app initialization (daemon is already started)
    Promise.all([
      initDrafts().then(() => {
        logger.info('Drafts ready')
      }),
      initCommentDrafts().then(() => {
        logger.info('Comment Drafts ready')
      }),
    ])
      .then(() => {
        initAccountSubscriptions()
          .then(() => {
            logger.info('InitAccountSubscriptionsComplete')
          })
          .catch((e: Error) => {
            logger.error('InitAccountSubscriptionsError ' + e.message)
          })

        grpcClient.daemon.listKeys({}).then(async (response) => {
          const onboardingState = getOnboardingState()
          setInitialAccountIdCount(response.keys.length)
          if (
            response.keys.length === 0 &&
            !onboardingState.hasCompletedOnboarding &&
            !onboardingState.hasSkippedOnboarding
          ) {
            deleteWindowsState().then(() => {
              trpc.createAppWindow({routes: [defaultRoute]})
              isStartingUp = false
            })
          } else {
            await openInitialWindows()
            isStartingUp = false
          }
        })

        autoUpdate()
      })
      .catch((e: Error) => {
        logger.error('App startup error from debug button', {error: e.message})
        app.quit()
      })
  })

  // Window management handlers
  ipcMain.on('invalidate_queries', (_event, info) => {
    appInvalidateQueries(info)
  })

  ipcMain.on('focusedWindowAppEvent', (_event, info) => {
    dispatchFocusedWindowAppEvent(info)
  })

  ipcMain.on('new_window', () => {
    // Get the focused window's properties to copy them to the new window
    const focusedWindow = getLastFocusedWindow()
    let selectedIdentity: AppWindow['selectedIdentity'] = null
    let accessoryWidth: AppWindow['accessoryWidth'] | undefined = undefined
    let sidebarLocked: AppWindow['sidebarLocked'] | undefined = undefined
    let sidebarWidth: AppWindow['sidebarWidth'] | undefined = undefined
    let width: number | undefined = undefined
    let height: number | undefined = undefined

    if (focusedWindow) {
      const focusedWindowId = Array.from(getAllWindows().entries()).find(
        ([_, window]) => window === focusedWindow,
      )?.[0]

      if (focusedWindowId) {
        // Use in-memory windowNavState instead of persisted windowsState
        // to get the most current state values
        const windowNavState = getWindowNavState()
        const focusedWindowState = windowNavState[focusedWindowId]
        selectedIdentity = focusedWindowState?.selectedIdentity || null
        accessoryWidth = focusedWindowState?.accessoryWidth
        sidebarLocked = focusedWindowState?.sidebarLocked
        sidebarWidth = focusedWindowState?.sidebarWidth

        // Only get dimensions if window is in a valid state (not fullscreen/maximized/minimized)
        if (
          !focusedWindow.isFullScreen() &&
          !focusedWindow.isMaximized() &&
          !focusedWindow.isMinimized()
        ) {
          const bounds = focusedWindow.getBounds()
          width = bounds.width
          height = bounds.height
        }
      }
    }

    trpc.createAppWindow({
      routes: [defaultRoute],
      selectedIdentity,
      accessoryWidth,
      sidebarLocked,
      sidebarWidth,
      bounds:
        width !== undefined && height !== undefined
          ? {width, height}
          : undefined,
    })
  })

  ipcMain.on('minimize_window', (_event, _info) => {
    getFocusedWindow()?.minimize()
  })

  ipcMain.on('hide_window', (_event, _info) => {
    getFocusedWindow()?.hide()
  })

  ipcMain.on('maximize_window', (_event, info) => {
    const window = getFocusedWindow()
    if (!window) return

    // Handle the force flags if they're provided
    if (info && typeof info === 'object') {
      if (info.forceMaximize) {
        window.maximize()
        return
      }
      if (info.forceUnmaximize) {
        window.unmaximize()
        return
      }
    }

    // Default toggle behavior if no force flags
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  })

  ipcMain.on('close_window', (_event, _info) => {
    getFocusedWindow()?.close()
  })

  // Development: manually open loading window for testing
  ipcMain.on('open_loading_window', () => {
    logger.info('[MAIN]: Manual loading window open requested')
    createLoadingWindow()
  })

  ipcMain.on('close_loading_window', () => {
    logger.info('[MAIN]: Manual loading window close requested')
    closeLoadingWindow()
  })

  ipcMain.on('find_in_page_query', (_event, _info) => {
    getFocusedWindow()?.webContents?.findInPage(_info.query, {
      findNext: _info.findNext,
      forward: _info.forward,
    })
  })

  ipcMain.on('find_in_page_cancel', (_event) => {
    getFocusedWindow()?.webContents?.stopFindInPage('clearSelection')
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

  // LaTeX file handlers
  ipcMain.on('open-latex-directory', async (event, accountId: string) => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (!focusedWindow) {
      console.error('No focused window found.')
      return
    }

    const options: OpenDialogOptions = {
      title: 'Select directories containing LaTeX files',
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

          const latexFiles = files.filter((file) => file.endsWith('.tex'))
          if (latexFiles.length > 0 && isDirectory) {
            for (const latexFile of latexFiles) {
              const latexFilePath = path.join(dirPath, latexFile)
              const latexContent = fs.readFileSync(latexFilePath, 'utf-8')

              const fileName = path.basename(latexFile, '.tex')
              const title = formatTitle(fileName)

              docMap.set('./' + latexFile, {
                name: title,
                path: path.join(
                  accountId,
                  title.toLowerCase().replace(/\s+/g, '-'),
                ),
              })

              validDocuments.push({
                latexContent,
                title,
                directoryPath: dirPath,
              })
            }
          }
        }

        event.sender.send('latex-directories-content-response', {
          success: true,
          result: {
            documents: validDocuments,
            docMap: docMap,
          },
        })
      } else {
        event.sender.send('latex-directories-content-response', {
          success: false,
          error: 'Directory selection was canceled',
        })
      }
    } catch (err: unknown) {
      console.error('Error selecting directories:', err)
      event.sender.send('latex-directories-content-response', {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error occurred',
      })
    }
  })

  ipcMain.on('open-latex-file', async (event, accountId: string) => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (!focusedWindow) {
      console.error('No focused window found.')
      return
    }

    const options: OpenDialogOptions = {
      title: 'Select LaTeX files',
      properties: ['openFile', 'multiSelections'],
      filters: [{name: 'LaTeX Files', extensions: ['tex']}],
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
          if (stats.isFile() && filePath.endsWith('.tex')) {
            const latexContent = fs.readFileSync(filePath, 'utf-8')
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
              latexContent,
              title,
              directoryPath: path.dirname(filePath),
            })
          }
        }

        event.sender.send('latex-files-content-response', {
          success: true,
          result: {documents: validDocuments, docMap: docMap},
        })
      } else {
        event.sender.send('latex-files-content-response', {
          success: false,
          error: 'File selection was canceled',
        })
      }
    } catch (err: unknown) {
      console.error('Error selecting file:', err)
      event.sender.send('latex-files-content-response', {
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
