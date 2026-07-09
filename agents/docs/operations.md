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
  `seedhypermedia/agents:dev`, which `agents-dev` tracks.
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

`agentic.seed.hyper.media` runs `/opt/agentic/docker-compose.yml` with Watchtower (`nickfedor/watchtower:1.18.1`,
label-enabled, 5-minute interval) auto-pulling the `agents-stable` (`:latest`) and `agents-dev` (`:dev`) containers.
After pushing a new image it deploys within the poll interval, or force it immediately:

```bash
# Force an update now (proves Watchtower works end to end and pulls labeled containers):
ssh ubuntu@agentic.seed.hyper.media \
  'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
     nickfedor/watchtower:1.18.1 --run-once --label-enable --cleanup'

# Or with compose directly:
ssh ubuntu@agentic.seed.hyper.media \
  'cd /opt/agentic && docker compose pull agents-stable agents-dev && docker compose up -d'
```

> The host's `docker-compose.yml`/`Caddyfile` are not yet tracked in git (the `seed_infra/agentic` Terraform stack
> provisions a bare Docker host only). Treat the file on the host as authoritative until that drift is captured.

## Configuration

Config source: `agents/src/config.ts`.

| Environment variable                    | Default                | Purpose                                                                      |
| --------------------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `SEED_AGENTS_HTTP_HOSTNAME`             | `0.0.0.0`              | HTTP bind hostname.                                                          |
| `SEED_AGENTS_HTTP_PORT`                 | `3050`                 | HTTP port.                                                                   |
| `SEED_AGENTS_DB_PATH`                   | `./data/agents.sqlite` | SQLite DB path.                                                              |
| `SEED_AGENTS_DATA_DIR`                  | `./data`               | Data directory.                                                              |
| `SEED_AGENTS_HM_SERVER_URL`             | `https://hyper.media`  | Upstream SHM HTTP API used for ActivityFeed polls and HM tool reads/writes.  |
| `SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS` | `5000`                 | Activity and schedule trigger monitor poll interval.                         |
| `SEED_AGENTS_ACTIVITY_PAGE_SIZE`        | `50`                   | ActivityFeed page size.                                                      |
| `SEED_AGENTS_ACTIVITY_MAX_PAGES`        | `5`                    | Max pages fetched per poll.                                                  |
| `SEED_AGENTS_SEARXNG_URL`               | _(unset)_              | Self-hosted SearXNG base URL. Enables the `web_search` tool.                 |
| `SEED_AGENTS_CRAWLER_URL`               | _(unset)_              | Self-hosted Crawl4AI base URL. Enables `web_read` browser-render escalation. |
| `SEED_AGENTS_CRAWLER_TOKEN`             | _(unset)_              | Bearer token for Crawl4AI (required by Crawl4AI >= 0.9).                     |

CLI flags override env/defaults:

```bash
bun src/main.ts \
  --server-hostname 127.0.0.1 \
  --server-port 3050 \
  --db-path ./data/agents.sqlite \
  --data-dir ./data \
  --hm-server-url https://hyper.media
```

## Web research backends

The `web_search` and `web_read` tools are fully self-hosted and use no third-party API keys. They are optional: without
configuration the tools are simply unavailable (`web_search` errors; `web_read` falls back to its MediaWiki and
in-process static tiers). To enable them, run the backends as sidecar containers on the same internal network and point
the agents service at them.

For local development a ready-to-run compose and SearXNG config live at `agents/dev/web-backends/`. Start the
containers, then run the service — `bun run dev` already points at these dev endpoints by default:

```bash
cd agents/dev/web-backends && docker compose up -d   # SearXNG on :8899, Crawl4AI on :11235
cd ../.. && bun run dev                               # auto-targets the dev backends
```

The `dev` script defaults `SEED_AGENTS_SEARXNG_URL` (`http://127.0.0.1:8899`), `SEED_AGENTS_CRAWLER_URL`
(`http://127.0.0.1:11235`), and `SEED_AGENTS_CRAWLER_TOKEN` (`dev-crawl-token`) to the compose values; export those env
vars to override. The startup log prints `Web tools: search=on reader=static+crawl4ai` when wired. `web_read`'s
MediaWiki and static tiers still work if the containers are not running; only `web_search` and the browser escalation
need them. Stop the backends with `docker compose down` in `agents/dev/web-backends/`.

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

