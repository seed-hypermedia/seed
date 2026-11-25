---
name: Self-hosting an app environment
summary: This page shows how to run the app environment image on your own server and lists the decisions you make about its Hypermedia server, hostname, code execution, web tools, accounts and updates.
---
You can run an [app environment](../software/app-environment.md) of your own. It is one Docker image. This page gives the smallest command that works, and then the decisions you make, most important first.

If you install a whole site with the deploy script, the script can run the app environment for you; see [self-hosting](./self-hosting.md). The other setups are in [environments](./environments.md).

# The minimal server

This is the smallest command that works: <!-- id:GiuKlBIH -->

```bash <!-- id:y3vgeIe0 -->
docker run -d --restart unless-stopped \
  -p 3050:3050 \
  -v seed-agents-data:/data \
  -e SEED_APPS_HM_SERVER_URL=https://your-site.example \
  seedhypermedia/agents:latest
```

Then check it: `curl http://localhost:3050/api/health` should answer `200` with `"status": "ok"`.

The image keeps its state in `/data`; see [persistence](./persistence.md). The same image is also published as `seedhypermedia/apps`.

# Decisions

These are the things you must decide, most important first. [Self-hosting](./self-hosting.md) covers running the rest of Seed. <!-- id:yljIcZLv -->
  - **HM API URL.** `SEED_APPS_HM_SERVER_URL` must point at an HTTP [Seed API](../build/web-api.md): the `/api/*` endpoint that speaks [DAG-CBOR](../schema/dag-cbor.md), which `createSeedClient` uses. That is your [site](../protocol/sites.md), the API of a [desktop app](../software/desktop.md), or the public gateway. The gRPC-web port of a [daemon](../software/daemon.md) does not work here. <!-- id:52sJmwjp -->
  - **IPFS URL.** By default the server reads files from `/ipfs/*` on the same origin as the HM API. If files are served somewhere else, set `SEED_APPS_IPFS_SERVER_URL` to that origin. This is the case on a local machine, where the daemon serves them. To publish a file, the server still cuts it into UnixFS pieces and sends them with `PublishBlobs` to the HM API. So a daemon alone can serve the files, but `SEED_APPS_HM_SERVER_URL` still needs a Seed HTTP API. <!-- id:kUmtvyqv -->
  - **TLS and hostname.** Put a reverse proxy, such as Caddy or nginx, in front. The desktop app and the [web app](../software/web.md) connect over HTTPS, and the [signed API](../build/signed-api.md) expects a connection nobody can change on the way. Then do three things. Send `/hm/api/apps/*` and `/hm/api/agents/*` on your site's origin to the server. Give people `https://<site>/hm/api/apps` as the server URL. Set `SEED_APPS_PUBLIC_URL=https://<site>/hm/api/apps`, so the server knows where it is reached (see [endpoints and health](./endpoints-and-health.md#base-url)). The self-hosting deploy script does all three when [agents](../agent.md) are on. The server already allows requests from any web origin. <!-- id:vOaBc75h -->
  - **Code execution.** It needs KVM: pass `--device /dev/kvm`, on a host that exposes virtualization. The image already contains the microsandbox runtime in `/app/node_modules`, so you need no image of your own. Without KVM the server still runs, `/api/health` reports `codeExec: false` (`kvm-missing`), and agents are not offered `execute`. You can also set `SEED_APPS_EXEC_BACKEND=off` to turn it off on purpose. If you turn it on, keep `/root/.microsandbox` on a volume. Set `SEED_APPS_EXEC_TS_IMAGE=` (empty) to leave out TypeScript, or keep the default `oven/bun`. See the [code execution backend](./code-execution-backend.md). <!-- id:K-cuGQ_3 -->
  - **Web tools.** Two optional containers, on an internal network only: SearXNG (`SEED_APPS_SEARXNG_URL`) and Crawl4AI (`SEED_APPS_CRAWLER_URL` and `SEED_APPS_CRAWLER_TOKEN`); see [web research backends](./web-research-backends.md). Without SearXNG, a `web_search` call fails with an error that says it is not configured. Remove `web_search` from an agent's tools if you do not run SearXNG. <!-- id:pTXkE4RK -->
  - **Subscription sign-in.** Off by default. `SEED_APPS_SUBSCRIPTION_AUTH=true` turns on "Sign in with ChatGPT". See [model providers](../agent/model-providers.md). <!-- id:q6somAIy -->
  - **Accounts.** The server serves many accounts and knows them by signature. It trusts any request signed by the [account](../protocol/identity.md) itself, or by a key that account authorized. There is no list of allowed accounts. So a server that people can reach runs the agents of any account that signs a request. Do not count on the address staying secret. If this matters, limit who can reach the server at the network level. <!-- id:7AAQLXv1 -->
  - **Updates.** Run `docker pull` when you choose, or run Watchtower to pull new images for you (see [deploying](./deploying.md)). `/api/version` tells you what a running server was built from. <!-- id:LRGZT4Im -->
  - **Secrets.** Provider API keys and sign-in credentials are not part of the server's environment. Each account stores its own through the signed API, and the database keeps them encrypted. See [security](../agent/security.md).

# See also

- [Environments](./environments.md), the other four setups
- [Configuration](./configuration.md), every setting
- [Code execution backend](./code-execution-backend.md) and [web research backends](./web-research-backends.md)
- [Endpoints and health](./endpoints-and-health.md), to check the server once it is up
- [Self-hosting](./self-hosting.md), running a site, which can include an app environment
- [Seed API](../build/web-api.md), the API the HM server URL must speak
