# Operations

This document explains how to run, inspect, and troubleshoot the Agents service.

## Runtime/package boundary

`agents/` is a Bun workspace. Use Bun commands inside it.

From repo root:

```bash
direnv exec . bash -lc 'cd agents && bun install'
direnv exec . bash -lc 'cd agents && bun src/main.ts'
```

Validation:

```bash
direnv exec . bash -lc 'cd agents && bun check && bun test'
direnv exec . bash -lc 'cd agents && bun run test:build'
direnv exec . bash -lc 'cd agents && bun run test:docker'
direnv exec . bash -lc 'cd agents && bun run test:trigger'
```

`test:trigger` boots the real daemon against a local stand-in for hyper.media's `/api/ListEvents`, creates an agent +
user-mention trigger over the signed API, and asserts a comment-mention fires exactly one session (guards the
comment/citation sibling race; see `agent-triggers-plan.md`).

Desktop:

```bash
direnv exec . bash -lc './dev run-desktop'
```

Build the deployment image from the repo root:

```bash
docker build -t seedhypermedia/agents:dev . -f ./agents/Dockerfile
```

Run the image with persistent state mounted at `/data`:

```bash
docker run --rm -p 3050:3050 -v seed-agents-data:/data seedhypermedia/agents:dev
```

## Versioning, build, and deploy

The image records what it was built from and exposes it at runtime. `/api/version` (and `/agents/api/version`) returns:

```json
{"version": "2026.6.10", "commit": "<sha>", "branch": "<ref>", "date": "<date>"}
```

The `commit`/`branch`/`date` fields mirror the daemon `/debug/version` and web `/hm/api/version` shape; `version` (the
image tag) is an agents-specific addition. `/api/health` also includes the `version` field for quick checks. To see what
a host is running:

```bash
curl -s https://agentic.seed.hyper.media/agents/api/version
```

The values come from `agents/src/build-info.ts`, populated by Docker build args (`VERSION`, `COMMIT_HASH`, `BRANCH`,
`DATE` — the same `COMMIT_HASH`/`BRANCH`/`DATE` names used by the web and daemon images) that `agents/Dockerfile` maps
to namespaced `SEED_AGENTS_*` runtime `ENV`. Without build args (e.g. local `bun dev` or a plain `docker build`) they
fall back to `dev`/`unknown`.

### CI build + push

`agents/Dockerfile` is built and pushed by three GitHub Actions workflows, all of which also accept a manual
`workflow_dispatch` run from the Actions tab:

- `.github/workflows/release-docker-images.yml` — on a `*.*.*` release tag push (or manual dispatch), pushes
  `seedhypermedia/agents:<tag>`. The resolved tag is the version (`latest` for a manual run with no tag);
  `agents-stable` on the host tracks `:latest`.
- `.github/workflows/dev-docker-images.yml` — on push to `main` touching `agents/**` (or manual dispatch), pushes
  `seedhypermedia/agents:dev`, which **both** `agents-staging` and `agents-dev` track. Note the consequence: while this
  workflow is red on `main`, `:dev` stops moving, and staging silently keeps validating an older commit than the one you
  are about to release. `/api/version` on staging is the check that catches it.
- `.github/workflows/hotfix-agents-image.yml` — manual dispatch only, from `main` only. Runs the agents test gate and
  pushes ONLY `seedhypermedia/agents:latest`. Use this to hotfix the production agent server without cutting a full
  release of every image.

### Manual build + push from a workstation

To build and push an image yourself with correct version metadata baked in:

```bash
agents/scripts/build-and-push.sh dev      # or: latest
```

It stamps the current git `HEAD` (commit/branch/date) into the image and pushes `seedhypermedia/agents:<tag>`.

### Deploy onto the agent host

One host runs `/opt/agentic/docker-compose.yml` with three agents containers behind Caddy:

