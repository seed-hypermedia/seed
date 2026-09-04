import {afterEach, describe, expect, test} from 'bun:test'
import {
  boundMarkdown,
  clearWebReadCacheForTests,
  executeWebRead,
  executeWebSearch,
  extractReadableMarkdown,
  parseWikiTitle,
  type WebToolsConfig,
} from '@/web-tools'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  clearWebReadCacheForTests()
})

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>
function mockFetch(route: Route) {
  globalThis.fetch = ((input: unknown, init?: RequestInit) =>
    Promise.resolve(route(String(input), init))) as typeof fetch
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}})
}
function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {status, headers: {'content-type': 'text/html; charset=utf-8'}})
}

const ARTICLE_HTML = `<!DOCTYPE html><html><head><title>Test Article Title</title></head><body>
<header><nav>site nav junk</nav></header>
<article>
<h1>Test Article Title</h1>
<p>${'This is a substantial paragraph of article content that should easily clear the extraction threshold. '.repeat(
  4,
)}</p>
<p>${'A second paragraph adds more readable body text so Readability is confident about the main content. '.repeat(
  4,
)}</p>
<p>It also includes a <a href="https://example.com/more">link</a> and some <strong>emphasis</strong>.</p>
</article>
<footer>footer junk</footer>
</body></html>`

const SEARXNG = 'http://searxng:8080'
const CRAWLER = 'http://crawl4ai:11235'

describe('boundMarkdown', () => {
  test('passes through small markdown', () => {
    const r = boundMarkdown('# hi\n\nshort')
    expect(r.truncated).toBe(false)
    expect(r.markdown).toBe('# hi\n\nshort')
  })
  test('truncates oversized markdown on a byte budget', () => {
    const big = 'a'.repeat(300 * 1024)
    const r = boundMarkdown(big)
    expect(r.truncated).toBe(true)
    expect(Buffer.byteLength(r.markdown, 'utf8')).toBeLessThanOrEqual(200 * 1024 + 64)
    expect(r.markdown.endsWith('_[content truncated]_')).toBe(true)
  })
})

describe('parseWikiTitle', () => {
  test('extracts from /wiki/ path', () => {
    expect(parseWikiTitle(new URL('https://en.wikipedia.org/wiki/Hypermedia'))).toBe('Hypermedia')
  })
  test('extracts from ?title= query', () => {
    expect(parseWikiTitle(new URL('https://wiki.example.org/index.php?title=Foo_Bar'))).toBe('Foo_Bar')
  })
  test('returns null for non-wiki urls', () => {
    expect(parseWikiTitle(new URL('https://example.com/blog/post'))).toBeNull()
  })
})

describe('extractReadableMarkdown', () => {
  test('extracts article markdown from html', () => {
    const r = extractReadableMarkdown(ARTICLE_HTML, 'https://example.com/post')
    expect(r).not.toBeNull()
    expect(r?.title).toContain('Test Article Title')
    expect(r?.markdown).toContain('substantial paragraph')
    expect(r?.markdown).not.toContain('footer junk')
  })
  test('returns null for thin content', () => {
    expect(extractReadableMarkdown('<html><body><p>hi</p></body></html>', 'https://x.com')).toBeNull()
  })
})

