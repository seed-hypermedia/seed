---
name: Operations
summary: This document explains how to run, inspect, and troubleshoot the Agents service.
---
This document explains how to run, inspect, and troubleshoot the Agents service. <!-- id:nR-WGkJx -->

# Runtime/package boundary <!-- id:unUpYzoN -->

`agents/` is a Bun workspace. Use Bun commands inside it. <!-- id:hnrbpymM -->

From repo root: <!-- id:cvH06CGz -->

```bash <!-- id:QPisRTbW -->
direnv exec . bash -lc 'cd agents && bun install'
direnv exec . bash -lc 'cd agents && bun src/main.ts'
```

Validation: <!-- id:AamjsE1v -->

```bash <!-- id:rosEGSrU -->
direnv exec . bash -lc 'cd agents && bun check && bun test'
direnv exec . bash -lc 'cd agents && bun run test:build'
direnv exec . bash -lc 'cd agents && bun run test:docker'
direnv exec . bash -lc 'cd agents && bun run test:trigger'
```

`test:trigger` boots the real daemon against a local stand-in for hyper.media's `/api/ListEvents`, creates an agent + user-mention trigger over the signed API, and asserts a comment-mention fires exactly one session (guards the comment/citation sibling race; see `agent-triggers-plan.md`). <!-- id:PN41rCE- -->

Desktop: <!-- id:nzMipXzR -->

```bash <!-- id:fQC0BA0- -->
direnv exec . bash -lc './dev run-desktop'
```

Build the deployment image from the repo root: <!-- id:UjHaLIjM -->

```bash <!-- id:-i1uRyfu -->
docker build -t seedhypermedia/agents:dev . -f ./agents/Dockerfile
```

Run the image with persistent state mounted at `/data`: <!-- id:sY0rShW2 -->

```bash <!-- id:jq6Wn7cW -->
docker run --rm -p 3050:3050 -v seed-agents-data:/data seedhypermedia/agents:dev
```

# Versioning, build, and deploy <!-- id:cVmqN7IW -->

The image records what it was built from and exposes it at runtime. `/api/version` (and `/agents/api/version`) returns: <!-- id:KRJqFMwI -->

```json <!-- id:7QqXMmsN -->
{"version": "2026.6.10", "commit": "<sha>", "branch": "<ref>", "date": "<date>"}
```

The `commit`/`branch`/`date` fields mirror the daemon `/debug/version` and web `/hm/api/version` shape; `version` (the image tag) is an agents-specific addition. `/api/health` also includes the `version` field for quick checks. To see what a host is running: <!-- id:YpXAAaEN -->

```bash <!-- id:T46AIml8 -->
curl -s https://agentic.seed.hyper.media/agents/api/version
```

The values come from `agents/src/build-info.ts`, populated by Docker build args (`VERSION`, `COMMIT_HASH`, `BRANCH`, `DATE` — the same `COMMIT_HASH`/`BRANCH`/`DATE` names used by the web and daemon images) that `agents/Dockerfile` maps to namespaced `SEED_AGENTS_*` runtime `ENV`. Without build args (e.g. local `bun dev` or a plain `docker build`) they fall back to `dev`/`unknown`. <!-- id:3EKhBIqX -->

## CI build + push <!-- id:TT-1OVn2 -->

`agents/Dockerfile` is built and pushed by three GitHub Actions workflows, all of which also accept a manual `workflow_dispatch` run from the Actions tab: <!-- id:9ag8Sj9F -->
  - `.github/workflows/release-docker-images.yml` — on a `*.*.*` release tag push (or manual dispatch), pushes `seedhypermedia/agents:<tag>`. The resolved tag is the version (`latest` for a manual run with no tag); `agents-stable` on the host tracks `:latest`. <!-- id:dqZxrWX0 -->
  - `.github/workflows/dev-docker-images.yml` — on push to `main` touching `agents/**` (or manual dispatch), pushes `seedhypermedia/agents:dev`, which **both** `agents-staging` and `agents-dev` track. Note the consequence: while this workflow is red on `main`, `:dev` stops moving, and staging silently keeps validating an older commit than the one you are about to release. `/api/version` on staging is the check that catches it. <!-- id:-c40zu4a -->
  - `.github/workflows/hotfix-agents-image.yml` — manual dispatch only, from `main` only. Runs the agents test gate and pushes ONLY `seedhypermedia/agents:latest`. Use this to hotfix the production agent server without cutting a full release of every image. <!-- id:i8GnJuWs -->

## Manual build + push from a workstation <!-- id:g7mprK3Z -->

To build and push an image yourself with correct version metadata baked in: <!-- id:t63K_Lee -->

```bash <!-- id:XeudkRfN -->
agents/scripts/build-and-push.sh dev      # or: latest
```

It stamps the current git `HEAD` (commit/branch/date) into the image and pushes `seedhypermedia/agents:<tag>`. <!-- id:zH3oxaoU -->

## Deploy onto the agent host <!-- id:q7ez6eeh -->

One host runs `/opt/agentic/docker-compose.yml` with three agents containers behind Caddy: <!-- id:QMQwk2vp -->

