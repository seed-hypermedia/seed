# Environments

The agents server runs in five distinct environments. Same binary logic, very different surroundings: what spawns it,
what it binds, which HM server it reads and writes through, whether code execution and web tools exist, and how it gets
updated. This document describes each one and the configuration that makes it work. The full env-var reference lives in
`operations.md`; this is about which of those knobs each environment turns and why.

A quick orientation table:

|                    | 1 · dev (`./dev up`)              | 2 · CI-built desktop apps    | 3 · `./dev build-desktop`    | 4 · production remote          | 5 · self-hosted remote    |
| ------------------ | --------------------------------- | ---------------------------- | ---------------------------- | ------------------------------ | ------------------------- |
| Process            | `bun --hot` under a watcher       | compiled binary, app-spawned | compiled binary, app-spawned | Docker container               | Docker container          |
| Port               | `3051` (from `.env.vars`)         | `3050` (app default)         | `3050` (app default)         | `3050` behind Caddy `443`      | operator's choice         |
| HM API / IPFS      | bridge `:58004` / daemon `:58001` | app bridge / app daemon      | app bridge / app daemon      | `https://hyper.media` (both)   | operator's endpoint(s)    |
| Code exec          | host microVMs (msb)               | embedded msb runtime         | embedded msb runtime         | `/dev/kvm` plumbed, see gap    | needs KVM + runtime       |
| web_search/crawler | Docker compose backends           | none (unless configured)     | none (unless configured)     | compose-internal SearXNG/Crawl | optional compose backends |
| Updates            | file-watch restart                | app release cycle            | rebuild                      | Watchtower auto-pull           | operator pulls            |

## 1. Dev mode — `./dev up`

The developer stack. mprocs runs one pane per process; the agents pane is `cd agents && bun run dev`, which wraps
`bun --hot src/main.ts` in `scripts/watch-file-deps.ts` (the watcher re-runs `bun install` and restarts the server when
a `file:` dependency like `agents/protocol` changes — during heavy protocol editing it flaps, killing in-flight runs).

Configuration comes from direnv (`.env.vars`), which is the layer that makes dev different from the built-in defaults:

- `SEED_AGENTS_HTTP_PORT=3051` — dev deliberately does NOT use the default `3050`, so a stale packaged binary (which the
  desktop app spawns on its own default) cannot shadow the dev server. If `localhost:3051` ever answers with
  `Unsupported action: ListRuns`-class errors, something else claimed the port — check
  `lsof -nP -iTCP:3051 -sTCP:LISTEN`.
- `SEED_AGENTS_HM_SERVER_URL="$DESKTOP_API_HTTP_URL"` (`http://localhost:58004`) — typed Seed requests such as
  `ListEvents`, `Resource`, and `PublishBlobs` go through the desktop's DAG-CBOR `/api/*` bridge. The raw daemon port is
  a gRPC-web endpoint and rejects this transport (`405` for query GETs, `415` for CBOR actions).
- `SEED_AGENTS_IPFS_SERVER_URL="$DAEMON_HTTP_URL"` (`http://localhost:58001`) — direct `/ipfs/<cid>` gateway reads go to
  the daemon, because the desktop API bridge intentionally serves only `/api/*`. File publication does **not** use
  `/ipfs/file-upload`: the service chunks bytes into UnixFS blocks and sends them through `PublishBlobs` on the typed
  API. Together these endpoints reach the same **local desktop node**, not the public gateway. Content published in the
  dev app is what dev agents see.
- `VITE_DESKTOP_DEFAULT_AGENTS_URL=http://localhost:3051` — how the dev desktop app finds this server (it attaches
  instead of spawning its own binary; see the resolution order in environment 2).
- `SEED_AGENTS_SUBSCRIPTION_AUTH=true` and the web-tool URLs are set by the `dev` script itself:
  `SEED_AGENTS_SEARXNG_URL=http://127.0.0.1:8899`, `SEED_AGENTS_CRAWLER_URL=http://127.0.0.1:11235`.

**Docker is available here**, and the `backends` mprocs pane runs it: SearXNG and Crawl4AI from
`agents/dev/web-backends/docker-compose.yml`, inline (their logs stream into the pane; they stop when mprocs quits).
That is what turns on `web_search` and browser-render escalation in dev.

**Code execution does not use Docker.** The microsandbox runtime (`msb`, libkrun) runs hardware-isolated microVMs
directly on the host — macOS Hypervisor.framework in dev. The `microsandbox` npm package under `agents/node_modules`
carries the runtime; sandbox rootfs images (`python`, `oven/bun` for the `ts` runtime) are pulled by msb itself on first
use into `~/.microsandbox/`. Two sharp edges: every msb copy on the machine shares that one state directory, and a newer
msb migrating its database silently locks out every older copy (`database schema is newer than this msb binary`) — keep
the dependency pinned exactly; and the sandbox image pull makes the first execution slow.

