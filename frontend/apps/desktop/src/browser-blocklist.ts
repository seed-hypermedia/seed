import {mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {isIP} from 'node:net'
import {z} from 'zod'
import starter from './browser-blocklist-starter.json'

/** Maximum decoded bytes accepted from a threat feed. */
export const blocklistFeedLimit = 1024 * 1024
/** Minimum interval between refresh attempts, including failed attempts. */
export const browserListRefreshInterval = 24 * 60 * 60 * 1000
const feedUrl = 'https://openphish.com/feed.txt'
const feedName = 'OpenPhish'
const cacheSchema = z.object({
  checkedAt: z.number().finite().nonnegative(),
  etag: z.string().max(1024).optional(),
  hosts: z.array(z.string().max(253)).max(100000),
})
type Cache = z.infer<typeof cacheSchema>

/** Reads a response with a streaming cap, including responses without Content-Length. */
export async function readBrowserFeed(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    throw new Error('Browser feed exceeds size limit')
  }
  if (!response.ok || !response.body) throw new Error(`Browser feed returned ${response.status}`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const {done, value} = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) throw new Error('Browser feed exceeds size limit')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Parses URL feeds, hosts files and domain lists at the input boundary. */
export function parseBrowserBlocklist(text: string): string[] {
  const hosts = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const fields = line.split('#')[0]!.trim().split(/\s+/)
    const value = fields[0] === '0.0.0.0' || fields[0] === '127.0.0.1' ? fields[1] : fields[0]
    if (!value) continue
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      const host = url.hostname.replace(/\.$/, '')
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        (!isIP(host) && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/.test(host))
      )
        continue
      if (host === 'localhost' || host === '0.0.0.0' || host === '127.0.0.1') continue
      hosts.add(host)
    } catch {
      // Comments and malformed feed records cannot become blocking rules.
    }
  }
  return Array.from(hosts)
}

/** A matched website and the feed responsible for blocking it. */
export type BrowserBlocklistMatch = {host: string; list: string}

/** Keeps bundled test sites and the last valid daily threat feed available synchronously. */
export class BrowserBlocklist {
  private lists = new Map<string, Set<string>>(Object.entries(starter).map(([name, hosts]) => [name, new Set(hosts)]))
  private cache: Cache = {checkedAt: 0, hosts: []}
  private path?: string
  private refreshing = false

  /** Loads cached rules before the first guest can navigate. */
  load(userData: string) {
    this.path = join(userData, 'browser', 'blocklist.json')
    try {
      if (statSync(this.path).size > 4 * blocklistFeedLimit) return
      this.cache = cacheSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')))
      this.lists.set(feedName, new Set(parseBrowserBlocklist(this.cache.hosts.join('\n'))))
    } catch {
      // A missing or damaged cache leaves the bundled list active.
    }
  }

  /** Matches only HTTP(S) hosts, including their parent domains on label boundaries. */
  match(url: string): BrowserBlocklistMatch | undefined {
    let host: string
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) return
      host = parsed.hostname.replace(/\.$/, '')
    } catch {
      return
    }
    for (const [list, hosts] of Array.from(this.lists)) {
      let candidate = host
      for (;;) {
        if (hosts.has(candidate)) return {host, list}
        if (isIP(host) || !candidate.includes('.')) break
        candidate = candidate.slice(candidate.indexOf('.') + 1)
      }
    }
  }

  /** Refreshes at most daily, retaining old rules on HTTP, size, parsing or storage failures. */
  async refresh(fetchFeed: typeof fetch = fetch, now = Date.now()) {
    if (this.refreshing || now - this.cache.checkedAt < browserListRefreshInterval) return
    this.refreshing = true
    this.cache.checkedAt = now
    try {
      this.save()
      const response = await fetchFeed(feedUrl, {
        headers: this.cache.etag ? {'If-None-Match': this.cache.etag} : {},
        signal: AbortSignal.timeout(30000),
        credentials: 'omit',
      })
      if (response.status === 304) return
      const hosts = parseBrowserBlocklist(await readBrowserFeed(response, blocklistFeedLimit))
      if (!hosts.length) throw new Error('Browser feed contains no hosts')
      const cache = {checkedAt: now, hosts, etag: response.headers.get('etag') ?? undefined}
      const parsed = cacheSchema.parse(cache)
      this.save(parsed)
      this.cache = parsed
      this.lists.set(feedName, new Set(hosts))
    } catch {
      // Offline browsing keeps the last valid list, and retries on the next daily interval.
    } finally {
      this.refreshing = false
    }
  }

  private save(cache = this.cache) {
    if (!this.path) return
    mkdirSync(join(this.path, '..'), {recursive: true})
    writeFileSync(`${this.path}.tmp`, JSON.stringify(cache))
    renameSync(`${this.path}.tmp`, this.path)
  }
}

/** Shared only by the experimental browser's request and navigation guards. */
export const browserBlocklist = new BrowserBlocklist()

/** Builds Seed's script-free warning, with no way to continue inside the pane. */
export function browserBlockedPage(match: BrowserBlocklistMatch): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Website blocked</title>
<style>body{font:16px system-ui;max-width:40rem;margin:15vh auto;padding:2rem;color-scheme:light dark}a{display:inline-block;padding:0.75rem;border:1px solid;border-radius:0.5rem;color:inherit;margin-right:1rem}</style></head>
<body><h1>Website blocked</h1><p>${escape(match.host)} was flagged by ${escape(
      match.list,
    )}.</p><p>This website may try to steal information or install harmful software.</p><a role="button" href="seed-browser://back">Go back</a><a role="button" href="seed-browser://external">Open in default browser</a></body></html>`)
  )
}
