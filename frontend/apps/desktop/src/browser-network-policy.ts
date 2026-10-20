import type {Session, WebContents} from 'electron'
import {isIP} from 'node:net'
import {browserContentBlocker} from './browser-content-blocker'
import {browserBlocklist, type BrowserBlocklistMatch} from './browser-blocklist'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {httpsVersion, isInsecureUrl} from './browser-https-policy'
import {assertPublicWebUrl, isPrivateHost} from './browser-url-policy'
import {isPublicIPAddress, normalizeIPHostname} from './remote-file-security'

type MainResponse = {id: number; url: string; ip?: string; privateNetwork: boolean}
const guests = new Map<
  number,
  {
    guest: WebContents
    onBlocked?: (url: string, match: BrowserBlocklistMatch) => void
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
export function trackBrowserNetwork(
  guest: WebContents,
  onBlocked?: (url: string, match: BrowserBlocklistMatch) => void,
) {
  const state = {guest, history: new Map<number, MainResponse>(), onBlocked} as NonNullable<
    ReturnType<typeof guests.get>
  >
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

// A small, bundled approximation, not a PSL. Common ccTLD categories and shared hosting
// suffixes need one more label; uncommon suffixes and PSL exceptions remain unsupported.
const sharedSuffixes = new Set([
  'github.io',
  'gitlab.io',
  'pages.dev',
  'vercel.app',
  'netlify.app',
  'appspot.com',
  'blogspot.com',
])
function cookieSite(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return
    const host = normalizeIPHostname(parsed.hostname).replace(/\.$/, '')
    if (isIP(host) || !host.includes('.')) return host
    const labels = host.split('.')
    const suffix = labels.slice(-2).join('.')
    const extraLabel =
      sharedSuffixes.has(suffix) ||
      (labels.at(-1)!.length === 2 && /^(ac|co|com|edu|gov|net|org)$/.test(labels.at(-2)!))
    return labels.slice(extraLabel ? -3 : -2).join('.')
  } catch {
    return
  }
}

function isThirdParty(
  details: Electron.OnBeforeSendHeadersListenerDetails | Electron.OnHeadersReceivedListenerDetails,
) {
  // Top-level sign-in and OAuth redirects must retain cookies on every hop.
  if (details.resourceType === 'mainFrame') return false
  const guest = details.webContentsId === undefined ? undefined : guests.get(details.webContentsId)?.guest
  const topUrl = details.frame?.top?.url || guest?.getURL() || details.frame?.url
  // Main-process image fetches and some workers have no document attribution. Leave
  // those alone: in particular, authenticated same-site favicons use session.fetch.
  const topSite = topUrl && cookieSite(topUrl)
  return !!topSite && cookieSite(details.url) !== topSite
}

/** The http(s) URL behind a frame or referrer value; blob: URLs carry their creator's origin. */
function webUrlOf(value: string | undefined): string | undefined {
  const url = value?.replace(/^blob:/i, '')
  return url && /^https?:\/\//i.test(url) ? url : undefined
}

// Main-process fetches made for a guest (favicons, archived images) reach webRequest with no
// frame, referrer or webContentsId, so they announce themselves here before they start. A request
// matched this way keeps its page across redirects, which reuse the request id.
type GuestFetch = {page: string; ids: Set<number>}
const guestFetches = new Map<string, GuestFetch[]>()
const attributedRequests = new Map<number, string>()

/** Attributes the coming session.fetch of `url` to the guest's current page until released. */
export function attributeGuestFetch(guest: WebContents, url: string): () => void {
  const entry: GuestFetch = {page: guest.getURL(), ids: new Set()}
  guestFetches.set(url, [...(guestFetches.get(url) ?? []), entry])
  return () => {
    const remaining = (guestFetches.get(url) ?? []).filter((other) => other !== entry)
    if (remaining.length) guestFetches.set(url, remaining)
    else guestFetches.delete(url)
    entry.ids.forEach((id) => attributedRequests.delete(id))
  }
}

/**
 * The web page a sub-request acts for: its frame, or the nearest ancestor with a real URL
 * (about:blank and about:srcdoc frames inherit theirs), else the referrer or the guest's page,
 * else the page of a main-process fetch announced for exactly this URL.
 * Undefined means nothing shows which page is responsible.
 */
function requestInitiator(details: Electron.OnBeforeRequestListenerDetails): string | undefined {
  const attributed = attributedRequests.get(details.id)
  if (attributed) return attributed
  try {
    for (let frame = details.frame, depth = 0; frame && depth < 32; frame = frame.parent, depth++) {
      const url = webUrlOf(frame.url)
      if (url) return url
    }
  } catch {
    // A frame disposed mid-request has no URL to offer.
  }
  const guest = details.webContentsId === undefined ? undefined : guests.get(details.webContentsId)?.guest
  const known = webUrlOf(details.referrer) ?? webUrlOf(guest?.getURL())
  if (known || details.frame || details.webContentsId !== undefined) return known
  const announced = guestFetches.get(details.url)?.[0]
  const page = announced && webUrlOf(announced.page)
  if (!page) return
  announced.ids.add(details.id)
  attributedRequests.set(details.id, page)
  return page
}

/** Whether a sub-request targets loopback, the local network, link-local or a `.local` name. */
function isPrivateNetworkTarget(url: string): boolean {
  const target = url.replace(/^ws(s?):/i, 'http$1:')
  return /^https?:\/\//i.test(target) && isPrivateHost(target)
}

/** Filters third-party cookie headers and observes the main-frame peer IP in the browser session. */
export function setupBrowserNetworkPolicy(browserSession: Session) {
  // Electron keeps only the last listener for each webRequest hook; GPC belongs here too.
  browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders: Record<string, string> = {...details.requestHeaders, 'Sec-GPC': '1'}
    if (isThirdParty(details)) {
      for (const name of Object.keys(requestHeaders)) {
        if (name.toLowerCase() === 'cookie') delete requestHeaders[name]
      }
    }
    callback({requestHeaders})
  })
  browserSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = {...details.responseHeaders}
    if (isThirdParty(details)) {
      for (const name of Object.keys(responseHeaders)) {
        if (name.toLowerCase() === 'set-cookie') delete responseHeaders[name]
      }
    }
    callback({responseHeaders})
  })
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === 'mainFrame') {
      const match = browserBlocklist.match(details.url)
      if (match) {
        callback({cancel: true})
        if (details.webContentsId !== undefined) guests.get(details.webContentsId)?.onBlocked?.(details.url, match)
        return
      }
    }
    // Public pages get no sub-requests into localhost or the local network, not even for images.
    // A request that cannot be traced to a page the user opened at a local address is refused
    // too. Main-frame navigations are judged in will-navigate, so typed addresses keep working.
    if (details.resourceType !== 'mainFrame' && isPrivateNetworkTarget(details.url)) {
      const initiator = requestInitiator(details)
      if (!initiator || !isPrivateHost(initiator)) {
        callback({cancel: true})
        return
      }
    }
    const state = details.webContentsId === undefined ? undefined : guests.get(details.webContentsId)
    if (state && details.resourceType === 'mainFrame') state.requestId = details.id
    if (browserContentBlocker.shouldBlock(browserSession, details)) {
      callback({cancel: true})
      return
    }
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

