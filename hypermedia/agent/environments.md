---
name: Environments
summary: The five kinds of environment the agents server runs in, from local development to hosted and self-hosted remotes, and the configuration each one turns on.
---
A [Seed Agents](../agent.md) server runs in five kinds of environment. The hosted remote is one kind, running as three deployments: production, staging, and dev. The binary logic is the same everywhere. The surroundings differ: what spawns it, what it binds, which HM server it reads and writes through, whether code execution and web tools exist, and how it gets updated. This page describes each environment and the configuration that makes it work. The full env-var reference is in [operations](./operations.md). This page covers which of those settings each environment uses, and why. <!-- id:qqHzmE1k -->

A quick orientation table: <!-- id:13MIJU72 -->

<!-- id:sgr1VOVF -->
| <!-- col:xXXyuwDZ --> | 1 · dev (`./dev up`) <!-- col:MUgpL-N7 --> | 2 · CI-built desktop apps <!-- col:FrVBIVND --> | 3 · `./dev build-desktop` <!-- col:gWkGhzsg --> | 4 · hosted remotes <!-- col:lnpTZf-q --> | 5 · self-hosted remote <!-- col:VQqw7q2w --> <!-- id:ePNSBgYW --> |
| --- | --- | --- | --- | --- | --- |
| Process | `bun --hot` under a watcher | compiled binary, app-spawned | compiled binary, app-spawned | Docker container | Docker container <!-- id:JpoB0wf7 --> |
| Port | `3051` (from `.env.vars`) | `3050` (app default) | `3050` (app default) | `3050` behind Caddy `443` | operator's choice <!-- id:LmOfwzRx --> |
| HM API / IPFS | bridge `:58004` / daemon `:58001` | app bridge / app daemon | app bridge / app daemon | `hyper.media` or `dev.` (both) | operator's endpoint(s) <!-- id:t9YSJmfK --> |
| Code exec | host microVMs (msb) | embedded msb runtime | embedded msb runtime | staged msb + `/dev/kvm` | needs KVM <!-- id:kDAHkpSn --> |
| web_search/crawler_ | Docker compose backends | none (unless configured) | none (unless configured) | compose-internal SearXNG/Crawl | optional compose backends <!-- id:BbVZFhT6 --> |
| Updates | file-watch restart | app release cycle | rebuild | Watchtower auto-pull | operator pulls <!-- id:KT44zgxN --> |

# 1. Dev mode: `./dev up` <!-- id:sFkTQxjN -->

The developer stack. mprocs runs one pane per process. The agents pane is `cd agents && bun run dev`, which wraps `bun --hot src/main.ts` in `scripts/watch-file-deps.ts`. The watcher re-runs `bun install` and restarts the server when a `file:` dependency like `agents/protocol` changes. During heavy protocol editing it flaps and kills in-flight runs. See [development](./development.md). <!-- id:Xn93wACK -->

Configuration comes from direnv (`.env.vars`). That layer is what makes dev different from the built-in defaults: <!-- id:ppx-D0aQ -->
  - `SEED_AGENTS_HTTP_PORT=3051`: dev does NOT use the default `3050`, on purpose, so a stale packaged binary (which the desktop app spawns on its own default) cannot shadow the dev server. If `localhost:3051` ever answers with `Unsupported action: ListRuns`-class errors, something else claimed the port. Check `lsof -nP -iTCP:3051 -sTCP:LISTEN`. <!-- id:VvPX6Qkl -->
  - `SEED_AGENTS_HM_SERVER_URL="$DESKTOP_API_HTTP_URL"` (`http://localhost:58004`): typed Seed requests such as `ListEvents`, `Resource`, and `PublishBlobs` go through the desktop's DAG-CBOR `/api/*` bridge ([Seed API](../build/web-api.md)). The raw [daemon](../apps/daemon.md) port is a [gRPC-web](../build/grpc.md) endpoint and rejects this transport (`405` for query GETs, `415` for CBOR actions). <!-- id:qN0lD1bl -->
  - `SEED_AGENTS_IPFS_SERVER_URL="$DAEMON_HTTP_URL"` (`http://localhost:58001`): direct `/ipfs/<cid>` gateway reads go to the daemon, because the desktop API bridge serves only `/api/*`. File publication does **not** use `/ipfs/file-upload`. The service chunks bytes into [UnixFS](../protocol/files.md) blocks and sends them through `PublishBlobs` on the typed API. Together these endpoints reach the same **local desktop node**, and never the public gateway. Content published in the dev app is what dev agents see. <!-- id:EdXCmGti -->
  - `VITE_DESKTOP_DEFAULT_AGENTS_URL=http://localhost:3051`: how the dev desktop app finds this server. It attaches and does not spawn its own binary. See the resolution order in environment 2. <!-- id:qk6SrIpe -->
  - `SEED_AGENTS_SUBSCRIPTION_AUTH=true` and the web-tool URLs are set by the `dev` script itself: `SEED_AGENTS_SEARXNG_URL=http://127.0.0.1:8899`, `SEED_AGENTS_CRAWLER_URL=http://127.0.0.1:11235`. <!-- id:GxBS7_xM -->