<!-- id:SIM6kqVF -->
| Hostname <!-- col:LqSuj2MH --> | Container <!-- col:69XPEtJw --> | Image tag <!-- col:iCY30j_y --> | Code <!-- col:y0qrOEXZ --> | Data <!-- col:leHGcMht --> <!-- id:Exwz3Qfb --> |
| --- | --- | --- | --- | --- |
| `agentic.seed.hyper.media` | `agents-stable` | `:latest` | newest release | mainnet <!-- id:JGFQErsK --> |
| `staging.agentic.seed.hyper.media` | `agents-staging` | `:dev` | `main` | mainnet, via `staging.hyper.media` <!-- id:rPtV9zjA --> |
| `dev.agentic.seed.hyper.media` | `agents-dev` | `:dev` | `main` | devnet <!-- id:sKgI7CtP --> |

Staging is the release gate — same code as dev, real mainnet data — so the sequence before cutting a release is: land on `main`, wait for `:dev` to deploy, exercise `staging.agentic.seed.hyper.media`, then tag. See `environments.md` for the full picture, including why each container needs its own data volume. <!-- id:4aRdm50_ -->

Watchtower (`nickfedor/watchtower:1.18.1`, label-enabled, 5-minute interval) auto-pulls the labeled containers. After pushing a new image it deploys within the poll interval, or force it immediately: <!-- id:hwGCsVgy -->

```bash <!-- id:J4Y3ksRe -->
# Force an update now, with compose (the reliable way):
ssh ubuntu@agentic.seed.hyper.media \
  'cd /opt/agentic && docker compose pull agents-stable agents-staging agents-dev && docker compose up -d'

# Or a one-shot Watchtower. Note: only works when the resident Watchtower is stopped — it treats a
# second instance as an "excess Watchtower container" and SIGTERMs it mid-run.
ssh ubuntu@agentic.seed.hyper.media \
  'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
     nickfedor/watchtower:1.18.1 --run-once --label-enable --cleanup'
```

Watchtower reads `com.centurylinklabs.watchtower.enable` off the **running container**, so editing that label in the compose file changes nothing until `docker compose up -d <service>` recreates the container. That is the knob for temporarily pinning a deployment; it does not stop `bootstrap.sh`, whose `docker compose pull` will still move a pinned container on the next Terraform apply. <!-- id:adholITo -->
  > `/opt/agentic/docker-compose.yml` and `/opt/agentic/Caddyfile` are rendered by `seed_infra/agentic/main.tf` in the <!-- id:piG1RxCf -->
  > SeedInfra repo and pushed over SSH by the `ssh_resource.files` resource. Edits made directly on the host survive until <!-- id:WlBk_Eum -->
  > the next apply and then vanish — mirror anything you change there back into `main.tf`. <!-- id:VQyleHww -->

# Configuration <!-- id:07ntysg_ -->

Config source: `agents/src/config.ts`. <!-- id:Woltv7hS -->

<!-- id:IA0NLgts -->
| Environment variable <!-- col:k4r6o34C --> | Default <!-- col:7jsKg_9k --> | Purpose <!-- col:1XR71v9t --> <!-- id:th_kSyA7 --> |
| --- | --- | --- |
| `SEED_AGENTS_HTTP_HOSTNAME` | `0.0.0.0` | HTTP bind hostname. <!-- id:G8sJvW8w --> |
| `SEED_AGENTS_HTTP_PORT` | `3050` | HTTP port. <!-- id:sJW1ZpvU --> |
| `SEED_AGENTS_DB_PATH` | `./data/agents.sqlite` | SQLite DB path. <!-- id:dknRVRGp --> |
| `SEED_AGENTS_DATA_DIR` | `./data` | Data directory. <!-- id:oMgwJJep --> |
| `SEED_AGENTS_HM_SERVER_URL` | `https://hyper.media` | Seed DAG-CBOR `/api/*` endpoint used for activity and HM reads/writes. <!-- id:-U_3_rUb --> |
| `SEED_AGENTS_IPFS_SERVER_URL` | HM server URL | Direct `/ipfs/*` gateway origin for reads when it differs from the typed API endpoint. <!-- id:ltc8JHyj --> |
| `SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS` | `5000` | Activity and schedule trigger monitor poll interval. <!-- id:O4k599Ev --> |
| `SEED_AGENTS_ACTIVITY_PAGE_SIZE` | `50` | ActivityFeed page size. <!-- id:72cPVt59 --> |
| `SEED_AGENTS_ACTIVITY_MAX_PAGES` | `5` | Max pages fetched per poll. <!-- id:AMt50Bbp --> |
| `SEED_AGENTS_SEARXNG_URL` | _(unset)_ | Self-hosted SearXNG base URL. Enables the `web_search` tool. <!-- id:r7A0bkD3 --> |
| `SEED_AGENTS_CRAWLER_URL` | _(unset)_ | Self-hosted Crawl4AI base URL. Enables browser-render escalation for web reads. <!-- id:0R7M1OGu --> |
| `SEED_AGENTS_CRAWLER_TOKEN` | _(unset)_ | Bearer token for Crawl4AI (required by Crawl4AI >= 0.9). <!-- id:ABE0a0Tv --> |
| `SEED_AGENTS_SUBSCRIPTION_AUTH` | _(off)_ | Offer provider OAuth sign-in ("Sign in with ChatGPT"). Only `1`/`true`/`yes`/`on` enables it. <!-- id:Sv4pKPqe --> |
| `SEED_AGENTS_SESSION_TITLE_GENERATION` | `true` | Name untitled sessions with a dedicated model call. Set exactly `false` to disable. <!-- id:ED7y2rAF --> |
| `SEED_AGENTS_EXEC_BACKEND` | `microsandbox` | Code-execution backend for `execute` and authored lambda tools. Set empty/`off`/`none` to disable. <!-- id:81BYtsXO --> |
| `SEED_AGENTS_EXEC_IMAGE` | `python` | OCI image used for execution sandboxes. <!-- id:QRvggCQy --> |
| `SEED_AGENTS_EXEC_TS_IMAGE` | `oven/bun` | OCI image for the `ts` runtime (needs bun). Set empty to withhold ts. <!-- id:yQbjzCnq --> |
| `SEED_AGENTS_EXEC_CPUS` | `1` | Virtual CPUs per execution sandbox. <!-- id:QRuJer3f --> |
| `SEED_AGENTS_EXEC_MEMORY_MIB` | `512` | Guest memory per execution sandbox (MiB). <!-- id:AlLSx3oW --> |
| `SEED_AGENTS_EXEC_TIMEOUT_SECS` | `60` | Default per-execution timeout (tool may request up to 300s). <!-- id:lyEYdp2i --> |
| `SEED_AGENTS_EXEC_ALLOW_NETWORK` | `true` | Sandbox internet access. Set `false`/`off`/`0` to isolate sandboxes. <!-- id:YZQgb6sX --> |
| `SEED_AGENTS_EXEC_DNS` | `1.1.1.1,8.8.8.8` | Comma-separated DNS resolvers used inside execution sandboxes. <!-- id:J926ue8T --> |
| `SEED_AGENTS_LOG_LEVEL` | `info` | Minimum log level (`debug`, `info`, `warn`, `error`). `debug` re-enables hot-path lines. <!-- id:5TX4N4wb --> |

