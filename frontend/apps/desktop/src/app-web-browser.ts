import type {BrowserWindow, WebContents} from 'electron'
import {nativeTheme} from 'electron'
import {z} from 'zod'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {loadBrowserFavicon, readBrowserFavicons} from './app-browser-favicon'
import {executeBrowserCommand, type BrowserArchive} from './app-browser-agent'

import {isGuestOnPrivateNetwork, navigatePublicBrowser, trackBrowserNetwork} from './browser-network-policy'
import {
  browserPartition as partition,
  browserUserGesture,
  hardenBrowserPreferences,
  setupBrowserSessionPolicy,
} from './browser-session-policy'
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

/** Installs an isolated website guest and limits its communication to navigation in its owning window. */
export function setupWebBrowser(
  window: BrowserWindow,
  isWebBrowserEnabled: () => boolean,
  archive?: (archive: BrowserArchive, accountUid: string) => Promise<{id: string}>,
) {
  const host = window.webContents
  let access: {connectionId: string; browserId: number; accountUid: string} | undefined
  const guests = new Map<number, WebContents>()
  const requests = new Map<number, number>()
  setupBrowserSessionPolicy()

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
    const frame = (event as Electron.Event & {senderFrame?: Electron.WebFrameMain}).senderFrame
    if (
      !isWebBrowserEnabled() ||
      params.partition !== partition ||
      params.src !== 'about:blank' ||
      (frame !== undefined && frame !== host.mainFrame)
    ) {
      event.preventDefault()
      return
    }
    hardenBrowserPreferences(preferences)
  })

  host.ipc.handle('browser-agent-access', (event, input: unknown) => {
    if (event.sender !== host || event.senderFrame !== host.mainFrame) throw new Error('Invalid browser host')
    const parsed = z
      .object({connectionId: z.string(), browserId: z.number(), accountUid: z.string(), enabled: z.boolean()})
      .parse(input)
    if (!parsed.enabled) {
      if (access?.connectionId === parsed.connectionId) access = undefined
      return
    }
    if (!isWebBrowserEnabled() || activeGuests.get(window)?.id !== parsed.browserId)
      throw new Error('Open a website to connect browser access')
    access = parsed
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
      if (isGuestOnPrivateNetwork(guest.id)) throw new Error('Browser page is on a private network')
    }
    assertActive()
    const result = await browserUserGesture(guest!).runAgent(() =>
      executeBrowserCommand(guest!, input.command, {
        assertActive,
        navigate: (url) => navigatePublicBrowser(guest!, url, assertActive),
        archive: (page) => {
          if (!archive) throw new Error('Draft creation is unavailable in this window')
          return archive(page, grant!.accountUid)
        },
      }),
    )
    assertActive()
    return result
  })

  host.on('did-attach-webview', (_event, guest) => {
    guests.set(guest.id, guest)
    trackBrowserNetwork(guest)
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
    const guardNavigation = (event: Electron.Event, url: string) => {
      if (!isWebBrowserEnabled() || !/^https?:\/\//.test(url) || hypermediaUrlToRoute(url)) {
        event.preventDefault()
        if (isWebBrowserEnabled() && hypermediaUrlToRoute(url) && gesture.consume()) openUrl(url)
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
      if (!/^https?:\/\//.test(guest.getURL())) return
      const requestId = requests.get(guest.id)
      requests.delete(guest.id)
      send({
        type: 'browser-location',
        userInitiated: gesture.allowed(),
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
    if (event.sender !== host || event.senderFrame !== host.mainFrame || !isWebBrowserEnabled()) return
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