**Docker is available here**, and the `backends` mprocs pane runs it: SearXNG and Crawl4AI from `agents/dev/web-backends/docker-compose.yml`, inline. Their logs stream into the pane, and they stop when mprocs quits. That turns on `web_search` and browser-render escalation in dev. <!-- id:W2puy6Vu -->

**Code execution does not use Docker.** The microsandbox runtime (`msb`, libkrun) runs hardware-isolated microVMs directly on the host, with macOS Hypervisor.framework in dev. The `microsandbox` npm package under `agents/node_modules` carries the runtime. msb pulls sandbox rootfs images (`python`, and `oven/bun` for the `ts` runtime) itself on first use, into `~/.microsandbox/`. There are two sharp edges. First, every msb copy on the machine shares that one state directory, and a newer msb that migrates its database silently locks out every older copy (`database schema is newer than this msb binary`), so keep the dependency pinned exactly. Second, the sandbox image pull makes the first execution slow. <!-- id:JhyoO_4y -->

Data lives in `agents/data/` (`agents.sqlite` + per-agent state dirs). It is gitignored and persists across restarts. See [persistence](./persistence.md). <!-- id:j4Xpyvza -->

# 2. Local agents server inside CI-built desktop apps <!-- id:lFxXR6eC -->

The [desktop app](../apps/desktop.md) ships its own agents server. In CI (`dev-desktop.yml` for dev builds, `release-desktop.yml` for releases), each platform runner executes: <!-- id:TUxRjJC6 -->

``` <!-- id:6Bv9VqW- -->
cd agents
bun install --frozen-lockfile
bun scripts/build-binary.ts --target=<llvm-triple> --smoke
```

`build-binary.ts` produces a `bun build --compile` single-file binary in `plz-out/bin/agents/`. `forge.config.ts` picks it up as an extraResource and fails loudly in CI when it is missing, so a desktop build cannot silently ship without its agents server. `--smoke` boots the compiled binary and hits `/agents/api/health`, so a binary that compiles but cannot start fails in CI and never reaches user machines. <!-- id:rbNv_dwm -->

The `microsandbox` package cannot live inside the compiled bundle (napi binding, `msb` helper, libkrunfw). The build stages it into a `node_modules/` directory **next to the executable**, and at runtime the server points `MSB_PATH` and `MSB_LIBKRUNFW_PATH` at that staged copy. On macOS the msb binary must be signed with the `com.apple.security.hypervisor` entitlement (handled per-binary via `osxSign.binaries` in `forge.config.ts`), or every sandbox create fails. On Windows, execution needs the Windows Hypervisor Platform feature, and the desktop UI answers the execute toggle with setup instructions when it is off. <!-- id:T2Bsll-v -->