| Hostname                           | Container        | Image tag | Code           | Data    |
| ---------------------------------- | ---------------- | --------- | -------------- | ------- |
| `agentic.seed.hyper.media`         | `agents-stable`  | `:latest` | newest release | mainnet |
| `staging.agentic.seed.hyper.media` | `agents-staging` | `:dev`    | `main`         | mainnet |
| `dev.agentic.seed.hyper.media`     | `agents-dev`     | `:dev`    | `main`         | devnet  |

Staging is the release gate — same code as dev, real mainnet data — so the sequence before cutting a release is: land on
`main`, wait for `:dev` to deploy, exercise `staging.agentic.seed.hyper.media`, then tag. See `environments.md` for the
full picture, including why each container needs its own data volume.

Watchtower (`nickfedor/watchtower:1.18.1`, label-enabled, 5-minute interval) auto-pulls the labeled containers. After
pushing a new image it deploys within the poll interval, or force it immediately:

```bash
# Force an update now, with compose (the reliable way):
ssh ubuntu@agentic.seed.hyper.media \
  'cd /opt/agentic && docker compose pull agents-stable agents-staging agents-dev && docker compose up -d'

# Or a one-shot Watchtower. Note: only works when the resident Watchtower is stopped — it treats a
# second instance as an "excess Watchtower container" and SIGTERMs it mid-run.
ssh ubuntu@agentic.seed.hyper.media \
  'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
     nickfedor/watchtower:1.18.1 --run-once --label-enable --cleanup'
```

Watchtower reads `com.centurylinklabs.watchtower.enable` off the **running container**, so editing that label in the
compose file changes nothing until `docker compose up -d <service>` recreates the container. That is the knob for
temporarily pinning a deployment; it does not stop `bootstrap.sh`, whose `docker compose pull` will still move a pinned
container on the next Terraform apply.

> `/opt/agentic/docker-compose.yml` and `/opt/agentic/Caddyfile` are rendered by `seed_infra/agentic/main.tf` in the
> SeedInfra repo and pushed over SSH by the `ssh_resource.files` resource. Edits made directly on the host survive until
> the next apply and then vanish — mirror anything you change there back into `main.tf`.

## Configuration

Config source: `agents/src/config.ts`.

| Environment variable                    | Default                | Purpose                                                                                            |
| --------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `SEED_AGENTS_HTTP_HOSTNAME`             | `0.0.0.0`              | HTTP bind hostname.                                                                                |
| `SEED_AGENTS_HTTP_PORT`                 | `3050`                 | HTTP port.                                                                                         |
| `SEED_AGENTS_DB_PATH`                   | `./data/agents.sqlite` | SQLite DB path.                                                                                    |
| `SEED_AGENTS_DATA_DIR`                  | `./data`               | Data directory.                                                                                    |
| `SEED_AGENTS_HM_SERVER_URL`             | `https://hyper.media`  | Seed DAG-CBOR `/api/*` endpoint used for activity and HM reads/writes.                             |
| `SEED_AGENTS_IPFS_SERVER_URL`           | HM server URL          | Direct `/ipfs/*` gateway origin for reads when it differs from the typed API endpoint.             |
| `SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS` | `5000`                 | Activity and schedule trigger monitor poll interval.                                               |
| `SEED_AGENTS_ACTIVITY_PAGE_SIZE`        | `50`                   | ActivityFeed page size.                                                                            |
| `SEED_AGENTS_ACTIVITY_MAX_PAGES`        | `5`                    | Max pages fetched per poll.                                                                        |
| `SEED_AGENTS_SEARXNG_URL`               | _(unset)_              | Self-hosted SearXNG base URL. Enables the `web_search` tool.                                       |
| `SEED_AGENTS_CRAWLER_URL`               | _(unset)_              | Self-hosted Crawl4AI base URL. Enables browser-render escalation for web reads.                    |
| `SEED_AGENTS_CRAWLER_TOKEN`             | _(unset)_              | Bearer token for Crawl4AI (required by Crawl4AI >= 0.9).                                           |
| `SEED_AGENTS_SUBSCRIPTION_AUTH`         | _(off)_                | Offer provider OAuth sign-in ("Sign in with ChatGPT"). Only `1`/`true`/`yes`/`on` enables it.      |
| `SEED_AGENTS_SESSION_TITLE_GENERATION`  | `true`                 | Name untitled sessions with a dedicated model call. Set exactly `false` to disable.                |
| `SEED_AGENTS_EXEC_BACKEND`              | `microsandbox`         | Code-execution backend for `execute` and authored lambda tools. Set empty/`off`/`none` to disable. |
| `SEED_AGENTS_EXEC_IMAGE`                | `python`               | OCI image used for execution sandboxes.                                                            |
| `SEED_AGENTS_EXEC_TS_IMAGE`             | `oven/bun`             | OCI image for the `ts` runtime (needs bun). Set empty to withhold ts.                              |
| `SEED_AGENTS_EXEC_CPUS`                 | `1`                    | Virtual CPUs per execution sandbox.                                                                |
| `SEED_AGENTS_EXEC_MEMORY_MIB`           | `512`                  | Guest memory per execution sandbox (MiB).                                                          |
| `SEED_AGENTS_EXEC_TIMEOUT_SECS`         | `60`                   | Default per-execution timeout (tool may request up to 300s).                                       |
| `SEED_AGENTS_EXEC_ALLOW_NETWORK`        | `true`                 | Sandbox internet access. Set `false`/`off`/`0` to isolate sandboxes.                               |
| `SEED_AGENTS_EXEC_DNS`                  | `1.1.1.1,8.8.8.8`      | Comma-separated DNS resolvers used inside execution sandboxes.                                     |

