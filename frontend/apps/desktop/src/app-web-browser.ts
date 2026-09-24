import type {BrowserWindow, WebContents} from 'electron'
import {nativeTheme, session} from 'electron'
import {z} from 'zod'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {loadBrowserFavicon, readBrowserFavicons} from './app-browser-favicon'
import {executeBrowserCommand, type BrowserArchive} from './app-browser-agent'

const partition = 'persist:seed-web-browser'
const activeGuests = new WeakMap<BrowserWindow, WebContents>()

/** The visible page to target with native find commands, whether a website or Seed content. */
export function getPageWebContents(window: BrowserWindow): WebContents {
  const guest = activeGuests.get(window)
  return guest && !guest.isDestroyed() ? guest : window.webContents
}
const commandSchema = z.object({
  browserId: z.number(),
  requestId: z.number(),
  url: z
    .string()
    .url()
    .refine((url) => /^https?:\/\//.test(url)),
  historyIndex: z.number().int().nonnegative().optional(),
})

const accessSchema = z.object({
  connectionId: z.string(),
  browserId: z.number(),
  accountUid: z.string(),
  enabled: z.boolean(),
  /** Websites the user approved for this session, as exact `https://host[:port]` origins. */
  origins: z
    .array(z.string().refine((origin) => webOrigin(origin) === origin, 'Invalid website origin'))
    .max(100)
    .default([]),
})

/** The http(s) origin of a URL, or null for anything else. */
export function webOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null
  } catch {
    return null
  }
}