At runtime the app resolves its agents server in this order (`agents-server-process.ts`): <!-- id:O7cFdv9h -->
  1. `SEED_NO_AGENTS_SPAWN` set: never spawn. The app only talks to configured remote servers. <!-- id:FHzcCAGI -->
  2. `SEED_AGENTS_SERVER_URL` set: attach to that URL (with retry) and spawn nothing. <!-- id:7leliLB5 -->
  3. A healthy server already answering on the default port: attach to it. This is how the dev app uses env 1. <!-- id:sS4eNf-p -->
  4. Otherwise, spawn the bundled binary with explicit `--hm-server-url=${API_HTTP_URL}` and `--ipfs-server-url=${DAEMON_HTTP_URL}` flags. The first is the app's typed `/api/*` bridge. The second serves direct `/ipfs/*` gateway reads. Both front the **app's own local daemon**, so the embedded server reads and writes through the same node the user sees, and never through a public gateway. <!-- id:2mVdpAqI -->

Differences from dev: **no Docker exists here**, so there is no SearXNG or Crawl4AI, and `web_search` is unavailable unless the user configures a remote backend. There is no watcher, because updates come with the app release cycle. Data lives in the app's userData directory, outside the repo. <!-- id:XAKdEOuV -->

# 3. Local desktop builds: `./dev build-desktop` <!-- id:Q_3JaDnK -->

This is the CI packaging path, run locally. The `dev` script executes `cd agents && bun install && bun run build:binary` before invoking forge, because forge only copies whatever is already staged in `plz-out/bin/agents/`. Skipping the step silently packages a stale binary. Everything in environment 2 applies (embedded binary, staged msb runtime, entitlements, no Docker, daemon-backed HM URL), plus two local-only gotchas: <!-- id:EzIxz9Sv -->
  - The renderer build needs a large JS heap (`NODE_OPTIONS=--max-old-space-size=8192`-class). `desktop:make` has been seen to exit 0 even on a fatal OOM, so check that the artifact exists before trusting the exit code. <!-- id:6qF07oSy -->
  - A locally built app spawns its binary on the **default port 3050**, but attaches to anything healthy it finds first. A running `./dev up` stack (port 3051 via `VITE_DESKTOP_DEFAULT_AGENTS_URL`) wins in the dev app, and a stale previously-installed app's binary can hold a port the new build then attaches to. When in doubt, `/api/health` reports the running server's version. <!-- id:KvHiV9ar -->

# 4. Hosted remotes: production, staging, and dev <!-- id:4984BLo_ -->

One Ubuntu 24.04 VM runs all three hosted agents servers. It is on OVH/OpenStack, managed by the Terraform Cloud workspace `SHM-Agentic` in the SeedInfra repo (`seed_infra/agentic`). Terraform provisions a bare Docker host. The service definition is the compose file it writes to `/opt/agentic/docker-compose.yml`. <!-- id:i-Dhbvn7 -->

The three deployments differ in exactly two ways: which image tag they track, and which HM network they read. <!-- id:ORaW2HNY -->

<!-- id:kkpozSX- -->
| Hostname <!-- col:sXrNq-0H --> | Container <!-- col:1FEmsSXu --> | Image tag <!-- col:d1bQOJd8 --> | Code <!-- col:kG1ioF-3 --> | Data <!-- col:ty-3yWjB --> <!-- id:-S4MK1Hh --> |
| --- | --- | --- | --- | --- |
| `agentic.seed.hyper.media` | `agents-stable` | `:latest` | newest release | mainnet <!-- id:EKhrmFMc --> |
| `staging.agentic.seed.hyper.media` | `agents-staging` | `:dev` | `main` | mainnet, via `staging.hyper.media` <!-- id:hEF6ChWm --> |
| `dev.agentic.seed.hyper.media` | `agents-dev` | `:dev` | `main` | devnet <!-- id:c63XBVSE --> |

Staging is the release gate. It runs the _same code_ as dev against _production data_, so you can validate behavior on real mainnet content before a release tag promotes that code to `agents-stable`. Dev keeps devnet data, which is where you want to be while a change may still write nonsense. <!-- id:pDjXSwim -->

Each container has its own `agents-*-data` volume, and that separation matters. The activity monitor only polls for accounts that have enabled [triggers](./triggers.md) **in its own database**, so three servers pointed at the same feed stay quiet about each other's agents. If you copied prod's DB into staging, both would fire on the same mainnet mention and answer twice. <!-- id:7jt-i-la -->

