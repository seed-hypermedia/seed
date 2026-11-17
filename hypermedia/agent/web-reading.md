---
name: Web Reading
summary: "How an agent reads a web page and searches the web: Hypermedia is tried first, then a cheapest-first chain of readers, and search goes through a self-hosted SearXNG instance."
---
An agent reaches the web in two ways. The [read](./read.md) verb takes an `https://` address and returns the page as markdown. The `web_search` [callable](./callables.md) finds pages. Both are self-hosted and use no third-party API keys. This page covers the order in which a web address is tried, the readers behind it, and the search backend. Operators configure the backends as described in [operations](../operate/web-research-backends.md).

# Hypermedia first

An `https://` address is tried as hypermedia first. It falls through to the web reader only when the resolver says the URL is not hypermedia, or the resource 404s. Every other failure surfaces: transient daemon errors, too-large, network. Scraped page HTML never silently replaces a document's real content (`api-service.ts`). <!-- id:V1SnC19P -->

# The reader chain

`executeWebRead` (`apps/src/web-tools.ts`) runs a cheapest-first chain and returns the first tier that yields ≥ 200 characters: <!-- id:XauDXdGs -->
  1. **MediaWiki API** for wiki-shaped URLs. It probes the host once via `api.php?meta=siteinfo` (cached per host) and fetches Parsoid HTML. <!-- id:LvDhX5Wk -->
  2. **In-process static extraction**: plain `fetch`, Mozilla Readability on a `linkedom` DOM, Turndown to markdown. <!-- id:iREwMBdU -->
  3. **Crawl4AI** (`POST /md`, Bearer token) when `SEED_APPS_CRAWLER_URL` is configured. This is the backstop for JS-heavy and anti-bot pages. <!-- id:rl1exd6I -->

`options.raw: true` skips the chain and returns the response body verbatim (text content types only). Markdown is bounded to 200 KiB, truncated on a byte boundary. <!-- id:64A-mWGZ -->

# `web_search` <!-- id:yjViFSdL -->

Backed by a self-hosted **SearXNG** instance (`GET /search?format=json`), with no third-party API keys. SearXNG has no index of its own. It federates public engines. Engines rate-limit datacenter IPs, so `executeWebSearch` (`web-tools.ts`) inspects `unresponsive_engines`. When the first query returns nothing but engines were unavailable, it retries once against a fallback engine set. It throws (which becomes `tool_result.error`) when no `searxngUrl` is configured. <!-- id:1JGPaHGk -->

The implementation matches the registry contract exactly. `timeRange` goes in (forwarded to SearXNG as its own `time_range` query param). A `partial` boolean comes out when engines were unavailable, and the markdown names the affected engines. A test pins the round trip. <!-- id:-QRwHtKL -->

# See also

- [Read](./read.md)
- [Callable tools](./callables.md)
- [Security](./security.md)
- [Operations: web research backends](../operate/web-research-backends.md)
