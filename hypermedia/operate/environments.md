---
name: Environments
summary: This page describes the five setups the app environment runs in, from the developer stack to the servers Seed hosts and a server you host yourself, and the settings each one uses.
---
The [app environment](../software/app-environment.md), the server behind [Seed Agents](../agent.md), is the same program everywhere. What changes is what starts it, which port it uses, which site it reads and writes through, whether it can run code and search the web, and how it is updated. <!-- id:qqHzmE1k -->

There are five setups: the dev stack, the desktop app built by CI, the desktop app built on your machine, the servers Seed hosts, and a server you host yourself. The servers Seed hosts are three deployments: production, staging and dev.

The first thing to check, in any setup: `/api/health` on the running server shows its version, the HM server it uses, and whether code execution and web tools are on.

This page says which settings each setup uses, and why. [Configuration](./configuration.md) is the full list of settings. A server you host yourself has its own page: [self-hosting an app environment](./self-hosted-app-environment.md).

The five setups side by side: <!-- id:13MIJU72 -->

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

This is the developer stack. mprocs runs one pane for each process. The agents pane runs `cd apps && bun run dev`. That command runs `bun --watch src/main.ts` under a watcher, `scripts/watch-file-deps.ts` at the root of the repository (called as `bun ../scripts/watch-file-deps.ts`). <!-- id:Xn93wACK -->

The watcher runs `bun install` again and restarts the server when a `file:` dependency such as `apps/protocol` changes. While you edit the protocol a lot, the server restarts often, and each restart stops the runs in progress. See [development](../contribute/development.md).

The settings come from direnv (`.env.vars`). They are what makes dev differ from the built-in defaults: <!-- id:ppx-D0aQ -->
  - `SEED_APPS_HTTP_PORT=3051`: dev does not use the default `3050`, on purpose. The desktop app starts its packaged binary on `3050`, so an old packaged binary cannot answer in place of the dev server. If something else holds the port, `lsof -nP -iTCP:3051 -sTCP:LISTEN` names it. <!-- id:VvPX6Qkl -->
  - `SEED_APPS_HM_SERVER_URL="$DESKTOP_API_HTTP_URL"` (`http://localhost:58004`): requests such as `ListEvents`, `Resource` and `PublishBlobs` go to the desktop app's `/api/*` bridge, which speaks [DAG-CBOR](../schema/dag-cbor.md) ([Seed API](../build/web-api.md)). The [daemon](../software/daemon.md)'s own port speaks [gRPC-web](../build/grpc.md) and refuses these requests: `405` for query GETs, `415` for CBOR actions. <!-- id:qN0lD1bl -->
  - `SEED_APPS_IPFS_SERVER_URL="$DAEMON_HTTP_URL"` (`http://localhost:58001`): file reads from `/ipfs/<cid>` go to the daemon, because the desktop bridge serves only `/api/*`. Publishing a file does **not** use `/ipfs/file-upload`. The server cuts the bytes into [UnixFS](../protocol/files.md) pieces and sends them with `PublishBlobs` to the HM API. Both addresses reach the same **local desktop node**, never the public gateway. So dev agents see what you publish in the dev app. <!-- id:EdXCmGti -->
  - `SEED_APPS_DOCS_ACCOUNT_FILE="$WORKSPACE/hypermedia/.dev/account"`: the `hm-sync` pane writes the [account](../protocol/identity.md) of its dev key to this file, and the server reads `hm://hyper.media` as that account. So dev agents read the knowledge base, and the default [Agent Guide](../agent/guide.md), from your working copy of `hypermedia/`. The links they write name that account too, so a link in a dev agent's reply opens your dev site, not the published docs. Until `hm-sync` has run once, those reads fail. <!-- id:v8hCXS77 -->
  - `SEED_APPS_DEFAULT_PROMPT_URL`: the Agent Guide [document](../protocol/documents.md) that new agents embed as their system prompt. <!-- id:CX3-4JMU -->
  - `VITE_DESKTOP_DEFAULT_APPS_URL=http://localhost:3051`: how the dev desktop app finds this server. It connects to it and does not start its own binary. See the order in setup 2. <!-- id:qk6SrIpe -->
  - The `dev` script in `apps/package.json` sets the rest: `SEED_APPS_SUBSCRIPTION_AUTH=true`, `SEED_APPS_SEARXNG_URL=http://127.0.0.1:8899`, `SEED_APPS_CRAWLER_URL=http://127.0.0.1:11235` and `SEED_APPS_CRAWLER_TOKEN=dev-crawl-token`. <!-- id:GxBS7_xM -->

