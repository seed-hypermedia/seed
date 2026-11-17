---
name: Environments
summary: The five kinds of environment the app environment runs in, from local development to hosted and self-hosted remotes, and the configuration each one turns on.
---
An [app environment](../software/app-environment.md), the server behind [Seed Agents](../agent.md), runs in five kinds of environment. The hosted remote is one kind, running as three deployments: production, staging, and dev. The binary logic is the same everywhere. The surroundings differ: what spawns it, what it binds, which HM server it reads and writes through, whether code execution and web tools exist, and how it gets updated. This page describes each environment and the configuration that makes it work. The full reference of settings is in [configuration](./configuration.md). This page covers which of those settings each environment uses, and why. Self-hosted remotes, the fifth kind, have their own page: [self-hosting an app environment](./self-hosted-app-environment.md). <!-- id:qqHzmE1k -->

A quick orientation table: <!-- id:13MIJU72 -->

<!-- id:sgr1VOVF -->
| <!-- col:xXXyuwDZ --> | 1 · dev (`./dev up`) <!-- col:MUgpL-N7 --> | 2 · CI-built desktop apps <!-- col:FrVBIVND --> | 3 · `./dev build-desktop` <!-- col:gWkGhzsg --> | 4 · hosted remotes <!-- col:lnpTZf-q --> | 5 · self-hosted remote <!-- col:VQqw7q2w --> <!-- id:ePNSBgYW --> |
| --- | --- | --- | --- | --- | --- |
| Process | `bun --watch` under a watcher | compiled binary, app-spawned | compiled binary, app-spawned | Docker container | Docker container <!-- id:JpoB0wf7 --> |
| Port | `3051` (from `.env.vars`) | `3050` (app default) | `3050` (app default) | `3050` behind Caddy `443` | operator's choice <!-- id:LmOfwzRx --> |
| HM API / IPFS | bridge `:58004` / daemon `:58001` | app bridge / app daemon | app bridge / app daemon | `hyper.media` or `dev.` (both) | operator's endpoint(s) <!-- id:t9YSJmfK --> |
| Code exec | host microVMs (msb) | embedded msb runtime | embedded msb runtime | staged msb + `/dev/kvm` | needs KVM <!-- id:kDAHkpSn --> |
| `web_search` and crawler | Docker compose backends | none (unless configured) | none (unless configured) | SearXNG and Crawl4AI on a private host | optional compose backends <!-- id:BbVZFhT6 --> |
| Updates | file-watch restart | app release cycle | rebuild | Watchtower auto-pull | operator pulls <!-- id:KT44zgxN --> |

# 1. Dev mode: `./dev up` <!-- id:sFkTQxjN -->

The developer stack. mprocs runs one pane per process. The agents pane is `cd apps && bun run dev`, which wraps `bun --watch src/main.ts` in the repo-root `scripts/watch-file-deps.ts` (invoked as `bun ../scripts/watch-file-deps.ts`). The watcher re-runs `bun install` and restarts the server when a `file:` dependency like `apps/protocol` changes. During heavy protocol editing it flaps and kills in-flight runs. See [development](../contribute/development.md). <!-- id:Xn93wACK -->