Data lives in `agents/data/` (`agents.sqlite` + per-agent state dirs), gitignored, persistent across restarts.

## 2. Local agents server inside CI-built desktop apps

The desktop app ships its own agents server. In CI (`dev-desktop.yml` for dev builds, `release-desktop.yml` for
releases), each platform runner executes:

```
cd agents
bun install --frozen-lockfile
bun scripts/build-binary.ts --target=<llvm-triple> --smoke
```

`build-binary.ts` produces a `bun build --compile` single-file binary in `plz-out/bin/agents/`, which `forge.config.ts`
picks up as an extraResource — and fails loudly in CI when missing, so a desktop build cannot silently ship without its
agents server. `--smoke` boots the compiled binary and hits `/agents/api/health`, so a binary that compiles but cannot
start fails in CI instead of on user machines.

The `microsandbox` package cannot live inside the compiled bundle (napi binding, `msb` helper, libkrunfw), so the build
stages it into a `node_modules/` directory **next to the executable**; at runtime the server points
`MSB_PATH`/`MSB_LIBKRUNFW_PATH` at that staged copy. On macOS the msb binary must be signed with the
`com.apple.security.hypervisor` entitlement (handled per-binary via `osxSign.binaries` in `forge.config.ts`) or every
sandbox create fails; on Windows, execution needs the Windows Hypervisor Platform feature, and the desktop UI answers
the execute toggle with setup instructions when it is off.

At runtime the app resolves its agents server in this order (`agents-server-process.ts`):

1. `SEED_NO_AGENTS_SPAWN` set → never spawn; the app only talks to configured remote servers.
2. `SEED_AGENTS_SERVER_URL` set → attach to that URL (with retry), spawn nothing.
3. A healthy server already answering on the default port → attach to it (this is how the dev app uses env 1).
4. Otherwise spawn the bundled binary with explicit `--hm-server-url=${API_HTTP_URL}` and
   `--ipfs-server-url=${DAEMON_HTTP_URL}` flags. The first is the app's typed `/api/*` bridge; the second serves direct
   `/ipfs/*` gateway reads. Both front the **app's own local daemon**, so the embedded server reads and writes through
   the same node the user sees rather than a public gateway.

Differences from dev to keep in mind: **no Docker exists here**, so there is no SearXNG/Crawl4AI — `web_search` is
unavailable unless the user configures a remote backend; there is no watcher (updates ride the app release cycle); and
data lives in the app's userData directory, not the repo.

## 3. Local desktop builds — `./dev build-desktop`

The same packaging path as CI, run locally: the `dev` script executes `cd agents && bun install && bun run build:binary`
before invoking forge, precisely because forge only copies whatever is already staged in `plz-out/bin/agents/` —
skipping the step silently packages a stale binary. Everything in environment 2 applies (embedded binary, staged msb
runtime, entitlements, no Docker, daemon-backed HM URL), plus two local-only gotchas:

- The renderer build needs a large JS heap (`NODE_OPTIONS=--max-old-space-size=8192`-class); `desktop:make` has been
  observed to exit 0 even on a fatal OOM, so verify the artifact exists before trusting the exit code.
- A locally built app spawns its binary on the **default port 3050** — but attaches to anything healthy it finds first,
  so a running `./dev up` stack (port 3051 via `VITE_DESKTOP_DEFAULT_AGENTS_URL`) wins in the dev app, and a stale
  previously-installed app's binary can hold a port the new build then attaches to. When in doubt, `/api/health` reports
  the running server's version.

## 4. Production remote — `agentic.seed.hyper.media`

An Ubuntu 24.04 VM (OVH/OpenStack, Terraform Cloud workspace `SHM-Agentic` in the SeedInfra repo, `seed_infra/agentic`).
Terraform provisions a bare Docker host; the actual service definition is the compose file it writes to
`/opt/agentic/docker-compose.yml`. The stack:

- **Caddy** (`caddy:2`) terminates TLS on 80/443 and reverse-proxies two hostnames to two containers:
  `agentic.seed.hyper.media` → `agents-stable` (image `seedhypermedia/agents:latest`), and
  `dev.agentic.seed.hyper.media` → `agents-dev` (image `seedhypermedia/agents:dev`), each on internal port `3050`.
- **agents-stable / agents-dev** run with:
  - `SEED_AGENTS_HM_SERVER_URL` → `https://hyper.media` (stable) / `https://dev.hyper.media` (dev). Those origins serve
    both typed `/api/*` and direct `/ipfs/*`, so `SEED_AGENTS_IPFS_SERVER_URL` defaults to the same value. Unlike every
    local environment, production reads and writes through the public gateway — there is no co-located daemon.
  - `devices: /dev/kvm:/dev/kvm` — hardware virtualization for the execute microVMs. Without the device the service runs
    but every execution fails 502. (This requires an OVH flavor that exposes KVM.)
  - Named volumes: `agents-*-data:/data` (the sqlite DB + agent state; `SEED_AGENTS_DB_PATH=/data/agents.sqlite` and
    `SEED_AGENTS_DATA_DIR=/data` are baked into the image) and `agents-*-msb:/root/.microsandbox` (the sandbox image
    cache, persisted so the first execution after each redeploy does not re-pull rootfs images).
  - `SEED_AGENTS_SEARXNG_URL=http://searxng:8080`, `SEED_AGENTS_CRAWLER_URL=http://crawl4ai:11235` — compose-internal
    backends.
