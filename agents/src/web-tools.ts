/**
 * Web research tools for the Agents service.
 *
 * Provides two model-facing capabilities, fully self-hosted with no third-party API keys:
 *
 * - `web_search`: query a self-hosted SearXNG instance for public web results.
 * - `web_read`: fetch a single public web URL and return clean markdown using a tiered,
 *   cheapest-first reader chain: MediaWiki API -> in-process static extraction
 *   (Readability + Turndown) -> Crawl4AI headless-browser escalation.
 *
 * All extraction except the optional Crawl4AI escalation runs inside this Bun process, so a
 * minimal deployment only needs a SearXNG container. Crawl4AI is optional and enabled by
 * configuring a crawler URL; when absent, `web_read` relies on the MediaWiki and static tiers.
 */

import {Readability} from '@mozilla/readability'
import {parseHTML} from 'linkedom'
import TurndownService from 'turndown'

import {recordPerfCount} from '@/perf'

/** Optional URLs/credentials for the self-hosted web backends. */
export type WebToolsConfig = {
  /** Self-hosted SearXNG base URL, e.g. http://searxng:8080. Required for web_search. */
  searxngUrl?: string
  /** Optional self-hosted Crawl4AI base URL, e.g. http://crawl4ai:11235. Enables browser-render escalation. */
  crawlerUrl?: string
  /** Bearer token for Crawl4AI (Crawl4AI >= 0.9 is secure-by-default and requires it). */
  crawlerToken?: string
  /** Override for FETCH_TIMEOUT_MS (tests exercise the deadline without waiting 15s). */
  fetchTimeoutMs?: number
  /** Override for CRAWL_TIMEOUT_MS. */
  crawlTimeoutMs?: number
  /** Override for READ_CACHE_TTL_MS (0 disables the web_read cache). */
  readCacheTtlMs?: number
}

/** Keep markdown comfortably under the 256 KiB tool-result cap, leaving room for metadata. */
const MAX_MARKDOWN_BYTES = 200 * 1024
const FETCH_TIMEOUT_MS = 15_000
const CRAWL_TIMEOUT_MS = 45_000
/** Below this many characters, static extraction is treated as "thin" and escalates. */
const MIN_CONTENT_CHARS = 200
const USER_AGENT = 'Mozilla/5.0 (compatible; SeedAgent/1.0; +https://hyper.media)'

const SEARCH_CATEGORIES = new Set(['general', 'news', 'science', 'it'])
const SEARCH_TIME_RANGES = new Set(['day', 'week', 'month', 'year'])

/** Reader tier that produced a `web_read` result. */
export type WebReadSource = 'mediawiki' | 'static' | 'crawl4ai' | 'raw'