describe('executeWebSearch', () => {
  test('throws when SearXNG not configured', async () => {
    await expect(executeWebSearch({}, {query: 'x'})).rejects.toThrow(/not configured/)
  })
  test('throws on empty query', async () => {
    await expect(executeWebSearch({searxngUrl: SEARXNG}, {query: '  '})).rejects.toThrow(/required/)
  })
  test('parses results, limits count, marks partial coverage from unresponsive engines', async () => {
    mockFetch((url) => {
      expect(url).toContain('/search')
      expect(url).toContain('format=json')
      return json({
        results: [
          {url: 'https://a.com', title: 'A', content: 'snippet a', engine: 'google'},
          {url: 'https://b.com', title: 'B', content: 'snippet b', engine: 'google'},
          {url: 'https://c.com', title: 'C', content: 'snippet c', engine: 'bing'},
        ],
        unresponsive_engines: [['brave', 'too many requests']],
      })
    })
    const out = await executeWebSearch({searxngUrl: SEARXNG}, {query: 'test', count: 2})
    expect((out.results as unknown[]).length).toBe(2)
    // `partial` is the registry-contract name the model reads.
    expect(out.partial).toBe(true)
    expect(String(out.markdown)).toContain('brave')
    expect(String(out.markdown)).toContain('[A](https://a.com)')
  })
  test('timeRange from the tool contract reaches SearXNG as time_range', async () => {
    // The registry declares `timeRange` (and additionalProperties: false); reading any other key
    // makes the recency filter silently unreachable — which is exactly the drift this pins.
    let searchUrl = ''
    mockFetch((url) => {
      searchUrl = url
      return json({results: [], unresponsive_engines: []})
    })
    await executeWebSearch({searxngUrl: SEARXNG}, {query: 'news today', timeRange: 'week'})
    expect(searchUrl).toContain('time_range=week')
  })

  test('retries with fallback engines when first query is empty but engines were unresponsive', async () => {
    let calls = 0
    mockFetch((url) => {
      calls += 1
      if (calls === 1) return json({results: [], unresponsive_engines: [['google', 'CAPTCHA']]})
      expect(url).toContain('engines=')
      return json({
        results: [{url: 'https://x.com', title: 'X', content: 's', engine: 'duckduckgo'}],
        unresponsive_engines: [],
      })
    })
    const out = await executeWebSearch({searxngUrl: SEARXNG}, {query: 'test'})
    expect(calls).toBe(2)
    expect((out.results as unknown[]).length).toBe(1)
  })
})

