---
name: Endpoints and health
summary: The HTTP and WebSocket paths an app environment answers on, the base URL shapes a client may hold, and the health, version, timing and metrics endpoints an operator watches.
---
An [app environment](../software/app-environment.md) is one HTTP server. This page lists every path it answers, says how a client turns one base URL into those paths, and documents the open endpoints an operator uses: health, version, timing counters and metrics. The signed actions themselves are in the [signed API](../build/signed-api.md), and live updates in [WebSocket subscriptions](../build/websocket-subscriptions.md).

# Paths <!-- id:oTx-eqES -->

Every endpoint lives under the canonical prefix `/hm/api/apps`, so the service can sit on its own host or on a site's own origin with one reverse-proxy rule. The same routes answer under `/hm/api/agents`, the earlier prefix, which released clients, published bindings and webhook URLs already handed out name. The legacy paths (`/api/*`, `/agents/api/*`, `/agents/ws`) stay registered for clients that hold a bare origin. <!-- id:tYSO6ajj -->

<!-- id:WyyD8vqE -->
| Endpoint <!-- col:QqHnNcMC --> | Method <!-- col:0cPxyrJj --> | Purpose <!-- col:oVN2t9-G --> <!-- id:p8d1Mrxo --> |
| --- | --- | --- |
| `/hm/api/apps/message` | `POST` | Signed CBOR action API (canonical). <!-- id:zX6SdlMV --> |
| `/hm/api/apps/ws` | WebSocket | Signed live subscriptions (canonical). <!-- id:8py3ZRIE --> |
| `/hm/api/apps/health`, `/version`, `/perf`, `/perf/sessions/<sessionId>`, `/metrics` | `GET` | Health, build metadata, timing counters, Prometheus metrics (canonical). <!-- id:546OlRfm --> |
| `/hm/api/apps/webhooks/<triggerId>[/<secret>]` | `POST` | Webhook trigger delivery (canonical). <!-- id:MExnSG43 --> |
| `/hm/api/apps` | `GET` | The apps running on this server, as plain JSON. Open. Only under this prefix. |
| `/hm/api/apps/<space>/<app path>` | `GET` | One running app with its tools, or one of its tools with its recent calls, as plain JSON. Open. A `POST` answers `405`: a tool call is a signed `CallAppTool` action. |
| `/api/message` | `POST` | Signed CBOR action API. <!-- id:D634v2_4 --> |
| `/agents/api/message` | `POST` | Same action API under `/agents`. <!-- id:0MOz3jtf --> |
| `/api/health` | `GET` | JSON health and capabilities (no account data). <!-- id:A68cofS7 --> |
| `/agents/api/health` | `GET` | JSON health under `/agents`. <!-- id:b1WZL61v --> |
| `/api/version` | `GET` | Build metadata of the deployed image. <!-- id:2Y7ZWDiX --> |
| `/agents/api/version` | `GET` | Build metadata under `/agents`. <!-- id:UrIALpko --> |
| `/agents/ws` | WebSocket | Signed live subscriptions. <!-- id:Em_QCmeP --> |

The legacy forms of the other endpoints are `/api/perf` and `/agents/api/perf` (and `/api/perf/sessions/<sessionId>`), `/api/metrics` and `/agents/api/metrics`, and `POST /agents/api/webhooks/<triggerId>` and `/<triggerId>/<secret>`. A [trigger](../agent/triggers.md)'s `endpointPath` names the canonical webhook form. This site writes the short forms `/api/health`, `/api/version`, `/api/perf` and `/api/metrics` when it talks about a server reached directly on its port; the same handler answers every spelling.

Everything else is a 404. The server has no browser UI and no unauthenticated data routes. Account-owned state (agents, triggers, sessions, events, memory) is reachable only through signed envelopes on the message endpoint and the WebSocket. Use the desktop app, or the signed API (`ListAgents`, `ListSessions`, `GetSession`, `GetAgentTrigger`, `ListRuns`), to inspect a server. <!-- id:cJBkT6iS -->

