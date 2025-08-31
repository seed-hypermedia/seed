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
  const focusedWindow = getFocusedWindow()
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
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .nullable()
    .optional(),
  sidebarLocked: z.boolean(),
  sidebarWidth: z.number(),
  accessoryWidth: z.number(),
})

type AppWindow = z.infer<typeof appWindowSchema>

const WINDOW_STATE_STORAGE_KEY = 'WindowState-v004'

let windowsState =
  (appStore.get(WINDOW_STATE_STORAGE_KEY) as Record<string, AppWindow>) ||
  ({} as Record<string, AppWindow>)

export function getWindowsState() {
  return windowsState || {}
}

function getAWindow() {
  const focused = getFocusedWindow()
  if (focused) return focused
  const allWins = Object.values(allWindows)
  const window: BrowserWindow | undefined = allWins[allWins.length - 1]
  return window
}

let lastFocusedWindowId: string | null = null

const windowNavState: Record<string, Omit<AppWindow, 'bounds'>> = {}

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
function updateWindowState(
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
  const focusedWindow = getFocusedWindow()
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
  const win = getAWindow()
  const prevWindowBounds = win?.getBounds()
  const initActiveRoute = initRoutes[initRouteIndex]
  const windowType = getRouteWindowType(initActiveRoute)
  const bounds = input.bounds
    ? input.bounds
    : prevWindowBounds
    ? {
        ...prevWindowBounds,
        width: Math.max(
          windowType.minWidth,
          Math.min(
            prevWindowBounds.width,
            windowType.maxWidth || windowType.initWidth || 1024,
          ),
        ),
        height: Math.max(
          windowType.minHeight,
          Math.min(
            prevWindowBounds.height,
            windowType.maxHeight || windowType.initHeight || 768,
          ),
        ),
        x: prevWindowBounds.x + 60,
        y: prevWindowBounds.y + 60,
      }
    : {
        width: windowType.initWidth || windowType.minWidth,
        height: windowType.initHeight || windowType.minHeight,
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

  const windValue = {
    routes: initRoutes,
    routeIndex: initRouteIndex,
    sidebarLocked:
      typeof input.sidebarLocked === 'boolean' ? input.sidebarLocked : true,
    sidebarWidth: input.sidebarWidth || 15,
    accessoryWidth: input.accessoryWidth || 20,
  }
  windowNavState[windowId] = windValue

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
    browserWindow.show()
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

  setWindowState(windowId, {
    routes: initRoutes,
    routeIndex: input.routeIndex || 0,
    sidebarLocked:
      typeof input.sidebarLocked === 'boolean' ? input.sidebarLocked : true,
    sidebarWidth: input.sidebarWidth || 15,
    accessoryWidth: input.accessoryWidth || 20,
    bounds: null,
  })

  browserWindow.webContents.send('initWindow', {
    routes: initRoutes,
    routeIndex: input.routeIndex,
    daemonState: getDaemonState(),
    windowId,
  })
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
      }: NavState,
    ) => {
      windowNavState[windowId] = {
        routes,
        routeIndex,
        sidebarLocked:
          typeof sidebarLocked === 'boolean' ? sidebarLocked : true,
        sidebarWidth: sidebarWidth || 15,
        accessoryWidth: accessoryWidth || 20,
      }
      updateWindowState(windowId, (window) => ({
        ...window,
        routes,
        routeIndex,
        sidebarLocked:
          typeof sidebarLocked === 'boolean' ? sidebarLocked : true,
        sidebarWidth: sidebarWidth || 15,
        accessoryWidth: accessoryWidth || 20,
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

  browserWindow.webContents.on('found-in-page', (event, result) => {
    // if (result.finalUpdate) {
    //   browserWindow.webContents.stopFindInPage('clearSelection')
    // }
  })

  browserWindow.on('blur', () => {
    windowBlurred(windowId)
    globalShortcut.unregister('CommandOrControl+F')
  })

  windowFocused(windowId)
  lastFocusedWindowId = windowId

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    browserWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    browserWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    )
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
