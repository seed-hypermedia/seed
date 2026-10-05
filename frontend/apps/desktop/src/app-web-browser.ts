import type {BrowserWindow, WebContents} from 'electron'
import {WebContentsView, nativeTheme, shell} from 'electron'
import {browserBlocklist, browserBlockedPage, type BrowserBlocklistMatch} from './browser-blocklist'
import {z} from 'zod'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {loadBrowserFavicon, readBrowserFavicons} from './app-browser-favicon'
import {executeBrowserCommand, type BrowserArchive} from './app-browser-agent'

import {isGuestOnPrivateNetwork, navigatePublicBrowser, trackBrowserNetwork} from './browser-network-policy'
import {isPrivateHost} from './browser-url-policy'
import {
  browserUserGesture,
  hardenBrowserPreferences,
  hardenGuestWebContents,
  setupBrowserSessionPolicy,
} from './browser-session-policy'
const activeGuests = new WeakMap<BrowserWindow, WebContents>()

/** The visible page to target with native find commands, whether a website or Seed content. */
export function getPageWebContents(window: BrowserWindow): WebContents {
  const guest = activeGuests.get(window)
  return guest && !guest.isDestroyed() ? guest : window.webContents
}
const boundsSchema = z.object({
  browserId: z.number(),
  visible: z.boolean(),
  bounds: z
    .object({x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite()})
    .optional(),
})
const controlSchema = z.object({browserId: z.number(), action: z.enum(['reload', 'stop'])})
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
  const views = new Map<number, WebContentsView>()
  const requests = new Map<number, number>()
  const blockedNavigations = new Map<number, (url: string, match: BrowserBlocklistMatch) => void>()
  setupBrowserSessionPolicy()

  /**
   * Creates the website guest as a main-process-owned view. The app renderer never holds web view
   * privileges: it only asks for a guest, reports where to draw it, and receives events.
   */
  const createGuest = (): WebContentsView => {
    const webPreferences: Electron.WebPreferences = {}
    hardenBrowserPreferences(webPreferences)
    const view = new WebContentsView({webPreferences})
    view.setVisible(false)
    view.setBounds({x: 0, y: 0, width: 0, height: 0})
    window.contentView.addChildView(view)
    const guest = view.webContents
    hardenGuestWebContents(guest)
    views.set(guest.id, view)
    attachGuest(guest)
    guest.once('destroyed', () => {
      views.delete(guest.id)
      if (!window.isDestroyed()) window.contentView.removeChildView(view)
    })
    return view
  }
  const liveView = () => Array.from(views.values()).find((view) => !view.webContents.isDestroyed())
  window.once('closed', () => {
    for (const view of Array.from(views.values())) if (!view.webContents.isDestroyed()) view.webContents.close()
  })

  host.ipc.on('windowNavState', (event, state) => {
    if (event.sender !== host) return
    const route = state?.routes?.[state.routeIndex]
    if (route?.key !== 'web') {
      access = undefined
      activeGuests.delete(window)
      guests.forEach((guest) => guest.stop())
      views.forEach((view) => view.setVisible(false))
    }
  })

  host.ipc.handle('web-browser-create', (event) => {
    if (event.sender !== host || event.senderFrame !== host.mainFrame) throw new Error('Invalid browser host')
    if (!isWebBrowserEnabled()) throw new Error('The web browser is disabled')
    const view = liveView() ?? createGuest()
    return {browserId: view.webContents.id}
  })
  host.ipc.on('web-browser-bounds', (event, input: unknown) => {
    if (event.sender !== host || event.senderFrame !== host.mainFrame) return
    const parsed = boundsSchema.safeParse(input)
    if (!parsed.success) return
    const view = views.get(parsed.data.browserId)
    if (!view || view.webContents.isDestroyed()) return
    if (parsed.data.bounds) {
      // The renderer measures in CSS pixels of the app page; the view is placed in the window's
      // content coordinates, so page zoom has to be applied, and the view can never leave the window.
      const zoom = host.getZoomFactor()
      const [contentWidth, contentHeight] = window.getContentSize()
      const clamp = (value: number, max: number) => Math.min(Math.max(Math.round(value * zoom), 0), max)
      const x = clamp(parsed.data.bounds.x, contentWidth)
      const y = clamp(parsed.data.bounds.y, contentHeight)
      view.setBounds({
        x,
        y,
        width: clamp(parsed.data.bounds.width, contentWidth - x),
        height: clamp(parsed.data.bounds.height, contentHeight - y),
      })
    }
    view.setVisible(parsed.data.visible && isWebBrowserEnabled())
  })
  host.ipc.on('web-browser-control', (event, input: unknown) => {
    if (event.sender !== host || event.senderFrame !== host.mainFrame) return
    const parsed = controlSchema.safeParse(input)
    if (!parsed.success) return
    const guest = guests.get(parsed.data.browserId)
    if (!guest || guest.isDestroyed()) return
    if (parsed.data.action === 'reload') guest.reload()
    else guest.stop()
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
      if (isGuestOnPrivateNetwork(guest.id)) throw new Error('Browser page is on a private network')
    }
    const assertAllowed = (url: string) => {
      const origin = webOrigin(url)
      if (!origin) throw new Error('Agents can only open HTTP(S) websites. Ask the user to open Seed links.')
      if (!grant!.origins.includes(origin))
        throw new Error(`Opening ${origin} needs the user's approval in the assistant panel.`)
    }
    assertActive()
    const result = await browserUserGesture(guest!).runAgent(() =>
      executeBrowserCommand(guest!, input.command, {
        assertActive,
        assertOrigin: (url) => {
          const origin = webOrigin(url)
          if (!origin || !grant!.origins.includes(origin))
            throw new Error('The page moved to a website the user has not allowed. Take a fresh snapshot.')
        },
        // Every hop, including redirects, must stay on websites the user allowed and off private networks.
        navigate: (url) => navigatePublicBrowser(guest!, url, assertActive, assertAllowed),
        archive: (page) => {
          if (!archive) throw new Error('Draft creation is unavailable in this window')
          return archive(page, grant!.accountUid)
        },
      }),
    )
    assertActive()
    return result
  })

  function attachGuest(guest: WebContents) {
    guests.set(guest.id, guest)
    let blocked: {url: string; page: string} | undefined
    const showBlocked = (url: string, match: BrowserBlocklistMatch) => {
      blocked = {url, page: browserBlockedPage(match)}
      void guest.loadURL(blocked.page).catch(() => {})
    }
    blockedNavigations.set(guest.id, showBlocked)
    trackBrowserNetwork(guest, showBlocked)
    const gesture = browserUserGesture(guest)
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
        const icons = (await Promise.all(candidates.slice(0, 4).map((icon) => loadBrowserFavicon(guest, icon)))).filter(
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
    const guardNavigation = (event: Electron.Event, url: string, _inPlace?: boolean, mainFrame = true) => {
      if (!mainFrame) return
      if (url === 'seed-browser://back' || url === 'seed-browser://external') {
        event.preventDefault()
        if (!blocked || guest.getURL() !== blocked.page || !gesture.consume()) return
        if (url === 'seed-browser://back') send({type: 'back'})
        else void shell.openExternal(blocked.url)
        return
      }
      const match = browserBlocklist.match(url)
      if (match) {
        event.preventDefault()
        showBlocked(url, match)
        return
      }
      if (!isWebBrowserEnabled() || !/^https?:\/\//.test(url) || hypermediaUrlToRoute(url)) {
        event.preventDefault()
        if (isWebBrowserEnabled() && hypermediaUrlToRoute(url) && gesture.consume()) openUrl(url)
        return
      }
      // A public page may not send the user to localhost or the local network. Addresses the user
      // types arrive through loadURL, which never raises this event, and a page that is itself local
      // may keep linking locally.
      if (isPrivateHost(url) && !isPrivateHost(guest.getURL())) {
        event.preventDefault()
        send({
          type: 'browser-load-error',
          description: 'This page tried to open a private network address. Type the address yourself to open it.',
        })
      }
    }
    guest.on('will-navigate', guardNavigation)
    guest.on('will-redirect', guardNavigation)
    guest.setWindowOpenHandler(({url}) => {
      if (isWebBrowserEnabled() && gesture.consume() && (/^https?:\/\//.test(url) || hypermediaUrlToRoute(url)))
        openUrl(url)
      return {action: 'deny'}
    })
    const committed = () => {
      const url = blocked?.page === guest.getURL() ? blocked.url : guest.getURL()
      if (!/^https?:\/\//.test(url)) return
      if (url === guest.getURL()) blocked = undefined
      const requestId = requests.get(guest.id)
      requests.delete(guest.id)
      send({
        type: 'browser-location',
        userInitiated: gesture.allowed(),
        url,
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
    guest.on('did-start-loading', () => send({type: 'browser-loading', loading: true}))
    guest.on('did-stop-loading', () => send({type: 'browser-loading', loading: false}))
    guest.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3 && !(blocked && _url === blocked.url))
        send({type: 'browser-load-error', description: errorDescription || 'The page could not be loaded.'})
    })
    guest.on('render-process-gone', () =>
      send({type: 'browser-load-error', description: 'The web page stopped responding. Reload to try again.'}),
    )
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
      blockedNavigations.delete(guest.id)
      requests.delete(guest.id)
      if (activeGuests.get(window) === guest) activeGuests.delete(window)
    })
  }

  host.ipc.on('web-browser-navigate', (event, input: unknown) => {
    if (event.sender !== host || event.senderFrame !== host.mainFrame || !isWebBrowserEnabled()) return
    const parsed = commandSchema.safeParse(input)
    if (!parsed.success) return
    const {browserId, requestId, url, historyIndex} = parsed.data
    const guest = guests.get(browserId)
    if (!guest || guest.isDestroyed()) return
    activeGuests.set(window, guest)
    requests.set(browserId, requestId)
    // Check before restoring history too: a back/forward cache hit may make no request.
    const match = browserBlocklist.match(url)
    if (match) {
      blockedNavigations.get(browserId)?.(url, match)
      return
    }
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
