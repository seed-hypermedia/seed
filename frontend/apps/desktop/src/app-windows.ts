import appError from '@/errors'
import type {AppWindowEvent} from '@/utils/window-events'
import {getRouteWindowType} from '@/utils/window-types'
import {defaultRoute} from '@shm/shared/routes'
import type {NavState} from '@shm/shared/utils/navigation'
import {
  BrowserWindow,
  WebContentsView,
  app,
  globalShortcut,
  nativeTheme,
  screen,
  shell,
} from 'electron'
import path from 'node:path'
import {z} from 'zod'
import {updateRecentRoute} from './app-recents'
import {getAppTheme, shouldUseDarkColors} from './app-settings'
import {appStore} from './app-store.mjs'
import {getDaemonState, subscribeDaemonState} from './daemon'
import {childLogger, debug, info, warn} from './logger'

let windowIdCount = 1

const allWindows = new Map<string, BrowserWindow>()

export function getAllWindows() {
  return allWindows
}

let focusedWindowKey: string | null = null

export function getFocusedWindow(): BrowserWindow | null | undefined {
  return BrowserWindow.getFocusedWindow()
}

// Routes that should prevent duplicate windows
const SINGLE_INSTANCE_ROUTES = new Set([
  'library',
  'contacts',
  'settings',
  'drafts',
])

// Check if a route key should prevent duplicate windows
function shouldPreventDuplicateWindow(routeKey: string): boolean {
  return SINGLE_INSTANCE_ROUTES.has(routeKey)
}

// Find an existing window that has the specified route as its currently active route
function findWindowWithActiveRoute(routeKey: string): BrowserWindow | null {
  const windowEntries = Array.from(allWindows.entries())
  for (const [windowId, browserWindow] of windowEntries) {
    const navState = windowNavState[windowId]

    if (navState && navState.routes.length > 0) {
      const activeRoute = navState.routes[navState.routeIndex]
      if (activeRoute && activeRoute.key === routeKey) {
        return browserWindow
      }
    }
  }
  return null
}

// Focus an existing window and restore it if minimized
function focusExistingWindow(browserWindow: BrowserWindow): void {
  if (browserWindow.isMinimized()) {
    browserWindow.restore()
  }
  browserWindow.focus()
  browserWindow.show()
}

// @ts-ignore
export function closeAppWindow(windowId: string) {
  const window = allWindows.get(windowId)
  if (!window) return null
  window.close()
  allWindows.delete(windowId)
  if (allWindows.size === 0) {
    createAppWindow({
      routes: [defaultRoute],
      routeIndex: 0,
      sidebarLocked: true,
      sidebarWidth: 15,
      accessoryWidth: 20,
    })
  }
}

function windowFocused(windowId: string) {
  focusedWindowKey = windowId
}
function windowBlurred(windowId: string) {
  if (focusedWindowKey === windowId) {
    focusedWindowKey = null
  }
}

export function ensureFocusedWindowVisible() {
  const focusedWindow = getLastFocusedWindow()
  if (focusedWindow) {
    if (focusedWindow.isMinimized()) focusedWindow.restore()
    focusedWindow.focus()
  } else {
    let mssg =
      'did not have the focused window. we should create a window or refocus another window from allWindows'
    appError(mssg)
    console.error(mssg)
  }
}

nativeTheme.addListener('updated', () => {
  broadcastUseDarkColors()
})

export function broadcastUseDarkColors() {
  const settingsTheme = getAppTheme()
  const darkColors =
    settingsTheme === 'system'
      ? nativeTheme.shouldUseDarkColors
      : settingsTheme === 'dark'
  allWindows.forEach((window) => {
    window.webContents.send('darkMode', darkColors)
  })
}

const appWindowSchema = z.object({
  routes: z.array(z.any()),
  routeIndex: z.number(),
  bounds: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    })
    .nullable()
    .optional(),
  sidebarLocked: z.boolean(),
  sidebarWidth: z.number(),
  accessoryWidth: z.number(),
  selectedIdentity: z.string().nullable().optional(),
})

export type AppWindow = z.infer<typeof appWindowSchema>

const WINDOW_STATE_STORAGE_KEY = 'WindowState-v004'

const initalizedWindows = new Set<string>()