CLI flags override env/defaults: <!-- id:ZtCaYR7h -->

```bash <!-- id:VLKHNkHQ -->
bun src/main.ts \
  --server-hostname 127.0.0.1 \
  --server-port 3050 \
  --db-path ./data/agents.sqlite \
  --data-dir ./data \
  --hm-server-url https://hyper.media \
  --ipfs-server-url https://hyper.media
```

Every environment variable in the table has a matching flag (`--searxng-url`, `--exec-backend`, `--exec-ts-image`, `--subscription-auth`, `--session-title-generation`, …); the full list is the `Flags` type in `config.ts`. An unknown flag or a flag with an empty value is a startup error, so a typo fails loudly instead of running with a default. <!-- id:9OIa8qFe -->

# Web research backends <!-- id:ww1gPvmR -->

Web research is fully self-hosted and uses no third-party API keys: the `web_search` callable tool, and the tiered reader behind `read https://…` (MediaWiki → in-process static Readability+Turndown → Crawl4AI). Both backends are optional — without configuration `web_search` errors, and web reads fall back to the MediaWiki and static tiers. To enable them, run the backends as sidecar containers on the same internal network and point the agents service at them. <!-- id:6w4jARt9 -->

For local development a ready-to-run compose and SearXNG config live at `agents/dev/web-backends/`. Start the containers, then run the service — `bun run dev` already points at these dev endpoints by default: <!-- id:ylFQ-SIc -->

```bash <!-- id:ObEJf9WQ -->
cd agents/dev/web-backends && docker compose up -d   # SearXNG on :8899, Crawl4AI on :11235
cd ../.. && bun run dev                               # auto-targets the dev backends
```

The `dev` script defaults `SEED_AGENTS_SEARXNG_URL` (`http://127.0.0.1:8899`), `SEED_AGENTS_CRAWLER_URL` (`http://127.0.0.1:11235`), and `SEED_AGENTS_CRAWLER_TOKEN` (`dev-crawl-token`) to the compose values; export those env vars to override — the same script also turns `SEED_AGENTS_SUBSCRIPTION_AUTH` on for local development. The startup log prints `Web tools: search=on reader=static+crawl4ai` when wired. The reader's MediaWiki and static tiers still work if the containers are not running; only `web_search` and the browser escalation need them. Stop the backends with `docker compose down` in `agents/dev/web-backends/`. <!-- id:sU3Ky-PV -->

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
  SEED_AGENTS_SEARXNG_URL: http://searxng:8080
  SEED_AGENTS_CRAWLER_URL: http://crawl4ai:11235
  SEED_AGENTS_CRAWLER_TOKEN: ${CRAWL4AI_API_TOKEN}