The stack: <!-- id:S14BIIBT -->
  - **Caddy** (`caddy:2`) terminates TLS on 80/443 and reverse-proxies each hostname above to its container on internal port `3050`. <!-- id:kfTXHdMc -->
  - **agents-stable / agents-staging / agents-dev** run with: <!-- id:Uh2MD0Rd -->
    - `SEED_AGENTS_HM_SERVER_URL` set to `https://hyper.media` (stable), `https://staging.hyper.media` (staging), or `https://dev.hyper.media` (dev). Staging reads through the staging web [gateway](../protocol/sites.md): a mainnet node that also holds the staging site's own documents, which the `hyper.media` gateway may not have synced yet. Those origins serve both typed `/api/*` and direct `/ipfs/*`, so `SEED_AGENTS_IPFS_SERVER_URL` defaults to the same value. Unlike every local environment, the hosted servers read and write through the public gateway. There is no co-located daemon. <!-- id:rPt5XsXl -->
    - `devices: /dev/kvm:/dev/kvm`: hardware virtualization for the execute microVMs. Without the device the service runs, but every execution fails 502. This needs an OVH flavor that exposes KVM. <!-- id:YVs7Li3g -->
    - Named volumes: `agents-*-data:/data` (the sqlite DB + agent state; `SEED_AGENTS_DB_PATH=/data/agents.sqlite` and `SEED_AGENTS_DATA_DIR=/data` are baked into the image) and `agents-*-msb:/root/.microsandbox` (the sandbox image cache, persisted so the first execution after each redeploy does not re-pull rootfs images). <!-- id:TkZJsI2X -->
    - `SEED_AGENTS_SEARXNG_URL=http://searxng:8080`, `SEED_AGENTS_CRAWLER_URL=http://crawl4ai:11235`: compose-internal backends. <!-- id:WbR7Jqh_ -->
  - **SearXNG** (json format enabled, limiter off, which is safe only because it is never published outside the compose network) and **Crawl4AI** (version-pinned, because 0.9.0 changed auth defaults, so it must not float to `:latest`; needs shared memory for Chromium) serve the web tools, internal-only. <!-- id:ru0yEILm -->
  - **Watchtower** (label-enabled, short poll interval) auto-pulls the agents images. Pushing `seedhypermedia/agents:latest` deploys to `agents-stable`, and pushing `:dev` deploys to **both** `agents-staging` and `agents-dev`, within minutes. The three GitHub workflows described in [operations](./operations.md) push the images (release tags to `:latest`, main pushes touching `agents/**` to `:dev`, plus a manual hotfix path), or you push manually via `agents/scripts/build-and-push.sh`. Make sure the Watchtower container itself has `restart: unless-stopped`. A crashed auto-updater silently stops all deploys, and so does a _stopped_ one: `docker stop` on a container with that policy stays stopped across reboots. That is how the host once went four days without a deploy. <!-- id:F96Vwha9 -->

    Watchtower reads `com.centurylinklabs.watchtower.enable` from the **running container**, and ignores the compose file, so editing that label only takes effect after `docker compose up -d <service>` recreates the container. <!-- id:053hqR9T -->

Secrets (provider API keys, OAuth credentials) are **not** in the compose environment. They are per-account rows in the database, written through the signed `SetSecret` API and encrypted at rest. See [security](./security.md). Subscription OAuth (`SEED_AGENTS_SUBSCRIPTION_AUTH`) is an explicit opt-in flag wherever it is wanted. <!-- id:QlY7z673 -->

**Code execution inside the image.** The microsandbox runtime cannot be bundled (native binding + `msb` + libkrunfw). So `microsandbox` is `external` in the server bundle (`build.ts`), and the Dockerfile stages the package, plus its linux platform package, into `/app/node_modules` next to `main.js` (`scripts/stage-msb-runtime.ts`). This is the same layout `build-binary.ts` ships beside the desktop binary. The image build runs `--exec-selfcheck`, so a staging regression fails the build and never shows up as `codeExec: false` on the servers. With `/dev/kvm` plumbed and the msb cache volumes mounted, executions run in-container. `/api/health` reports the probe result either way. <!-- id:LLspUN31 -->