Configuration comes from direnv (`.env.vars`). That layer is what makes dev different from the built-in defaults: <!-- id:ppx-D0aQ -->
  - `SEED_APPS_HTTP_PORT=3051`: dev does NOT use the default `3050`, on purpose, so a stale packaged binary (which the desktop app spawns on its own default) cannot shadow the dev server. If something else claimed the port, `lsof -nP -iTCP:3051 -sTCP:LISTEN` names it. <!-- id:VvPX6Qkl -->
  - `SEED_APPS_HM_SERVER_URL="$DESKTOP_API_HTTP_URL"` (`http://localhost:58004`): typed Seed requests such as `ListEvents`, `Resource`, and `PublishBlobs` go through the desktop's DAG-CBOR `/api/*` bridge ([Seed API](../build/web-api.md)). The raw [daemon](../software/daemon.md) port is a [gRPC-web](../build/grpc.md) endpoint and rejects this transport (`405` for query GETs, `415` for CBOR actions). <!-- id:qN0lD1bl -->
  - `SEED_APPS_IPFS_SERVER_URL="$DAEMON_HTTP_URL"` (`http://localhost:58001`): direct `/ipfs/<cid>` gateway reads go to the daemon, because the desktop API bridge serves only `/api/*`. File publication does **not** use `/ipfs/file-upload`. The service chunks bytes into [UnixFS](../protocol/files.md) blocks and sends them through `PublishBlobs` on the typed API. Together these endpoints reach the same **local desktop node**, and never the public gateway. Content published in the dev app is what dev agents see. <!-- id:EdXCmGti -->
  - `SEED_APPS_DOCS_ACCOUNT_FILE="$WORKSPACE/hypermedia/.dev/account"`: the `hm-sync` pane writes its dev key's account to this file, and the server resolves `hm://hyper.media` to it. Dev agents read the knowledge base, and the default [Agent Guide](../agent/guide.md), straight from your working copy of `hypermedia/`. They are told the knowledge base is that account, and the links they write to it name that account, so a link in a dev agent's reply opens your dev site and not the published docs. Until `hm-sync` has run once, those reads fail. <!-- id:v8hCXS77 -->
  - `SEED_APPS_DEFAULT_PROMPT_URL`: the Agent Guide document new agents embed as their system prompt. <!-- id:CX3-4JMU -->
  - `VITE_DESKTOP_DEFAULT_APPS_URL=http://localhost:3051`: how the dev desktop app finds this server. It attaches and does not spawn its own binary. See the resolution order in environment 2. <!-- id:qk6SrIpe -->
  - `SEED_APPS_SUBSCRIPTION_AUTH=true` and the web-tool URLs are set by the `dev` script itself: `SEED_APPS_SEARXNG_URL=http://127.0.0.1:8899`, `SEED_APPS_CRAWLER_URL=http://127.0.0.1:11235`. <!-- id:GxBS7_xM -->

**Docker is available here**, and the `backends` mprocs pane runs it: SearXNG and Crawl4AI from `apps/dev/web-backends/docker-compose.yml`, inline. Their logs stream into the pane, and they stop when mprocs quits. That turns on `web_search` and browser-render escalation in dev. <!-- id:W2puy6Vu -->

**Code execution does not use Docker.** The microsandbox runtime (`msb`, libkrun) runs hardware-isolated microVMs directly on the host, with macOS Hypervisor.framework in dev. The `microsandbox` npm package under `apps/node_modules` carries the runtime. msb pulls sandbox rootfs images (`python`, and `oven/bun` for the `ts` runtime) itself on first use, into `~/.microsandbox/`. The image pull makes the first execution slow. Every msb copy on the machine shares that one state directory; the [code execution backend](./code-execution-backend.md) page says why that matters. <!-- id:JhyoO_4y -->

Data lives in `apps/data/` (`agents.sqlite` + per-agent state dirs). It is gitignored and persists across restarts. See [persistence](./persistence.md). <!-- id:j4Xpyvza -->

# 2. Local app environment inside CI-built desktop apps <!-- id:lFxXR6eC -->

The [desktop app](../software/desktop.md) ships its own app environment. In CI (`dev-desktop.yml` for dev builds, `release-desktop.yml` for releases), each platform runner executes: <!-- id:TUxRjJC6 -->

``` <!-- id:6Bv9VqW- -->
cd apps
bun install --frozen-lockfile
bun scripts/build-binary.ts --target=<llvm-triple> --smoke
```