The health endpoints (`/api/health`, `/agents/api/health`) report which optional web backends are configured via a
`webTools: {search, readBrowser}` capability object (derived from `SEED_AGENTS_SEARXNG_URL` /
`SEED_AGENTS_CRAWLER_URL`). The desktop Tools tab reads this to grey out tools the server cannot run.

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

SQLite is authoritative. Agent state directories are created on agent creation and are reserved for future
artifacts/state.

## HTTP endpoints

| Endpoint                             | Method    | Purpose                                    |
| ------------------------------------ | --------- | ------------------------------------------ |
| `/`                                  | `GET`     | Redirects to `/agents`.                    |
| `/api/message`                       | `POST`    | Signed CBOR action API.                    |
| `/agents/api/message`                | `POST`    | Same action API under `/agents`.           |
| `/api/health`                        | `GET`     | JSON health (includes `version`).          |
| `/agents/api/health`                 | `GET`     | JSON health under `/agents`.               |
| `/api/version`                       | `GET`     | Build metadata of the deployed image.      |
| `/agents/api/version`                | `GET`     | Build metadata under `/agents`.            |
| `/agents/api/status`                 | `GET`     | Debug overview for inspector UI.           |
| `/agents/api/session?id=<sessionId>` | `GET`     | Debug session event data for inspector UI. |
| `/agents`                            | `GET`     | Built-in session inspector UI.             |
| `/agents/*`                          | `GET`     | Built inspector assets or dev fallback.    |
| `/agents/ws`                         | WebSocket | Signed live subscriptions.                 |

## Built-in inspector UI

Open:

```text
http://localhost:3050/agents
```

It shows:

- server uptime;
- connected WebSocket count;
- all agents visible in the local DB;
- triggers grouped by agent, including enabled state, firing counts, last firing time, and last error;
- activity monitor watermarks by account/server;
- sessions grouped by agent;
- session status and event counts;
- durable session event details.

It auto-refreshes every 2 seconds. It is a diagnostic UI, not a replacement for the desktop workflow.

## Trigger monitors

The server starts a background ActivityFeed monitor for enabled HM activity triggers. It polls every 2 seconds by
default and does not contact the HM activity feed unless an account has at least one enabled trigger. The first poll for
an account establishes a baseline watermark and only processes activity observed after the earliest enabled trigger was
created. Later polls process new ActivityFeed events through trigger matching. If a persisted watermark is older because
the server was down, the monitor backfills unseen events for up to 1 hour and then advances the watermark.

The server also starts a background schedule monitor. It evaluates enabled `schedule` triggers on the same poll
interval, records durable `trigger_firings` rows with `schedule:<triggerId>:<scheduledAt>` idempotency keys, creates
sessions for due occurrences, and disables one-time triggers after a successful run.

## Startup behavior

On startup:

1. `config.create(config.parseArgs())` builds config.
2. `sqlite.open(cfg.dbPath)` validates or initializes the DB.
3. If schema is valid, `Service`, the activity trigger monitor, and the schedule trigger monitor are created and Bun
   server starts.
4. If schema is mismatched, server starts in schema-mismatch mode and returns a JSON error.

Schema mismatch log includes stored and expected version. For local throwaway data, delete the SQLite files and restart.

## Shutdown behavior

The service handles `SIGINT` and `SIGTERM`:

1. stop repeated shutdown handling;
2. stop the activity trigger monitor;
3. close WebSocket clients with code `1001`;
4. clear client set;
5. stop Bun server;
6. close SQLite DB;
7. exit.

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
- `[Agents Trigger] Skipping trigger firing during cooldown`
- `[Agents Trigger] Fired trigger and created session`
- `[Agents Trigger] Trigger firing failed`

Server model execution now goes through the Pi SDK. The old manual OpenAI stream logs are not emitted on the primary
Pi-backed path. Use durable session events, WebSocket partial logs, mocked tests, and the `/agents` inspector for
current runtime diagnosis. Add Seed-level Pi runtime diagnostics before production if real-provider troubleshooting
needs more visibility.

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

Check:

```bash
curl http://localhost:3050/agents/api/health
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
5. The final assistant message should appear as a durable event in `/agents` inspector and after refresh.

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