```

Capacity note: Crawl4AI runs a headless Chromium and documents a >=4 GB RAM minimum plus 1 GB shared memory. Size the host accordingly. The SearXNG + in-process static reader path is lightweight; Crawl4AI is the heavy escalation tier. <!-- id:U9QXiKwN -->

The health endpoints (`/api/health`, `/agents/api/health`) report what this server can actually do: <!-- id:15g_rrEQ -->

```json <!-- id:dv8IoP83 -->
{
  "status": "ok",
  "uptime": 1234.5,
  "version": "2026.6.10",
  "hmServerUrl": "https://hyper.media",
  "ipfsServerUrl": "https://hyper.media",
  "webTools": {"search": true, "readBrowser": true},
  "subscriptionAuth": false,
  "codeExec": true,
  "codeExecReason": "…",
  "codeExecReasonCode": "…",
  "codeExecRuntimes": ["ts", "python", "shell"]
}
```

`ipfsServerUrl` defaults to `hmServerUrl`, which is correct for hosted all-in-one origins. Local desktop environments set them separately because the desktop bridge owns `/api/*` while the daemon owns gateway reads under `/ipfs/*`. IPFS publication itself chunks UnixFS blocks and uses `PublishBlobs` on `hmServerUrl`. `webTools` derives from `SEED_AGENTS_SEARXNG_URL` / `SEED_AGENTS_CRAWLER_URL`; `codeExec` from the exec backend probe, with `codeExecReason`/`codeExecReasonCode` explaining an unavailable sandbox. `codeExecRuntimes` says which runtimes this host offers — `ts` needs an image with bun, so an operator can see at a glance whether TypeScript execution is on here. Clients read these to grey out what the server cannot run. <!-- id:5FIU-ofh -->

# Code execution backend <!-- id:VLdUUR8z -->

The `execute` tool — and every authored lambda tool, which runs in the same sandbox — uses the embedded `microsandbox` npm runtime: hardware-isolated microVMs with no separate server process. Host requirements: Apple Silicon on macOS, KVM on Linux, WHP (Windows Hypervisor Platform) on Windows. The runtime and native binaries install with the package; the first execution pulls the configured OCI image (default `python`), which takes tens of seconds, after which sandboxes boot in well under a second. The `ts` runtime comes from a second image (`SEED_AGENTS_EXEC_TS_IMAGE`, default `oven/bun`); setting it empty leaves TypeScript unavailable, which `codeExecRuntimes` then reports. <!-- id:pQ4E3B90 -->

On a host that cannot run sandboxes the tool is withheld rather than left to fail: `enabledCallableTools` drops `execute` from the agent's callable set when the availability probe says no, so the model never sees a tool that can only error. `SEED_AGENTS_EXEC_BACKEND=off` disables the backend outright. <!-- id:EmHP7rkO -->

When the agents service runs inside a container, the container needs access to the host virtualization device (on Linux, `--device /dev/kvm`); without it, executions fail with the backend-unavailable error while the rest of the service keeps working. <!-- id:1nsXcwQ3 -->

Sandbox networking is **on by default** so agents can install packages and fetch data. The runtime gives each sandbox an explicit DNS resolver (`SEED_AGENTS_EXEC_DNS`, default `1.1.1.1,8.8.8.8` — a guest has no resolver otherwise) and a non-local egress policy: the sandbox reaches the public internet but not the host's private network or cloud-metadata endpoints (e.g. `169.254.169.254`). Set `SEED_AGENTS_EXEC_ALLOW_NETWORK=false` to cut the sandbox off entirely. Installed packages do not survive between calls (each runs in a fresh microVM); the tool prompt tells agents to `pip install --target /workspace/pylibs <pkg>` so packages persist in memory and can be re-imported later. <!-- id:OYeHVeib -->

Production deployment of these sidecars on the hosted agent server is handled in the `mintterteam/infrastructure` repo (the `seed_infra/agentic` Terraform stack adds the `searxng` and `crawl4ai` containers and wires the env vars), not in this repo. <!-- id:mmGE05vJ -->

# Local files <!-- id:cXgkgXPk -->

Default local files: <!-- id:4jlD-xvi -->

```text <!-- id:mvRKXMGP -->
agents/data/agents.sqlite
agents/data/agents.sqlite-shm
agents/data/agents.sqlite-wal
agents/data/agents/<agentId>/
```

SQLite is authoritative for everything except bytes on disk. An agent's state directory is created with the agent and holds its `memory/` filesystem (the `~/memory/` half of its Space) plus session-private attachments; it is removed with the agent. Staged chunked uploads live under the data dir until they are committed or expire. <!-- id:dWWK_HDM -->

# HTTP endpoints <!-- id:oTx-eqES -->

<!-- id:WyyD8vqE -->
| Endpoint <!-- col:QqHnNcMC --> | Method <!-- col:0cPxyrJj --> | Purpose <!-- col:oVN2t9-G --> <!-- id:p8d1Mrxo --> |
| --- | --- | --- |
| `/api/message` | `POST` | Signed CBOR action API. <!-- id:D634v2_4 --> |
| `/agents/api/message` | `POST` | Same action API under `/agents`. <!-- id:0MOz3jtf --> |
| `/api/health` | `GET` | JSON health and capabilities (no account data). <!-- id:A68cofS7 --> |
| `/agents/api/health` | `GET` | JSON health under `/agents`. <!-- id:b1WZL61v --> |
| `/api/version` | `GET` | Build metadata of the deployed image. <!-- id:2Y7ZWDiX --> |
| `/agents/api/version` | `GET` | Build metadata under `/agents`. <!-- id:UrIALpko --> |
| `/agents/ws` | WebSocket | Signed live subscriptions. <!-- id:Em_QCmeP --> |

Everything else is a 404. The server has no browser UI and no unauthenticated data routes: account-owned state (agents, triggers, sessions, events, memory) is reachable only through signed envelopes on `/api/message` and `/agents/ws`. Use the desktop app, or the signed API (`ListAgents`, `ListSessions`, `GetSession`, `GetAgentTrigger`, `ListRuns`), to inspect a server. <!-- id:cJBkT6iS -->

# Trigger monitors <!-- id:KlGKY3Ne -->

The server starts a background ActivityFeed monitor for enabled HM activity triggers. It polls on `SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS` (default 5 seconds) and does not contact the HM activity feed unless an account has at least one enabled non-schedule trigger. <!-- id:vygOfZs- -->

Each polled event is offered to two consumers: trigger matching, and any run parked on `ctx.waitForEvent({eventType, resource, author})` for that account (`#deliverActivityToRunWaits`). A wait is one run's private business, a trigger is the agent's standing configuration, but they ride the same feed — which means an account with **no** enabled activity trigger is never polled, so an activity-shaped wait on such an account only ever resolves by timeout. Signal-shaped waits do not depend on polling at all. The first poll for an account establishes a baseline watermark and only processes activity observed after the earliest enabled trigger was created. Later polls process new ActivityFeed events through trigger matching. If a persisted watermark is older because the server was down, the monitor backfills unseen events for up to 1 hour and then advances the watermark. <!-- id:Z8YvKpdU -->

The server also starts a background schedule monitor. It evaluates enabled `schedule` triggers on the same poll interval, records durable `trigger_firings` rows with `schedule:<triggerId>:<scheduledAt>` idempotency keys, creates sessions for due occurrences, and disables one-time triggers after a successful run. <!-- id:As3XFW0a -->

# Run queue and workflow engine <!-- id:jIKj9Ovy -->

Every agent execution is a durable row in the `runs` table, which doubles as the dispatch queue (`agents/src/runs.ts`): <!-- id:Cdw3Ljyi -->
  - **Queues**: interactive user turns are claimed inline by `MessageSession` (unchanged latency); everything else (trigger firings, agent-started sessions, delegated model children, script children) dispatches on the `background` queue. Agent runs are capped at 8 concurrent provider streams; script runs get their own pool of 32 (they hold no provider stream), so a script awaiting its children can never starve them. <!-- id:db3BA2As -->
  - **One live agent run per session** is enforced at claim time (lease-based), replacing the old racy status-column 409. <!-- id:ST5DHKVV -->
  - **Boot sweep**: on service construction, runs a dead process left `claimed`/`running` are requeued and any queued backlog resumes. Agent runs resume by replaying their durable session events; a crash between a persisted `tool_call` and its `tool_result` gets a synthesized "interrupted by service restart" result so the provider request is well-formed and the model decides whether to retry. Script runs resume by journal replay. <!-- id:fGRoe2ad -->
  - **Retry classification**: provider 5xx/network failures are retryable with exponential backoff (base 5s, cap 5min); validation/config errors fail immediately. `maxAttempts` is 3 (`AGENT_RUN_MAX_ATTEMPTS`) for background agent runs — trigger firings, agent-started sessions, delegated model children — and 1 for interactive turns, which have a person waiting, and for script runs, which resume from their journal rather than restarting. <!-- id:it4z5p55 -->
  - **Parking**: a run waits for one of four reasons — its children, a timer (`ctx.sleep` of 60s or more parks with `not_before`; the dispatcher's 1-second interval wakes due timers), an event (`ctx.waitForEvent`, woken by a `SignalRun`, a trigger `wake` continuation, an activity event, or its timeout), or a budget pause a person resumes. Parked runs hold no resources. <!-- id:wYXSdipo -->
  - **Leases** expire after 60 seconds; the boot sweep uses them to tell a live claim from a dead one. <!-- id:YD2c9GyO -->
  - Tests and shutdown wait for the queue via `Service.drainTriggerSessions()`; `awaitQueueIdle()` is an alias for it under the name the runs feature documents. <!-- id:TebiC9QK -->

Script execution bounds (see `agents/src/workflow-host.ts`): QuickJS-WASM realm per run, 64 MiB memory cap, 2s pure-compute fuel between awaits, 256 KiB source cap, and journal caps of 5,000 entries / 8 MiB per run (`WORKFLOW_JOURNAL_MAX_ENTRIES` / `WORKFLOW_JOURNAL_MAX_BYTES` in `api-service.ts`). A long-lived loop escapes the journal cap with `ctx.continueAsNew`, which ends the run and starts a successor carrying only the declared state. <!-- id:4CrPGBii -->

# Model-gate harness (record/replay) <!-- id:igk3vJ3Z -->

<!-- id:KG9dahM9 -->
> **The cassettes are stale and the replay gate is currently skipping.** `agents/e2e/recordings/STALE.md` records why: <!-- id:wGkVe2-l -->
> every cassette was recorded against the pre-harness tool surface (`sub_session`, `run_workflow`, `update_plan`, <!-- id:-ODKf326 -->
> `memory_*`, `execute_code`), and the verb collapse changed both the tool names and the system prompt, so every replay <!-- id:Oaw4aeTS -->
> fingerprint is invalid. While that file exists, `bun e2e/run.ts` prints `recordings are STALE … skipping replay`, <!-- id:x9OWGhJO -->
> reports `0 pass, 0 fail (skipped)`, and exits 0 — which keeps `src/e2e-replay.test.ts` green **without pretending** <!-- id:9PoXBYXl -->
> coverage exists**. Do not read a passing `bun test` as evidence that these gates ran. Restoring them means** <!-- id:2DGOlIWz -->
> re-recording (below), verifying every scenario, then deleting `STALE.md` and any cassette the re-record did not <!-- id:4bl5Ybnn -->
> overwrite. <!-- id:JHraQnEw -->

`agents/e2e/run.ts` drives the real Service through six behavioral gates. By default it **replays** recorded gpt-5-mini responses from `agents/e2e/recordings/` — full service and tool loop, no network, no API key — and `agents/src/e2e-replay.test.ts` runs that replay as part of the regular `bun test` suite. Pass `--record` to hit the live OpenAI API and refresh the cassettes (spends real tokens — manual only, never CI): <!-- id:PaO3tHE2 -->

```bash <!-- id:uOMnss2O -->
cd agents && bun e2e/run.ts all              # replay all scenarios from recordings (offline)
bun e2e/run.ts wf-hello --record             # re-record one scenario live (needs OPENAI_API_KEY)
```

Recording proxies provider traffic through a local server that captures each response keyed by a request fingerprint (model + system-prompt head + last user message + tool names + tool-result count); replay matches the same fingerprints, so cassettes survive tool-description edits but need re-recording when system prompts or conversation flow change. Only a passing run overwrites a scenario's cassette. The live key comes from `OPENAI_API_KEY` or the repo-root `.keys` file (never committed). Every scenario asserts on durable state (runs, journals, session events) and dumps full transcripts to `agents/e2e-artifacts/<timestamp>/` for prompt autopsies. Scenarios: `chat-smoke`, `sub-basic`, `sub-typed`, `sub-restraint`, `wf-hello`, `todo-adoption`. <!-- id:sqsL6jBF -->

Status: the cassettes on disk were last recorded from live gpt-5-mini before the verb collapse and are now stale (see the note at the top of this section); the scenario code itself still exercises the current Service. The last live recording pass surfaced (and fixed) three real-model defects: top-level-array output schemas now rejected at spawn time with a self-correctable message, `functions.`-prefixed tool names normalized in scripts' `ctx.call`, and the standard `minItems`/`maxItems`/`maxLength`/`maximum` keywords added to the schema subset. <!-- id:iuku-qNG -->

# Live gate (real server, real model) <!-- id:W2IDueL_ -->

`agents/e2e/live-gate.ts` is the other half of the story: a pure client that signs envelopes with the desktop daemon's key over grpc-web — exactly as the desktop app does — and talks CBOR to an already-running server, so it gates the thing an operator actually uses rather than an in-process Service. It creates a throwaway `NightGate` agent mirroring an existing agent's provider/model/tools, runs the scenarios, writes full transcripts to an artifact directory, and deletes the agent again. <!-- id:09iIG175 -->

```bash <!-- id:JWUffEVV -->
cd agents
bun e2e/live-gate.ts                                  # every scenario against http://localhost:3051
bun e2e/live-gate.ts trivial memory                   # a subset
bun e2e/live-gate.ts --base http://localhost:3099 --out /tmp/gate --keep
```

Flags: `--base` (agents server), `--daemon` (Seed daemon grpc-web, default `http://localhost:56001`), `--account` (uid to sign as), `--provider` / `--model`, `--like` (agent id to mirror), `--out`, `--timeout` (per-scenario ms, default 600000), `--keep` (leave the NightGate agent behind). <!-- id:2tWMRgpD -->

Scenarios: `trivial` (restraint plus self-naming — arithmetic must be answered directly, with no delegation, and the session still ends up model-titled), `memory` (a fact written to `~/memory` in one session, read back by a second), `parallel-delegate`, `script-parallel`, `script-narration`. Enforced checks are deterministic properties; model behavior is reported rather than asserted. <!-- id:rTsrR0qu -->

This gate spends real tokens and needs a running server with a working provider. It is never part of `bun test`. <!-- id:oBoXgxg8 -->

Two focused companions live beside it, both model-free so they gate a mechanism rather than a model: <!-- id:9vBifZNZ -->
  - `e2e/narration-check.ts` drives the script VM directly (no model, no server, no credentials) and asserts that a `ctx.call(tool, input, {description})` label reaches both the durable journal entry and the tool-call adapter — the UI reads the first, the run transcript reads the second. <!-- id:UOu6RNcR -->
  - `e2e/obligations-live-check.ts` drives a real server over HTTP with a scripted provider (`e2e/scripted-provider.ts`) through the whole unified-obligations loop: a plan-shaped task, a step left open at turn end, the continuation the runtime hands itself, and the settled checklist afterwards. <!-- id:OTtMuLHc -->

## Simulated-model gates (no API key required) <!-- id:kdX10tm6 -->

When a live gate cannot run — and as a repeatable practice for iterating tool prompts — validation uses **blind simulated-model agents**: a fresh LLM session (a Claude Code subagent) is given ONLY what the runtime model sees (the system prompt plus the registry `description`/`inputSchema` of the tools under test, read from `agents/protocol/src/tool-registry.ts`) and asked to produce its exact assistant turns for scripted scenarios. Its tool calls are then validated mechanically: delegation choices checked against intent, declared output schemas run through `validateJsonSchemaShape`, and authored script source run through `lintWorkflowSource` and executed in the real engine (`runWorkflowVM`) against scripted adapters. The 2026-08-03 pass (against the pre-verb tool names) validated delegation choice — parallel typed fan-out, detached spawning only for fire-and-forget work, no tools at all for trivial input — and script authoring: a \~100-line module that lint-passed and ran correctly, unmodified, first try. The simulators' lists of guessed-at contracts drove the ctx-contract tightening in the tool descriptions and the bare-string `ctx.plan` fix. The key property making this honest: the simulator must be **blind** — no access to implementation, docs, or tests, only the model-facing prompt surface. <!-- id:fYBpj9CH -->

# Startup behavior <!-- id:AzD4c8yi -->

On startup: <!-- id:UERmMWWo -->
  1. `config.create(config.parseArgs())` builds config. <!-- id:karVPX4S -->
  2. `sqlite.open(cfg.dbPath)` validates or initializes the DB. <!-- id:0WgOMLsF -->
  3. If schema is valid, `Service` (which boot-sweeps the run queue), the activity trigger monitor, and the schedule trigger monitor are created and Bun server starts. <!-- id:bldAXA78 -->
  4. If schema is mismatched, server starts in schema-mismatch mode and returns a JSON error. <!-- id:gQtOx1bh -->

Schema mismatch log includes stored and expected version. For local throwaway data, delete the SQLite files and restart. <!-- id:_J_gv5T9 -->

# Shutdown behavior <!-- id:6sqQiSsC -->

The service handles `SIGINT` and `SIGTERM`: <!-- id:27DpYHG3 -->
  1. stop repeated shutdown handling; <!-- id:DJIfQ3v4 -->
  2. stop the activity trigger monitor and the schedule monitor; <!-- id:ZjI-8tpm -->
  3. close WebSocket clients with code `1001`; <!-- id:J6207Axe -->
  4. clear client set; <!-- id:sCNZyrwv -->
  5. stop Bun server; <!-- id:aDJ3JZvP -->
  6. drain in-flight background runs, bounded at 5 seconds so one stuck session cannot block shutdown, then stop the run-queue timers; <!-- id:X8QzoNFd -->
  7. close SQLite DB; <!-- id:PpbedZlo -->
  8. exit. <!-- id:bAUcIud1 -->

# CORS <!-- id:zUgG1bJ7 -->

Health and CBOR API routes return permissive CORS headers. Security is based on signatures and account authorization, not browser origin. <!-- id:zx4dahLP -->

# Diagnostics and logs <!-- id:DR_9rULX -->

Current logs intentionally include IDs, counts, statuses, sizes, timings, trigger sources, and compact activity metadata — not secrets or full message/session content. <!-- id:sRtUySO2 -->

Logging is leveled (`agents/src/log.ts`, `SEED_AGENTS_LOG_LEVEL` / `--log-level`, default `info`). The per-event hot paths — every WebSocket partial (`publish partial`, `send partial`, `skip partial`) and every no-op activity poll (`Polling feed`, `Feed page received`, `Processing feed events` with nothing new) — log at `debug` and are silent by default: measured in production, they were \~90% of \~440k lines/hour. Set the level to `debug` when tracing streaming or trigger delivery. <!-- id:OS2CBsMW -->

Activity trigger diagnostics use: <!-- id:LZjDOFOi -->
  - `[Agents Activity] Polling feed` <!-- id:CzKZDYrP -->
  - `[Agents Activity] Feed page received` <!-- id:mYmN01Cf -->
  - `[Agents Activity] First poll processing events` <!-- id:ovKIXloc -->
  - `[Agents Activity] Processing feed events` <!-- id:Jsb-sz4Q -->
  - `[Agents Activity] Poll failed` <!-- id:gJhHYcPM -->
  - `[Agents Trigger] Skipping activity without stable key` <!-- id:YB8_h-7L -->
  - `[Agents Trigger] Checked activity against trigger` <!-- id:hvBJi4x9 -->
  - `[Agents Trigger] Skipping duplicate trigger firing` <!-- id:eTxjrti2 -->
  - `[Agents Trigger] Skipping run-completed trigger already in this chain` <!-- id:jESnWMeT -->
  - `[Agents Trigger] Fired trigger and created session` <!-- id:rQ4EBAB_ -->
  - `[Agents Trigger] Trigger session run enqueued` <!-- id:x6tcJogd -->
  - `[Agents Trigger] Trigger session dispatch failed` <!-- id:f5n1P8TH -->
  - `[Agents Trigger] Trigger woke a parked run` <!-- id:N6Eb9Kio -->
  - `[Agents Trigger] Trigger fired with no run listening` <!-- id:PRUZg7PL -->
  - `[Agents Trigger] Trigger firing failed` <!-- id:oeFTB4Kf -->

Run, runtime, and script diagnostics: <!-- id:0OVrLoWY -->
  - `[agents/runs] boot sweep requeued interrupted runs` <!-- id:eh_YCZuP -->
  - `[agents/runs] boot reconcile: replaying finished child into parked parent` <!-- id:_RsqNClX -->
  - `[agents/runs] activity woke a waiting run` <!-- id:tpFxLg1i -->
  - `[agents/runtime] sending provider request` <!-- id:C2_CfkIS -->
  - `[agents/runtime] ending turn after tool batch` <!-- id:qZT_X9Yq -->
  - `[agents/runtime] sub-session spawned` / `[agents/runtime] sub-session resolved` <!-- id:rrfbE_Wv -->
  - `[agents/runtime] plan step settled from children` <!-- id:dCijbIeI -->
  - `[agents/runtime] agent started session` / `[agents/runtime] agent-started session run failed` <!-- id:gIm1siw2 -->
  - `[agents/runtime] session titled by model` / `[agents/runtime] session title generation failed` <!-- id:dBx3vxUA -->
  - `[agents/workflow] workflow spawned from chat` <!-- id:vnIHKeTj -->
  - `[agents/workflow] continued as new run` <!-- id:fH-VDeMa -->
  - `[agents/workflow] run paused on its time budget` <!-- id:u0b-olQJ -->

Server model execution now goes through the Pi SDK. The old manual OpenAI stream logs are not emitted on the primary Pi-backed path. Use durable session events (via `GetSession` or the desktop session page), WebSocket partial logs, and mocked tests for current runtime diagnosis. Add Seed-level Pi runtime diagnostics before production if real-provider troubleshooting needs more visibility. <!-- id:KNt6k5MM -->

Server WebSocket logs: <!-- id:LFKybXaZ -->
  - `[agents/ws] open` <!-- id:J0oO3TLG -->
  - `[agents/ws] subscribed` <!-- id:0KGebWeE -->
  - `[agents/ws] publish partial` <!-- id:B6N9i06j -->
  - `[agents/ws] send partial` <!-- id:5PXSkCYU -->
  - `[agents/ws] skip partial; no subscription` <!-- id:7eqwzaLy -->
  - `[agents/ws] close` <!-- id:gAExGHP- -->

Desktop WebSocket/UI logs: <!-- id:Fmgbj2nL -->
  - `[agents/ws] connecting` <!-- id:gGhsKMZy -->
  - `[agents/ws] open; signing subscribe` <!-- id:rrl_HVjS -->
  - `[agents/ws] subscribe sent` <!-- id:-01o8fj- -->
  - `[agents/ws] subscribed event` <!-- id:clsDqaZw -->
  - `[agents/ws] partial event` <!-- id:mGlEgw9h -->
  - `[agents/ws] partial state updated` <!-- id:jPWPhKjw -->
  - `[agents/ws] partial marked done; keeping visible until durable append` <!-- id:qJve8KM3 -->
  - `[agents/ui] sending session message` <!-- id:kDAKLiRi -->
  - `[agents/ui] rendering streaming assistant partial` <!-- id:LA86XvUl -->

# Troubleshooting <!-- id:QDNGqfkn -->

## Desktop says server offline <!-- id:kZ2mzvXq -->

Check (`3051` in the dev shell, `3050` for a release/packaged build): <!-- id:sSDnBlHJ -->

```bash <!-- id:IQWdeZq8 -->
curl http://localhost:3051/agents/api/health
```

Start server: <!-- id:5MRKd6bI -->

```bash <!-- id:OEloZ6RG -->
direnv exec . bash -lc 'cd agents && bun src/main.ts'
```

## WebSocket subscription says `Invalid signature` <!-- id:ivCBxbZ- -->

Likely causes: <!-- id:3kFIP4ug -->
  - desktop/server protocol mismatch; <!-- id:_A9gV4bK -->
  - signed action contains values that encode differently before/after decode; <!-- id:wSv7HCO_ -->
  - explicit `undefined` fields were sent. <!-- id:cGvB3HF1 -->

Current desktop signing omits `undefined` recursively before signing. If this returns, inspect `frontend/apps/desktop/src/agents-client.ts` and server `auth.verifyEnvelope()`. <!-- id:nS1GjGqf -->

## No live streaming appears <!-- id:3rMq20wP -->

Follow the log chain: <!-- id:y_nHvnuv -->
  1. Desktop should show `[agents/ws] subscribed event` for `sessions/<sessionId>`. <!-- id:D8kYyYQL -->
  2. The session should be set to `streaming` after `MessageSession`. <!-- id:TdzBvw7L -->
  3. Server should then show `[agents/ws] publish partial` and `[agents/ws] send partial` when Pi emits text deltas. <!-- id:_ipbPc0H -->
  4. Desktop should show `[agents/ws] partial event` and `[agents/ui] rendering streaming assistant partial`. <!-- id:NzvqNL8D -->
  5. The final assistant message should appear as a durable event in the desktop session page after refresh. <!-- id:CT2Cuh_P -->

If server shows `skip partial; no subscription`, the desktop subscribed too late or to a different key/account. <!-- id:2mhtmv0Z -->

## API key save fails <!-- id:IvcjRCR4 -->

Desktop refuses to send API keys to non-local plain HTTP servers. Use HTTPS for remote servers or local loopback for development. <!-- id:ojyB0F90 -->

## Schema mismatch <!-- id:JK1aCBM5 -->

For local reset: <!-- id:_OOGhGRY -->

```bash <!-- id:oFthHqMs -->
rm -f agents/data/agents.sqlite agents/data/agents.sqlite-shm agents/data/agents.sqlite-wal
```

Do not do this for persistent/shared data. <!-- id:ratUv9Ve -->

# Logging safety <!-- id:m2vIrzlQ -->

Do not add logs that include: <!-- id:ltN5wXmx -->
  - plaintext secrets; <!-- id:y5ZHGjET -->
  - decrypted API keys; <!-- id:c_eEjEjn -->
  - signed request bodies; <!-- id:m0iuHrnW -->
  - full model request/response bodies; <!-- id:PqYvNucC -->
  - full session messages; <!-- id:w74VDOkI -->
  - large tool outputs. <!-- id:uNVtqLqH -->

Prefer logging IDs, lengths, counts, timings, statuses, and booleans. <!-- id:xoQNhH3- -->