# 5. Self-hosted remote agents servers <!-- id:MwgU5uAJ -->

Anyone can run the image. The minimal server: <!-- id:GiuKlBIH -->

```bash <!-- id:y3vgeIe0 -->
docker run -d --restart unless-stopped \
  -p 3050:3050 \
  -v seed-agents-data:/data \
  -e SEED_AGENTS_HM_SERVER_URL=https://your-site.example \
  seedhypermedia/agents:latest
```

What an operator must decide, roughly in order of importance. [Self-hosting](../build/self-hosting.md) covers running the rest of Seed. <!-- id:yljIcZLv -->
  - **HM API URL.** `SEED_AGENTS_HM_SERVER_URL` must point at an HTTP [Seed API](../build/web-api.md) that accepts the typed DAG-CBOR `/api/*` protocol used by `createSeedClient`: your [site](../protocol/sites.md), a desktop-style API bridge, or the public gateway. A raw daemon gRPC-web port does not work as this endpoint. <!-- id:52sJmwjp -->
  - **IPFS URL.** By default, direct `/ipfs/*` gateway reads use the HM API origin. If the gateway lives elsewhere, as it does locally where the daemon owns it, set `SEED_AGENTS_IPFS_SERVER_URL` to that origin. File publication still chunks UnixFS blocks and sends them through `PublishBlobs` on the HM API. So a self-hosted raw daemon can be the gateway, but `SEED_AGENTS_HM_SERVER_URL` still needs a compatible Seed HTTP API or bridge. <!-- id:kUmtvyqv -->
  - **TLS and hostname.** Put a reverse proxy (Caddy, nginx) in front. The desktop and web apps connect over HTTPS, and the signed-envelope API assumes an authentic transport. CORS is already permissive server-side. <!-- id:vOaBc75h -->
  - **Code execution.** Needs KVM (`--device /dev/kvm`) on a host whose virtualization is exposed. The image ships the microsandbox runtime staged in `/app/node_modules`, so no custom image is needed. Without KVM the server still runs and `/api/health` reports `codeExec: false` (`kvm-missing`). Or set `SEED_AGENTS_EXEC_BACKEND=off` to advertise honestly. Persist `/root/.microsandbox` if you enable it. Set `SEED_AGENTS_EXEC_TS_IMAGE=` (empty) to withhold TypeScript, or leave the `oven/bun` default. <!-- id:K-cuGQ_3 -->
  - **Web tools.** Optional SearXNG (`SEED_AGENTS_SEARXNG_URL`) and Crawl4AI (`SEED_AGENTS_CRAWLER_URL` + `SEED_AGENTS_CRAWLER_TOKEN`) containers, internal-only, exactly as production wires them. Without SearXNG, agents are not offered the `web_search` callable. <!-- id:pTXkE4RK -->
  - **Subscription OAuth.** Off by default. `SEED_AGENTS_SUBSCRIPTION_AUTH=true` enables "Sign in with ChatGPT". See [model providers](./model-providers.md). <!-- id:q6somAIy -->
  - **Accounts.** The server is multi-account by signature. It trusts any envelope whose signer IS the [account](../protocol/identity.md), or an authorized signer. There is no allowlist today. A reachable server accepts any self-signed account's agents, so do not rely on obscurity. If that matters, gate reachability at the network layer. <!-- id:7AAQLXv1 -->
  - **Updates.** `docker pull` on your schedule, or run Watchtower as production does. `/api/version` tells you what a running server was built from. <!-- id:LRGZT4Im -->

# Which agents server a client connects to <!-- id:xUjvcvQu -->

