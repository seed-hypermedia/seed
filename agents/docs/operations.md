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
```

Desktop:

```bash
direnv exec . bash -lc './dev run-desktop'
```

## Configuration

Config source: `agents/src/config.ts`.

| Environment variable                    | Default                | Purpose                                                                     |
| --------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `SEED_AGENTS_HTTP_HOSTNAME`             | `0.0.0.0`              | HTTP bind hostname.                                                         |
| `SEED_AGENTS_HTTP_PORT`                 | `3050`                 | HTTP port.                                                                  |
| `SEED_AGENTS_DB_PATH`                   | `./data/agents.sqlite` | SQLite DB path.                                                             |
| `SEED_AGENTS_DATA_DIR`                  | `./data`               | Data directory.                                                             |
| `SEED_AGENTS_HM_SERVER_URL`             | `https://hyper.media`  | Upstream SHM HTTP API used for ActivityFeed polls and HM tool reads/writes. |
| `SEED_AGENTS_ACTIVITY_POLL_INTERVAL_MS` | `5000`                 | Activity and schedule trigger monitor poll interval.                        |
| `SEED_AGENTS_ACTIVITY_PAGE_SIZE`        | `50`                   | ActivityFeed page size.                                                     |
| `SEED_AGENTS_ACTIVITY_MAX_PAGES`        | `5`                    | Max pages fetched per poll.                                                 |

CLI flags override env/defaults:

```bash
bun src/main.ts \
  --server-hostname 127.0.0.1 \
  --server-port 3050 \
  --db-path ./data/agents.sqlite \
  --data-dir ./data \
  --hm-server-url https://hyper.media
```

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
| `/api/health`                        | `GET`     | JSON health.                               |
| `/agents/api/health`                 | `GET`     | JSON health under `/agents`.               |
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
