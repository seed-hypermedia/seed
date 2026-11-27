---
name: Endpoints and health
summary: This page lists every HTTP and WebSocket path an app environment answers on, explains the two shapes of base URL a client may hold, and describes the health, version, timing and metrics endpoints an operator watches.
---
An [app environment](../software/app-environment.md) is one HTTP server. This page lists every path it answers. It also explains the endpoints you can call without a signature: health, version, timing counters and metrics.

The first thing to check on any server is health: `curl <server>/api/health`. A `200` with `"status": "ok"` means the server is up and ready. The [Health](#health) section explains the rest of the answer.

The signed actions themselves are in the [signed API](../build/signed-api.md), and live updates are in [WebSocket subscriptions](../build/websocket-subscriptions.md).

# Paths <!-- id:oTx-eqES -->

Every endpoint lives under one prefix, `/hm/api/apps`. So the server can sit on its own host, or on the origin of a [site](../protocol/sites.md) with one reverse-proxy rule. The server answers the same routes in two more spellings: <!-- id:tYSO6ajj -->

- under `/hm/api/agents`, the older prefix. Released clients, published bindings and webhook URLs that were already handed out use it;
- under the short paths `/api/*`, `/agents/api/*` and `/agents/ws`, for clients that hold only an origin.

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

The other endpoints have short forms too: `/api/perf` and `/agents/api/perf` (and `/api/perf/sessions/<sessionId>`), `/api/metrics` and `/agents/api/metrics`, and `POST /agents/api/webhooks/<triggerId>` and `/<triggerId>/<secret>`. The `endpointPath` of a webhook [trigger](../trigger.md) names the `/hm/api/apps` form; see [triggers](../agent/triggers.md).

These pages write the short forms `/api/health`, `/api/version`, `/api/perf` and `/api/metrics` when they talk about a server you reach directly on its port. The same code answers every spelling.

Everything else is a `404`. The server has no pages for a browser and no data routes that work without a signature. What an [account](../protocol/identity.md) owns ([agents](../agent.md), triggers, sessions, events, memory) can be reached only with a signed request, on the message endpoint and the WebSocket. The [signed API](../build/signed-api.md#signed-envelope) describes the envelope such a request travels in. To look inside a server, use the [desktop app](../software/desktop.md) or the signed actions `ListAgents`, `ListSessions`, `GetSession`, `GetAgentTrigger` and `ListRuns`. <!-- id:cJBkT6iS -->

# Base URL <!-- id:CJWNG9gR -->

A client holds one base URL for each app environment. It works out the endpoint paths from the shape of that URL (`agentServerEndpoint()` in `frontend/packages/ui/src/agents/client.ts`): <!-- id:_3fqlgq8 -->
  - **Canonical**: the path ends in `/hm/api/apps` or `/hm/api/agents`, for example `https://site.example/hm/api/apps`. The client calls `<base>/message`, `<base>/ws`, `<base>/health` and `<base>/webhooks/…`. <!-- id:p4SQmeaZ -->
  - **Legacy**: an origin only, for example `https://apps.seed.hyper.media` (a trailing `/agents` is stripped). The client calls `/api/message`, `/agents/ws` and `/agents/api/*` under it. <!-- id:hS7cHZfj -->

Clients reach the hosted Seed servers in the canonical form, on the origin of their [gateway](../protocol/sites.md). An example is `https://hyper.media/hm/api/apps`, which is the default of the desktop app (`frontend/apps/desktop/src/agents-defaults.ts`).

A site can serve an app environment on its own origin in the same way:

1. The reverse proxy sends `/hm/api/apps/*` and `/hm/api/agents/*`, both the API and the WebSocket, to the app environment container.
2. The site names that URL as its app environment. You set `SEED_AGENT_SERVER_URL` on the [web app](../software/web.md), and `/hm/api/config` reports it as `appEnvironmentUrl` (and as `agentServerUrl`, the older name).

The web app never passes this traffic on itself. Do not give a client the bare origin of a site: `<origin>/api/message` is the site's own API, not the app environment.

`SEED_APPS_PUBLIC_URL` tells the server the URL that clients reach it at. The server reports it as `publicUrl` in health, and an app that runs here names it as its `appEnvironmentUrl`.

An [enterprise node](./enterprise-node.md) is a site for members only. There, these paths sit behind the same sign-in check as the rest of the site. One path stays open: `POST …/webhooks/*`, which outside services call with the trigger's secret. <!-- id:oNdAu6c9 -->

The app environment itself must read that members-only site. It does so with the deployment's service secret, `SEED_APPS_HM_SERVER_SECRET`, which it sends as `X-Seed-Service-Secret` only to that site's origin (`apps/src/hm-server-auth.ts`). So triggers that react to mentions keep firing.

# Health

The health endpoint reports what this server can do: <!-- id:15g_rrEQ -->

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
  "features": ["tools", "apps", "agents"],
  "sandboxWarmUp": {"state": "ready", "durationMs": 41250},
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

The fields, one by one: <!-- id:5FIU-ofh -->

- `hmServerUrl` and `ipfsServerUrl` are where the server reads and writes. `ipfsServerUrl` is the same as `hmServerUrl` unless you set it, which is right when one origin serves both. A local desktop setup sets them apart, because the desktop app answers `/api/*` and the [daemon](../software/daemon.md) answers file reads under `/ipfs/*`. To publish a file, the server cuts it into [UnixFS](../protocol/files.md) pieces and sends them with `PublishBlobs` to `hmServerUrl`.
- `webTools` comes from `SEED_APPS_SEARXNG_URL` and `SEED_APPS_CRAWLER_URL`. `search: false` means a `web_search` call fails. `readBrowser: false` means web reads cannot fall back to a browser.
- `codeExec` comes from a probe of the sandbox backend. When it is `false`, agents are not offered `execute`, and `codeExecReason` and `codeExecReasonCode` say why.
- `codeExecRuntimes` lists the runtimes this host offers. `ts` needs an image with bun, so this field shows whether TypeScript execution is on.
- `disk` compares how much disk is free where the database lives with the least amount a new run needs. It is `null` when the check is off.
- `dispatch` says whether the queue is taking runs. `{paused: true, reason}` names what stopped it. See the [run queue](./run-queue.md#when-dispatch-pauses) and the [effect outbox](../agent/effect-outbox.md).

Clients read these fields to grey out what the server cannot do.

The other fields:

- `loop.lag` is how late a 100 ms timer fires, over the last minute. While its p95 is above 250 ms the answer is `503` with `{"status": "unhealthy", "reason": "loop-lag", "p95": …}`. See [diagnosing a stalled server](./stalled-server.md).
- `publicUrl` is `SEED_APPS_PUBLIC_URL`, or `null`. `serverId` is this server's stable identity: a server checks that the URL an app names is itself by matching it.
- `defaultPromptUrl` is the [Agent Guide](../agent/guide.md) a new agent embeds, with the `hm://hyper.media` alias resolved to the knowledge base account.
- `subscriptionAuth` says whether provider sign-in is offered; see [model providers](../agent/model-providers.md).
- `sandboxWarmUp` is the one-time start of the first sandbox, on a server started with `SEED_APPS_EXEC_WARM_UP`. `state` is `off`, `warming`, `ready` or `failed`. While it is `warming`, a tool run waits for the sandbox, and a client can say so.
- `features` lists what the server runs: tools on their own, apps, agents. A client offers the server only for those. A server that sends no list is an older one, and runs all three. See [configuration](./configuration.md).
- `execCanary` is the last result of the sandbox probe, or `null` when the canary is off. It never turns health `503`. See the [code execution backend](./code-execution-backend.md#is-code-execution-working).
- `protocol` and `minClientProtocol` are the protocol versions of the [signed API](../build/signed-api.md).

The health payload carries no account data.

## While the server starts

The server opens its port before it opens the database. Until it is ready, every health path answers `503` with `{"status": "starting", "phase": "…", "reason": "…"}` and a `Retry-After` header. Every other path answers `503` too.

The phases are:

1. opening the database: migrations and planner statistics;
2. starting the run queue: the boot sweeps;
3. starting the monitors.

Each step logs `[agents/boot] step finished` with how long it took, and the line `App environment running` carries the total as `bootMs`. A step holds the only thread until it ends, so a request that arrives during a step is answered when the step ends.

Two jobs run after the server is ready: the reconcile of parked runs, and the pruning of receipts. They work on one run at a time and let other work happen in between. `bootRecovery` reports them as `pending`, `running`, `done` (with `ms`) or `failed` (with `error`). The container's health check allows ten minutes for a first start on a large database.

The `starting` body is served on `/hm/api/agents/health`, `/api/health` and `/agents/api/health`. During boot `/hm/api/apps/health` gets the plain `503` that every other path gets.

When the database fails the schema gate, every route answers `500` with `{"error": "schema mismatch"}`; see [persistence](./persistence.md#schema-gate).

# Version

`/api/version` returns the image tag, commit, branch and build date. [Deploying](./deploying.md#version-metadata) says where the values come from.

# Timing counters and metrics

`GET /api/perf` returns timing counters:

- counters for each stage of a run;
- the event-loop lag;
- the time each signed action took, by name, as `api.<ActionName>`;
- the time spent inside each prepared statement, by its first keyword, as `sql.<keyword>`.

`GET /api/perf/sessions/<sessionId>` returns the totals of one session: tool names, counts and milliseconds, never content. Both endpoints are open, like health. You must give the full session id, and an unknown id is a `404`.

`GET /api/metrics` serves the same aggregates and the exec canary in Prometheus text format, for a metrics collector and alert rules. [Diagnosing a stalled server](./stalled-server.md) and the [code execution backend](./code-execution-backend.md#is-code-execution-working) say how to read them.

# CORS <!-- id:zUgG1bJ7 -->

The health routes and the API routes allow requests from any web origin. Security comes from [signatures](../signature.md) and from what each account is allowed to do. The origin of the browser page plays no part. <!-- id:zx4dahLP -->

# See also

- [Signed API](../build/signed-api.md), the actions sent to the message endpoint
- [WebSocket subscriptions](../build/websocket-subscriptions.md), the live channel
- [Triggers](../agent/triggers.md), for webhook delivery
- [Configuration](./configuration.md), the settings the health payload reflects
- [Troubleshooting](./troubleshooting.md), symptoms that start with a health check
- [Security](../agent/security.md), why open endpoints carry no account data
