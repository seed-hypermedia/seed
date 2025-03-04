import type {AppWindowEvent} from '@/utils/window-events'
import {getRouteWindowType} from '@/utils/window-types'
import type {NavRoute} from '@shm/shared/routes'
import {defaultRoute} from '@shm/shared/routes'
import {
  BrowserWindow,
  WebContentsView,
  app,
  globalShortcut,
  nativeTheme,
  screen,
} from 'electron'
import path from 'node:path'
import {updateRecentRoute} from './app-recents'
import {appStore} from './app-store.mjs'
import {getDaemonState, subscribeDaemonState} from './daemon'
import {childLogger, info, warn} from './logger'

// Types
interface AppWindow {
  routes: NavRoute[]
  routeIndex: number
  bounds: any
  sidebarLocked: boolean
}

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

// Constants
const WINDOW_STATE_STORAGE_KEY = 'WindowState-v004'
const SAVE_THROTTLE = 1000 // ms

// Caches and State Management
const windowStateCache = new Map<string, AppWindow>()
const windowTypeConfigCache = new Map<string, any>()
const windowEventHandlers = new Map<string, Set<Function>>()
const allWindows = new Map<string, BrowserWindow>()

let windowIdCount = 1
let isExpectingQuit = false

// Focus Tracking
const focusedWindowTracker = {
  currentFocusedId: null as string | null,
  lastFocusedId: null as string | null,

  setFocused(windowId: string) {
    this.lastFocusedId = this.currentFocusedId
    this.currentFocusedId = windowId
  },

  clearFocus(windowId: string) {
    if (this.currentFocusedId === windowId) {
      this.currentFocusedId = this.lastFocusedId
      this.lastFocusedId = null
    }
  },
}

// IPC Message Batching
const ipcBatcher = {
  queue: new Map<string, any[]>(),
  timeout: null as NodeJS.Timeout | null,

  add(browserWindow: BrowserWindow, channel: string, data: any) {
    const key = `${browserWindow.id}:${channel}`
    if (!this.queue.has(key)) {
      this.queue.set(key, [])
    }
    this.queue.get(key)!.push(data)

    this.scheduleFlush(browserWindow)
  },

  scheduleFlush(browserWindow: BrowserWindow) {
    if (!this.timeout) {
      this.timeout = setTimeout(() => this.flush(browserWindow), 16) // ~1 frame
    }
  },

  flush(browserWindow: BrowserWindow) {
    const prefix = `${browserWindow.id}:`
    Array.from(this.queue.entries()).forEach(([key, messages]) => {
      if (!key.startsWith(prefix)) return

      const channel = key.slice(prefix.length)
      if (messages.length === 1) {
        browserWindow.webContents.send(channel, messages[0])
      } else {
        browserWindow.webContents.send(`${channel}_batch`, messages)
      }
      this.queue.delete(key)
    })
    this.timeout = null
  },
}

// Window State Management
function getWindowState(windowId: string): AppWindow | undefined {
  if (windowStateCache.has(windowId)) {
    return windowStateCache.get(windowId)
  }

  const allStates = (appStore as any).get(WINDOW_STATE_STORAGE_KEY) || {}
  const state = allStates[windowId]
  if (state) {
    windowStateCache.set(windowId, state)
  }
  return state
}

function setWindowState(windowId: string, state: AppWindow) {
  windowStateCache.set(windowId, state)
  const allStates = (appStore as any).get(WINDOW_STATE_STORAGE_KEY) || {}
  allStates[windowId] = state
  ;(appStore as any).set(WINDOW_STATE_STORAGE_KEY, allStates)
}

function deleteWindowState(windowId: string) {
  windowStateCache.delete(windowId)
  const allStates = (appStore as any).get(WINDOW_STATE_STORAGE_KEY) || {}
  delete allStates[windowId]
  ;(appStore as any).set(WINDOW_STATE_STORAGE_KEY, allStates)
}

// Window Type Configuration
function getWindowTypeConfig(route: NavRoute) {
  const cacheKey = route.key
  if (!windowTypeConfigCache.has(cacheKey)) {
    const config = getRouteWindowType(route)
    windowTypeConfigCache.set(cacheKey, config)
  }
  return windowTypeConfigCache.get(cacheKey)
}

