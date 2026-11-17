---
name: Web research backends
summary: How to run the two optional sidecars, SearXNG and Crawl4AI, that give an app environment web search and browser-rendered web reads.
---
An [app environment](../software/app-environment.md) can search the web and read web pages for its agents without any third-party API key. Two optional sidecar containers provide this: SearXNG for search and Crawl4AI for pages that need a browser. This page says what each one turns on and how to run them. What agents do with them is in [tools](../agent/tools.md), and the risks are in [security](../agent/security.md).

# What each backend turns on <!-- id:ww1gPvmR -->

Web research is fully self-hosted and uses no third-party API keys. It covers the `web_search` callable tool and the tiered reader behind `read https://…` (MediaWiki, then in-process static Readability+Turndown, then Crawl4AI). See [tools](../agent/tools.md). Both backends are optional. Without configuration, `web_search` errors and web reads fall back to the MediaWiki and static tiers. To enable them, run the backends as sidecar containers on the same internal network and point the app environment at them. <!-- id:6w4jARt9 -->

The health endpoint reports the result as `webTools: {search, readBrowser}`, and the startup log prints `Web tools: search=on reader=static+crawl4ai` when both are wired. See [endpoints and health](./endpoints-and-health.md).

# Local development

For local development a ready-to-run compose and SearXNG config live at `apps/dev/web-backends/`. Start the containers, then run the service. `bun run dev` already points at these dev endpoints by default: <!-- id:ylFQ-SIc -->

```bash <!-- id:ObEJf9WQ -->
cd apps/dev/web-backends && docker compose up -d   # SearXNG on :8899, Crawl4AI on :11235
cd ../.. && bun run dev                               # auto-targets the dev backends
```

The `dev` script defaults `SEED_APPS_SEARXNG_URL` (`http://127.0.0.1:8899`), `SEED_APPS_CRAWLER_URL` (`http://127.0.0.1:11235`), and `SEED_APPS_CRAWLER_TOKEN` (`dev-crawl-token`) to the compose values. Export those env vars to override them. The same script also turns `SEED_APPS_SUBSCRIPTION_AUTH` on for local development. The reader's MediaWiki and static tiers still work if the containers are not running. Only `web_search` and the browser escalation need them. Stop the backends with `docker compose down` in `apps/dev/web-backends/`. Under `./dev up` the `backends` pane runs the same compose file; see [environments](./environments.md). <!-- id:sU3Ky-PV -->

# Production

For production the same two containers run as internal sidecars: <!-- id:HEFIWVDD -->

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

Required SearXNG `settings.yml` (the JSON format is off by default and the limiter blocks API calls): <!-- id:VkqeSybu -->

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

Then wire the agents container: <!-- id:T9adfXgF -->

```yaml <!-- id:O7DuPU3J -->
environment:
  SEED_APPS_SEARXNG_URL: http://searxng:8080
  SEED_APPS_CRAWLER_URL: http://crawl4ai:11235
  SEED_APPS_CRAWLER_TOKEN: ${CRAWL4AI_API_TOKEN}
```

Keep both containers off the public network. SearXNG runs with its limiter off, which is safe only because nothing outside the internal network can reach it. Pin the Crawl4AI version: `0.9.0` changed its auth defaults, so it must not float to `:latest`.

Capacity note: Crawl4AI runs a headless Chromium and documents a >=4 GB RAM minimum plus 1 GB shared memory. Size the host accordingly. The SearXNG and in-process static reader path is lightweight. Crawl4AI is the heavy escalation tier. <!-- id:U9QXiKwN -->

On the hosted servers the two backends run on their own host, reachable only on the private network, and every environment points at them. They are defined in `seed_infra/agentic` in the infrastructure repository (`mintterteam/infrastructure` on GitHub, usually checked out as `SeedInfra`), not in the Seed repository.

# See also

- [Tools](../agent/tools.md), the `web_search` callable and the tiers behind `read https://…`
- [Security](../agent/security.md), web reading safety
- [Configuration](./configuration.md), the three settings
- [Environments](./environments.md), which deployments have the backends
- [Endpoints and health](./endpoints-and-health.md), the `webTools` field