**Docker is available here.** The `backends` pane of mprocs runs SearXNG and Crawl4AI from `apps/dev/web-backends/docker-compose.yml`. Their logs show in the pane, and they stop when mprocs quits. With them, `web_search` works in dev, and web reads can fall back to a browser. <!-- id:W2puy6Vu -->

**Code execution does not use Docker.** The microsandbox runtime (`msb`, libkrun) runs microVMs directly on the host. In dev on a Mac it uses Hypervisor.framework. The `microsandbox` npm package under `apps/node_modules` carries the runtime. On first use, msb downloads the sandbox images (`python`, and `oven/bun` for the `ts` runtime) into `~/.microsandbox/`, so the first execution is slow. Every copy of msb on the machine shares that one directory; the [code execution backend](./code-execution-backend.md) page says why that matters. <!-- id:JhyoO_4y -->

Data lives in `apps/data/`: `agents.sqlite` and one state directory per agent. Git ignores it, and it stays across restarts. See [persistence](./persistence.md). <!-- id:j4Xpyvza -->

# 2. Local app environment inside CI-built desktop apps <!-- id:lFxXR6eC -->

The [desktop app](../software/desktop.md) ships its own app environment. In CI (`dev-desktop.yml` for dev builds, `release-desktop.yml` for releases), each platform runner executes: <!-- id:TUxRjJC6 -->

``` <!-- id:6Bv9VqW- -->
cd apps
bun install --frozen-lockfile
bun scripts/build-binary.ts --target=<llvm-triple> --smoke
```

`build-binary.ts` makes one binary file with `bun build --compile`, in `plz-out/bin/apps/`. Two checks keep a broken app environment away from people's machines: <!-- id:rbNv_dwm -->

- `forge.config.ts` packs the binary as an extraResource and fails the CI build when it is missing. So a desktop build cannot ship without its app environment.
- `--smoke` starts the compiled binary and calls `/agents/api/health`. So a binary that compiles but cannot start fails in CI.

The `microsandbox` package cannot go inside the compiled binary, because it has a native binding, the `msb` helper and libkrunfw. The build puts it in a `node_modules/` directory **next to the executable**. When the server runs, it points `MSB_PATH` and `MSB_LIBKRUNFW_PATH` at that copy. <!-- id:T2Bsll-v -->

- On macOS the msb binary must be signed with the `com.apple.security.hypervisor` entitlement, or every sandbox fails to start. `osxSign.binaries` in `forge.config.ts` does this for each binary.
- On Windows, execution needs the Windows Hypervisor Platform feature. When it is off, the desktop app answers the execute switch with setup instructions.

When the app runs, it finds its app environment in this order (`agents-server-process.ts`): <!-- id:O7cFdv9h -->
  1. `SEED_NO_APPS_SPAWN` is set (or the older `SEED_NO_AGENTS_SPAWN`): the app never starts a server. It talks only to the remote servers it is configured with. <!-- id:FHzcCAGI -->
  2. `SEED_APPS_SERVER_URL` is set (or the older `SEED_AGENTS_SERVER_URL`): the app connects to that URL, trying again if needed, and starts nothing. <!-- id:7leliLB5 -->
  3. A healthy server already answers on the default port: the app connects to it. This is how the dev app uses setup 1. <!-- id:sS4eNf-p -->
  4. Otherwise, if the `agentsLocalServer` setting allows it, the app starts the bundled binary on the first free port, counting up from the default. The setting allows it when it is on, or when it is unset and an earlier build left a database; see the [desktop UI](../agent/in-the-app.md) page. The app passes `--hm-server-url=${API_HTTP_URL}` and `--ipfs-server-url=${DAEMON_HTTP_URL}`. The first is the app's `/api/*` bridge, and the second serves file reads from `/ipfs/*`. Both lead to the **app's own local daemon**. So the server inside the app reads and writes through the same node the person sees, never through a public gateway. <!-- id:2mVdpAqI -->

How this differs from dev: <!-- id:XAKdEOuV -->

- **There is no Docker**, so there is no SearXNG and no Crawl4AI. A `web_search` call fails unless the person configures a remote backend.
- There is no watcher. Updates come with new releases of the app.
- Data lives in the app's userData directory, outside the repository.