Clients (desktop, web, the web gateway) can talk to any number of agents servers at once, and the agents UI groups agents by server. The list a client uses is the union of three sources, in this order. Order matters, because the assistant panel's default agent context is the first agent of the first server: <!-- id:dOTNHY0y -->
  1. **The app's own local server**: desktop only (`getLocalServerUrl` on the platform seam). A client connects to it. A space never advertises it, since only the computer running it can reach it. <!-- id:MXogIsaE -->
  2. **The server advertised by the space on screen**: the `agentServerUrl` field in the space's [home document](../protocol/documents.md) [metadata](../metadata.md) (`HMDocumentMetadataSchema`, set on the Agents tab of desktop's Space Settings). While any document of that space is open, its server joins the list, ahead of the user's own servers and labeled "This site" in the panel's agent picker. It leaves the list when the user navigates elsewhere, and it is never written into the user's configured list. This lets the gateway, which shows many [sites](../protocol/sites.md), use a different agents backend per site. Where the app is itself served by a space (the web app and the gateway), that space also applies on pages that name no document, so `/hm/agents` is still "in" the space hosting it. <!-- id:WFCTSK67 -->
  3. **The user's configured servers**: persisted per client (`agent-server-urls` setting: electron-store on desktop, `localStorage` under `seed.agents.setting.` on web). On first run this list is seeded with the deployment default. For the web server that is `SEED_AGENT_SERVER_URL`, read on the server and injected into `window.ENV` for the client (for example `https://agentic.seed.hyper.media` in production and `https://dev.agentic.seed.hyper.media` on dev deployments). Desktop's default lives in `frontend/apps/desktop/src/agents-defaults.ts`. Once the user has edited the list, even to empty, the default is no longer re-added. <!-- id:CI-i5FLy -->

The agents server itself needs no per-client configuration for this. It answers signed requests from any origin (`Access-Control-Allow-Origin: *`) and identifies callers by their signed account, never by where the page was served. <!-- id:PeNlJuN5 -->

## Which agents a reader of a space sees <!-- id:hdQPP4g3 -->

A server alone does not reach a reader. `ListAgents` returns only agents the caller owns or accepted an invitation to, so a visitor asking a space's server for a list gets an empty one. So a space names its agents too, in `spaceAgents` on the home document: `{[agentId]: order}`. It is written from the same Space Settings tab, where both the server and the agent are picked from dropdowns (the servers this app talks to, then that server's public agents), with no typing. Given an id, the server resolves the owning account itself and answers `GetAgent` for any signed account once the agent is public-read. Clients fetch each published agent by id and put them at the head of the assistant panel's picker, where the first one becomes the default context. Because the default is the first published agent, someone arriving at a space can open the panel and start chatting without configuring anything, as long as the agent has public chat enabled (`SetAgentPublicChat`, offered per agent on that same settings tab). See the [signed API](./signed-api.md) for both flags. <!-- id:VGFbVTln -->

A space that names no agents server offers no agents at all. The web account menu leaves out the agents entry while browsing it, since opening the panel there would only show an empty picker. <!-- id:e1DIAUej -->

Public read is a precondition. Publishing does not arrange it. Only an already-public agent can be published, because opening an agent to the world is a decision made on the agent (`SetAgentPublicRead`), and listing it on a space must not do that as a side effect. The order has exactly one meaning: the first published agent is the default. So the settings tab offers a "make default" button and no way to arrange the list. <!-- id:O5aYBUZI -->

Only ids and order live in the document. An agent's name, icon, and status are read from the agent itself, so renaming one never strands a stale copy in a signed document. Document metadata attributes have no array encoding, so the ordered list is a map to positions. <!-- id:JMmRzk56 -->

# See also <!-- id:3S26P38- -->

- [Operations](./operations.md) <!-- id:FxRtwkH5 -->
- [Desktop and web UI](./desktop-ui.md) <!-- id:YHB2GhlS -->
- [Development](./development.md) <!-- id:mxqWnHIb -->
- [Model providers](./model-providers.md) <!-- id:Ji11frcK -->
- [Self-hosting](../build/self-hosting.md) <!-- id:SSwXndlB -->
- [Sites](../protocol/sites.md) <!-- id:-SxSweG5 -->
- [Agents service](../apps/agents.md) <!-- id:7A-dIiqm -->