let windowsState =
  (appStore.get(WINDOW_STATE_STORAGE_KEY) as Record<string, AppWindow>) ||
  ({} as Record<string, AppWindow>)

export function getWindowsState() {
  return windowsState || {}
}

function getAWindow() {
  const focused = getLastFocusedWindow()
  if (focused) return focused
  const allWins = Object.values(allWindows)
  const window: BrowserWindow | undefined = allWins[allWins.length - 1]
  return window
}

/**
 * Gets a valid window for inheriting properties (size, position, etc).
 * Returns null if window is in an invalid state (fullscreen, maximized, minimized, or destroyed).
 */
function getValidWindowForInheritance(): BrowserWindow | null {
  const win = getAWindow()
  if (!win || win.isDestroyed()) return null
  if (win.isFullScreen() || win.isMaximized() || win.isMinimized()) return null
  return win
}

/**
 * Validates and adjusts window position to ensure it's visible on a display.
 * Returns adjusted bounds if the window would be off-screen.
 */
function validateWindowPosition(bounds: {
  x: number
  y: number
  width: number
  height: number
}): {x: number; y: number; width: number; height: number} {
  const displays = screen.getAllDisplays()

  // Check if window would be visible on any display
  const isVisible = displays.some((display) => {
    const workArea = display.workArea
    // Window is visible if any part overlaps with display
    return !(
      bounds.x + bounds.width < workArea.x ||
      bounds.x > workArea.x + workArea.width ||
      bounds.y + bounds.height < workArea.y ||
      bounds.y > workArea.y + workArea.height
    )
  })

  if (!isVisible) {
    // Fallback to primary display
    const primary = screen.getPrimaryDisplay()
    return {
      ...bounds,
      x: primary.workArea.x + 60,
      y: primary.workArea.y + 60,
    }
  }

  return bounds
}

let lastFocusedWindowId: string | null = null

const windowNavState: Record<string, Omit<AppWindow, 'bounds'>> = {}

export function getWindowNavState() {
  return windowNavState
}

// Re-export the pure utility function from utils/account-selection
export {getSelectedIdentityFromWindowState} from './utils/account-selection'

/**
 * Gets the most recently focused window, even if app is in background.
 * Used by auto-updater to send notifications when app isn't focused.
 */
export function getLastFocusedWindow(): BrowserWindow | null {
  // Try last focused window by ID
  if (lastFocusedWindowId) {
    const window = allWindows.get(lastFocusedWindowId)
    if (window && !window.isDestroyed()) {
      return window
    }
  }

  // Fallback to currently focused window
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) {
    return focused
  }

  // Last resort: any available window
  const allWins = Array.from(allWindows.values())
  const anyWindow = allWins.find((win) => !win.isDestroyed())
  return anyWindow || null
}

let isExpectingQuit = false
app.addListener('before-quit', () => {
  isExpectingQuit = true
})

function setWindowsState(newWindows: Record<string, AppWindow>) {
  windowsState = newWindows
  appStore.set(WINDOW_STATE_STORAGE_KEY, newWindows)
}

export function deleteWindowsState() {
  return new Promise((resolve) => {
    // Clear all windows from the Map
    allWindows.forEach((window) => {
      window.close()
    })
    allWindows.clear()

    // Reset windows state in the store
    setWindowsState({})
    resolve(void 0)
  })
}

function deleteWindowState(windowId: string) {
  const newWindows = {...windowsState}
  delete newWindows[windowId]
  setWindowsState(newWindows)
}
function setWindowState(windowId: string, window: AppWindow) {
  const newWindows = {...windowsState}
  newWindows[windowId] = window
  setWindowsState(newWindows)
}
export function updateWindowState(
  windowId: string,
  updater: (window: AppWindow) => AppWindow,
) {
  const newWindows = {...windowsState}
  const winState = newWindows[windowId]
  if (winState) {
    newWindows[windowId] = updater(winState)
    setWindowsState(newWindows)
  } else warn('updateWindowState: window not found', {windowID: windowId})
}

export function dispatchFocusedWindowAppEvent(event: AppWindowEvent) {
  const focusedWindow = getLastFocusedWindow()
  if (focusedWindow) {
    focusedWindow.webContents.send('appWindowEvent', event)
  }
}