describe('executeWebRead tiers', () => {
  test('reads a MediaWiki page via the wiki API tier', async () => {
    mockFetch((url) => {
      if (url.includes('api.php') && url.includes('siteinfo'))
        return json({query: {general: {generator: 'MediaWiki 1.47', scriptpath: '/w'}}})
      if (url.includes('/rest.php/v1/page/') && url.endsWith('/html')) return htmlResponse(ARTICLE_HTML)
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await executeWebRead({}, {url: 'https://wiki.test.org/wiki/Sample'})
    expect(out.source).toBe('mediawiki')
    expect(out.success).toBe(true)
    expect(String(out.markdown)).toContain('substantial paragraph')
  })

  test('falls back to static extraction for ordinary pages', async () => {
    mockFetch((url) => {
      if (url === 'https://blog.test/post') return htmlResponse(ARTICLE_HTML)
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await executeWebRead({crawlerUrl: CRAWLER}, {url: 'https://blog.test/post'})
    expect(out.source).toBe('static')
    expect(String(out.markdown)).toContain('substantial paragraph')
  })

  test('escalates to crawl4ai when static is thin, and passes the bearer token', async () => {
    let sawAuth = ''
    mockFetch((url, init) => {
      if (url === 'https://spa.test/') return htmlResponse('<html><body><div id="root"></div></body></html>')
      if (url.endsWith('/md')) {
        sawAuth = (init?.headers as Record<string, string>)?.Authorization ?? ''
        return json({url, markdown: '# Rendered\n\n' + 'rendered content '.repeat(20), success: true})
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await executeWebRead({crawlerUrl: CRAWLER, crawlerToken: 'secret-token'}, {url: 'https://spa.test/'})
    expect(out.source).toBe('crawl4ai')
    expect(sawAuth).toBe('Bearer secret-token')
    expect(String(out.markdown)).toContain('Rendered')
  })

  test('throws a clean error when every tier fails and no crawler is configured', async () => {
    mockFetch((url) => {
      if (url === 'https://dead.test/') return new Response('nope', {status: 500})
      throw new Error(`unexpected fetch ${url}`)
    })
    await expect(executeWebRead({}, {url: 'https://dead.test/'})).rejects.toThrow(/Could not extract/)
  })

  test('rejects non-http(s) URLs', async () => {
    await expect(executeWebRead({}, {url: 'ftp://x'})).rejects.toThrow(/http/)
  })

  describe('read cache and coalescing', () => {
    test('a repeat read is served from cache without fetching, fragment-insensitive', async () => {
      let fetches = 0
      mockFetch((url) => {
        fetches += 1
        if (url.startsWith('https://docs.test/page')) return htmlResponse(ARTICLE_HTML)
        throw new Error(`unexpected fetch ${url}`)
      })
      const first = await executeWebRead({}, {url: 'https://docs.test/page#section-one'})
      // The prod shape this exists for: the same page re-read under a different anchor.
      const second = await executeWebRead({}, {url: 'https://docs.test/page#section-two'})
      expect(fetches).toBe(1)
      expect(second.markdown).toBe(first.markdown)
      expect(String(second.summary)).toContain('(cached)')
      // Each response still echoes the URL it was asked for.
      expect(second.url).toBe('https://docs.test/page#section-two')
      expect(String(first.summary)).not.toContain('(cached)')
    })

    test('concurrent identical reads share one fetch', async () => {
      let fetches = 0
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      mockFetch(async (url) => {
        fetches += 1
        await gate
        return htmlResponse(ARTICLE_HTML)
      })
      const a = executeWebRead({}, {url: 'https://docs.test/page'})
      const b = executeWebRead({}, {url: 'https://docs.test/page#anchor'})
      release()
      const [ra, rb] = await Promise.all([a, b])
      expect(fetches).toBe(1)
      expect(rb.markdown).toBe(ra.markdown)
    })

    test('a coalesced failure rejects both callers and is not cached', async () => {
      let fetches = 0
      mockFetch(() => {
        fetches += 1
        return new Response('nope', {status: 500})
      })
      const settled = await Promise.allSettled([
        executeWebRead({}, {url: 'https://dead.test/'}),
        executeWebRead({}, {url: 'https://dead.test/'}),
      ])
      expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected'])
      for (const s of settled) {
        expect(String((s as PromiseRejectedResult).reason)).toMatch(/Could not extract/)
      }
      expect(fetches).toBe(1)
      // The failure must not poison the cache: the next read tries again.
      await expect(executeWebRead({}, {url: 'https://dead.test/'})).rejects.toThrow(/Could not extract/)
      expect(fetches).toBe(2)
    })

    test('entries expire after the ttl and different queries do not share entries', async () => {
      let fetches = 0
      mockFetch((url) => {
        fetches += 1
        if (url.startsWith('https://docs.test/')) return htmlResponse(ARTICLE_HTML)
        if (url.endsWith('/md')) return json({success: true, markdown: 'x'.repeat(300)})
        throw new Error(`unexpected fetch ${url}`)
      })
      await executeWebRead({readCacheTtlMs: 30}, {url: 'https://docs.test/page'})
      await new Promise((resolve) => setTimeout(resolve, 40))
      await executeWebRead({readCacheTtlMs: 30}, {url: 'https://docs.test/page'})
      expect(fetches).toBe(2)
      // `query` steers crawl4ai's content filter, so it is part of the identity.
      await executeWebRead({readCacheTtlMs: 60_000}, {url: 'https://docs.test/page', query: 'pricing'})
      expect(fetches).toBe(3)
    })

    test('readCacheTtlMs: 0 disables caching entirely', async () => {
      let fetches = 0
      mockFetch(() => {
        fetches += 1
        return htmlResponse(ARTICLE_HTML)
      })
      await executeWebRead({readCacheTtlMs: 0}, {url: 'https://docs.test/page'})
      await executeWebRead({readCacheTtlMs: 0}, {url: 'https://docs.test/page'})
      expect(fetches).toBe(2)
    })
  })

  // Regression: the fetch deadline must cover the BODY, not just the headers. A server that
  // responds 200 quickly and then stalls the stream held prod `web_read` calls for 31s against a
  // 15s timeout (the timer used to be cleared as soon as headers arrived).
  describe('body-stall deadline', () => {
    function stallingServer(): {url: string; stop: () => void} {
      const server = Bun.serve({
        port: 0,
        fetch() {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('<html><body><p>partial'))
              // Never close, never enqueue again: headers + a taste of body, then silence.
            },
          })
          return new Response(stream, {headers: {'content-type': 'text/html'}})
        },
      })
      return {url: `http://127.0.0.1:${server.port}/page`, stop: () => server.stop(true)}
    }

    test('a stalled static body escalates to crawl4ai instead of hanging', async () => {
      const site = stallingServer()
      const crawler = Bun.serve({
        port: 0,
        fetch: () =>
          Response.json({success: true, markdown: '# Rendered\n\n' + 'rendered by browser tier '.repeat(20)}),
      })
      try {
        const startedAt = Date.now()
        const out = await executeWebRead(
          {crawlerUrl: `http://127.0.0.1:${crawler.port}`, fetchTimeoutMs: 250},
          {url: site.url},
        )
        expect(out.source).toBe('crawl4ai')
        // Well under the old unbounded hang: the static tier gave up at its deadline.
        expect(Date.now() - startedAt).toBeLessThan(3_000)
      } finally {
        site.stop()
        crawler.stop(true)
      }
    })

    test('a stalled body with no crawler fails cleanly at the deadline', async () => {
      const site = stallingServer()
      try {
        const startedAt = Date.now()
        await expect(executeWebRead({fetchTimeoutMs: 250}, {url: site.url})).rejects.toThrow(/Could not extract/)
        expect(Date.now() - startedAt).toBeLessThan(3_000)
      } finally {
        site.stop()
      }
    })

    test('raw mode also bounds body streaming', async () => {
      const site = stallingServer()
      try {
        const startedAt = Date.now()
        await expect(executeWebRead({fetchTimeoutMs: 250}, {url: site.url, raw: true})).rejects.toThrow(
          /Could not fetch/,
        )
        expect(Date.now() - startedAt).toBeLessThan(3_000)
      } finally {
        site.stop()
      }
    })
  })

  test('uses a human-readable source label in the summary', async () => {
    mockFetch((url) => {
      if (url === 'https://blog.test/post') return htmlResponse(ARTICLE_HTML)
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await executeWebRead({}, {url: 'https://blog.test/post'})
    expect(out.source).toBe('static')
    expect(String(out.summary)).toContain('via direct fetch')
    expect(String(out.summary)).not.toContain('via static')
  })

  test('raw mode returns the verbatim body without extraction', async () => {
    const code = 'export function add(a, b) {\n  return a + b\n}\n'
    mockFetch((url) => {
      if (url === 'https://raw.githubusercontent.com/o/r/main/add.ts')
        return new Response(code, {status: 200, headers: {'content-type': 'text/plain; charset=utf-8'}})
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await executeWebRead({}, {url: 'https://raw.githubusercontent.com/o/r/main/add.ts', raw: true})
    expect(out.source).toBe('raw')
    expect(out.contentType).toBe('text/plain')
    expect(out.markdown).toBe(code)
  })

  test('raw mode rejects binary content', async () => {
    mockFetch((url) => {
      if (url === 'https://files.test/x.png')
        return new Response('\x89PNG', {status: 200, headers: {'content-type': 'image/png'}})
      throw new Error(`unexpected fetch ${url}`)
    })
    await expect(executeWebRead({}, {url: 'https://files.test/x.png', raw: true})).rejects.toThrow(/text responses/)
  })
})
