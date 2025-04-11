import appError from '@/errors'
import type {NavState} from '@/utils/navigation'
import type {AppWindowEvent} from '@/utils/window-events'
import {getRouteWindowType} from '@/utils/window-types'
import {defaultRoute} from '@shm/shared/routes'
import {
  BrowserWindow,
  WebContentsView,
  app,
  globalShortcut,
  nativeTheme,
} from 'electron'
import path from 'node:path'
import {z} from 'zod'
import {updateRecentRoute} from './app-recents'
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
  allWindows.forEach((window) => {
    window.webContents.send('darkMode', nativeTheme.shouldUseDarkColors)
  })
})

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
})

type AppWindow = z.infer<typeof appWindowSchema>

const WINDOW_STATE_STORAGE_KEY = 'WindowState-v004'

let windowsState =
  (appStore.get(WINDOW_STATE_STORAGE_KEY) as Record<string, AppWindow>) ||
  ({} as Record<string, AppWindow>)

export function getWindowsState() {
  console.log(`== ~ STORAGE: ~ getWindowsState:`, windowsState)
  return windowsState || {}
}

function getAWindow() {
  const focused = getFocusedWindow()
  if (focused) return focused
  const allWins = Object.values(allWindows)
  const window: BrowserWindow | undefined = allWins[allWins.length - 1]
  return window
}

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
export function createAppWindow(
  input: Partial<AppWindow> & {id?: string},
): BrowserWindow {
  if (!app.isReady()) {
    throw new Error('Cannot create BrowserWindow before app is ready')
  }
  const windowId = input.id || `window.${windowIdCount++}.${Date.now()}`
  const win = getAWindow()
  const prevWindowBounds = win?.getBounds()
  const initRoutes = input?.routes || [{key: 'library'}]
  const initRouteIndex = input?.routeIndex || 0
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

  const windValue = {
    routes: initRoutes,
    routeIndex: initRouteIndex,
    sidebarLocked:
      typeof input.sidebarLocked === 'boolean' ? input.sidebarLocked : true,
    sidebarWidth: input.sidebarWidth || 15,
  }
  console.log('=== NEW windowNavState', windowId, windValue)

  windowNavState[windowId] = windValue

  browserWindow.webContents.ipc.on('initWindow', (e) => {
    e.returnValue = {
      windowType,
      navState: windowNavState[windowId],
      daemonState: getDaemonState(),
      windowId,
      darkMode: nativeTheme.shouldUseDarkColors,
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
    (info, {routes, routeIndex, sidebarLocked, sidebarWidth}: NavState) => {
      windowNavState[windowId] = {
        routes,
        routeIndex,
        sidebarLocked:
          typeof sidebarLocked === 'boolean' ? sidebarLocked : true,
        sidebarWidth: sidebarWidth || 15,
      }
      updateWindowState(windowId, (window) => ({
        ...window,
        routes,
        routeIndex,
        sidebarLocked:
          typeof sidebarLocked === 'boolean' ? sidebarLocked : true,
        sidebarWidth: sidebarWidth || 15,
      }))
      updateRecentRoute(routes[routeIndex])
    },
  )

  // First render trick: https://getlotus.app/21-making-electron-apps-feel-native-on-mac
  browserWindow.on('ready-to-show', () => {
    // browserWindow.show()
  })

  browserWindow.on('close', () => {
    releaseDaemonListener()
    allWindows.delete(windowId)
    if (!isExpectingQuit) {
      deleteWindowState(windowId)
    }
  })
  browserWindow.on('show', () => {
    windowFocused(windowId)
  })
  browserWindow.on('focus', () => {
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