export function dispatchAllWindowsAppEvent(event: AppWindowEvent) {
  allWindows.forEach((window) => {
    window.webContents.send('appWindowEvent', event)
  })
}

export function createAppWindow(
  input: Partial<AppWindow> & {id?: string},
): BrowserWindow {
  if (!app.isReady()) {
    throw new Error('Cannot create BrowserWindow before app is ready')
  }

  // Check if we should prevent duplicate windows for this route
  const initRoutes = input?.routes || [{key: 'library'}]
  const initRouteIndex = input?.routeIndex || 0
  const targetRoute = initRoutes[initRouteIndex]

  if (targetRoute && shouldPreventDuplicateWindow(targetRoute.key)) {
    const existingWindow = findWindowWithActiveRoute(targetRoute.key)
    if (existingWindow) {
      focusExistingWindow(existingWindow)
      return existingWindow
    }
  }

  const windowId = input.id || `window.${windowIdCount++}.${Date.now()}`
  const initActiveRoute = initRoutes[initRouteIndex]
  const windowType = getRouteWindowType(initActiveRoute)

  // Calculate bounds for the new window
  let bounds: {x?: number; y?: number; width: number; height: number}

  // Check if input.bounds has full position (x, y, width, height) - used for window restoration
  if (
    input.bounds &&
    input.bounds.x !== undefined &&
    input.bounds.y !== undefined &&
    input.bounds.width !== undefined &&
    input.bounds.height !== undefined
  ) {
    // Full bounds provided, use directly for window restoration
    bounds = {
      x: input.bounds.x,
      y: input.bounds.y,
      width: input.bounds.width,
      height: input.bounds.height,
    }
  } else {
    // Determine dimensions
    let width: number
    let height: number

    if (
      input.bounds?.width !== undefined &&
      input.bounds?.height !== undefined
    ) {
      // Use provided width/height from bounds (e.g., inherited from focused window)
      width = input.bounds.width
      height = input.bounds.height
    } else {
      // Get valid window for inheritance (null if fullscreen/maximized/minimized)
      const validWindow = getValidWindowForInheritance()
      if (validWindow) {
        const prevBounds = validWindow.getBounds()
        width = prevBounds.width
        height = prevBounds.height
      } else {
        // Use defaults from windowType
        width = windowType.initWidth || windowType.minWidth
        height = windowType.initHeight || windowType.minHeight
      }
    }

    // Apply windowType constraints to dimensions
    // Apply min constraint
    width = Math.max(windowType.minWidth, width)
    height = Math.max(windowType.minHeight, height)

    // Apply max constraint only if it exists
    if (windowType.maxWidth !== undefined) {
      width = Math.min(width, windowType.maxWidth)
    }
    if (windowType.maxHeight !== undefined) {
      height = Math.min(height, windowType.maxHeight)
    }

    // Calculate position
    const validWindow = getValidWindowForInheritance()
    if (validWindow) {
      const prevBounds = validWindow.getBounds()
      const proposedBounds = {
        x: prevBounds.x + 60,
        y: prevBounds.y + 60,
        width,
        height,
      }
      // Validate position is on-screen, adjust if needed
      bounds = validateWindowPosition(proposedBounds)
    } else {
      // No valid window to inherit from, let Electron position it
      bounds = {width, height}
    }
  }
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
    },
    minWidth: windowType.minWidth,
    minHeight: windowType.minHeight,
    maxWidth: windowType.maxWidth,
    maxHeight: windowType.maxHeight,
    icon: process.env.CI
      ? path.resolve(__dirname, '../assets/icons-prod/icon.png')
      : path.resolve(__dirname, '../assets/icons/icon.png'),
    titleBarStyle: 'hidden',
    trafficLightPosition: windowType.trafficLightPosition || undefined,
  })

  createFindView(browserWindow)

  debug('Window created', {windowId})

  const windowLogger = childLogger(`seed/${windowId}`)
  browserWindow.webContents.on(
    'console-message',
    (e, level, message, line, sourceId) => {
      if (level === 0) windowLogger.verbose(message)
      else if (level === 1) windowLogger.info(message)
      else if (level === 2) windowLogger.warn(message)
      else windowLogger.error(message)
    },
  )

  // Handle links from embedded content (Twitter, YouTube, etc.) that try to open new windows
  browserWindow.webContents.setWindowOpenHandler(
    ({url, frameName, features}) => {
      // Log for debugging
      debug('Window open request', {url, frameName, features})

      // Open all external URLs in the default browser
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url)
      }

      // Deny the window creation - we've handled it by opening in default browser
      return {action: 'deny'}
    },
  )

  // Handle navigation attempts within the main frame
  browserWindow.webContents.on('will-navigate', (event, url) => {
    // Allow navigation for the main app (localhost in dev, file:// in production)
    if (url.includes('localhost') || url.startsWith('file://')) {
      return
    }

    // Prevent navigation and open in external browser instead
    event.preventDefault()
    shell.openExternal(url)
  })

  // Handle navigation in frames (for iframe content like YouTube embeds)
  browserWindow.webContents.on('will-frame-navigate', (event) => {
    const {url, isMainFrame} = event

    // Only handle iframe navigations, not main frame
    if (!isMainFrame) {
      // Allow embed domains to load their content
      const allowedEmbedDomains = [
        'youtube.com',
        'youtube-nocookie.com',
        'twitter.com',
        'x.com',
        'platform.twitter.com',
        'instagram.com',
        'cdninstagram.com',
      ]

      const isAllowedEmbed = allowedEmbedDomains.some((domain) =>
        url.includes(domain),
      )

      if (!isAllowedEmbed) {
        // If it's not an allowed embed domain, open in external browser
        event.preventDefault()
        shell.openExternal(url)
      }
      // Otherwise allow the embed to load normally
    }
  })

  // Additional handler for any child windows that might slip through
  browserWindow.webContents.on('did-create-window', (childWindow, details) => {
    // Log for debugging
    debug('Child window created', {url: details.url})

    // Get the URL and open it externally
    if (details.url) {
      shell.openExternal(details.url)
    }

    // Close the child window immediately
    childWindow.close()
  })

  const selectedIdentity =
    input.selectedIdentity ||
    (lastFocusedWindowId &&
      windowNavState[lastFocusedWindowId]?.selectedIdentity) ||
    null

  const initNavState = {
    routes: initRoutes,
    routeIndex: initRouteIndex,
    sidebarLocked:
      typeof input.sidebarLocked === 'boolean' ? input.sidebarLocked : true,
    sidebarWidth: input.sidebarWidth || 15,
    accessoryWidth: input.accessoryWidth || 20,
    selectedIdentity,
  }

  windowNavState[windowId] = initNavState

  browserWindow.webContents.ipc.on('initWindow', (e) => {
    e.returnValue = {
      windowType,
      navState: windowNavState[windowId],
      daemonState: getDaemonState(),
      windowId,
      darkMode: shouldUseDarkColors(),
    }
  })
  const releaseDaemonListener = subscribeDaemonState((goDaemonState) => {
    browserWindow.webContents.send('goDaemonState', goDaemonState)
  })

  browserWindow.webContents.ipc.on('windowIsReady', (e) => {
    if (initalizedWindows.has(windowId)) return
    browserWindow.show()
    initalizedWindows.add(windowId)
  })

  function saveWindowPosition() {
    const bounds = browserWindow.getBounds()
    updateWindowState(windowId, (window) => ({...window, bounds}))
  }
  let windowPositionSaveTimeout: null | NodeJS.Timeout = null
  function saveWindowPositionDebounced() {
    if (windowPositionSaveTimeout) {
      clearTimeout(windowPositionSaveTimeout)
    }
    windowPositionSaveTimeout = setTimeout(() => {
      saveWindowPosition()
    }, 200)
  }
  // @ts-expect-error
  browserWindow.on('resize', (e, a) => {
    updateFindInPageView(browserWindow)
    saveWindowPositionDebounced()
  })
  // @ts-expect-error
  browserWindow.on('moved', (e, a) => {
    saveWindowPositionDebounced()
  })
  // @ts-expect-error
  browserWindow.on('show', (e) => {
    saveWindowPosition()
  })
  allWindows.set(windowId, browserWindow)

  // Set the persistent window state - this should match the windValue above
  setWindowState(windowId, {
    ...initNavState,
    bounds: null,
  })

  // Note: The initWindow data is sent via the synchronous IPC handler above, not via send()
  // browserWindow.webContents.send('initWindow', ...) - removed duplicate send
  browserWindow.webContents.ipc.addListener(
    'windowNavState',
    (
      info,
      {
        routes,
        routeIndex,
        sidebarLocked,
        sidebarWidth,
        accessoryWidth,
        selectedIdentity,
      }: NavState,
    ) => {
      windowNavState[windowId] = {
        routes,
        routeIndex,
        sidebarLocked:
          typeof sidebarLocked === 'boolean' ? sidebarLocked : true,
        sidebarWidth: sidebarWidth || 15,
        accessoryWidth: accessoryWidth || 20,
        selectedIdentity: selectedIdentity || null,
      }
      updateWindowState(windowId, (window) => ({
        ...window,
        routes,
        routeIndex,
        sidebarLocked:
          typeof sidebarLocked === 'boolean' ? sidebarLocked : true,
        sidebarWidth: sidebarWidth || 15,
        accessoryWidth: accessoryWidth || 20,
        selectedIdentity: selectedIdentity || null,
      }))
      // @ts-ignore
      updateRecentRoute(routes[routeIndex])
    },
  )

  // First render trick: https://getlotus.app/21-making-electron-apps-feel-native-on-mac
  browserWindow.on('ready-to-show', () => {
    // browserWindow.show()
  })

  // Add event listeners for maximize and unmaximize events
  browserWindow.on('maximize', () => {
    browserWindow.webContents.send('window-state-change', {isMaximized: true})
  })

  browserWindow.on('unmaximize', () => {
    browserWindow.webContents.send('window-state-change', {isMaximized: false})
  })

  browserWindow.on('close', () => {
    releaseDaemonListener()
    allWindows.delete(windowId)
    if (lastFocusedWindowId === windowId) {
      lastFocusedWindowId = null
    }
    if (!isExpectingQuit) {
      deleteWindowState(windowId)
    }
  })
  browserWindow.on('show', () => {
    lastFocusedWindowId = windowId
    windowFocused(windowId)
  })
  browserWindow.on('focus', () => {
    lastFocusedWindowId = windowId
    windowFocused(windowId)
    const navState = windowNavState[windowId]
    const activeRoute = navState
      ? navState.routes[navState.routeIndex]
      : undefined
    if (activeRoute) {
      updateRecentRoute(activeRoute)
    }

    globalShortcut.register('CommandOrControl+F', () => {
      const focusedWindow = getLastFocusedWindow()
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

    globalShortcut.register('CommandOrControl+B', () => {
      // Dispatch both events - handlers check editor focus
      dispatchFocusedWindowAppEvent({type: 'toggle_bold'})
      dispatchFocusedWindowAppEvent({type: 'toggle_sidebar'})
    })

    // Register numbered shortcuts for accessories
    for (let i = 1; i <= 5; i++) {
      globalShortcut.register(`CommandOrControl+${i}`, () => {
        dispatchFocusedWindowAppEvent({
          type: 'toggle_accessory',
          index: i - 1, // 0-based index
        })
      })
    }
  })

  browserWindow.webContents.on('found-in-page', (event, result) => {
    // if (result.finalUpdate) {
    //   browserWindow.webContents.stopFindInPage('clearSelection')
    // }
  })

  browserWindow.on('blur', () => {
    windowBlurred(windowId)
    globalShortcut.unregister('CommandOrControl+F')
    globalShortcut.unregister('CommandOrControl+B')

    // Unregister numbered shortcuts
    for (let i = 1; i <= 5; i++) {
      globalShortcut.unregister(`CommandOrControl+${i}`)
    }
  })

  windowFocused(windowId)
  lastFocusedWindowId = windowId

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    browserWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    // Use local server to avoid file:// CORS restrictions with iframes
    const serverPort = (global as any).localServerPort
    if (serverPort) {
      browserWindow.loadURL(
        `http://127.0.0.1:${serverPort}/${MAIN_WINDOW_VITE_NAME}/index.html`,
      )
    } else {
      // Fallback to file:// if server not available (embeds won't work)
      browserWindow.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      )
      warn(
        '[APP-WINDOWS]: Local server not available, using file:// protocol - embeds will not work',
      )
    }
  }

  return browserWindow
}

