---
name: Web research backends
summary: This page explains how to run SearXNG and Crawl4AI, the two optional helper containers that give an app environment web search and web reads through a real browser.
---
An [app environment](../software/app-environment.md) can search the web and read web pages for its [agents](../agent.md). It needs no API key from another company. Two optional helper containers do the work: SearXNG searches, and Crawl4AI reads pages that need a real browser. This page says what each one turns on and how to run them.

The first thing to check: `curl <server>/api/health` and read `webTools`. `{"search": true, "readBrowser": true}` means both are connected.

What agents do with them is in [web reading](../agent/web-reading.md), and the risks are in [security](../agent/security.md).

# What each backend turns on <!-- id:ww1gPvmR -->

Web research has two parts: <!-- id:6w4jARt9 -->

- **`web_search`**, a tool agents can call. It needs SearXNG.
- **The web reader** behind `read https://…`. It tries three ways in order: MediaWiki, then a plain fetch that the server turns into readable text itself, then Crawl4AI. Only the last one needs a backend.

Both backends are optional. What happens without them:

- **Without SearXNG**, the server still offers `web_search` to agents, and every call fails with `web_search is not configured (no SearXNG backend)`. If you do not run SearXNG, take `web_search` out of your agents' tools.
- **Without Crawl4AI**, web reads still work through the first two ways. A page that only works in a browser may come back empty or incomplete.

To turn them on, run the two containers on the same internal network as the app environment and give the server their addresses.

The health endpoint reports the result as `webTools: {search, readBrowser}`. The startup log prints `Web tools: search=on reader=static+crawl4ai` when both are connected. See [endpoints and health](./endpoints-and-health.md).

# Local development

A compose file and a SearXNG config, ready to run, are in `apps/dev/web-backends/`. Start the containers, then start the server. `bun run dev` already points at them: <!-- id:ylFQ-SIc -->

```bash <!-- id:ObEJf9WQ -->
cd apps/dev/web-backends && docker compose up -d   # SearXNG on :8899, Crawl4AI on :11235
cd ../.. && bun run dev                               # auto-targets the dev backends
```

The `dev` script in `apps/package.json` sets three values to match the compose file. Export the variables yourself to use other values: <!-- id:sU3Ky-PV -->

- `SEED_APPS_SEARXNG_URL` is `http://127.0.0.1:8899`;
- `SEED_APPS_CRAWLER_URL` is `http://127.0.0.1:11235`;
- `SEED_APPS_CRAWLER_TOKEN` is `dev-crawl-token`.

The same script turns `SEED_APPS_SUBSCRIPTION_AUTH` on for local development.

To stop the backends, run `docker compose down` in `apps/dev/web-backends/`. Under `./dev up` the `backends` pane runs the same compose file; see [environments](./environments.md).

# Production

In production the same two containers run beside the server, on an internal network: <!-- id:HEFIWVDD -->

```yaml <!-- id:PHv3Gdqr -->
services:
  searxng:
    image: searxng/searxng:latest
    volumes:
      - ./searxng:/etc/searxng:rw # settings.yml must enable the json format
    restart: unless-stopped
    # No published ports: reachable on the internal network as http://searxng:8080

  crawl4ai:
    image: unclecode/crawl4ai:0.9.0 # pin; do NOT use :latest (0.9.0 changed auth defaults)
    shm_size: '1g' # required: headless Chromium crashes without it
    environment:
      - CRAWL4AI_API_TOKEN=${CRAWL4AI_API_TOKEN} # required: 0.9.x is secure-by-default
    restart: unless-stopped
    # Reachable on the internal network as http://crawl4ai:11235
```

SearXNG needs this `settings.yml`. The JSON format is off by default, and the limiter refuses API calls: <!-- id:VkqeSybu -->

```yaml <!-- id:qV3GeELm -->
use_default_settings: true
server:
  secret_key: '${SEARXNG_SECRET_KEY}'
  limiter: false # safe only on a trusted internal network
  public_instance: false
search:
  formats:
    - html
    - json
```

Then give the app environment container the addresses: <!-- id:T9adfXgF -->

```yaml <!-- id:O7DuPU3J -->
environment:
  SEED_APPS_SEARXNG_URL: http://searxng:8080
  SEED_APPS_CRAWLER_URL: http://crawl4ai:11235
  SEED_APPS_CRAWLER_TOKEN: ${CRAWL4AI_API_TOKEN}
```

Two rules:

- **Keep both containers off the public network.** SearXNG runs with its limiter off. That is safe only because nothing outside the internal network can reach it.
- **Pin the Crawl4AI version.** Version `0.9.0` changed how it checks access, so do not use `:latest`.

Size the host for Crawl4AI. It runs a Chromium browser without a window, and its own documentation asks for at least 4 GB of RAM plus 1 GB of shared memory. SearXNG and the server's own reader are light. <!-- id:U9QXiKwN -->

On the hosted Seed servers, the two backends run on their own host. Only the private network reaches them, and every environment points at them. They are defined in `seed_infra/agentic` in the infrastructure repository (`mintterteam/infrastructure` on GitHub, usually checked out as `SeedInfra`), not in the Seed repository. This describes the hosted servers and can change.

# See also

- [Tools](../agent/tools.md), the `web_search` tool and the reader behind `read https://…`
- [Security](../agent/security.md), web reading safety
- [Configuration](./configuration.md), the three settings
- [Environments](./environments.md), which setups have the backends
- [Endpoints and health](./endpoints-and-health.md), the `webTools` field