/** Human-readable phrase for each reader source, used in the user-facing summary. */
const WEB_READ_SOURCE_LABEL: Record<WebReadSource, string> = {
  mediawiki: 'the wiki API',
  static: 'direct fetch',
  crawl4ai: 'a browser',
  raw: 'direct fetch (raw)',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

/**
 * Runs one whole network exchange — headers AND body consumption — under a single deadline.
 *
 * A signal passed only to `fetch()` stops guarding the moment headers arrive, so a server that
 * responds quickly and then stalls the body stream hangs the caller unbounded. Measured in prod as
 * 31s `web_read` calls out of the "static" tier whose timeout is nominally 15s. Every read of
 * `res.text()` / `res.json()` must therefore happen inside the exchange callback, under the same
 * signal that guards the fetch.
 */
async function withFetchDeadline<T>(timeoutMs: number, exchange: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await exchange(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** Truncates markdown to the byte budget on a character boundary, reporting whether it was cut. */
export function boundMarkdown(markdown: string): {markdown: string; truncated: boolean} {
  if (Buffer.byteLength(markdown, 'utf8') <= MAX_MARKDOWN_BYTES) return {markdown, truncated: false}
  // Binary search for the longest char-prefix that fits the byte budget.
  let lo = 0
  let hi = markdown.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (Buffer.byteLength(markdown.slice(0, mid), 'utf8') <= MAX_MARKDOWN_BYTES) lo = mid
    else hi = mid - 1
  }
  return {markdown: `${markdown.slice(0, lo).trimEnd()}\n\n_[content truncated]_`, truncated: true}
}

function createTurndown(): TurndownService {
  const td = new TurndownService({headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-'})
  // Drop non-content nodes that Readability may leave behind.
  td.remove(['script', 'style', 'noscript', 'iframe', 'form'])
  return td
}

/** Extracts the main article from raw HTML and returns clean markdown, or null if extraction is weak. */
export function extractReadableMarkdown(html: string, url: string): {title: string; markdown: string} | null {
  let document: Document
  try {
    document = parseHTML(html).document as unknown as Document
  } catch {
    return null
  }
  let article: {title?: string | null; content?: string | null; textContent?: string | null} | null = null
  try {
    // Readability mutates the document; pass a parsed DOM scoped to this call.
    article = new Readability(document as never, {charThreshold: 200}).parse()
  } catch {
    // Readability throws on some DOM shapes; treat as extraction failure so the caller escalates.
    return null
  }
  if (!article || !article.content) return null
  const text = (article.textContent ?? '').trim()
  if (text.length < MIN_CONTENT_CHARS) return null
  const markdown = createTurndown().turndown(article.content).trim()
  if (markdown.length < MIN_CONTENT_CHARS) return null
  return {title: (article.title ?? '').trim() || hostnameOf(url), markdown}
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// ---------------------------------------------------------------------------
// web_search (SearXNG)
// ---------------------------------------------------------------------------

export type WebSearchResult = {
  title: string
  url: string
  snippet: string
  engine: string
}

type SearxngResponse = {
  results: WebSearchResult[]
  unresponsiveEngines: string[]
}

/** Alternate engines used to route around an engine that rate-limited the first query. */
const FALLBACK_ENGINES = 'duckduckgo,bing,startpage,wikipedia'

async function querySearxng(
  searxngUrl: string,
  params: URLSearchParams,
  engines: string | undefined,
  timeoutMs: number,
): Promise<SearxngResponse> {
  const url = new URL('/search', searxngUrl)
  url.search = params.toString()
  if (engines) url.searchParams.set('engines', engines)
  const body: unknown = await withFetchDeadline(timeoutMs, async (signal) => {
    const res = await fetch(url.toString(), {headers: {Accept: 'application/json', 'User-Agent': USER_AGENT}, signal})
    if (!res.ok) throw new Error(`SearXNG request failed: HTTP ${res.status}`)
    return res.json()
  })
  if (!isRecord(body) || !Array.isArray(body.results)) throw new Error('SearXNG returned an unexpected response')
  const results: WebSearchResult[] = body.results.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.url !== 'string') return []
    return [
      {
        title: boundedString(entry.title, 512) || (entry.url as string),
        url: entry.url,
        snippet: boundedString(entry.content, 1024),
        engine: typeof entry.engine === 'string' ? entry.engine : '',
      },
    ]
  })
  const unresponsiveEngines = Array.isArray(body.unresponsive_engines)
    ? body.unresponsive_engines.flatMap((item) =>
        Array.isArray(item) && typeof item[0] === 'string' ? [item[0] as string] : [],
      )
    : []
  return {results, unresponsiveEngines}
}

export async function executeWebSearch(config: WebToolsConfig, raw: unknown): Promise<Record<string, unknown>> {
  if (!config.searxngUrl) throw new Error('web_search is not configured (no SearXNG backend)')
  const input = isRecord(raw) ? raw : {}
  const query = boundedString(input.query, 1024)
  if (!query) throw new Error('Search query is required')

  const count = boundedInteger(input.count, 10, 1, 25)
  const category =
    typeof input.category === 'string' && SEARCH_CATEGORIES.has(input.category) ? input.category : 'general'
  const params = new URLSearchParams({q: query, format: 'json', categories: category, safesearch: '1'})
  // The registry contract says `timeRange`; SearXNG's own query param is snake_case.
  if (typeof input.timeRange === 'string' && SEARCH_TIME_RANGES.has(input.timeRange))
    params.set('time_range', input.timeRange)
  params.set('language', boundedString(input.language, 16) || 'en')

  const timeoutMs = config.fetchTimeoutMs ?? FETCH_TIMEOUT_MS
  let {results, unresponsiveEngines} = await querySearxng(config.searxngUrl, params, undefined, timeoutMs)
  // If upstream engines blocked the query and nothing came back, retry once with a different engine set.
  if (results.length === 0 && unresponsiveEngines.length > 0) {
    const retry = await querySearxng(config.searxngUrl, params, FALLBACK_ENGINES, timeoutMs)
    results = retry.results
    unresponsiveEngines = retry.unresponsiveEngines
  }

  const limited = results.slice(0, count)
  const degraded = unresponsiveEngines.length > 0
  const markdown = limited.length
    ? [
        `Web search results for "${query}" (${limited.length} result${limited.length === 1 ? '' : 's'}${
          degraded ? `, degraded: ${unresponsiveEngines.join(', ')} unavailable` : ''
        })`,
        '',
        ...limited.flatMap((result, index) => [
          `${index + 1}. [${result.title}](${result.url})`,
          ...(result.snippet ? [`   ${result.snippet}`] : []),
          `   - ${result.url}${result.engine ? ` (${result.engine})` : ''}`,
          '',
        ]),
      ].join('\n')
    : `No web results found for "${query}".${
        degraded ? ` Some engines were unavailable: ${unresponsiveEngines.join(', ')}.` : ''
      }`

  return {
    summary: limited.length
      ? `Found ${limited.length} web result${limited.length === 1 ? '' : 's'} for "${query}".`
      : `No web results for "${query}".`,
    query,
    results: limited,
    // `partial` is the registry-contract name; the summary/markdown carry which engines were out.
    partial: degraded,
    markdown,
  }
}

// ---------------------------------------------------------------------------
// web_read tiers
// ---------------------------------------------------------------------------

/** Per-host MediaWiki discovery cache: scriptpath when MediaWiki, or null when confirmed non-wiki. */
const mediaWikiHostCache = new Map<string, string | null>()

/** Parses a likely MediaWiki page title from common URL shapes (/wiki/Title or ?title=Title). */
export function parseWikiTitle(url: URL): string | null {
  const titleParam = url.searchParams.get('title')
  if (titleParam) return titleParam
  const wikiMatch = url.pathname.match(/\/wiki\/(.+)$/)
  if (wikiMatch && wikiMatch[1]) return decodeURIComponent(wikiMatch[1])
  return null
}

/** Returns the MediaWiki scriptpath for a host (e.g. "/w"), or null if the host is not MediaWiki. */
async function discoverMediaWiki(origin: string, timeoutMs: number): Promise<string | null> {
  if (mediaWikiHostCache.has(origin)) return mediaWikiHostCache.get(origin) ?? null
  let scriptpath: string | null = null
  for (const candidate of ['/w', '']) {
    try {
      const api = `${origin}${candidate}/api.php?action=query&meta=siteinfo&siprop=general&format=json`
      const body: unknown = await withFetchDeadline(timeoutMs, async (signal) => {
        const res = await fetch(api, {headers: {'User-Agent': USER_AGENT}, signal})
        if (!res.ok) return undefined
        return res.json()
      })
      const general = isRecord(body) && isRecord(body.query) ? body.query.general : undefined
      const generator = isRecord(general) && typeof general.generator === 'string' ? general.generator : ''
      if (generator.startsWith('MediaWiki')) {
        scriptpath = isRecord(general) && typeof general.scriptpath === 'string' ? general.scriptpath : candidate
        break
      }
    } catch {
      // try next candidate
    }
  }
  mediaWikiHostCache.set(origin, scriptpath)
  return scriptpath
}

/** Reads a MediaWiki page as markdown via the REST Parsoid HTML endpoint. Returns null to fall through. */
async function readMediaWiki(url: URL, timeoutMs: number): Promise<{title: string; markdown: string} | null> {
  const title = parseWikiTitle(url)
  if (!title) return null
  const scriptpath = await discoverMediaWiki(url.origin, timeoutMs)
  if (scriptpath === null) return null
  const restUrl = `${url.origin}${scriptpath}/rest.php/v1/page/${encodeURIComponent(title)}/html`
  try {
    const html = await withFetchDeadline(timeoutMs, async (signal) => {
      const res = await fetch(restUrl, {headers: {'User-Agent': USER_AGENT}, signal})
      if (!res.ok) return null
      return res.text()
    })
    if (html === null) return null
    const extracted = extractReadableMarkdown(html, url.toString())
    if (extracted) return extracted
    // Parsoid HTML occasionally defeats Readability; fall back to a direct conversion of the body.
    const markdown = createTurndown().turndown(html).trim()
    if (markdown.length < MIN_CONTENT_CHARS) return null
    return {title: title.replace(/_/g, ' '), markdown}
  } catch {
    return null
  }
}

/** Fetches a URL and extracts main-content markdown in-process. Returns null to escalate. */
async function readStatic(
  url: string,
  timeoutMs: number,
): Promise<{title: string; markdown: string; finalUrl: string} | null> {
  let fetched: {html: string; finalUrl: string} | null
  try {
    fetched = await withFetchDeadline(timeoutMs, async (signal) => {
      const res = await fetch(url, {
        headers: {'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml'},
        redirect: 'follow',
        signal,
      })
      if (!res.ok) return null
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('html') && !contentType.includes('xml') && contentType !== '') return null
      return {html: await res.text(), finalUrl: res.url || url}
    })
  } catch {
    return null
  }
  if (fetched === null) return null
  const extracted = extractReadableMarkdown(fetched.html, url)
  if (!extracted) return null
  return {...extracted, finalUrl: fetched.finalUrl}
}

/** Renders a URL to markdown via the self-hosted Crawl4AI headless browser. Returns null to fall through. */
async function readCrawl4ai(
  config: WebToolsConfig,
  url: string,
  query: string,
): Promise<{title: string; markdown: string} | null> {
  if (!config.crawlerUrl) return null
  const headers: Record<string, string> = {'Content-Type': 'application/json', 'User-Agent': USER_AGENT}
  if (config.crawlerToken) headers.Authorization = `Bearer ${config.crawlerToken}`
  const body = query ? {url, f: 'bm25', q: query} : {url, f: 'fit'}
  const endpoint = new URL('/md', config.crawlerUrl).toString()
  // Browser rendering is transiently flaky under concurrency; one retry covers the common hiccup.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const data: unknown = await withFetchDeadline(config.crawlTimeoutMs ?? CRAWL_TIMEOUT_MS, async (signal) => {
        const res = await fetch(endpoint, {method: 'POST', headers, body: JSON.stringify(body), signal})
        if (!res.ok) return undefined
        return res.json()
      })
      if (!isRecord(data) || data.success !== true || typeof data.markdown !== 'string') continue
      const markdown = data.markdown.trim()
      if (markdown.length === 0) continue
      return {title: hostnameOf(url), markdown}
    } catch {
      // retry once, then give up so the caller can surface a clean error
    }
  }
  return null
}

