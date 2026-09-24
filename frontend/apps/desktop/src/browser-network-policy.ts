import type {Session, WebContents} from 'electron'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {assertPublicWebUrl, isPrivateHost} from './browser-url-policy'
import {isPublicIPAddress} from './remote-file-security'

type MainResponse = {id: number; url: string; ip?: string; privateNetwork: boolean}
const guests = new Map<
  number,
  {
    current?: MainResponse
    pending?: MainResponse
    requestId?: number
    history: Map<number, MainResponse>
  }
>()

/** Whether the current or incoming document used a private IP behind a public-looking hostname. */
export function isGuestOnPrivateNetwork(guestId: number): boolean {
  const state = guests.get(guestId)
  return !!(state?.current?.privateNetwork || state?.pending?.privateNetwork)
}

/** Keeps response provenance bound to the guest document, including history restoration. */
export function trackBrowserNetwork(guest: WebContents) {
  const state = {history: new Map<number, MainResponse>()} as NonNullable<ReturnType<typeof guests.get>>
  guests.set(guest.id, state)
  guest.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) {
      state.pending = undefined
      state.requestId = undefined
    }
  })
  guest.on('did-navigate', (_event, url) => {
    const index = guest.navigationHistory.getActiveIndex()
    const response = state.pending?.url === url.split('#')[0] ? state.pending : state.history.get(index)
    state.current = response?.url === url.split('#')[0] ? response : undefined
    if (state.current) state.history.set(index, state.current)
    state.pending = undefined
  })
  guest.once('destroyed', () => guests.delete(guest.id))
}

/** Observes the actual main-frame peer IP, never subresource or other-session responses. */
export function setupBrowserNetworkPolicy(browserSession: Session) {
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    const state = details.webContentsId === undefined ? undefined : guests.get(details.webContentsId)
    if (state && details.resourceType === 'mainFrame') state.requestId = details.id
    callback({})
  })
  // Electron supplies ip at runtime, but v39's response-event declarations omit it.
  const record = (details: Electron.OnResponseStartedListenerDetails & {ip?: string}) => {
    const state = details.webContentsId === undefined ? undefined : guests.get(details.webContentsId)
    if (!state || details.resourceType !== 'mainFrame' || state.requestId !== details.id) return
    const url = details.url.split('#')[0]!
    const previous = [state.pending, state.current, ...Array.from(state.history.values()).reverse()].filter(
      (response) => response?.url === url && response.ip,
    )
    // An IP-less cache hit must not hide an older private response for the same URL.
    const ip = details.ip || previous.find((response) => response?.privateNetwork)?.ip || previous[0]?.ip
    const response: MainResponse = {
      id: details.id,
      url,
      ip,
      privateNetwork: !!ip && !isPrivateHost(details.url) && !isPublicIPAddress(ip),
    }
    // Completed can arrive after commit; it must not replace a newer request or erase known IPs.
    if (state.current?.id === details.id) {
      if (details.ip) Object.assign(state.current, response)
    } else if (details.ip || !state.pending) state.pending = response
  }
  browserSession.webRequest.onResponseStarted(record)
  browserSession.webRequest.onCompleted(record)
}

/** Validates every agent redirect before requesting it; Electron redirect events cannot await DNS. */
export async function navigatePublicBrowser(guest: WebContents, url: string, assertActive: () => void): Promise<void> {
  for (let redirects = 0; redirects <= 10; redirects++) {
    await assertPublicWebUrl(url)
    assertActive()
    if (hypermediaUrlToRoute(url)) throw new Error('Native Seed navigation requires a user gesture')
    let redirect: string | undefined
    const guard = (event: Electron.Event, target: string, _inPlace: boolean, mainFrame: boolean) => {
      if (!mainFrame) return
      event.preventDefault()
      redirect = target
    }
    guest.on('will-redirect', guard)
    try {
      await guest.loadURL(url)
    } catch (error) {
      if (!redirect) throw error
    } finally {
      guest.off('will-redirect', guard)
    }
    if (!redirect) {
      assertActive()
      return
    }
    url = redirect
  }
  throw new Error('Too many browser redirects')
}