/**
 * Validates every agent redirect before requesting it; Electron redirect events cannot await DNS.
 *
 * Plain http follows the pane's rule: the encrypted address is tried first, and when that fails
 * (or sends the agent back to http) the command is refused through `insecure.refuse`, which shows
 * the user the warning; the agent itself can never accept it.
 */
export async function navigatePublicBrowser(
  guest: WebContents,
  url: string,
  assertActive: () => void,
  assertAllowed: (url: string) => void = () => {},
  insecure?: {allows: (url: string) => boolean; refuse: (url: string) => never},
): Promise<void> {
  for (let redirects = 0; redirects <= 10; redirects++) {
    const upgrade = insecure && !insecure.allows(url) ? httpsVersion(url) : undefined
    const target = upgrade ?? url
    const match = browserBlocklist.match(target)
    if (match) throw new Error(`Website blocked by ${match.list}: ${match.host}`)
    assertAllowed(target)
    await assertPublicWebUrl(target)
    assertActive()
    if (hypermediaUrlToRoute(target)) throw new Error('Native Seed navigation requires a user gesture')
    let redirect: string | undefined
    const guard = (event: Electron.Event, next: string, _inPlace: boolean, mainFrame: boolean) => {
      if (!mainFrame) return
      event.preventDefault()
      redirect = next
    }
    guest.on('will-redirect', guard)
    try {
      await guest.loadURL(target)
    } catch (error) {
      if (redirect) {
        // fall through to the next hop
      } else if (upgrade) insecure!.refuse(url)
      else throw error
    } finally {
      guest.off('will-redirect', guard)
    }
    if (!redirect) {
      assertActive()
      return
    }
    if (upgrade && insecure && !insecure.allows(redirect) && isInsecureUrl(redirect)) insecure.refuse(redirect)
    url = redirect
  }
  throw new Error('Too many browser redirects')
}