`build-binary.ts` produces a `bun build --compile` single-file binary in `plz-out/bin/apps/`. `forge.config.ts` picks it up as an extraResource and fails loudly in CI when it is missing, so a desktop build cannot silently ship without its app environment. `--smoke` boots the compiled binary and hits `/agents/api/health`, so a binary that compiles but cannot start fails in CI and never reaches user machines. <!-- id:rbNv_dwm -->

The `microsandbox` package cannot live inside the compiled bundle (napi binding, `msb` helper, libkrunfw). The build stages it into a `node_modules/` directory **next to the executable**, and at runtime the server points `MSB_PATH` and `MSB_LIBKRUNFW_PATH` at that staged copy. On macOS the msb binary must be signed with the `com.apple.security.hypervisor` entitlement (handled per-binary via `osxSign.binaries` in `forge.config.ts`), or every sandbox create fails. On Windows, execution needs the Windows Hypervisor Platform feature, and the desktop UI answers the execute toggle with setup instructions when it is off. <!-- id:T2Bsll-v -->

At runtime the app resolves its app environment in this order (`agents-server-process.ts`): <!-- id:O7cFdv9h -->
  1. `SEED_NO_APPS_SPAWN` set (or the earlier `SEED_NO_AGENTS_SPAWN`): never spawn. The app only talks to configured remote servers. <!-- id:FHzcCAGI -->
  2. `SEED_APPS_SERVER_URL` set (or the earlier `SEED_AGENTS_SERVER_URL`): attach to that URL (with retry) and spawn nothing. <!-- id:7leliLB5 -->
  3. A healthy server already answering on the default port: attach to it. This is how the dev app uses env 1. <!-- id:sS4eNf-p -->
  4. Otherwise, if the `agentsLocalServer` setting allows it (on, or unset with a database left by an earlier build; see the [desktop UI](../agent/in-the-app.md) page), spawn the bundled binary on the first free port from the default, with explicit `--hm-server-url=${API_HTTP_URL}` and `--ipfs-server-url=${DAEMON_HTTP_URL}` flags. The first is the app's typed `/api/*` bridge. The second serves direct `/ipfs/*` gateway reads. Both front the **app's own local daemon**, so the embedded server reads and writes through the same node the user sees, and never through a public gateway. <!-- id:2mVdpAqI -->

Differences from dev: **no Docker exists here**, so there is no SearXNG or Crawl4AI, and `web_search` is unavailable unless the user configures a remote backend. There is no watcher, because updates come with the app release cycle. Data lives in the app's userData directory, outside the repo. <!-- id:XAKdEOuV -->

# 3. Local desktop builds: `./dev build-desktop` <!-- id:Q_3JaDnK -->

This is the CI packaging path, run locally. The `dev` script executes `cd apps && bun install && bun run build:binary` before invoking forge, because forge only copies whatever is already staged in `plz-out/bin/apps/`. Skipping the step silently packages a stale binary. Everything in environment 2 applies (embedded binary, staged msb runtime, entitlements, no Docker, daemon-backed HM URL), plus two local-only gotchas: <!-- id:EzIxz9Sv -->
  - The renderer build needs a large JS heap (`NODE_OPTIONS=--max-old-space-size=8192`-class). `desktop:make` can exit 0 even on a fatal OOM, so check that the artifact exists before trusting the exit code. <!-- id:6qF07oSy -->
  - A locally built app spawns its binary on the **default port 3050**, but attaches to anything healthy it finds first. A running `./dev up` stack (port 3051 via `VITE_DESKTOP_DEFAULT_APPS_URL`) wins in the dev app, and a stale previously-installed app's binary can hold a port the new build then attaches to. When in doubt, `/api/health` reports the running server's version. <!-- id:KvHiV9ar -->

# 4. Hosted remotes: production, staging, and dev <!-- id:4984BLo_ -->