# 3. Local desktop builds: `./dev build-desktop` <!-- id:Q_3JaDnK -->

This is the same packaging that CI does, run on your machine. The repository's `./dev` script runs `cd apps && bun install && bun run build:binary` before it calls forge. Forge only copies what is already in `plz-out/bin/apps/`, so without that step it would pack an old binary and say nothing. <!-- id:EzIxz9Sv -->

Everything in setup 2 applies here: the binary inside the app, the msb runtime beside it, the entitlements, no Docker, and an HM URL that leads to the app's daemon. Two more things can go wrong on your machine:
  - The renderer build needs a large JavaScript heap, about `NODE_OPTIONS=--max-old-space-size=8192`. `desktop:make` can exit with 0 even when it ran out of memory. So check that the built app exists; do not trust the exit code. <!-- id:6qF07oSy -->
  - An app you built starts its binary on the **default port 3050**, but first it connects to any healthy server it finds. A running `./dev up` stack (port 3051, through `VITE_DESKTOP_DEFAULT_APPS_URL`) wins in the dev app. The binary of an older installed app can hold a port, and the new build then connects to it. When in doubt, `/api/health` reports the version of the server that answers. <!-- id:KvHiV9ar -->

# 4. Hosted remotes: production, staging, and dev <!-- id:4984BLo_ -->

This section describes the servers Seed hosts. Their setup lives in another repository, so this repository cannot confirm it, and it can change.

Three Ubuntu virtual machines on OVH/OpenStack run the hosted app environments: <!-- id:i-Dhbvn7 -->

- `sae-prod` runs production alone.
- `sae-dev` runs staging and dev.
- `sae-services` runs the web research backends for all three, on a private network.

The Terraform Cloud workspace `SHM-Agentic` manages them. It is in the infrastructure repository (`mintterteam/infrastructure` on GitHub, usually checked out as `SeedInfra`; stack `seed_infra/agentic`). Terraform sets up plain Docker hosts. What runs on each is defined by the compose file Terraform writes to `/opt/sae/docker-compose.yml`.

The three deployments differ in exactly two ways: which image tag they follow, and which HM network they read. <!-- id:ORaW2HNY -->

<!-- id:kkpozSX- -->
| Hostname <!-- col:sXrNq-0H --> | Container <!-- col:1FEmsSXu --> | Image tag <!-- col:d1bQOJd8 --> | Code <!-- col:kG1ioF-3 --> | Data <!-- col:ty-3yWjB --> <!-- id:-S4MK1Hh --> |
| --- | --- | --- | --- | --- |
| `apps.seed.hyper.media` (on `sae-prod`) | `agents-stable` | `:latest` | newest release | mainnet <!-- id:EKhrmFMc --> |
| `staging.apps.seed.hyper.media` (on `sae-dev`) | `agents-staging` | `:dev` | `main` | mainnet, via `staging.hyper.media` <!-- id:hEF6ChWm --> |
| `dev.apps.seed.hyper.media` (on `sae-dev`) | `agents-dev` | `:dev` | `main` | devnet <!-- id:c63XBVSE --> |

Clients do not use these host names. They reach each deployment on the origin of its gateway: `https://hyper.media/hm/api/apps`, `https://staging.hyper.media/hm/api/apps` and `https://dev.hyper.media/hm/api/apps`. Those origins pass the requests on to the host. The older `*.agentic.seed.hyper.media` names lead to the same hosts, for clients that saved them.

Staging is the last check before a release. It runs the _same code_ as dev on _production data_. So you can test a change on real mainnet content before a release tag moves that code to `agents-stable`. Dev keeps devnet data, which is the right place while a change may still write wrong data. <!-- id:pDjXSwim -->

Each container has its own `agents-*-data` volume, and this matters. The activity monitor polls only for accounts that have enabled [triggers](../trigger.md) **in its own database**. So three servers that read the same feed do not react to each other's agents. If you copied the production database into staging, both would fire on the same mention and answer twice. <!-- id:7jt-i-la -->

