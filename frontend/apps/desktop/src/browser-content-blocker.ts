import {FiltersEngine, Request} from '@ghostery/adblocker'
import type {Session, WebContents} from 'electron'
import {mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {z} from 'zod'
import {browserListRefreshInterval, readBrowserFeed} from './browser-blocklist'
import bundled from './browser-filter-lists/engine.json'

const filterLimit = 8 * 1024 * 1024
const engineLimit = 16 * 1024 * 1024
const feeds = ['https://easylist.to/easylist/easylist.txt', 'https://easylist.to/easylist/easyprivacy.txt']
const preferenceKey = 'browser-allow-trackers'
const cacheSchema = z.object({checkedAt: z.number().finite().nonnegative(), engine: z.string()})

/** Main-process app store subset used for per-origin preferences. */
export type BrowserBlockingStore = {get(key: string): unknown; set(key: string, value: unknown): void}
/** Current page protection state, sent only to the guest's owning window. */
export type BrowserBlockedCount = {
  type: 'browser-blocked-count'
  browserId: number
  url: string
  count: number
  allowed: boolean
}

/** Network-only filtering, composed with Seed's existing partition policy rather than replacing it. */
export class BrowserContentBlocker {
  private engine: FiltersEngine
  private session?: Session
  private store?: BrowserBlockingStore
  private allowed = new Set<string>()
  private protectedOrigins: () => string[] = () => []
  private path?: string
  private checkedAt = 0
  private refreshing = false
  private pages = new Map<number, {url: string; count: number; send: (state: BrowserBlockedCount) => void}>()

  constructor(engine = FiltersEngine.deserialize(Buffer.from(bundled.engine, 'base64'))) {
    this.engine = engine
  }

  /** Loads preferences and cached rules synchronously before the browser's first request. */
  initialize(session: Session, userData: string, store: BrowserBlockingStore, protectedOrigins: () => string[]) {
    this.session = session
    this.store = store
    this.protectedOrigins = protectedOrigins
    const saved = z.array(z.string().url()).safeParse(store.get(preferenceKey))
    this.allowed = new Set(saved.success ? saved.data.filter((url) => this.origin(url) === url) : [])
    this.path = join(userData, 'browser', 'content-blocker.json')
    try {
      if (statSync(this.path).size > engineLimit * 2) throw new Error('Oversized filter cache')
      const cache = cacheSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')))
      const bytes = Buffer.from(cache.engine, 'base64')
      if (bytes.length > engineLimit) throw new Error('Oversized filter engine')
      const engine = FiltersEngine.deserialize(bytes)
      this.engine = engine
      this.checkedAt = cache.checkedAt
    } catch {
      // First launch uses the bundled engine without a network fetch.
      this.checkedAt = Date.now()
      try {
        this.save(this.engine)
      } catch {}
      // Missing, corrupt or incompatible caches leave the bundled engine active.
    }
  }

  private origin(url: string): string | undefined {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'ws:') parsed.protocol = 'http:'
      if (parsed.protocol === 'wss:') parsed.protocol = 'https:'
      if (['http:', 'https:'].includes(parsed.protocol)) return parsed.origin
    } catch {}
  }

  private publish(browserId: number) {
    const page = this.pages.get(browserId)
    if (page)
      page.send({
        type: 'browser-blocked-count',
        browserId,
        url: page.url,
        count: page.count,
        allowed: this.allowed.has(this.origin(page.url) ?? ''),
      })
  }

  /** Tracks document changes per guest; same-document navigation keeps the current count. */
  track(guest: WebContents, send: (state: BrowserBlockedCount) => void) {
    if (guest.session !== this.session) return
    const page = {url: guest.getURL(), count: 0, send}
    this.pages.set(guest.id, page)
    guest.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
      if (!mainFrame) return
      page.url = url
      if (!inPlace) page.count = 0
      this.publish(guest.id)
    })
    guest.on('did-redirect-navigation', (_event, url, _inPlace, mainFrame) => {
      if (mainFrame) {
        page.url = url
        this.publish(guest.id)
      }
    })
    guest.on('did-navigate', (_event, url) => {
      page.url = url
      this.publish(guest.id)
    })
    guest.once('destroyed', () => this.pages.delete(guest.id))
  }

  /** Reports state when a renderer reconnects to an existing guest. */
  report(guest: WebContents) {
    this.publish(guest.id)
  }

  /** Saves a setting only for the page currently displayed by this browser guest. */
  setAllowed(guest: WebContents, origin: string, allowed: boolean) {
    if (guest.session !== this.session || !this.pages.has(guest.id) || this.origin(guest.getURL()) !== origin)
      throw new Error('The browser page changed')
    const next = new Set(this.allowed)
    if (allowed) next.add(origin)
    else next.delete(origin)
    this.store!.set(preferenceKey, Array.from(next))
    this.allowed = next
    for (const [id, page] of Array.from(this.pages)) if (this.origin(page.url) === origin) this.publish(id)
  }

  /** Returns a blocking decision only for registered guests in the browser session. */
  shouldBlock(session: Session, details: Electron.OnBeforeRequestListenerDetails): boolean {
    if (session !== this.session || details.resourceType === 'mainFrame' || details.webContentsId === undefined)
      return false
    const page = this.pages.get(details.webContentsId)
    if (!page) return false
    const topUrl = details.frame?.top?.url
    const origin = this.origin(topUrl ?? '') ?? this.origin(page.url)
    const target = this.origin(details.url)
    const protectedOrigins = this.protectedOrigins()
    if (
      !origin ||
      !target ||
      protectedOrigins.includes(origin) ||
      protectedOrigins.includes(target) ||
      this.allowed.has(origin)
    )
      return false
    const sourceUrl =
      (details.resourceType === 'subFrame' ? details.frame?.parent?.url : details.frame?.url) ||
      details.referrer ||
      page.url
    if (protectedOrigins.includes(this.origin(sourceUrl) ?? '')) return false
    const match = this.engine.match(
      Request.fromRawDetails({
        url: details.url,
        sourceUrl,
        type: details.resourceType,
        tabId: details.webContentsId,
        requestId: String(details.id),
      }),
    )
    if (!match.match) return false
    // Old documents can finish requests after a new navigation starts. Do not count those on the new page.
    if (!topUrl || topUrl.split('#')[0] === page.url.split('#')[0]) {
      page.count++
      this.publish(details.webContentsId)
    }
    return true
  }

  /** Fetches both lists atomically at most daily; failed or oversized updates keep the last engine. */
  async refresh(fetchFeed: typeof fetch = fetch, now = Date.now()) {
    if (!this.path || this.refreshing || now - this.checkedAt < browserListRefreshInterval) return
    this.refreshing = true
    this.checkedAt = now
    try {
      this.save(this.engine)
      const lists = []
      for (const url of feeds) {
        const response = await fetchFeed(url, {credentials: 'omit', signal: AbortSignal.timeout(30000)})
        const text = await readBrowserFeed(response, filterLimit)
        if (!text.startsWith('[Adblock') || !text.includes('\n||')) throw new Error('Invalid browser filter list')
        lists.push(text)
      }
      const engine = FiltersEngine.parse(lists.join('\n'), {loadCosmeticFilters: false})
      this.save(engine)
      this.engine = engine
    } catch {
      // Offline browsing remains protected by the last valid engine, without repeated fetches.
    } finally {
      this.refreshing = false
    }
  }

  private save(engine: FiltersEngine) {
    const bytes = engine.serialize()
    if (bytes.length > engineLimit) throw new Error('Browser filter engine exceeds size limit')
    mkdirSync(join(this.path!, '..'), {recursive: true})
    writeFileSync(
      `${this.path}.tmp`,
      JSON.stringify({checkedAt: this.checkedAt, engine: Buffer.from(bytes).toString('base64')}),
    )
    renameSync(`${this.path}.tmp`, this.path!)
  }
}

/** Shared engine for the isolated browser partition. */
export const browserContentBlocker = new BrowserContentBlocker()