/** Content types web_read raw mode will return verbatim; anything else is treated as binary. */
const RAW_TEXT_CONTENT_TYPE = /(^$)|text|json|xml|javascript|ecmascript|csv|yaml|x-sh|x-www-form/i

/** Fetches a URL and returns its body verbatim (no extraction/conversion). Throws on failure or binary content. */
async function readRaw(url: string, timeoutMs: number): Promise<{body: string; finalUrl: string; contentType: string}> {
  try {
    return await withFetchDeadline(timeoutMs, async (signal) => {
      const res = await fetch(url, {headers: {'User-Agent': USER_AGENT}, redirect: 'follow', signal})
      if (!res.ok) throw new Error(`Could not fetch ${url} (raw): HTTP ${res.status}`)
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
      if (!RAW_TEXT_CONTENT_TYPE.test(contentType))
        throw new Error(`web_read raw mode only supports text responses; got content-type "${contentType}"`)
      return {body: await res.text(), finalUrl: res.url || url, contentType}
    })
  } catch (error) {
    // The exchange's own errors (HTTP status, content-type) already read well; wrap only transport failures.
    if (
      error instanceof Error &&
      (error.message.startsWith('Could not fetch') || error.message.startsWith('web_read raw mode'))
    )
      throw error
    throw new Error(`Could not fetch ${url} (raw): ${error instanceof Error ? error.message : 'request failed'}`)
  }
}