CLI flags override env/defaults:

```bash
bun src/main.ts \
  --server-hostname 127.0.0.1 \
  --server-port 3050 \
  --db-path ./data/agents.sqlite \
  --data-dir ./data \
  --hm-server-url https://hyper.media \
  --ipfs-server-url https://hyper.media
```

Every environment variable in the table has a matching flag (`--searxng-url`, `--exec-backend`, `--exec-ts-image`,
`--subscription-auth`, `--session-title-generation`, …); the full list is the `Flags` type in `config.ts`. An unknown
flag or a flag with an empty value is a startup error, so a typo fails loudly instead of running with a default.

## Web research backends

Web research is fully self-hosted and uses no third-party API keys: the `web_search` callable tool, and the tiered
reader behind `read https://…` (MediaWiki → in-process static Readability+Turndown → Crawl4AI). Both backends are
optional — without configuration `web_search` errors, and web reads fall back to the MediaWiki and static tiers. To
enable them, run the backends as sidecar containers on the same internal network and point the agents service at them.

For local development a ready-to-run compose and SearXNG config live at `agents/dev/web-backends/`. Start the
containers, then run the service — `bun run dev` already points at these dev endpoints by default:

```bash
cd agents/dev/web-backends && docker compose up -d   # SearXNG on :8899, Crawl4AI on :11235
cd ../.. && bun run dev                               # auto-targets the dev backends
```

The `dev` script defaults `SEED_AGENTS_SEARXNG_URL` (`http://127.0.0.1:8899`), `SEED_AGENTS_CRAWLER_URL`
(`http://127.0.0.1:11235`), and `SEED_AGENTS_CRAWLER_TOKEN` (`dev-crawl-token`) to the compose values; export those env
vars to override — the same script also turns `SEED_AGENTS_SUBSCRIPTION_AUTH` on for local development. The startup log
prints `Web tools: search=on reader=static+crawl4ai` when wired. The reader's MediaWiki and static tiers still work if
the containers are not running; only `web_search` and the browser escalation need them. Stop the backends with
`docker compose down` in `agents/dev/web-backends/`.

For production the same two containers run as internal sidecars:

```yaml
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

Required SearXNG `settings.yml` (the JSON format is off by default and the limiter blocks API calls):

```yaml
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

Then wire the agents container:

```yaml
environment:
  SEED_AGENTS_SEARXNG_URL: http://searxng:8080
  SEED_AGENTS_CRAWLER_URL: http://crawl4ai:11235
  SEED_AGENTS_CRAWLER_TOKEN: ${CRAWL4AI_API_TOKEN}
```