- **SearXNG** (json format enabled, limiter off — safe only because it is never published outside the compose network)
  and **Crawl4AI** (version-pinned; 0.9.0 changed auth defaults, so it must not float to `:latest`; needs shared memory
  for Chromium) serve the web tools, internal-only.
- **Watchtower** (label-enabled, short poll interval) auto-pulls both agents images: pushing
  `seedhypermedia/agents:latest` or `:dev` deploys within minutes. Images are pushed by the three GitHub workflows
  described in `operations.md` (release tags → `:latest`, main pushes touching `agents/**` → `:dev`, plus a manual
  hotfix path), or manually via `agents/scripts/build-and-push.sh`. Make sure the Watchtower container itself carries
  `restart: unless-stopped` — a crashed auto-updater silently stops all deploys.

Secrets (provider API keys, OAuth credentials) are **not** in the compose environment: they are per-account rows in the
database, written through the signed `SetSecret` API and encrypted at rest. Subscription OAuth
(`SEED_AGENTS_SUBSCRIPTION_AUTH`) is an explicit opt-in flag wherever it is wanted.

**Known gap — code execution inside the image.** `agents/Dockerfile` bundles the server with `bun run build` and its
final stage copies only `package.json` and `dist/` — no `node_modules`. The microsandbox runtime cannot be bundled
(native binding + `msb` + libkrunfw) and is not currently staged into the image, so the SDK's staged-runtime fallback
finds nothing: the `/dev/kvm` plumbing and msb cache volumes are ready, but executions in the container fail until the
image stages the runtime the way `build-binary.ts` does for desktop. Tracked in `roadmap.md` ("TypeScript execution in
deployed images" — in truth all runtimes, in Docker).

## 5. Self-hosted remote agents servers

Anyone can run the image. The minimal viable server:

```bash
docker run -d --restart unless-stopped \
  -p 3050:3050 \
  -v seed-agents-data:/data \
  -e SEED_AGENTS_HM_SERVER_URL=https://your-site.example \
  seedhypermedia/agents:latest
```

What an operator must decide, in rough order of importance:

- **HM API URL.** `SEED_AGENTS_HM_SERVER_URL` must point at an HTTP Seed API that accepts the typed DAG-CBOR `/api/*`
  protocol used by `createSeedClient` — your site, a desktop-style API bridge, or the public gateway. A raw daemon
  gRPC-web port is not interchangeable with this endpoint.
- **IPFS URL.** By default direct `/ipfs/*` gateway reads use the HM API origin. If the gateway lives elsewhere — as it
  does locally, where the daemon owns it — set `SEED_AGENTS_IPFS_SERVER_URL` to that origin. File publication still
  chunks UnixFS blocks and sends them through `PublishBlobs` on the HM API. A self-hosted raw daemon can therefore be
  the gateway, but needs a compatible Seed HTTP API/bridge for `SEED_AGENTS_HM_SERVER_URL`.
- **TLS + hostname.** Put a reverse proxy (Caddy, nginx) in front; the desktop and web apps connect over HTTPS and the
  signed-envelope API assumes an authentic transport. CORS is already permissive server-side.
- **Code execution.** Requires KVM (`--device /dev/kvm`) on a host whose virtualization is exposed, AND the microsandbox
  runtime staged into the container (see the environment-4 gap — until the image stages it, exec in Docker needs a
  custom image or `SEED_AGENTS_EXEC_BACKEND=off` to advertise honestly). Persist `/root/.microsandbox` if you enable it.
  Set `SEED_AGENTS_EXEC_TS_IMAGE=` (empty) to withhold TypeScript, or leave the `oven/bun` default.
- **Web tools.** Optional SearXNG (`SEED_AGENTS_SEARXNG_URL`) and Crawl4AI (`SEED_AGENTS_CRAWLER_URL` +
  `SEED_AGENTS_CRAWLER_TOKEN`) containers, internal-only, exactly as production wires them. Without SearXNG the
  `web_search` callable is simply not offered to agents.
- **Subscription OAuth.** Off by default; `SEED_AGENTS_SUBSCRIPTION_AUTH=true` enables "Sign in with ChatGPT".
- **Accounts.** The server is multi-account by signature: it trusts any envelope whose signer IS the account (or an
  authorized signer). There is no allowlist today — a reachable server accepts any self-signed account's agents, so do
  not assume obscurity; if that matters, gate reachability at the network layer.
- **Updates.** `docker pull` on your schedule, or run Watchtower as production does. `/api/version` tells you what a
  running server was built from.