// Event Handler Management
function addWindowEventHandler(
  windowId: string,
  event: string,
  handler: Function,
) {
  if (!windowEventHandlers.has(windowId)) {
    windowEventHandlers.set(windowId, new Set())
  }
  windowEventHandlers.get(windowId)!.add(handler)
}

function removeWindowEventHandlers(windowId: string) {
  const handlers = windowEventHandlers.get(windowId)
  if (handlers) {
    handlers.clear()
    windowEventHandlers.delete(windowId)
  }
}

// Window Position Management
function calculateWindowBounds(
  inputBounds: WindowBounds | null | undefined,
  prevWindow: BrowserWindow | undefined,
  windowType: any,
): WindowBounds {
  if (inputBounds) return inputBounds

  const prevBounds = prevWindow?.getBounds()
  if (prevBounds) {
    return {
      width: Math.max(
        windowType.minWidth,
        Math.min(
          prevBounds.width,
          windowType.maxWidth || windowType.initWidth || 800,
        ),
      ),
      height: Math.max(
        windowType.minHeight,
        Math.min(
          prevBounds.height,
          windowType.maxHeight || windowType.initHeight || 600,
        ),
      ),
      x: prevBounds.x + 60,
      y: prevBounds.y + 60,
    }
  }

  // For the first window, center it on the screen
  const width = windowType.initWidth || windowType.minWidth || 800
  const height = windowType.initHeight || windowType.minHeight || 600

  // Get the primary display dimensions
  const {width: screenWidth, height: screenHeight} =
    screen.getPrimaryDisplay().workAreaSize

  return {
    width,
    height,
    x: Math.round((screenWidth - width) / 2),
    y: Math.round((screenHeight - height) / 2),
  }
}

// Window Position Save Optimization
function createWindowPositionSaver(
  browserWindow: BrowserWindow,
  windowId: string,
) {
  let saveTimeout: NodeJS.Timeout | null = null
  let lastSaveTime = 0

  return () => {
    const now = Date.now()

    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }

    if (now - lastSaveTime >= SAVE_THROTTLE) {
      const bounds = browserWindow.getBounds()
      setWindowState(windowId, {
        ...getWindowState(windowId)!,
        bounds,
      })
      lastSaveTime = now
    } else {
      saveTimeout = setTimeout(
        () => {
          const bounds = browserWindow.getBounds()
          setWindowState(windowId, {
            ...getWindowState(windowId)!,
            bounds,
          })
          lastSaveTime = Date.now()
        },
        SAVE_THROTTLE - (now - lastSaveTime),
      )
    }
  }
}

// Window Setup
function setupWindowListeners(browserWindow: BrowserWindow, windowId: string) {
  const savePosition = createWindowPositionSaver(browserWindow, windowId)
  const windowLogger = childLogger(`seed/${windowId}`)

  // Console logging
  browserWindow.webContents.on('console-message', (e, level, message) => {
    if (level === 0) windowLogger.verbose(message)
    else if (level === 1) windowLogger.info(message)
    else if (level === 2) windowLogger.warn(message)
    else windowLogger.error(message)
  })

  // Window state events
  browserWindow.on('resize', () => {
    updateFindInPageView(browserWindow)
    savePosition()
  })

  browserWindow.on('moved', savePosition)
  browserWindow.on('show', () => {
    savePosition()
    focusedWindowTracker.setFocused(windowId)
  })

  browserWindow.on('focus', () => {
    focusedWindowTracker.setFocused(windowId)
    const state = getWindowState(windowId)
    if (state?.routes[state.routeIndex]) {
      updateRecentRoute(state.routes[state.routeIndex])
    }

    globalShortcut.register('CommandOrControl+F', () => {
      const focusedWindow = getFocusedWindow()
      if (focusedWindow) {
        let findInPageView = focusedWindow.contentView.children[0] as
          | WebContentsView
          | undefined

        info(`== ~ globalShortcut.register ~ findInPageView:`)

        if (!findInPageView) {
          info('[CMD+F]: no view present')
          createFindView(focusedWindow)
        } else {
          info('[CMD+F]: view present', {bounds: findInPageView.getBounds()})
          findInPageView.setBounds({
            ...findInPageView.getBounds(),
            y: 20,
          })
          setTimeout(() => {
            findInPageView?.webContents.focus()
            findInPageView?.webContents.send(
              'appWindowEvent',
              'find_in_page_focus',
            )
          }, 10)
        }
      }
    })
  })

  browserWindow.on('blur', () => {
    focusedWindowTracker.clearFocus(windowId)
    globalShortcut.unregister('CommandOrControl+F')
  })

  // Cleanup
  browserWindow.on('close', () => {
    cleanupWindow(windowId)
  })

  // Store handlers for cleanup
  addWindowEventHandler(windowId, 'resize', savePosition)
}