/**
 * Extracted-page cache and in-flight coalescing for the tiered (non-raw) `web_read` path.
 *
 * Agents demonstrably re-read pages: a prod session fetched the same docs page three times — the
 * last two as PARALLEL calls that differed only in their `#fragment` — burning ~63s on content the
 * process had held 25 minutes earlier. The key strips the fragment (anchors never change the
 * fetched document) and includes `query` (it steers crawl4ai's content filter). Failures are never
 * cached; concurrent identical reads share one in-flight promise, including its rejection.
 */
const READ_CACHE_TTL_MS = 5 * 60_000
const READ_CACHE_MAX_ENTRIES = 50

type WebReadPage = {title: string; markdown: string; source: WebReadSource; finalUrl: string}
const readCache = new Map<string, {page: WebReadPage; expiresAt: number}>()
const readsInFlight = new Map<string, Promise<WebReadPage>>()

/** Tests only — the cache is process-wide state. */
export function clearWebReadCacheForTests(): void {
  readCache.clear()
  readsInFlight.clear()
}

function readCacheKey(parsed: URL, crawlQuery: string): string {
  const noFragment = new URL(parsed.toString())
  noFragment.hash = ''
  return `${noFragment.toString()} ${crawlQuery}`
}

/** Runs the tier chain: MediaWiki -> static -> crawl4ai. Throws when no tier extracts content. */
async function readTiered(config: WebToolsConfig, parsed: URL, rawUrl: string, query: string): Promise<WebReadPage> {
  const timeoutMs = config.fetchTimeoutMs ?? FETCH_TIMEOUT_MS
  const attempts: string[] = []
  let result: WebReadPage | null = null

  // Tier 1: MediaWiki API (clean, no browser) when the URL looks like a wiki page.
  if (parseWikiTitle(parsed)) {
    const wiki = await readMediaWiki(parsed, timeoutMs)
    attempts.push('mediawiki')
    if (wiki) result = {...wiki, source: 'mediawiki', finalUrl: rawUrl}
  }

  // Tier 2: in-process static extraction.
  if (!result) {
    const stat = await readStatic(rawUrl, timeoutMs)
    attempts.push('static')
    if (stat) result = {title: stat.title, markdown: stat.markdown, source: 'static', finalUrl: stat.finalUrl}
  }

  // Tier 3: Crawl4AI headless-browser escalation.
  if (!result && config.crawlerUrl) {
    const crawled = await readCrawl4ai(config, rawUrl, query)
    attempts.push('crawl4ai')
    if (crawled) result = {...crawled, source: 'crawl4ai', finalUrl: rawUrl}
  }

  if (!result) {
    throw new Error(`Could not extract readable content from ${rawUrl} (tried: ${attempts.join(', ') || 'none'}).`)
  }
  return result
}