# Base URL <!-- id:CJWNG9gR -->

A client holds one base URL per app environment and picks the endpoint paths from its shape (`agentServerEndpoint()` in `frontend/packages/ui/src/agents/client.ts`): <!-- id:_3fqlgq8 -->
  - **Canonical**: the path ends in `/hm/api/apps` or `/hm/api/agents`, for example `https://site.example/hm/api/apps`. The client calls `<base>/message`, `<base>/ws`, `<base>/health` and `<base>/webhooks/…`. <!-- id:p4SQmeaZ -->
  - **Legacy**: an origin only, for example `https://apps.seed.hyper.media` (a trailing `/agents` is stripped). The client calls `/api/message`, `/agents/ws` and `/agents/api/*` under it. <!-- id:hS7cHZfj -->

The hosted environments are reached in the canonical form on their gateway's origin, for example `https://hyper.media/hm/api/apps`, which is the desktop app's default (`frontend/apps/desktop/src/agents-defaults.ts`). A site may serve an app environment on its own origin in the same way: the reverse proxy routes `/hm/api/apps/*` and `/hm/api/agents/*` (API and WebSocket) to the app environment container, and the site advertises that URL as its app environment (`SEED_AGENT_SERVER_URL` on the [web app](../software/web.md), surfaced as `agentServerUrl` in `/hm/api/config`). The web app never proxies this traffic. Pointing a client at a bare site origin does not work: `<origin>/api/message` is the site's own API, not the app environment.

`SEED_APPS_PUBLIC_URL` tells the server the URL clients reach it at. It reports it as `publicUrl` in health, and an app run here names it as its `appEnvironmentUrl`.

On an [enterprise node](./enterprise-node.md), a members-only site, these paths sit behind the same sign-in gate as the rest of the site, except `POST …/webhooks/*`, which outside services call with the trigger secret and which stays open. The app environment reads its members-only site with the deployment's service secret (`SEED_APPS_HM_SERVER_SECRET`, sent as `X-Seed-Service-Secret` only to that site's origin; `apps/src/hm-server-auth.ts`), so mention triggers keep firing behind the gate. <!-- id:oNdAu6c9 -->

# Health

The health endpoints report what this server can actually do: <!-- id:15g_rrEQ -->

```json <!-- id:dv8IoP83 -->
{
  "status": "ok",
  "loop": {"lag": {"p50": 1, "p95": 3, "max": 12, "windowMs": 60000}},
  "uptime": 1234.5,
  "version": "<image tag>",
  "protocol": 3,
  "minClientProtocol": 1,
  "hmServerUrl": "https://hyper.media",
  "publicUrl": "https://hyper.media/hm/api/apps",
  "serverId": "…",
  "ipfsServerUrl": "https://hyper.media",
  "webTools": {"search": true, "readBrowser": true},
  "subscriptionAuth": false,
  "defaultPromptUrl": "hm://<knowledge base account>/agent/guide",
  "codeExec": true,
  "codeExecReason": "…",
  "codeExecReasonCode": "…",
  "codeExecRuntimes": ["ts", "python", "shell"],
  "execCanary": {"ok": true, "lastRunAt": 1700000000000, "consecutiveFailures": 0},
  "disk": {"freeBytes": 123456789, "minFreeBytes": 536870912, "ok": true},
  "dispatch": {"paused": false},
  "bootRecovery": {"state": "done", "ms": 412}
}
```

`ipfsServerUrl` defaults to `hmServerUrl`, which is correct for hosted all-in-one origins. Local desktop environments set them separately because the desktop bridge owns `/api/*` while the daemon owns gateway reads under `/ipfs/*`. IPFS publication itself chunks [UnixFS](../protocol/files.md) blocks and uses `PublishBlobs` on `hmServerUrl`. `webTools` derives from `SEED_APPS_SEARXNG_URL` and `SEED_APPS_CRAWLER_URL`. `codeExec` derives from the exec backend probe, and `codeExecReason` and `codeExecReasonCode` explain an unavailable sandbox. `codeExecRuntimes` says which runtimes this host offers. `ts` needs an image with bun, so an operator can see at a glance whether TypeScript execution is on here. Clients read these fields to grey out what the server cannot run. `disk` is the free space where the database lives against the floor new runs require (`null` when the check is off), and `dispatch` says whether the queue is claiming runs; `{paused: true, reason}` names what stopped it. See the [effect outbox](../agent/effect-outbox.md). <!-- id:5FIU-ofh -->