// Window Cleanup
function cleanupWindow(windowId: string) {
  const win = allWindows.get(windowId)
  if (win) {
    // Clear cached resources
    win.webContents.session.clearCache()

    // Remove from tracking
    allWindows.delete(windowId)
    windowStateCache.delete(windowId)
    windowTypeConfigCache.delete(windowId)

    // Clear event listeners
    removeWindowEventHandlers(windowId)

    // Clear focus if needed
    focusedWindowTracker.clearFocus(windowId)
  }
}

// Find in Page View Management
function updateFindInPageView(browserWindow: BrowserWindow) {
  const bounds = browserWindow.getBounds()
  const view = browserWindow.contentView.children[0] as
    | WebContentsView
    | undefined
  if (view) {
    view.setBounds({
      ...view.getBounds(),
      x: bounds.width - 320,
    })
  }
}

function createFindView(browserWindow: BrowserWindow) {
  const {width} = browserWindow.getBounds()
  const findView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-find-in-page.js'),
    },
  })

  findView.setBackgroundColor('#00000000')
  browserWindow.contentView.addChildView(findView)

  findView.setBounds({
    x: width - 320,
    y: -200,
    width: 320,
    height: 100,
  })

  if (FIND_IN_PAGE_VITE_DEV_SERVER_URL) {
    findView.webContents.loadURL(
      `${FIND_IN_PAGE_VITE_DEV_SERVER_URL}/find.html`,
    )
  } else {
    findView.webContents.loadFile(
      path.join(__dirname, `../renderer/${FIND_IN_PAGE_VITE_NAME}/find.html`),
    )
  }
}

