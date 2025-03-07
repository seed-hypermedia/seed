import {resolveHmIdToAppRoute} from '@/utils/navigation'

import {DAEMON_HTTP_URL} from '@shm/shared/constants'

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  NativeImage,
  nativeTheme,
  WebContentsView,
} from 'electron'
import {createIPCHandler} from 'electron-trpc/main'
import {writeFile} from 'fs-extra'
import {decompressFromEncodedURIComponent} from 'lz-string'
import path from 'path'
import z from 'zod'
import {commentsApi} from './app-comments'
import {diagnosisApi} from './app-diagnosis'
import {draftsApi} from './app-drafts'
import {experimentsApi} from './app-experiments'
import {favoritesApi} from './app-favorites'
import {gatewaySettingsApi} from './app-gateway-settings'
import {grpcClient} from './app-grpc'
import {appInvalidateQueries, queryInvalidation} from './app-invalidation'
import {userDataPath} from './app-paths'
import {recentSignersApi} from './app-recent-signers'
import {recentsApi} from './app-recents'

import {defaultRoute, NavRoute, navRouteSchema} from '@shm/shared/routes'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {secureStorageApi} from './app-secure-storage'
import {appSettingsApi} from './app-settings'
import {sitesApi} from './app-sites'
import {t} from './app-trpc'
import {extractMetaTags, uploadFile, webImportingApi} from './app-web-importing'
import {welcomingApi} from './app-welcoming'
import * as log from './logger'
import {
  closeAppWindow,
  createAppWindow,
  dispatchFocusedWindowAppEvent,
  ensureFocusedWindowVisible,
  getAllWindows,
  getFocusedWindow,
  getWindowsState,
} from './window-manager'

export {dispatchFocusedWindowAppEvent} from './window-manager'

ipcMain.on('invalidate_queries', (_event, info) => {
  appInvalidateQueries(info)
})