The other fields:

- `loop.lag` is how late a 100 ms timer fires, over the last minute. While its p95 is above 250 ms the answer is `503` with `{"status": "unhealthy", "reason": "loop-lag", "p95": …}`. See [diagnosing a stalled server](./stalled-server.md).
- `publicUrl` is `SEED_APPS_PUBLIC_URL`, or `null`. `serverId` is this server's stable identity: a server checks that the URL an app names is itself by matching it.
- `defaultPromptUrl` is the [Agent Guide](../agent/guide.md) a new agent embeds, with the `hm://hyper.media` alias resolved to the knowledge base account.
- `subscriptionAuth` says whether provider sign-in is offered; see [model providers](../agent/model-providers.md).
- `execCanary` is the last result of the sandbox probe, or `null` when the canary is off. It never turns health `503`. See the [code execution backend](./code-execution-backend.md#is-code-execution-working).
- `protocol` and `minClientProtocol` are the protocol versions of the [signed API](../build/signed-api.md).

The health payload carries no account data.

## While the server starts

The server binds its port before it opens the database. Until it is ready, every health path answers `503` with `{"status": "starting", "phase": "…", "reason": "…"}` and a `Retry-After`, and every other path answers `503`. The phases are opening the database (migrations, planner statistics), starting the run queue (the boot sweeps), and starting monitors. Each step logs `[agents/boot] step finished` with its duration, and `App environment running` carries the total `bootMs`. A step is synchronous on the only thread, so a request that arrives during it is answered when it ends. The parked-run reconcile and receipt pruning run after the server is ready, one run at a time with the event loop given back in between; `bootRecovery` reports them as `pending`, `running`, `done` (with `ms`) or `failed` (with `error`). The container healthcheck allows a ten-minute start period for a cold boot on a large database.

The `starting` body is served on `/hm/api/agents/health`, `/api/health` and `/agents/api/health`. During boot `/hm/api/apps/health` gets the plain `503` that every other path gets.

When the database fails the schema gate, every route answers `500` with `{"error": "schema mismatch"}`; see [persistence](./persistence.md#schema-gate).

# Version

`/api/version` returns the image tag, commit, branch and build date. [Deploying](./deploying.md#version-metadata) says where the values come from.

# Timing counters and metrics

`GET /api/perf` returns per-stage timing counters, the event-loop lag, the wall time of every signed action by name (`api.<ActionName>`) and the time inside every prepared statement by its first keyword (`sql.<keyword>`). `GET /api/perf/sessions/<sessionId>` returns one session's rollup: tool names, counts and milliseconds, never content. Both are open like health. The full session id is required, and an unknown one is a 404.

`GET /api/metrics` serves the same aggregates and the exec canary in Prometheus text format, for a metrics collector and alert rules. [Diagnosing a stalled server](./stalled-server.md) and the [code execution backend](./code-execution-backend.md#is-code-execution-working) say how to read them.

# CORS <!-- id:zUgG1bJ7 -->

Health and CBOR API routes return permissive CORS headers. Security comes from [signatures](../signature.md) and account authorization. Browser origin plays no part. <!-- id:zx4dahLP -->

# See also

- [Signed API](../build/signed-api.md), the actions sent to the message endpoint
- [WebSocket subscriptions](../build/websocket-subscriptions.md), the live channel
- [Triggers](../agent/triggers.md), for webhook delivery
- [Configuration](./configuration.md), the settings the health payload reflects
- [Troubleshooting](./troubleshooting.md), symptoms that start with a health check
- [Security](../agent/security.md), why open endpoints carry no account data