export async function executeWebRead(config: WebToolsConfig, raw: unknown): Promise<Record<string, unknown>> {
  const input = isRecord(raw) ? raw : {}
  const rawUrl = boundedString(input.url, 2048)
  if (!rawUrl) throw new Error('A url is required')
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid url: ${rawUrl}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error('web_read only supports http(s) URLs')
  const query = boundedString(input.query, 512)

  // Raw mode: return the response body verbatim (source code, JSON APIs, config files) with no
  // extraction — and no caching: raw reads are often APIs whose freshness matters.
  if (input.raw === true) {
    const fetched = await readRaw(rawUrl, config.fetchTimeoutMs ?? FETCH_TIMEOUT_MS)
    const {markdown, truncated} = boundMarkdown(fetched.body)
    return {
      summary: `Fetched ${fetched.finalUrl} via ${WEB_READ_SOURCE_LABEL.raw}${truncated ? ' (truncated)' : ''}.`,
      url: rawUrl,
      finalUrl: fetched.finalUrl,
      title: hostnameOf(rawUrl),
      source: 'raw' satisfies WebReadSource,
      contentType: fetched.contentType,
      truncated,
      success: true,
      markdown,
    }
  }

  const ttlMs = config.readCacheTtlMs ?? READ_CACHE_TTL_MS
  const key = readCacheKey(parsed, query)
  let page: WebReadPage
  let cached = false
  const cachedEntry = ttlMs > 0 ? readCache.get(key) : undefined
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    page = cachedEntry.page
    cached = true
    recordPerfCount('web_read.cache_hit')
  } else {
    const inFlight = readsInFlight.get(key)
    if (inFlight) {
      recordPerfCount('web_read.coalesced')
      page = await inFlight
    } else {
      recordPerfCount('web_read.cache_miss')
      const pending = readTiered(config, parsed, rawUrl, query)
      readsInFlight.set(key, pending)
      try {
        page = await pending
      } finally {
        readsInFlight.delete(key)
      }
      if (ttlMs > 0) {
        // Refresh insertion order so eviction drops the least-recently written entry.
        readCache.delete(key)
        readCache.set(key, {page, expiresAt: Date.now() + ttlMs})
        while (readCache.size > READ_CACHE_MAX_ENTRIES) {
          const oldest = readCache.keys().next().value
          if (oldest === undefined) break
          readCache.delete(oldest)
        }
      }
    }
  }

  const {markdown, truncated} = boundMarkdown(page.markdown)
  return {
    summary: `Read ${page.title} via ${WEB_READ_SOURCE_LABEL[page.source]}${truncated ? ' (truncated)' : ''}${
      cached ? ' (cached)' : ''
    }.`,
    url: rawUrl,
    finalUrl: page.finalUrl,
    title: page.title,
    source: page.source,
    truncated,
    success: true,
    markdown,
  }
}