Capacity note: Crawl4AI runs a headless Chromium and documents a >=4 GB RAM minimum plus 1 GB shared memory. Size the
host accordingly. The SearXNG + in-process static reader path is lightweight; Crawl4AI is the heavy escalation tier.

The health endpoints (`/api/health`, `/agents/api/health`) report what this server can actually do:

```json
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

`ipfsServerUrl` defaults to `hmServerUrl`, which is correct for hosted all-in-one origins. Local desktop environments
set them separately because the desktop bridge owns `/api/*` while the daemon owns gateway reads under `/ipfs/*`. IPFS
publication itself chunks UnixFS blocks and uses `PublishBlobs` on `hmServerUrl`. `webTools` derives from
`SEED_AGENTS_SEARXNG_URL` / `SEED_AGENTS_CRAWLER_URL`; `codeExec` from the exec backend probe, with
`codeExecReason`/`codeExecReasonCode` explaining an unavailable sandbox. `codeExecRuntimes` says which runtimes this
host offers — `ts` needs an image with bun, so an operator can see at a glance whether TypeScript execution is on here.
Clients read these to grey out what the server cannot run.

## Code execution backend

The `execute` tool — and every authored lambda tool, which runs in the same sandbox — uses the embedded `microsandbox`
npm runtime: hardware-isolated microVMs with no separate server process. Host requirements: Apple Silicon on macOS, KVM
on Linux, WHP (Windows Hypervisor Platform) on Windows. The runtime and native binaries install with the package; the
first execution pulls the configured OCI image (default `python`), which takes tens of seconds, after which sandboxes
boot in well under a second. The `ts` runtime comes from a second image (`SEED_AGENTS_EXEC_TS_IMAGE`, default
`oven/bun`); setting it empty leaves TypeScript unavailable, which `codeExecRuntimes` then reports.

On a host that cannot run sandboxes the tool is withheld rather than left to fail: `enabledCallableTools` drops
`execute` from the agent's callable set when the availability probe says no, so the model never sees a tool that can
only error. `SEED_AGENTS_EXEC_BACKEND=off` disables the backend outright.

When the agents service runs inside a container, the container needs access to the host virtualization device (on Linux,
`--device /dev/kvm`); without it, executions fail with the backend-unavailable error while the rest of the service keeps
working.

Sandbox networking is **on by default** so agents can install packages and fetch data. The runtime gives each sandbox an
explicit DNS resolver (`SEED_AGENTS_EXEC_DNS`, default `1.1.1.1,8.8.8.8` — a guest has no resolver otherwise) and a
non-local egress policy: the sandbox reaches the public internet but not the host's private network or cloud-metadata
endpoints (e.g. `169.254.169.254`). Set `SEED_AGENTS_EXEC_ALLOW_NETWORK=false` to cut the sandbox off entirely.
Installed packages do not survive between calls (each runs in a fresh microVM); the tool prompt tells agents to
`pip install --target /workspace/pylibs <pkg>` so packages persist in memory and can be re-imported later.

Production deployment of these sidecars on the hosted agent server is handled in the `mintterteam/infrastructure` repo
(the `seed_infra/agentic` Terraform stack adds the `searxng` and `crawl4ai` containers and wires the env vars), not in
this repo.

## Local files

Default local files:

```text
agents/data/agents.sqlite
agents/data/agents.sqlite-shm
agents/data/agents.sqlite-wal
agents/data/agents/<agentId>/
```

SQLite is authoritative for everything except bytes on disk. An agent's state directory is created with the agent and
holds its `memory/` filesystem (the `~/memory/` half of its Space) plus session-private attachments; it is removed with
the agent. Staged chunked uploads live under the data dir until they are committed or expire.

## HTTP endpoints

| Endpoint              | Method    | Purpose                                         |
| --------------------- | --------- | ----------------------------------------------- |
| `/api/message`        | `POST`    | Signed CBOR action API.                         |
| `/agents/api/message` | `POST`    | Same action API under `/agents`.                |
| `/api/health`         | `GET`     | JSON health and capabilities (no account data). |
| `/agents/api/health`  | `GET`     | JSON health under `/agents`.                    |
| `/api/version`        | `GET`     | Build metadata of the deployed image.           |
| `/agents/api/version` | `GET`     | Build metadata under `/agents`.                 |
| `/agents/ws`          | WebSocket | Signed live subscriptions.                      |

Everything else is a 404. The server has no browser UI and no unauthenticated data routes: account-owned state (agents,
triggers, sessions, events, memory) is reachable only through signed envelopes on `/api/message` and `/agents/ws`. Use
the desktop app, or the signed API (`ListAgents`, `ListSessions`, `GetSession`, `GetAgentTrigger`, `ListRuns`), to
inspect a server.

## Trigger monitors

The server starts a background ActivityFeed monitor for enabled HM activity triggers. It polls on
`SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS` (default 5 seconds) and does not contact the HM activity feed unless an account
has at least one enabled non-schedule trigger.

Each polled event is offered to two consumers: trigger matching, and any run parked on
`ctx.waitForEvent({eventType, resource, author})` for that account (`#deliverActivityToRunWaits`). A wait is one run's
private business, a trigger is the agent's standing configuration, but they ride the same feed — which means an account
with **no** enabled activity trigger is never polled, so an activity-shaped wait on such an account only ever resolves
by timeout. Signal-shaped waits do not depend on polling at all. The first poll for an account establishes a baseline
watermark and only processes activity observed after the earliest enabled trigger was created. Later polls process new
ActivityFeed events through trigger matching. If a persisted watermark is older because the server was down, the monitor
backfills unseen events for up to 1 hour and then advances the watermark.

The server also starts a background schedule monitor. It evaluates enabled `schedule` triggers on the same poll
interval, records durable `trigger_firings` rows with `schedule:<triggerId>:<scheduledAt>` idempotency keys, creates
sessions for due occurrences, and disables one-time triggers after a successful run.

## Run queue and workflow engine

Every agent execution is a durable row in the `runs` table, which doubles as the dispatch queue (`agents/src/runs.ts`):

- **Queues**: interactive user turns are claimed inline by `MessageSession` (unchanged latency); everything else
  (trigger firings, agent-started sessions, delegated model children, script children) dispatches on the `background`
  queue. Agent runs are capped at 8 concurrent provider streams; script runs get their own pool of 32 (they hold no
  provider stream), so a script awaiting its children can never starve them.
- **One live agent run per session** is enforced at claim time (lease-based), replacing the old racy status-column 409.
- **Boot sweep**: on service construction, runs a dead process left `claimed`/`running` are requeued and any queued
  backlog resumes. Agent runs resume by replaying their durable session events; a crash between a persisted `tool_call`
  and its `tool_result` gets a synthesized "interrupted by service restart" result so the provider request is
  well-formed and the model decides whether to retry. Script runs resume by journal replay.
- **Retry classification**: provider 5xx/network failures are retryable with exponential backoff (base 5s, cap 5min);
  validation/config errors fail immediately. `maxAttempts` is 3 (`AGENT_RUN_MAX_ATTEMPTS`) for background agent runs —
  trigger firings, agent-started sessions, delegated model children — and 1 for interactive turns, which have a person
  waiting, and for script runs, which resume from their journal rather than restarting.
- **Parking**: a run waits for one of four reasons — its children, a timer (`ctx.sleep` of 60s or more parks with
  `not_before`; the dispatcher's 1-second interval wakes due timers), an event (`ctx.waitForEvent`, woken by a
  `SignalRun`, a trigger `wake` continuation, an activity event, or its timeout), or a budget pause a person resumes.
  Parked runs hold no resources.
- **Leases** expire after 60 seconds; the boot sweep uses them to tell a live claim from a dead one.
- Tests and shutdown wait for the queue via `Service.drainTriggerSessions()`; `awaitQueueIdle()` is an alias for it
  under the name the runs feature documents.

Script execution bounds (see `agents/src/workflow-host.ts`): QuickJS-WASM realm per run, 64 MiB memory cap, 2s
pure-compute fuel between awaits, 256 KiB source cap, and journal caps of 5,000 entries / 8 MiB per run
(`WORKFLOW_JOURNAL_MAX_ENTRIES` / `WORKFLOW_JOURNAL_MAX_BYTES` in `api-service.ts`). A long-lived loop escapes the
journal cap with `ctx.continueAsNew`, which ends the run and starts a successor carrying only the declared state.

## Model-gate harness (record/replay)

> **The cassettes are stale and the replay gate is currently skipping.** `agents/e2e/recordings/STALE.md` records why:
> every cassette was recorded against the pre-harness tool surface (`sub_session`, `run_workflow`, `update_plan`,
> `memory_*`, `execute_code`), and the verb collapse changed both the tool names and the system prompt, so every replay
> fingerprint is invalid. While that file exists, `bun e2e/run.ts` prints `recordings are STALE … skipping replay`,
> reports `0 pass, 0 fail (skipped)`, and exits 0 — which keeps `src/e2e-replay.test.ts` green **without pretending
> coverage exists**. Do not read a passing `bun test` as evidence that these gates ran. Restoring them means
> re-recording (below), verifying every scenario, then deleting `STALE.md` and any cassette the re-record did not
> overwrite.

`agents/e2e/run.ts` drives the real Service through six behavioral gates. By default it **replays** recorded gpt-5-mini
responses from `agents/e2e/recordings/` — full service and tool loop, no network, no API key — and
`agents/src/e2e-replay.test.ts` runs that replay as part of the regular `bun test` suite. Pass `--record` to hit the
live OpenAI API and refresh the cassettes (spends real tokens — manual only, never CI):

```bash
cd agents && bun e2e/run.ts all              # replay all scenarios from recordings (offline)
bun e2e/run.ts wf-hello --record             # re-record one scenario live (needs OPENAI_API_KEY)
```

Recording proxies provider traffic through a local server that captures each response keyed by a request fingerprint
(model + system-prompt head + last user message + tool names + tool-result count); replay matches the same fingerprints,
so cassettes survive tool-description edits but need re-recording when system prompts or conversation flow change. Only
a passing run overwrites a scenario's cassette. The live key comes from `OPENAI_API_KEY` or the repo-root `.keys` file
(never committed). Every scenario asserts on durable state (runs, journals, session events) and dumps full transcripts
to `agents/e2e-artifacts/<timestamp>/` for prompt autopsies. Scenarios: `chat-smoke`, `sub-basic`, `sub-typed`,
`sub-restraint`, `wf-hello`, `todo-adoption`.

Status: the cassettes on disk were last recorded from live gpt-5-mini before the verb collapse and are now stale (see
the note at the top of this section); the scenario code itself still exercises the current Service. The last live
recording pass surfaced (and fixed) three real-model defects: top-level-array output schemas now rejected at spawn time
with a self-correctable message, `functions.`-prefixed tool names normalized in scripts' `ctx.call`, and the standard
`minItems`/`maxItems`/`maxLength`/`maximum` keywords added to the schema subset.

## Live gate (real server, real model)

`agents/e2e/live-gate.ts` is the other half of the story: a pure client that signs envelopes with the desktop daemon's
key over grpc-web — exactly as the desktop app does — and talks CBOR to an already-running server, so it gates the thing
an operator actually uses rather than an in-process Service. It creates a throwaway `NightGate` agent mirroring an
existing agent's provider/model/tools, runs the scenarios, writes full transcripts to an artifact directory, and deletes
the agent again.

```bash
cd agents
bun e2e/live-gate.ts                                  # every scenario against http://localhost:3051
bun e2e/live-gate.ts trivial memory                   # a subset
bun e2e/live-gate.ts --base http://localhost:3099 --out /tmp/gate --keep
```

Flags: `--base` (agents server), `--daemon` (Seed daemon grpc-web, default `http://localhost:56001`), `--account` (uid
to sign as), `--provider` / `--model`, `--like` (agent id to mirror), `--out`, `--timeout` (per-scenario ms, default
600000), `--keep` (leave the NightGate agent behind).

Scenarios: `trivial` (restraint plus self-naming — arithmetic must be answered directly, with no delegation, and the
session still ends up model-titled), `memory` (a fact written to `~/memory` in one session, read back by a second),
`parallel-delegate`, `script-parallel`, `script-narration`. Enforced checks are deterministic properties; model behavior
is reported rather than asserted.

This gate spends real tokens and needs a running server with a working provider. It is never part of `bun test`.

Two focused companions live beside it, both model-free so they gate a mechanism rather than a model:

- `e2e/narration-check.ts` drives the script VM directly (no model, no server, no credentials) and asserts that a
  `ctx.call(tool, input, {description})` label reaches both the durable journal entry and the tool-call adapter — the UI
  reads the first, the run transcript reads the second.
- `e2e/obligations-live-check.ts` drives a real server over HTTP with a scripted provider (`e2e/scripted-provider.ts`)
  through the whole unified-obligations loop: a plan-shaped task, a step left open at turn end, the continuation the
  runtime hands itself, and the settled checklist afterwards.

### Simulated-model gates (no API key required)

When a live gate cannot run — and as a repeatable practice for iterating tool prompts — validation uses **blind
simulated-model agents**: a fresh LLM session (a Claude Code subagent) is given ONLY what the runtime model sees (the
system prompt plus the registry `description`/`inputSchema` of the tools under test, read from
`agents/protocol/src/tool-registry.ts`) and asked to produce its exact assistant turns for scripted scenarios. Its tool
calls are then validated mechanically: delegation choices checked against intent, declared output schemas run through
`validateJsonSchemaShape`, and authored script source run through `lintWorkflowSource` and executed in the real engine
(`runWorkflowVM`) against scripted adapters. The 2026-08-03 pass (against the pre-verb tool names) validated delegation
choice — parallel typed fan-out, detached spawning only for fire-and-forget work, no tools at all for trivial input —
and script authoring: a ~100-line module that lint-passed and ran correctly, unmodified, first try. The simulators'
lists of guessed-at contracts drove the ctx-contract tightening in the tool descriptions and the bare-string `ctx.plan`
fix. The key property making this honest: the simulator must be **blind** — no access to implementation, docs, or tests,
only the model-facing prompt surface.

## Startup behavior

On startup:

1. `config.create(config.parseArgs())` builds config.
2. `sqlite.open(cfg.dbPath)` validates or initializes the DB.
3. If schema is valid, `Service` (which boot-sweeps the run queue), the activity trigger monitor, and the schedule
   trigger monitor are created and Bun server starts.
4. If schema is mismatched, server starts in schema-mismatch mode and returns a JSON error.

Schema mismatch log includes stored and expected version. For local throwaway data, delete the SQLite files and restart.

## Shutdown behavior

The service handles `SIGINT` and `SIGTERM`:

1. stop repeated shutdown handling;
2. stop the activity trigger monitor and the schedule monitor;
3. close WebSocket clients with code `1001`;
4. clear client set;
5. stop Bun server;
6. drain in-flight background runs, bounded at 5 seconds so one stuck session cannot block shutdown, then stop the
   run-queue timers;
7. close SQLite DB;
8. exit.

## CORS

Health and CBOR API routes return permissive CORS headers. Security is based on signatures and account authorization,
not browser origin.

## Diagnostics and logs

Current logs intentionally include IDs, counts, statuses, sizes, timings, trigger sources, and compact activity metadata
— not secrets or full message/session content. Activity trigger diagnostics use:

- `[Agents Activity] Polling feed`
- `[Agents Activity] Feed page received`
- `[Agents Activity] First poll processing events`
- `[Agents Activity] Processing feed events`
- `[Agents Activity] Poll failed`
- `[Agents Trigger] Skipping activity without stable key`
- `[Agents Trigger] Checked activity against trigger`
- `[Agents Trigger] Skipping duplicate trigger firing`
- `[Agents Trigger] Skipping run-completed trigger already in this chain`
- `[Agents Trigger] Fired trigger and created session`
- `[Agents Trigger] Trigger session run enqueued`
- `[Agents Trigger] Trigger session dispatch failed`
- `[Agents Trigger] Trigger woke a parked run`
- `[Agents Trigger] Trigger fired with no run listening`
- `[Agents Trigger] Trigger firing failed`

Run, runtime, and script diagnostics:

- `[agents/runs] boot sweep requeued interrupted runs`
- `[agents/runs] boot reconcile: replaying finished child into parked parent`
- `[agents/runs] activity woke a waiting run`
- `[agents/runtime] sending provider request`
- `[agents/runtime] ending turn after tool batch`
- `[agents/runtime] sub-session spawned` / `[agents/runtime] sub-session resolved`
- `[agents/runtime] plan step settled from children`
- `[agents/runtime] agent started session` / `[agents/runtime] agent-started session run failed`
- `[agents/runtime] session titled by model` / `[agents/runtime] session title generation failed`
- `[agents/workflow] workflow spawned from chat`
- `[agents/workflow] continued as new run`
- `[agents/workflow] run paused on its time budget`

Server model execution now goes through the Pi SDK. The old manual OpenAI stream logs are not emitted on the primary
Pi-backed path. Use durable session events (via `GetSession` or the desktop session page), WebSocket partial logs, and
mocked tests for current runtime diagnosis. Add Seed-level Pi runtime diagnostics before production if real-provider
troubleshooting needs more visibility.

Server WebSocket logs:

- `[agents/ws] open`
- `[agents/ws] subscribed`
- `[agents/ws] publish partial`
- `[agents/ws] send partial`
- `[agents/ws] skip partial; no subscription`
- `[agents/ws] close`

Desktop WebSocket/UI logs:

- `[agents/ws] connecting`
- `[agents/ws] open; signing subscribe`
- `[agents/ws] subscribe sent`
- `[agents/ws] subscribed event`
- `[agents/ws] partial event`
- `[agents/ws] partial state updated`
- `[agents/ws] partial marked done; keeping visible until durable append`
- `[agents/ui] sending session message`
- `[agents/ui] rendering streaming assistant partial`

## Troubleshooting

### Desktop says server offline

Check (`3051` in the dev shell, `3050` for a release/packaged build):

```bash
curl http://localhost:3051/agents/api/health
```

Start server:

```bash
direnv exec . bash -lc 'cd agents && bun src/main.ts'
```

### WebSocket subscription says `Invalid signature`

Likely causes:

- desktop/server protocol mismatch;
- signed action contains values that encode differently before/after decode;
- explicit `undefined` fields were sent.

Current desktop signing omits `undefined` recursively before signing. If this returns, inspect
`frontend/apps/desktop/src/agents-client.ts` and server `auth.verifyEnvelope()`.

### No live streaming appears

Follow the log chain:

1. Desktop should show `[agents/ws] subscribed event` for `sessions/<sessionId>`.
2. The session should be set to `streaming` after `MessageSession`.
3. Server should then show `[agents/ws] publish partial` and `[agents/ws] send partial` when Pi emits text deltas.
4. Desktop should show `[agents/ws] partial event` and `[agents/ui] rendering streaming assistant partial`.
5. The final assistant message should appear as a durable event in the desktop session page after refresh.

If server shows `skip partial; no subscription`, the desktop subscribed too late or to a different key/account.

### API key save fails

Desktop refuses to send API keys to non-local plain HTTP servers. Use HTTPS for remote servers or local loopback for
development.

### Schema mismatch

For local reset:

```bash
rm -f agents/data/agents.sqlite agents/data/agents.sqlite-shm agents/data/agents.sqlite-wal
```

Do not do this for persistent/shared data.

## Logging safety

Do not add logs that include:

- plaintext secrets;
- decrypted API keys;
- signed request bodies;
- full model request/response bodies;
- full session messages;
- large tool outputs.

Prefer logging IDs, lengths, counts, timings, statuses, and booleans.
