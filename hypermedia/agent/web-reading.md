---
name: Web Reading
summary: "An agent reads a web page with the read verb and searches the web with web_search: Hypermedia is tried first, then a chain of readers from cheapest to most costly, and search uses a self-hosted SearXNG instance."
---
An [agent](../agent.md) reaches the web in two ways. The [read](./read.md) [verb](./tools.md) takes an `https://` address and returns the page as markdown. The `web_search` [callable tool](./callables.md) finds pages. For example, `read https://example.com/post` returns the text of that post.

Both run on software the operator hosts. Neither uses an API key from another company. This page covers the order in which a web address is tried, the readers behind it, and the search backend. Operators set up the backends as described in [Web research backends](../operate/web-research-backends.md).

# Hypermedia first

An `https://` address is tried as Hypermedia first, because a Seed [site](../protocol/sites.md) serves [documents](../protocol/documents.md) at web addresses. The web reader is used only in two cases: the resolver says the URL is not Hypermedia, or the resource is not found (404). <!-- id:V1SnC19P -->

Every other failure is reported as a failure: a short-lived [daemon](../software/daemon.md) error, a result that is too large, a network error. So scraped page HTML never takes the place of a document's real content without anyone noticing (`api-service.ts`).

# The reader chain

`executeWebRead` (`apps/src/web-tools.ts`) tries the cheapest reader first. It returns the first result that has 200 characters or more: <!-- id:XauDXdGs -->
  1. **MediaWiki API** for URLs that look like a wiki. It asks the host once through `api.php?meta=siteinfo` (the answer is cached per host) and fetches Parsoid HTML. <!-- id:LvDhX5Wk -->
  2. **Static extraction inside the server**: a plain `fetch`, then Mozilla Readability on a `linkedom` DOM, then Turndown to markdown. <!-- id:iREwMBdU -->
  3. **Crawl4AI** (`POST /md`, with a secret token in the `Authorization` header) when `SEED_APPS_CRAWLER_URL` is set. This is the last resort, for pages that need JavaScript or that refuse bots. <!-- id:rl1exd6I -->

`options.raw: true` skips the chain and returns the response body as it is (text content types only). Markdown is limited to 200 KiB and is cut on a byte boundary. <!-- id:64A-mWGZ -->

# `web_search` <!-- id:yjViFSdL -->

`web_search` asks a self-hosted **SearXNG** instance (`GET /search?format=json`). SearXNG has no index of its own. It passes the query to public search engines and merges their answers. <!-- id:1JGPaHGk -->

- Search engines often limit requests from datacenter addresses. So `executeWebSearch` (`web-tools.ts`) looks at `unresponsive_engines`. When the first query returns nothing and some engines did not answer, it retries once with a fallback set of engines.
- When no `searxngUrl` is configured, the tool throws, and the error becomes `tool_result.error`.

The code matches the registry contract exactly. `timeRange` goes in, and is sent to SearXNG as its own `time_range` query parameter. A `partial` boolean comes out when engines did not answer, and the markdown names those engines. A test checks both directions. <!-- id:-QRwHtKL -->

# See also

- [Read](./read.md)
- [Callable tools](./callables.md)
- [Security](./security.md)
- [Web research backends](../operate/web-research-backends.md)