Three Ubuntu VMs on OVH/OpenStack run the hosted app environments: `sae-prod` runs production alone, `sae-dev` runs staging and dev, and `sae-services` runs the web research backends for all three on a private network. They are managed by the Terraform Cloud workspace `SHM-Agentic` in the infrastructure repository (`mintterteam/infrastructure` on GitHub, usually checked out as `SeedInfra`; stack `seed_infra/agentic`). Terraform provisions bare Docker hosts. The service definition is the compose file it writes to `/opt/sae/docker-compose.yml` on each. <!-- id:i-Dhbvn7 -->

The three deployments differ in exactly two ways: which image tag they track, and which HM network they read. <!-- id:ORaW2HNY -->

<!-- id:kkpozSX- -->
| Hostname <!-- col:sXrNq-0H --> | Container <!-- col:1FEmsSXu --> | Image tag <!-- col:d1bQOJd8 --> | Code <!-- col:kG1ioF-3 --> | Data <!-- col:ty-3yWjB --> <!-- id:-S4MK1Hh --> |
| --- | --- | --- | --- | --- |
| `apps.seed.hyper.media` (on `sae-prod`) | `agents-stable` | `:latest` | newest release | mainnet <!-- id:EKhrmFMc --> |
| `staging.apps.seed.hyper.media` (on `sae-dev`) | `agents-staging` | `:dev` | `main` | mainnet, via `staging.hyper.media` <!-- id:hEF6ChWm --> |
| `dev.apps.seed.hyper.media` (on `sae-dev`) | `agents-dev` | `:dev` | `main` | devnet <!-- id:c63XBVSE --> |

Clients do not use these host names: each environment is reached on its gateway's own origin, `https://hyper.media/hm/api/apps`, `https://staging.hyper.media/hm/api/apps` and `https://dev.hyper.media/hm/api/apps`, which proxy to the host. The former `*.agentic.seed.hyper.media` names resolve to the same hosts for clients that saved them.

Staging is the release gate. It runs the _same code_ as dev against _production data_, so you can validate behavior on real mainnet content before a release tag promotes that code to `agents-stable`. Dev keeps devnet data, which is where you want to be while a change may still write nonsense. <!-- id:pDjXSwim -->

Each container has its own `agents-*-data` volume, and that separation matters. The activity monitor only polls for accounts that have enabled [triggers](../agent/triggers.md) **in its own database**, so three servers pointed at the same feed stay quiet about each other's agents. If you copied prod's DB into staging, both would fire on the same mainnet mention and answer twice. <!-- id:7jt-i-la -->