// Exported Functions
export function createAppWindow(input: {
  routes: NavRoute[]
  routeIndex: number
  sidebarLocked: boolean
  id?: string
  bounds?: WindowBounds | null
}): BrowserWindow {
  try {
    const windowId = input.id || `window.${windowIdCount++}.${Date.now()}`
    childLogger('window-manager').info(`Creating window with ID: ${windowId}`)

    const windowType = getWindowTypeConfig(input.routes[input.routeIndex])
    const prevWindow = Array.from(allWindows.values())[allWindows.size - 1]
    const bounds = calculateWindowBounds(input.bounds, prevWindow, windowType)

    const browserWindow = new BrowserWindow({
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#151515' : '#f9f9f9',
      frame: false,
      autoHideMenuBar: true,
      ...bounds,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        disableDialogs: true,
        spellcheck: true,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
      minWidth: windowType.minWidth,
      minHeight: windowType.minHeight,
      maxWidth: windowType.maxWidth,
      maxHeight: windowType.maxHeight,
      icon: process.env.CI
        ? path.resolve(__dirname, '../assets/icons-prod/icon.png')
        : path.resolve(__dirname, '../assets/icons/icon.png'),
      titleBarStyle: 'hidden',
      trafficLightPosition: windowType.trafficLightPosition,
    })

    childLogger('window-manager').info(`Window created, initializing state...`)

    // Initialize window state
    setWindowState(windowId, {
      routes: input.routes,
      routeIndex: input.routeIndex,
      sidebarLocked: input.sidebarLocked,
      bounds: null,
    })

    // Setup window
    createFindView(browserWindow)
    setupWindowListeners(browserWindow, windowId)
    allWindows.set(windowId, browserWindow)

    childLogger('window-manager').info(`Setting up IPC handlers...`)

    // Setup IPC handlers
    const releaseDaemonListener = subscribeDaemonState((state) => {
      ipcBatcher.add(browserWindow, 'goDaemonState', state)
    })

    browserWindow.webContents.ipc.on('initWindow', (e) => {
      childLogger('window-manager').info(`Handling initWindow for ${windowId}`)
      e.returnValue = {
        windowType,
        navState: {
          routes: input.routes,
          routeIndex: input.routeIndex,
          sidebarLocked: input.sidebarLocked,
        },
        daemonState: getDaemonState(),
        windowId,
        darkMode: nativeTheme.shouldUseDarkColors,
      }
    })

    // Add route change handler
    browserWindow.webContents.ipc.on(
      'routeChange',
      (
        e,
        navState: {
          routes: NavRoute[]
          routeIndex: number
          sidebarLocked: boolean
        },
      ) => {
        childLogger('window-manager').info(
          `Route changed for window ${windowId}: ${JSON.stringify(navState)}`,
        )

        // Update window state with new routes
        const currentState = getWindowState(windowId)
        if (currentState) {
          const newState = {
            ...currentState,
            routes: navState.routes,
            routeIndex: navState.routeIndex,
            sidebarLocked: navState.sidebarLocked,
          }
          setWindowState(windowId, newState)

          // Update window type based on new route
          const newWindowType = getWindowTypeConfig(
            navState.routes[navState.routeIndex],
          )
          windowTypeConfigCache.set(windowId, newWindowType)

          // Update window bounds if needed
          if (
            newWindowType.minWidth !== undefined ||
            newWindowType.minHeight !== undefined
          ) {
            const currentBounds = browserWindow.getBounds()
            const newBounds = {
              ...currentBounds,
              width: Math.max(
                currentBounds.width,
                newWindowType.minWidth || currentBounds.width,
              ),
              height: Math.max(
                currentBounds.height,
                newWindowType.minHeight || currentBounds.height,
              ),
            }
            browserWindow.setBounds(newBounds)
          }
        }
      },
    )

    browserWindow.webContents.ipc.on('windowIsReady', () => {
      childLogger('window-manager').info(
        `Window ${windowId} is ready, showing window`,
      )
      browserWindow.show()
    })

    // Load content
    childLogger('window-manager').info(`Loading window content...`)
    try {
      if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        childLogger('window-manager').info(
          `Loading from dev server: ${MAIN_WINDOW_VITE_DEV_SERVER_URL}`,
        )
        browserWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      } else {
        if (!MAIN_WINDOW_VITE_NAME) {
          throw new Error('MAIN_WINDOW_VITE_NAME is not defined')
        }
        const filePath = path.join(
          __dirname,
          `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
        )
        childLogger('window-manager').info(`Loading from file: ${filePath}`)
        browserWindow.loadFile(filePath)
      }
    } catch (error) {
      childLogger('window-manager').error(
        `Error loading window content: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
      throw error
    }

    // Add error handler for window loading
    browserWindow.webContents.on(
      'did-fail-load',
      (event, errorCode, errorDescription) => {
        childLogger('window-manager').error(
          `Window failed to load: ${errorDescription} (${errorCode})`,
        )
      },
    )

    childLogger('window-manager').info(
      `Window creation completed for ${windowId}`,
    )
    return browserWindow
  } catch (error) {
    childLogger('window-manager').error(
      `Error creating window: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    )
    throw error
  }
}

export function closeAppWindow(windowId: string) {
  const window = allWindows.get(windowId)
  if (!window) return null
  window.close()
  if (allWindows.size === 0) {
    createAppWindow({
      routes: [defaultRoute],
      routeIndex: 0,
      sidebarLocked: true,
    })
  }
}

export function getFocusedWindow(): BrowserWindow | null | undefined {
  return focusedWindowTracker.currentFocusedId
    ? allWindows.get(focusedWindowTracker.currentFocusedId)
    : BrowserWindow.getFocusedWindow()
}

export function getAllWindows() {
  return allWindows
}

export function getWindowsState() {
  return Array.from(windowStateCache.entries()).reduce(
    (acc, [id, state]) => {
      acc[id] = state
      return acc
    },
    {} as Record<string, AppWindow>,
  )
}

export function dispatchFocusedWindowAppEvent(event: AppWindowEvent) {
  const focusedWindow = getFocusedWindow()
  if (focusedWindow) {
    ipcBatcher.add(focusedWindow, 'appWindowEvent', event)
  }
}

export function ensureFocusedWindowVisible() {
  const focusedWindow = getFocusedWindow()
  if (focusedWindow) {
    if (focusedWindow.isMinimized()) focusedWindow.restore()
    focusedWindow.focus()
  } else {
    warn(
      'did not have the focused window. we should create a window or refocus another window from allWindows',
    )
  }
}

// Initialize quit listener
app.addListener('before-quit', () => {
  isExpectingQuit = true
})