ipcMain.on('focusedWindowAppEvent', (_event, info) => {
  dispatchFocusedWindowAppEvent(info)
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

ipcMain.on('find_in_page_cancel', () => {
  let focusedWindow = getFocusedWindow()
  focusedWindow?.webContents?.stopFindInPage('keepSelection')
  let findInPageView = focusedWindow?.contentView.children[0] as
    | WebContentsView
    | undefined
  if (findInPageView) {
    findInPageView.setBounds({
      ...findInPageView.getBounds(),
      y: -200,
    })
  }
})

nativeTheme.addListener('updated', () => {
  getAllWindows().forEach((window) => {
    window.webContents.send('darkMode', nativeTheme.shouldUseDarkColors)
  })
})

log.info('App User Data', {path: userDataPath})

export function openInitialWindows() {
  const windowsState = getWindowsState()
  const validWindowEntries = Object.entries(windowsState).filter(
    ([windowId, window]) => {
      if (!window || !Array.isArray(window.routes)) return false
      if (window.routes.length === 0) return false
      return window.routes.every((route) => {
        return navRouteSchema.safeParse(route).success
      })
    },
  )
  if (!validWindowEntries.length) {
    trpc.createAppWindow({routes: [defaultRoute]})
    return
  }
  try {
    validWindowEntries.forEach(([windowId, window]) => {
      trpc.createAppWindow({
        routes: window.routes,
        routeIndex: window.routeIndex,
        sidebarLocked: window.sidebarLocked,
        bounds: window.bounds,
        id: windowId,
      })
    })
  } catch (error: unknown) {
    const e = error as Error
    log.error(`[MAIN]: openInitialWindows Error: ${e.message}`)
    trpc.createAppWindow({routes: [defaultRoute]})
    return
  }
}

export function openRoute(route: NavRoute) {
  const focusedWindow = getFocusedWindow()
  if (focusedWindow) {
    focusedWindow.webContents.send('open_route', route)
  } else {
    trpc.createAppWindow({routes: [route], routeIndex: 0})
  }
}

function getRouteRefocusKey(route: NavRoute): string | null {
  if (route.key === 'document') return null
  if (route.key === 'draft') return null
  return route.key
}

export const router = t.router({
  drafts: draftsApi,
  experiments: experimentsApi,
  diagnosis: diagnosisApi,
  welcoming: welcomingApi,
  webImporting: webImportingApi,
  web: t.router({
    queryMeta: t.procedure.input(z.string()).query(async ({input}) => {
      const res = await fetch(input)
      const html = await res.text()
      const meta = extractMetaTags(html)
      return {meta}
    }),
    requestDiscover: t.procedure
      .input(
        z.object({
          uid: z.string(),
          path: z.array(z.string()).nullable(),
          version: z.string().optional().nullable(),
          host: z.string(),
        }),
      )
      .mutation(async ({input}) => {
        try {
          const res = await fetch(`${input.host}/hm/api/discover`, {
            method: 'post',
            body: JSON.stringify({
              uid: input.uid,
              path: input.path || [],
              version: input.version || undefined,
            }),
            headers: {
              'Content-Type': 'application/json',
            },
          })
          const discoverOutput = await res.json()
          if (res.status !== 200) throw new Error(discoverOutput.message)
          return discoverOutput
        } catch (error: unknown) {
          const e = error as Error
          log.error('error discovering', {error: e.message})
          throw error
        }
      }),
  }),
  favorites: favoritesApi,
  recentSigners: recentSignersApi,
  comments: commentsApi,
  gatewaySettings: gatewaySettingsApi,
  secureStorage: secureStorageApi,
  recents: recentsApi,
  sites: sitesApi,
  appSettings: appSettingsApi,
  closeAppWindow: t.procedure.input(z.string()).mutation(async ({input}) => {
    closeAppWindow(input)
    return null
  }),
  createAppWindow: t.procedure
    .input(
      z.object({
        routes: z.array(z.any()), // todo, zodify NavRoute type
        routeIndex: z.number().default(0),
        id: z.string().optional(),
        sidebarLocked: z.boolean().default(false),
        bounds: z
          .object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
          })
          .or(z.null())
          .optional(),
      }),
    )
    .mutation(async ({input}) => {
      log.info(`[MAIN]: will createAppWindow ${JSON.stringify(input.routes)}`)
      if (!app.isReady()) {
        await new Promise<void>((resolve) => {
          app.whenReady().then(() => resolve())
        })
      }
      const allWindows = getWindowsState()
      const destRoute = input.routes[input.routeIndex]
      const destRouteKey = getRouteRefocusKey(destRoute)
      const matchedWindow = Object.entries(allWindows).find(
        ([windowId, window]) => {
          if (
            !window ||
            !Array.isArray(window.routes) ||
            typeof window.routeIndex !== 'number'
          ) {
            return false
          }
          const activeRoute = window.routes[window.routeIndex]
          if (!activeRoute) {
            return false
          }
          const activeRouteKey = getRouteRefocusKey(activeRoute)
          return activeRouteKey && activeRouteKey === destRouteKey
        },
      )
      if (matchedWindow && input.routes.length === 1) {
        const [matchedWindowId] = matchedWindow
        const window = getAllWindows().get(matchedWindowId)
        if (window) {
          window.focus()
          return
        }
      }
      try {
        log.info(`[MAIN]: will createAppWindow ${JSON.stringify(input.routes)}`)
        const allWindows = getWindowsState()
        log.info(`[MAIN]: current windows state: ${JSON.stringify(allWindows)}`)

        // Create a new window with a unique ID
        const browserWindow = createAppWindow({
          ...input,
          id:
            input.id ||
            `window.${Date.now()}.${Math.random().toString(36).slice(2)}`,
        })
        log.info(`[MAIN]: window created with id: ${browserWindow.id}`)

        trpcHandlers.attachWindow(browserWindow)
        browserWindow.on('close', () => {
          trpcHandlers.detachWindow(browserWindow)
        })

        // Return success
        return {success: true, windowId: browserWindow.id}
      } catch (error) {
        log.error(
          `[MAIN]: Error creating window: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        )
        throw error
      }
    }),

  webQuery: t.procedure
    .input(
      z.object({
        webUrl: z.string(),
      }),
    )
    .mutation(async ({input: {webUrl}}) => {
      const webView = new BrowserWindow({
        show: false,
        width: 1200,
        height: 1200,
        webPreferences: {
          offscreen: true,
          spellcheck: true,
        },
        icon: process.env.CI
          ? path.resolve(__dirname, '../assets/icons-prod/icon.png')
          : path.resolve(__dirname, '../assets/icons/icon.png'),
      })
      await webView.webContents.loadURL(webUrl)
      const htmlValue = await webView.webContents.executeJavaScript(
        "document.getElementsByTagName('html').item(0).outerHTML",
      )
      const versionRegex =
        /<meta\s+name="hypermedia-entity-version"\s+content="(.*?)"/
      const versionMatch = htmlValue.match(versionRegex)
      const hmVersion = versionMatch ? versionMatch[1] : null

      const hmIdRegex = /<meta\s+name="hypermedia-entity-id"\s+content="(.*?)"/
      const hmIdMatch = htmlValue.match(hmIdRegex)
      const hmId = hmIdMatch ? hmIdMatch[1] : null

      const hmUrlRegex = /<meta\s+name="hypermedia-url"\s+content="(.*?)"/
      const hmUrlMatch = htmlValue.match(hmUrlRegex)
      const hmUrl = hmUrlMatch ? hmUrlMatch[1] : null

      if (hmId && hmVersion) {
        return {hypermedia: {id: hmId, version: hmVersion, url: hmUrl}}
      }

      const png = await new Promise<Buffer>((resolve, reject) => {
        function paintHandler(
          event: unknown,
          dirty: unknown,
          image: NativeImage,
        ) {
          webView.webContents.removeListener('paint', paintHandler)
          resolve(image.toPNG())
        }
        webView.webContents.on('paint', paintHandler)
        setTimeout(() => {
          reject(new Error('paint timeout'))
        }, 500)
      })
      const pdf = await webView.webContents.printToPDF({
        scale: 1,
      })

      await writeFile('/tmp/test.pdf', pdf)
      const uploadedPDF = await uploadFile(new Blob([pdf]))
      const uploadedHTML = await uploadFile(new Blob([htmlValue]))
      await writeFile('/tmp/test.png', png)
      const uploadedPNG = await uploadFile(new Blob([htmlValue]))
      webView.close()
      return {uploadedPNG, uploadedPDF, uploadedHTML, htmlValue}
    }),

  queryInvalidation,

  getDaemonInfo: t.procedure.query(async () => {
    const buildInfoUrl = `${DAEMON_HTTP_URL}/debug/buildinfo`
    let daemonVersion = null
    const errors = []
    try {
      const daemonVersionReq = await fetch(buildInfoUrl)
      daemonVersion = await daemonVersionReq.text()
    } catch (error: unknown) {
      const e = error as Error
      errors.push(
        `Failed to fetch daemon info from ${buildInfoUrl} url. "${e.message}"`,
      )
    }
    return {daemonVersion, errors}
  }),

  getAppInfo: t.procedure.query(() => {
    return {dataDir: userDataPath, loggingDir: log.loggingDir}
  }),
})

export const trpc = router.createCaller({})

const trpcHandlers = createIPCHandler({router, windows: []})

export type AppRouter = typeof router

export async function handleUrlOpen(url: string) {
  log.info('Deep Link Open', {url: url})
  const id = unpackHmId(url)
  const hmId = id ? await resolveHmIdToAppRoute(id, grpcClient) : null
  if (!hmId?.navRoute) {
    const connectionRegexp = /connect-peer\/([\w\d]+)/
    const parsedConnectUrl = url.match(connectionRegexp)
    const connectionDeviceId = parsedConnectUrl ? parsedConnectUrl[1] : null
    if (connectionDeviceId) {
      ensureFocusedWindowVisible()
      dispatchFocusedWindowAppEvent({
        key: 'connectPeer',
        connectionString: connectionDeviceId,
      })
      return
    }

    if (!hmId?.navRoute) {
      const connectionRegexp = /connect\/([\w\-\+]+)/
      const parsedConnectUrl = url.match(connectionRegexp)
      const connectInfoEncoded = parsedConnectUrl ? parsedConnectUrl[1] : null
      if (connectInfoEncoded) {
        ensureFocusedWindowVisible()
        const connectInfoJSON =
          decompressFromEncodedURIComponent(connectInfoEncoded)
        const connectInfo = JSON.parse(connectInfoJSON)
        dispatchFocusedWindowAppEvent({
          key: 'connectPeer',
          connectionString: connectInfo.a
            .map((shortAddr: string) => `${shortAddr}/p2p/${connectInfo.d}`)
            .join(','),
          name: connectInfo.n,
        })
        return
      }
    }

    dialog.showErrorBox('Invalid URL', `We could not parse this URL: ${url}`)
    return
  }
  trpc.createAppWindow({
    routes: [hmId.navRoute],
  })
}

export function handleSecondInstance(
  _event: {defaultPrevented: boolean; preventDefault: () => void},
  args: string[],
  cwd: string,
) {
  log.info('Handling second instance', {args: args, cwd: cwd})
  // from https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app
  // const focusedWindow = getFocusedWindow()
  // if (focusedWindow) {
  //   if (focusedWindow.isMinimized()) focusedWindow.restore()
  //   focusedWindow.focus()
  // }
  const linkUrl = args.pop()
  linkUrl && handleUrlOpen(linkUrl)
}