The stack: <!-- id:S14BIIBT -->
  - **Caddy** (`caddy:2`) on each host terminates TLS on 80/443 and reverse-proxies each hostname above to its container on internal port `3050`. <!-- id:kfTXHdMc -->
  - **agents-stable / agents-staging / agents-dev** run with: <!-- id:Uh2MD0Rd -->
    - `SEED_APPS_HM_SERVER_URL` set to `https://hyper.media` (stable), `https://staging.hyper.media` (staging), or `https://dev.hyper.media` (dev). Staging reads through the staging web [gateway](../protocol/sites.md): a mainnet node that also holds the staging site's own documents, which the `hyper.media` gateway may not have synced yet. Those origins serve both typed `/api/*` and direct `/ipfs/*`, so `SEED_APPS_IPFS_SERVER_URL` defaults to the same value. Unlike every local environment, the hosted servers read and write through the public gateway. There is no co-located daemon. <!-- id:rPt5XsXl -->
    - `SEED_APPS_PUBLIC_URL` set to the gateway that fronts it: `https://hyper.media/hm/api/apps` (stable), `https://staging.hyper.media/hm/api/apps` (staging), `https://dev.hyper.media/hm/api/apps` (dev). The gateways proxy `/hm/api/apps` and `/hm/api/agents` on their own origin, `*.hyper.media` subdomains included, to this host, so clients use one host for the web API and the app environment.
    - `SEED_APPS_DEFAULT_PROMPT_URL` naming the [Agent Guide](../agent/guide.md) new agents embed. Production uses the default, the guide on hyper.media; staging names the staging copy. <!-- id:Iw2z0_jA -->
    - `SEED_APPS_DOCS_ACCOUNT` set to the account of the published knowledge base, so `hm://hyper.media` reads resolve. The repo never names that account. It lives in the deployment config. <!-- id:jKOI2Ogq -->
    - `devices: /dev/kvm:/dev/kvm`: hardware virtualization for the execute microVMs. Without the device the service runs, but every execution fails 502. This needs an OVH flavor that exposes KVM. <!-- id:YVs7Li3g -->
    - Named volumes: `agents-*-data:/data` (the sqlite DB + agent state; `SEED_APPS_DB_PATH=/data/agents.sqlite` and `SEED_APPS_DATA_DIR=/data` are baked into the image) and `agents-*-msb:/root/.microsandbox` (the sandbox image cache, persisted so the first execution after each redeploy does not re-pull rootfs images). <!-- id:TkZJsI2X -->
    - `SEED_APPS_SEARXNG_URL` and `SEED_APPS_CRAWLER_URL` pointing at the backends on `sae-services`, over the private network.
    - `SEED_APPS_EXEC_WARM_POOL=1` and `SEED_APPS_EXEC_CANARY_SECS=300` on production and staging. <!-- id:WbR7Jqh_ -->
  - **SearXNG** and **Crawl4AI** serve the web tools from `sae-services`, reachable on the private network only. [Web research backends](./web-research-backends.md) has their settings. <!-- id:ru0yEILm -->
  - **Watchtower** (label-enabled, short poll interval) auto-pulls the images. Pushing `seedhypermedia/agents:latest` deploys to `agents-stable`, and pushing `:dev` deploys to **both** `agents-staging` and `agents-dev`, within minutes. [Deploying](./deploying.md) covers the workflows that push the images and the Watchtower rules. <!-- id:F96Vwha9 -->

Secrets (provider API keys, OAuth credentials) are **not** in the compose environment. They are per-account rows in the database, written through the signed `SetSecret` API and encrypted at rest. See [security](../agent/security.md). Subscription OAuth (`SEED_APPS_SUBSCRIPTION_AUTH`) is an explicit opt-in flag wherever it is wanted. <!-- id:QlY7z673 -->

**Code execution inside the image.** The image carries the microsandbox runtime staged next to the server bundle, and its build proves that the runtime loads. With `/dev/kvm` plumbed and the msb cache volumes mounted, executions run in-container. [Deploying](./deploying.md#the-image) describes the image, and the [code execution backend](./code-execution-backend.md) the host side.

# 5. Self-hosted remote app environments <!-- id:MwgU5uAJ -->

Anyone can run the image. [Self-hosting an app environment](./self-hosted-app-environment.md) gives the minimal server and the decisions an operator makes, and [self-hosting](./self-hosting.md) covers running the rest of Seed.

# How a client finds an environment's agents

None of these environments is configured per client. A [space](../protocol/spaces.md)'s agents are found through its mount documents, and each mount document names the server its agent runs on. [Mounting](../agent/mounting.md) explains how clients find a space's agents and which agents a reader sees.

# See also <!-- id:3S26P38- -->

- [Operations](./operations.md) <!-- id:FxRtwkH5 -->
- [Configuration](./configuration.md)
- [Deploying](./deploying.md)
- [Self-hosting an app environment](./self-hosted-app-environment.md)
- [Mounting](../agent/mounting.md)
- [Agents in the Seed app](../agent/in-the-app.md) <!-- id:YHB2GhlS -->
- [Development](../contribute/development.md) <!-- id:mxqWnHIb -->
- [Model providers](../agent/model-providers.md) <!-- id:Ji11frcK -->
- [Self-hosting](./self-hosting.md) <!-- id:SSwXndlB -->
- [Sites](../protocol/sites.md) <!-- id:-SxSweG5 -->
- [App environment](../software/app-environment.md) <!-- id:7A-dIiqm -->
