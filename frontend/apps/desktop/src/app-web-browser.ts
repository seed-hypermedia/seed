import type {BrowserWindow, WebContents} from 'electron'
import {WebContentsView, nativeTheme, shell} from 'electron'
import {browserBlocklist, browserBlockedPage, type BrowserBlocklistMatch} from './browser-blocklist'
import {z} from 'zod'
import {browserContentBlocker} from './browser-content-blocker'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {loadBrowserFavicon, readBrowserFavicons} from './app-browser-favicon'
import {executeBrowserCommand, type BrowserArchive} from './app-browser-agent'

import {isGuestOnPrivateNetwork, navigatePublicBrowser, trackBrowserNetwork} from './browser-network-policy'
import {
  HTTPS_ATTEMPT_TIMEOUT_MS,
  browserInsecurePage,
  httpsAttempt,
  insecureOrigins,
  isInsecureUrl,
} from './browser-https-policy'
import {isPrivateHost} from './browser-url-policy'
import {
  browserUserGesture,
  hardenBrowserPreferences,
  hardenGuestWebContents,
  privateBrowserPartition,
  setupBrowserSessionPolicy,
} from './browser-session-policy'
const activeGuests = new WeakMap<BrowserWindow, WebContents>()
// Electron sessions are process-wide. A new private guest must wait for the previous
// guest's asynchronous erasure, even when it is opened in another window.
let privateCleanup = Promise.resolve()

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
    .array(
      z.object({
        origin: z.string().refine((origin) => webOrigin(origin) === origin, 'Invalid website origin'),
        level: z.enum(['read', 'act']),
      }),
    )
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
  let access:
    | {connectionId: string; browserId: number; accountUid: string; origins: {origin: string; level: 'read' | 'act'}[]}
    | undefined
  const guests = new Map<number, WebContents>()
  const views = new Map<number, WebContentsView>()
  const requests = new Map<number, number>()
  const privateGuests = new Set<number>()
  let closingPrivate: Promise<void> | undefined
  let routeRevision = 0
  /** Per-guest navigation that the renderer and the agent go through, so every entry is judged alike. */
  const navigations = new Map<
    number,
    {
      showBlocked: (url: string, match: BrowserBlocklistMatch) => void
      /** Loads a URL the user asked for: https first for plain http, then the warning when that fails. */
      open: (url: string) => Promise<void>
      /** Whether the URL may not load as it is: it needs the encrypted attempt or the user's consent. */
      needsConsent: (url: string) => boolean
      /** Forgets an encrypted attempt in flight, so its failure shows no warning. */
      supersede: () => void
      /** An agent navigation, judged hop by hop, with the same https-first rule. */
      agentNavigate: (url: string, assertActive: () => void, assertAllowed: (url: string) => void) => Promise<void>
    }
  >()

  /**
   * Creates the website guest as a main-process-owned view. The app renderer never holds web view
   * privileges: it only asks for a guest, reports where to draw it, and receives events.
   *
   * The session policy (filter lists, their disk cache and daily refresh, secure DNS) is installed
   * here, before the first guest exists, rather than when the window opens: a user who leaves the
   * web browser off must not load, write or fetch anything for it.
   */
  const createGuest = (privatePage = false): WebContentsView => {
    if (views.size >= 2) throw new Error('This window can have at most two browser pages: one normal and one private.')
    // The persistent partition owns the blocklists that private pages share, so it is set up first.
    setupBrowserSessionPolicy()
    if (privatePage) setupBrowserSessionPolicy(privateBrowserPartition)
    const webPreferences: Electron.WebPreferences = {}
    hardenBrowserPreferences(webPreferences, privatePage)
    const view = new WebContentsView({webPreferences})
    view.setVisible(false)
    view.setBounds({x: 0, y: 0, width: 0, height: 0})
    window.contentView.addChildView(view)
    const guest = view.webContents
    const guestSession = guest.session
    if (privatePage) privateGuests.add(guest.id)
    hardenGuestWebContents(guest)
    views.set(guest.id, view)
    attachGuest(guest)
    guest.once('destroyed', () => {
      views.delete(guest.id)
      if (privateGuests.delete(guest.id)) {
        privateCleanup = privateCleanup.then(async () => {
          await guestSession.clearStorageData()
          await guestSession.clearCache()
          await guestSession.clearAuthCache()
          await guestSession.closeAllConnections()
          insecureOrigins.private.clear()
        })
        void privateCleanup.catch((error) => console.error('Could not clear private browsing data', error))
      }
      if (!window.isDestroyed()) window.contentView.removeChildView(view)
    })
    return view
  }
  const liveView = (privatePage = false) =>
    Array.from(views.values()).find(
      (view) => !view.webContents.isDestroyed() && privateGuests.has(view.webContents.id) === privatePage,
    )
  const closePrivate = (guest: WebContents): Promise<void> => {
    if (closingPrivate) return closingPrivate
    if (!privateGuests.has(guest.id) || guest.isDestroyed()) return Promise.resolve()
    const destroyed = new Promise<void>((resolve) => guest.once('destroyed', resolve))
    closingPrivate = destroyed
      .then(() => privateCleanup)
      .finally(() => {
        closingPrivate = undefined
      })
    guest.close({waitForBeforeUnload: false})
    return closingPrivate
  }
  window.once('closed', () => {
    for (const view of Array.from(views.values()))
      if (!view.webContents.isDestroyed()) view.webContents.close({waitForBeforeUnload: false})
  })

  host.ipc.on('windowNavState', (event, state) => {
    if (event.sender !== host) return
    const route = state?.routes?.[state.routeIndex]
    if (route?.key !== 'web') {
      routeRevision++
      access = undefined
      activeGuests.delete(window)
      navigations.forEach((navigation) => navigation.supersede())
      guests.forEach((guest) => guest.stop())
      views.forEach((view) => view.setVisible(false))
      guests.forEach((guest) => {
        if (privateGuests.has(guest.id)) void closePrivate(guest).catch(() => {})
      })
    }
  })

  host.ipc.handle('web-browser-create', (event, input: unknown) => {
    if (event.sender !== host || event.senderFrame !== host.mainFrame) throw new Error('Invalid browser host')
    if (!isWebBrowserEnabled()) throw new Error('The web browser is disabled')
    const options = z.object({private: z.boolean().optional()}).parse(input ?? {})
    const revision = routeRevision
    if (options.private)
      return (closingPrivate ?? privateCleanup).then(() => {
        if (host.isDestroyed() || window.isDestroyed()) throw new Error('The browser window is closed')
        if (revision !== routeRevision) throw new Error('The private page was closed')
        if (!isWebBrowserEnabled()) throw new Error('The web browser is disabled')
        const view = liveView(true) ?? createGuest(true)
        return {browserId: view.webContents.id}
      })
    const view = liveView() ?? createGuest()
    return {browserId: view.webContents.id}
  })
  host.ipc.handle('web-browser-destroy', (event, input: unknown) => {
    if (event.sender !== host || event.senderFrame !== host.mainFrame) throw new Error('Invalid browser host')
    const {browserId} = z.object({browserId: z.number()}).parse(input)
    const guest = guests.get(browserId)
    return guest ? closePrivate(guest) : closingPrivate ?? privateCleanup
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
  host.ipc.handle('web-browser-trackers', (event, input: unknown) => {
    if (event.sender !== host || event.senderFrame !== host.mainFrame || !isWebBrowserEnabled())
      throw new Error('Invalid browser host')
    const {browserId, origin, allowed} = z
      .object({browserId: z.number(), origin: z.string().url(), allowed: z.boolean()})
      .parse(input)
    const guest = guests.get(browserId)
    if (!guest || guest.isDestroyed()) throw new Error('The browser page closed')
    browserContentBlocker.setAllowed(guest, origin, allowed)
    guest.reload()
  })
  host.ipc.on('web-browser-blocking-state', (event, input: unknown) => {
    if (event.sender !== host || event.senderFrame !== host.mainFrame) return
    const parsed = z.object({browserId: z.number()}).safeParse(input)
    if (!parsed.success) return
    const guest = guests.get(parsed.data.browserId)
    if (guest && !guest.isDestroyed()) browserContentBlocker.report(guest)
  })
  host.ipc.on('web-browser-control', (event, input: unknown) => {
    if (event.sender !== host || event.senderFrame !== host.mainFrame) return
    const parsed = controlSchema.safeParse(input)
    if (!parsed.success) return
    const guest = guests.get(parsed.data.browserId)
    if (!guest || guest.isDestroyed()) return
    if (parsed.data.action === 'reload') guest.reload()
    else {
      navigations.get(guest.id)?.supersede()
      guest.stop()
    }
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
    const startingOrigin = guest && webOrigin(guest.getURL())
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
      if (!origin || !grant.origins.some((entry) => entry.origin === origin))
        throw new Error(
          `The user has not allowed browser access on ${
            origin ?? 'this page'
          }. They can allow it in the assistant panel.`,
        )
      // Opening an approved destination may leave it read-only. Navigation still requires
      // action access on the source, including while the navigation is in flight.
      const actionOrigin = input.command?.action === 'navigate' ? startingOrigin : origin
      if (
        !['snapshot', 'screenshot', 'scroll'].includes(input.command?.action) &&
        grant.origins.find((entry) => entry.origin === actionOrigin)?.level !== 'act'
      )
        throw new Error('The user allowed reading this website but not acting on it; ask them to allow actions')
      if (isGuestOnPrivateNetwork(guest.id)) throw new Error('Browser page is on a private network')
    }
    const assertAllowed = (url: string) => {
      const origin = webOrigin(url)
      if (!origin) throw new Error('Agents can only open HTTP(S) websites. Ask the user to open Seed links.')
      if (!grant!.origins.some((entry) => entry.origin === origin))
        throw new Error(`Opening ${origin} needs the user's approval in the assistant panel.`)
    }
    assertActive()
    const result = await browserUserGesture(guest!).runAgent(() =>
      executeBrowserCommand(guest!, input.command, {
        assertActive,
        assertOrigin: (url) => {
          const origin = webOrigin(url)
          if (!origin || !grant!.origins.some((entry) => entry.origin === origin))
            throw new Error('The page moved to a website the user has not allowed. Take a fresh snapshot.')
        },
        // Every hop, including redirects, must stay on websites the user allowed and off private networks.
        navigate: (url) => navigations.get(guest!.id)!.agentNavigate(url, assertActive, assertAllowed),
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
    /** A Seed page standing in for a website: the blocklist warning or the unencrypted warning. */
    let blocked: {url: string; page: string} | undefined
    let insecure: {url: string; page: string} | undefined
    /** Counts navigations this guest was asked for, so a superseded https attempt stays silent. */
    let generation = 0
    let attempt: {generation: number; https: string} | undefined
    let agentNavigating = false
    const allowance = () => (privateGuests.has(guest.id) ? insecureOrigins.private : insecureOrigins.normal)
    const supersede = () => ++generation
    const showBlocked = (url: string, match: BrowserBlocklistMatch) => {
      supersede()
      insecure = undefined
      blocked = {url, page: browserBlockedPage(match)}
      void guest.loadURL(blocked.page).catch(() => {})
    }
    const showInsecure = (url: string) => {
      supersede()
      blocked = undefined
      insecure = {url, page: browserInsecurePage(url)}
      void guest.loadURL(insecure.page).catch(() => {})
    }
    const open = async (url: string) => {
      const current = supersede()
      const https = httpsAttempt(url, allowance())
      if (!https) {
        attempt = undefined
        await guest.loadURL(url).catch(() => {
          // The guest's did-fail-load event supplies the visible error and retry action.
        })
        return
      }
      // The http request is never sent first: the encrypted address is tried, and only its failure
      // (refused, unresolved, a bad certificate, or too slow) leads to the warning.
      attempt = {generation: current, https}
      const live = () => generation === current && !guest.isDestroyed()
      const timer = setTimeout(() => {
        if (!live()) return
        guest.stop()
        showInsecure(url)
      }, HTTPS_ATTEMPT_TIMEOUT_MS)
      try {
        await guest.loadURL(https)
      } catch {
        if (live()) showInsecure(url)
      } finally {
        clearTimeout(timer)
        if (attempt?.generation === current) attempt = undefined
      }
    }
    navigations.set(guest.id, {
      showBlocked,
      open,
      needsConsent: (url) => httpsAttempt(url, allowance()) !== null,
      supersede,
      agentNavigate: async (url, assertActive, assertAllowed) => {
        agentNavigating = true
        try {
          await navigatePublicBrowser(guest, url, assertActive, assertAllowed, {
            allows: (target) => !httpsAttempt(target, allowance()),
            refuse: (target) => {
              showInsecure(target)
              throw new Error(
                `${
                  new URL(target).host
                } offers no encrypted connection. The user has to allow the insecure site first; the browser pane is asking them now.`,
              )
            },
          })
        } finally {
          agentNavigating = false
        }
      },
    })
    trackBrowserNetwork(guest, showBlocked)
    const gesture = browserUserGesture(guest)
    const send = (event: Record<string, unknown>) => {
      if (!host.isDestroyed()) host.send('appWindowEvent', {...event, browserId: guest.id})
    }
    browserContentBlocker.track(guest, send)
    const openUrl = (url: string) => send({type: 'browser-open-url', url})
    // Electron 44 has no public dialog event. Observe its native dialog notification
    // without replacing the handler or callback, preserving safeDialogs suppression.
    // Keep this in sync with Electron's lib/browser/api/web-contents.ts on upgrades.
    ;(guest as NodeJS.EventEmitter).on('-run-dialog', (info: {frame: {origin: string}; dialogType: string}) => {
      if (info.dialogType === 'prompt') return // Electron does not display prompt().
      const origin = webOrigin(info.frame.origin)
      if (origin) send({type: 'browser-dialog', origin})
    })
    guest.on('enter-html-full-screen', () => {
      // Permission denial is the primary gate. Hide unexpected fullscreen content
      // immediately; neither its view bounds nor Seed's window may expand for it.
      views.get(guest.id)?.setVisible(false)
      void guest.executeJavaScript('document.exitFullscreen()').catch(() => {})
      send({type: 'browser-load-error', description: 'Fullscreen is not available in this browser pane.'})
    })
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
    const guardNavigation = (redirect: boolean, event: Electron.Event, url: string, mainFrame: boolean) => {
      if (!mainFrame) return
      if (url.startsWith('seed-browser://')) {
        event.preventDefault()
        // The warning pages' buttons: only from the page itself, and only on a real click.
        const cover = [blocked, insecure].find((page) => page && guest.getURL() === page.page)
        if (!cover || !gesture.consume()) return
        if (url === 'seed-browser://back') send({type: 'back'})
        else if (url === 'seed-browser://external' && cover === blocked) void shell.openExternal(cover.url)
        else if (url === 'seed-browser://allow-insecure' && cover === insecure) {
          allowance().allow(cover.url)
          void open(cover.url)
        }
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
        return
      }
      if (httpsAttempt(url, allowance())) {
        // A link or redirect to plain http: never followed as is. The agent's own navigation loop
        // judges each of its hops, so it is only stopped here.
        event.preventDefault()
        if (agentNavigating) return
        // An encrypted attempt that sends the user back to plain http has failed; trying again would loop.
        if (redirect && attempt) showInsecure(url)
        else void open(url)
      }
    }
    guest.on('will-navigate', (event, url, _inPlace, mainFrame = true) => guardNavigation(false, event, url, mainFrame))
    guest.on('will-redirect', (event, url, _inPlace, mainFrame = true) => guardNavigation(true, event, url, mainFrame))
    guest.setWindowOpenHandler(({url}) => {
      if (isWebBrowserEnabled() && gesture.consume() && (/^https?:\/\//.test(url) || hypermediaUrlToRoute(url)))
        openUrl(url)
      return {action: 'deny'}
    })
    const committed = () => {
      const cover = [blocked, insecure].find((page) => page && guest.getURL() === page.page)
      const url = cover ? cover.url : guest.getURL()
      if (!/^https?:\/\//.test(url)) return
      if (!cover) blocked = insecure = undefined
      const requestId = requests.get(guest.id)
      requests.delete(guest.id)
      // Judged on the committed address, after redirects: an http address that ended on https is secure.
      send({
        type: 'browser-location',
        userInitiated: gesture.allowed(),
        url,
        title: guest.getTitle(),
        historyIndex: guest.navigationHistory.getActiveIndex(),
        requestId,
        insecure: isInsecureUrl(url),
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
      // A failed encrypted attempt is not an error the user sees: the warning for the http address follows.
      if (isMainFrame && errorCode !== -3 && !(blocked && _url === blocked.url) && !attempt)
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
      navigations.delete(guest.id)
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
    const navigation = navigations.get(browserId)
    if (!guest || guest.isDestroyed() || !navigation) return
    activeGuests.set(window, guest)
    requests.set(browserId, requestId)
    // Check before restoring history too: a back/forward cache hit may make no request.
    const match = browserBlocklist.match(url)
    if (match) {
      navigation.showBlocked(url, match)
      return
    }
    const entry =
      historyIndex === undefined || historyIndex >= guest.navigationHistory.length()
        ? undefined
        : guest.navigationHistory.getEntryAtIndex(historyIndex)
    // A restored http entry is judged again: after the data was cleared, its origin needs consent anew.
    if (entry?.url === url && historyIndex !== undefined && !navigation.needsConsent(url)) {
      navigation.supersede()
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
          insecure: isInsecureUrl(url),
        })
      }
    } else {
      void navigation.open(url)
    }
  })
}