/** Installs an isolated website guest and limits its communication to navigation in its owning window. */
export function setupWebBrowser(
  window: BrowserWindow,
  isWebBrowserEnabled: () => boolean,
  archive?: (archive: BrowserArchive, accountUid: string) => Promise<{id: string}>,
) {
  const host = window.webContents
  let access: {connectionId: string; browserId: number; accountUid: string; origins: string[]} | undefined
  const guests = new Map<number, WebContents>()
  const requests = new Map<number, number>()
  const browserSession = session.fromPartition(partition)
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  browserSession.setPermissionCheckHandler(() => false)

  host.ipc.on('windowNavState', (event, state) => {
    if (event.sender !== host) return
    const route = state?.routes?.[state.routeIndex]
    if (route?.key !== 'web') {
      access = undefined
      activeGuests.delete(window)
      guests.forEach((guest) => guest.stop())
    }
  })

  host.on('will-attach-webview', (event, preferences, params) => {
    if (!isWebBrowserEnabled() || params.partition !== partition || params.src !== 'about:blank') {
      event.preventDefault()
      return
    }
    delete preferences.preload
    preferences.nodeIntegration = false
    preferences.nodeIntegrationInSubFrames = false
    preferences.nodeIntegrationInWorker = false
    preferences.contextIsolation = true
    preferences.sandbox = true
    preferences.webSecurity = true
    preferences.allowRunningInsecureContent = false
    preferences.webviewTag = false
  })

  host.ipc.handle('browser-agent-access', (event, input: unknown) => {
    if (event.sender !== host || event.senderFrame !== host.mainFrame) throw new Error('Invalid browser host')
    const parsed = accessSchema.parse(input)
    if (!parsed.enabled) {
      if (access?.connectionId === parsed.connectionId) access = undefined
      return
    }
    if (!isWebBrowserEnabled() || activeGuests.get(window)?.id !== parsed.browserId)
      throw new Error('Open a website to connect browser access')
    // Approving another website keeps the same grant object, so in-flight checks see the new list.
    if (access?.connectionId === parsed.connectionId && access.browserId === parsed.browserId) {
      access.origins = parsed.origins
      return
    }
    const {enabled: _enabled, ...grant} = parsed
    access = grant
  })
  host.ipc.handle('browser-agent-execute', async (event, input) => {
    if (event.sender !== host || event.senderFrame !== host.mainFrame) throw new Error('Invalid browser host')
    const grant = access
    const guest = grant && guests.get(grant.browserId)
    const assertActive = () => {
      if (
        !grant ||
        access !== grant ||
        input?.connectionId !== grant.connectionId ||
        !isWebBrowserEnabled() ||
        !guest ||
        guest.isDestroyed() ||
        activeGuests.get(window) !== guest
      )
        throw new Error('Browser access is paused or the connected page is no longer active')
      const origin = webOrigin(guest.getURL())
      if (!origin || !grant.origins.includes(origin))
        throw new Error(
          `The user has not allowed browser access on ${
            origin ?? 'this page'
          }. They can allow it in the assistant panel.`,
        )
    }
    assertActive()
    return executeBrowserCommand(guest!, input.command, {
      assertActive,
      assertOrigin: (url) => {
        const origin = webOrigin(url)
        if (!origin || !grant!.origins.includes(origin))
          throw new Error('The page moved to a website the user has not allowed. Take a fresh snapshot.')
      },
      navigate: (url) => {
        if (!/^https?:\/\//.test(url) && !hypermediaUrlToRoute(url))
          throw new Error('Only HTTP(S) and Seed navigation is supported')
        const origin = webOrigin(url)
        if (origin && !hypermediaUrlToRoute(url) && !grant!.origins.includes(origin))
          throw new Error(`Opening ${origin} needs the user's approval in the assistant panel.`)
        host.send('appWindowEvent', {type: 'browser-open-url', browserId: guest!.id, url})
      },
      archive: (page) => {
        if (!archive) throw new Error('Draft creation is unavailable in this window')
        return archive(page, grant!.accountUid)
      },
    })
  })

  host.on('did-attach-webview', (_event, guest) => {
    guests.set(guest.id, guest)
    const send = (event: Record<string, unknown>) => {
      if (!host.isDestroyed()) host.send('appWindowEvent', {...event, browserId: guest.id})
    }
    const openUrl = (url: string) => send({type: 'browser-open-url', url})
    let faviconRevision = 0
    let faviconIcons: string[] = []
    const updateFavicons = async () => {
      const revision = ++faviconRevision
      const url = guest.getURL()
      if (!/^https?:\/\//.test(url)) return
      try {
        const candidates = await readBrowserFavicons(guest)
        const icons = (await Promise.all(candidates.map((icon) => loadBrowserFavicon(guest, icon)))).filter(
          (icon): icon is string => icon !== null,
        )
        if (!guest.isDestroyed() && revision === faviconRevision && guest.getURL() === url) {
          faviconIcons = icons
          send({type: 'browser-favicons', url, icons})
        }
      } catch {
        // The document may have navigated or closed while its icon was being resolved.
      }
    }
    guest.on('page-favicon-updated', () => void updateFavicons())
    nativeTheme.on('updated', updateFavicons)
    guest.on('did-finish-load', () => void updateFavicons())
    guest.on('did-navigate', () => {
      faviconRevision++
      faviconIcons = []
      send({type: 'browser-favicons', url: guest.getURL(), icons: []})
    })
    const guardNavigation = (event: Electron.Event, url: string) => {
      if (!isWebBrowserEnabled() || !/^https?:\/\//.test(url) || hypermediaUrlToRoute(url)) {
        event.preventDefault()
        if (isWebBrowserEnabled() && hypermediaUrlToRoute(url)) openUrl(url)
      }
    }
    guest.on('will-navigate', guardNavigation)
    guest.on('will-redirect', guardNavigation)
    guest.setWindowOpenHandler(({url}) => {
      if (isWebBrowserEnabled() && (/^https?:\/\//.test(url) || hypermediaUrlToRoute(url))) openUrl(url)
      return {action: 'deny'}
    })
    const committed = () => {
      if (!/^https?:\/\//.test(guest.getURL())) return
      const requestId = requests.get(guest.id)
      requests.delete(guest.id)
      send({
        type: 'browser-location',
        url: guest.getURL(),
        title: guest.getTitle(),
        historyIndex: guest.navigationHistory.getActiveIndex(),
        requestId,
      })
    }
    guest.on('did-navigate', committed)
    guest.on('did-navigate-in-page', (_event, _url, mainFrame) => {
      if (mainFrame) {
        committed()
        send({type: 'browser-favicons', url: guest.getURL(), icons: faviconIcons})
        void updateFavicons()
      }
    })
    guest.on('page-title-updated', (_event, title) => send({type: 'browser-title', title}))
    guest.on('found-in-page', (event, result) => {
      if (activeGuests.get(window) === guest) host.emit('found-in-page', event, result)
    })
    guest.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const command = process.platform === 'darwin' ? input.meta : input.control
      if (command && ['l', 'k'].includes(input.key.toLowerCase())) {
        event.preventDefault()
        host.focus()
        send({type: 'focus_omnibar', mode: input.key.toLowerCase() === 'l' ? 'url' : 'search'})
      } else if (
        (input.alt && ['ArrowLeft', 'ArrowRight'].includes(input.key)) ||
        (command && ['[', ']'].includes(input.key))
      ) {
        event.preventDefault()
        send({type: input.key === 'ArrowLeft' || input.key === '[' ? 'back' : 'forward'})
      } else if (command && input.key.toLowerCase() === 'r') {
        event.preventDefault()
        guest.reload()
      }
    })
    guest.once('destroyed', () => {
      faviconRevision++
      nativeTheme.off('updated', updateFavicons)
      guests.delete(guest.id)
      requests.delete(guest.id)
      if (activeGuests.get(window) === guest) activeGuests.delete(window)
    })
  })

  host.ipc.on('web-browser-navigate', (event, input: unknown) => {
    if (event.sender !== host || !isWebBrowserEnabled()) return
    const parsed = commandSchema.safeParse(input)
    if (!parsed.success) return
    const {browserId, requestId, url, historyIndex} = parsed.data
    const guest = guests.get(browserId)
    if (!guest || guest.isDestroyed()) return
    activeGuests.set(window, guest)
    requests.set(browserId, requestId)
    const entry =
      historyIndex === undefined || historyIndex >= guest.navigationHistory.length()
        ? undefined
        : guest.navigationHistory.getEntryAtIndex(historyIndex)
    if (entry?.url === url && historyIndex !== undefined) {
      if (guest.navigationHistory.getActiveIndex() !== historyIndex) guest.navigationHistory.goToIndex(historyIndex)
      else {
        requests.delete(browserId)
        host.send('appWindowEvent', {
          type: 'browser-location',
          browserId,
          requestId,
          url,
          title: guest.getTitle(),
          historyIndex,
        })
      }
    } else {
      void guest.loadURL(url).catch(() => {
        // The guest's did-fail-load event supplies the visible error and retry action.
      })
    }
  })
}
