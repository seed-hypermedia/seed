import {afterEach, describe, expect, test} from 'bun:test'
import {
  boundMarkdown,
  executeWebRead,
  executeWebSearch,
  extractReadableMarkdown,
  parseWikiTitle,
  type WebToolsConfig,
} from '@/web-tools'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
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
  test('parses results, limits count, sets degraded from unresponsive engines', async () => {
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
    expect(out.degraded).toBe(true)
    expect(out.unavailableEngines).toEqual(['brave'])
    expect(String(out.markdown)).toContain('[A](https://a.com)')
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
