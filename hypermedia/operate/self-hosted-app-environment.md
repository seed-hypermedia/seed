---
name: Self-hosting an app environment
summary: How to run the app environment image on your own server, and the decisions to make about its Hypermedia server, hostname, code execution, web tools, accounts and updates.
---
Anyone can run an [app environment](../software/app-environment.md) of their own. This page gives the smallest working server and then the decisions an operator makes, in order of importance. If you install a whole site with the deploy script, it can run the app environment for you; see [self-hosting](./self-hosting.md). The other kinds of deployment are in [environments](./environments.md).

# The minimal server

Anyone can run the image. The minimal server: <!-- id:GiuKlBIH -->

```bash <!-- id:y3vgeIe0 -->
docker run -d --restart unless-stopped \
  -p 3050:3050 \
  -v seed-agents-data:/data \
  -e SEED_APPS_HM_SERVER_URL=https://your-site.example \
  seedhypermedia/agents:latest
```

The image keeps its state in `/data`; see [persistence](./persistence.md). It is also published as `seedhypermedia/apps`.

# Decisions

What an operator must decide, roughly in order of importance. [Self-hosting](./self-hosting.md) covers running the rest of Seed. <!-- id:yljIcZLv -->
  - **HM API URL.** `SEED_APPS_HM_SERVER_URL` must point at an HTTP [Seed API](../build/web-api.md) that accepts the typed DAG-CBOR `/api/*` protocol used by `createSeedClient`: your [site](../protocol/sites.md), a desktop-style API bridge, or the public gateway. A raw daemon gRPC-web port does not work as this endpoint. <!-- id:52sJmwjp -->
  - **IPFS URL.** By default, direct `/ipfs/*` gateway reads use the HM API origin. If the gateway lives elsewhere, as it does locally where the daemon owns it, set `SEED_APPS_IPFS_SERVER_URL` to that origin. File publication still chunks UnixFS blocks and sends them through `PublishBlobs` on the HM API. So a self-hosted raw daemon can be the gateway, but `SEED_APPS_HM_SERVER_URL` still needs a compatible Seed HTTP API or bridge. <!-- id:kUmtvyqv -->
  - **TLS and hostname.** Put a reverse proxy (Caddy, nginx) in front. The desktop and web apps connect over HTTPS, and the signed-envelope API assumes an authentic transport. Route `/hm/api/apps/*` and `/hm/api/agents/*` on your site's origin to it, advertise `https://<site>/hm/api/apps` as the server URL, and set `SEED_APPS_PUBLIC_URL=https://<site>/hm/api/apps` so the server knows where it is reached (see [endpoints and health](./endpoints-and-health.md#base-url)). The self-hosting deploy script does all three when agents are on. CORS is already permissive server-side. <!-- id:vOaBc75h -->
  - **Code execution.** Needs KVM (`--device /dev/kvm`) on a host whose virtualization is exposed. The image ships the microsandbox runtime staged in `/app/node_modules`, so no custom image is needed. Without KVM the server still runs and `/api/health` reports `codeExec: false` (`kvm-missing`). Or set `SEED_APPS_EXEC_BACKEND=off` to advertise honestly. Persist `/root/.microsandbox` if you enable it. Set `SEED_APPS_EXEC_TS_IMAGE=` (empty) to withhold TypeScript, or leave the `oven/bun` default. <!-- id:K-cuGQ_3 -->
  - **Web tools.** Optional SearXNG (`SEED_APPS_SEARXNG_URL`) and Crawl4AI (`SEED_APPS_CRAWLER_URL` + `SEED_APPS_CRAWLER_TOKEN`) containers, internal-only; see [web research backends](./web-research-backends.md). Without SearXNG, agents are not offered the `web_search` callable. <!-- id:pTXkE4RK -->
  - **Subscription OAuth.** Off by default. `SEED_APPS_SUBSCRIPTION_AUTH=true` enables "Sign in with ChatGPT". See [model providers](../agent/model-providers.md). <!-- id:q6somAIy -->
  - **Accounts.** The server is multi-account by signature. It trusts any envelope whose signer IS the [account](../protocol/identity.md), or an authorized signer. There is no allowlist. A reachable server accepts any self-signed account's agents, so do not rely on obscurity. If that matters, gate reachability at the network layer. <!-- id:7AAQLXv1 -->
  - **Updates.** `docker pull` on your schedule, or run Watchtower as the hosted servers do (see [deploying](./deploying.md)). `/api/version` tells you what a running server was built from. <!-- id:LRGZT4Im -->
  - **Secrets.** Provider API keys and OAuth credentials are not part of the server's environment. Each account stores its own through the signed API, encrypted at rest in the database. See [security](../agent/security.md).

# See also

- [Environments](./environments.md), the other four kinds of deployment
- [Configuration](./configuration.md), every setting
- [Code execution backend](./code-execution-backend.md) and [web research backends](./web-research-backends.md)
- [Endpoints and health](./endpoints-and-health.md), to check the server once it is up
- [Self-hosting](./self-hosting.md), running a site, which can include an app environment
- [Seed API](../build/web-api.md), the API the HM server URL must speak