function updateFindInPageView(win: BrowserWindow) {
  const bounds = win.getBounds()
  const view = win.contentView.children[0] as WebContentsView | undefined
  if (view) {
    view.setBounds({
      ...view.getBounds(),
      x: bounds.width - 320,
    })
  }
}

function createFindView(win: BrowserWindow) {
  const {width} = win.getBounds()

  const findView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-find-in-page.js'),
    },
  })

  // Set transparent background
  findView.setBackgroundColor('#00000000')

  // Add the view to the window's content view
  win.contentView.addChildView(findView)

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

let loadingWindow: BrowserWindow | null = null

export function createLoadingWindow(): BrowserWindow {
  if (!app.isReady()) {
    throw new Error('Cannot create BrowserWindow before app is ready')
  }

  // If loading window already exists, return it
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    return loadingWindow
  }

  // Get primary display to center the window
  const primaryDisplay = screen.getPrimaryDisplay()
  const {width: screenWidth, height: screenHeight} = primaryDisplay.workAreaSize

  // Discord-style loading window: small, centered, frameless
  const windowWidth = 400
  const windowHeight = 480

  loadingWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.floor((screenWidth - windowWidth) / 2),
    y: Math.floor((screenHeight - windowHeight) / 2),
    show: true, // Show immediately for testing
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true, // Allow closing for testing
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload-loading.js'),
      disableDialogs: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Setup IPC handlers for loading window
  loadingWindow.webContents.ipc.on('initWindow', (e) => {
    e.returnValue = {
      daemonState: getDaemonState(),
      forceLoadingWindow:
        typeof __FORCE_LOADING_WINDOW__ !== 'undefined' &&
        __FORCE_LOADING_WINDOW__ === 'true',
    }
  })

  // Note: forceActiveState IPC handler is in main.ts

  // Subscribe to daemon state changes and broadcast to loading window
  const releaseDaemonListener = subscribeDaemonState((goDaemonState) => {
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.webContents.send('goDaemonState', goDaemonState)
    }
  })

  // Handle windowIsReady IPC call
  loadingWindow.webContents.ipc.on('windowIsReady', () => {
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.show()
    }
  })

  // Cleanup daemon listener when window is closed
  loadingWindow.on('closed', () => {
    releaseDaemonListener()
  })

  // Enable console logging from loading window
  loadingWindow.webContents.on('console-message', (e, level, message) => {
    info(`[LOADING WINDOW]: ${message}`)
  })

  // Load the loading window renderer
  // Debug: log what constants we have
  info(
    `LOADING_WINDOW_VITE_DEV_SERVER_URL: ${
      typeof LOADING_WINDOW_VITE_DEV_SERVER_URL !== 'undefined'
        ? LOADING_WINDOW_VITE_DEV_SERVER_URL
        : 'undefined'
    }`,
  )
  info(
    `LOADING_WINDOW_VITE_NAME: ${
      typeof LOADING_WINDOW_VITE_NAME !== 'undefined'
        ? LOADING_WINDOW_VITE_NAME
        : 'undefined'
    }`,
  )
  info(
    `MAIN_WINDOW_VITE_DEV_SERVER_URL: ${
      typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined'
        ? MAIN_WINDOW_VITE_DEV_SERVER_URL
        : 'undefined'
    }`,
  )

  // In development mode, Electron Forge might not start a separate dev server for loading_window
  // So we load loading.html directly from the source directory
  if (
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' &&
    MAIN_WINDOW_VITE_DEV_SERVER_URL
  ) {
    // Development mode - load loading.html directly
    const loadingHtmlPath = path.join(__dirname, '../../loading.html')
    info(`Development: Loading from file: ${loadingHtmlPath}`)
    loadingWindow.loadFile(loadingHtmlPath)
  } else {
    // Production mode - load from built files
    const prodPath = path.join(
      __dirname,
      `../renderer/${
        typeof LOADING_WINDOW_VITE_NAME !== 'undefined'
          ? LOADING_WINDOW_VITE_NAME
          : 'loading_window'
      }/index.html`,
    )
    info(`Production: Loading from: ${prodPath}`)
    loadingWindow.loadFile(prodPath)
  }

  info('Loading window created and visible')

  return loadingWindow
}

export function closeLoadingWindow(): void {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    info('Closing loading window')
    loadingWindow.close()
    loadingWindow = null
  }
}