The stack: <!-- id:S14BIIBT -->
  - **Caddy** (`caddy:2`) on each host handles TLS on ports 80 and 443, and passes each hostname above to its container on internal port `3050`. <!-- id:kfTXHdMc -->
  - **agents-stable / agents-staging / agents-dev** run with: <!-- id:Uh2MD0Rd -->
    - `SEED_APPS_HM_SERVER_URL` set to `https://hyper.media` (stable), `https://staging.hyper.media` (staging), or `https://dev.hyper.media` (dev). Staging reads through the staging web [gateway](../protocol/sites.md). That is a mainnet node that also holds the staging site's own documents, which the `hyper.media` gateway may not have received. These origins serve both `/api/*` and `/ipfs/*`, so `SEED_APPS_IPFS_SERVER_URL` keeps its default, the same value. Every local setup has a daemon beside the server. The hosted servers have none: they read and write through the public gateway. <!-- id:rPt5XsXl -->
    - `SEED_APPS_PUBLIC_URL` set to the gateway in front of it: `https://hyper.media/hm/api/apps` (stable), `https://staging.hyper.media/hm/api/apps` (staging), `https://dev.hyper.media/hm/api/apps` (dev). The gateways pass `/hm/api/apps` and `/hm/api/agents` on their own origin, and on `*.hyper.media` subdomains, to this host. So clients use one host for the Seed API and the app environment.
    - `SEED_APPS_DEFAULT_PROMPT_URL` naming the [Agent Guide](../agent/guide.md) new agents embed. Production uses the default, the guide on hyper.media; staging names the staging copy. <!-- id:Iw2z0_jA -->
    - `SEED_APPS_DOCS_ACCOUNT` set to the account of the published knowledge base, so reads of `hm://hyper.media` find it. The hosted servers set it in their deployment config. The self-hosting compose files default it to the production knowledge base account. <!-- id:jKOI2Ogq -->
    - `devices: /dev/kvm:/dev/kvm`: hardware virtualization for the `execute` microVMs. Without the device the service still runs. Health reports `codeExec: false` with the code `kvm-missing`, and agents are not offered `execute`. The host must be an OVH type that exposes KVM. <!-- id:YVs7Li3g -->
    - Named volumes: `agents-*-data:/data` holds the SQLite database and the agents' state (the image sets `SEED_APPS_DB_PATH=/data/agents.sqlite` and `SEED_APPS_DATA_DIR=/data`). `agents-*-msb:/root/.microsandbox` holds the sandbox images, so the first execution after a redeploy does not download them again. <!-- id:TkZJsI2X -->
    - `SEED_APPS_SEARXNG_URL` and `SEED_APPS_CRAWLER_URL` pointing at the backends on `sae-services`, over the private network.
    - `SEED_APPS_EXEC_WARM_POOL=1` and `SEED_APPS_EXEC_CANARY_SECS=300` on production and staging. <!-- id:WbR7Jqh_ -->
  - **SearXNG** and **Crawl4AI** serve the web tools from `sae-services`, reachable on the private network only. [Web research backends](./web-research-backends.md) has their settings. <!-- id:ru0yEILm -->
  - **Watchtower** pulls new images by itself. It acts on containers that carry its label, and it checks often. A push of `seedhypermedia/agents:latest` reaches `agents-stable`, and a push of `:dev` reaches **both** `agents-staging` and `agents-dev`, within minutes. [Deploying](./deploying.md) covers the workflows that push the images and the Watchtower rules. <!-- id:F96Vwha9 -->

Secrets, such as provider API keys and sign-in credentials, are **not** in the compose environment. Each account has its own rows in the database, written through the signed `SetSecret` action and stored encrypted. See [security](../agent/security.md). Subscription sign-in (`SEED_APPS_SUBSCRIPTION_AUTH`) is off unless a deployment turns it on. <!-- id:QlY7z673 -->

**Code execution inside the image.** The image carries the microsandbox runtime next to the server code, and the image build proves that the runtime loads. With `/dev/kvm` passed in and the msb volumes mounted, code runs inside the container. [Deploying](./deploying.md#the-image) describes the image, and the [code execution backend](./code-execution-backend.md) the host side.

# 5. Self-hosted remote app environments <!-- id:MwgU5uAJ -->

You can run the image on your own server. [Self-hosting an app environment](./self-hosted-app-environment.md) gives the smallest command that works and the decisions you make. [Self-hosting](./self-hosting.md) covers running the rest of Seed.

# How a client finds an environment's agents

You do not configure a client for any of these setups. A client finds the agents of a [space](../protocol/spaces.md) through the space's mount documents, and each mount document names the server its agent runs on. [Mounting](../agent/mounting.md) explains how clients find a space's agents and which agents a reader sees.

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
