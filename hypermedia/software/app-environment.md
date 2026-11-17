---
name: The app environment
summary: The Seed app environment as a program, a Bun server with one SQLite database that runs agents and apps, with where its code is, how it ships, which ports and paths it serves, and where to read more.
---
The app environment is the program that runs [Seed Agents](../agent.md) and [apps](../app.md). It is a Bun server with one SQLite database and no web pages of its own: the [desktop app](./desktop.md), the [web app](./web.md) and the [mobile app](./mobile.md) are its clients. This page is the map of the software. What an agent is and how the runtime behaves is under [Seed Agents](../agent.md). Running a server is under [Operations](../operate/operations.md). Changing the code is under [Development](../contribute/development.md). <!-- id:XahmX6O- -->

# Where the code is <!-- id:m2SxIwMF -->

`apps/`, package `@seed-hypermedia/apps`: a separate Bun workspace. Use Bun commands inside it, never pnpm. It is built on [Pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-ai` for model calls and `@earendil-works/pi-durable` for the agent loop, pinned to 1.0.x), the MCP SDK for connecting to remote [MCP servers](../agent/mcp.md), QuickJS for scripts, and microsandbox microVMs for code execution. It consumes `@seed-hypermedia/client` and `@shm/shared` through `file:` dependencies, which copy the [packages](./packages.md) at install time. <!-- id:YveM76cu -->

<!-- id:p0g-x6aC -->
| Path <!-- col:XVydtKVl --> | What it holds <!-- col:pxciYz7N --> <!-- id:QY9BBlKE --> |
| --- | --- |
| `src/main.ts` | Startup, the HTTP routes and the WebSocket server. <!-- id:Y0Xw5Kqi --> |
| `src/config.ts` | Every flag and its environment variable; the top code comment is the configuration reference. <!-- id:2V09w8mX --> |
| `src/api-service.ts` | The signed action handlers, by far the largest file. <!-- id:WgUneRMx --> |
| `src/durable-session.ts` | The per-session [Pi Durable store](../agent/durable-sessions.md) the model turn runs on. <!-- id:5dMbNOWF --> |
| `src/auth.ts` | Envelope signature checks and capability-based authorization. <!-- id:IKVKS0ev --> |
| `src/runs.ts`, `src/workflow-*.ts` | The run queue and the workflow engine. <!-- id:Jy_5I5KZ --> |
| `src/activity-monitor.ts`, `src/activity-triggers.ts`, `src/schedule-*.ts` | [Trigger](../agent/triggers.md) monitors. <!-- id:FzH_JMtW --> |
| `src/mcp.ts`, `src/web-tools.ts`, `src/code-exec.ts` | MCP client, web search and read, sandboxed execution. <!-- id:jyOzESXQ --> |
| `src/sqlite-schema.sql`, `src/sqlite.ts` | The schema and its version check. <!-- id:24lfD2VY --> |
| `protocol/` | `@seed-hypermedia/apps-protocol`: the wire types shared with clients, `PROTOCOL.md` and the `surface.json` snapshot. <!-- id:FQhl_OyT --> |
| `frontend/packages/ui/src/agents/` | The client side: the signed client, React Query models and chat UI used by desktop, web and mobile. <!-- id:-w9W9xSC --> |

[Development](../contribute/development.md) has the full code map and the conventions. <!-- id:jIOkr9Wm -->

# How it talks to the daemon <!-- id:oU9tXlHs -->

It never talks to a [daemon](./daemon.md) directly. The service talks to a Seed [site](../protocol/sites.md). `--hm-server-url` names the site, `https://hyper.media` by default. The service reads through the [SDK](../build/sdk.md)'s `createSeedClient` against that site's `/api/<Key>` routes (the [Seed API](../build/web-api.md)), publishes signed [blobs](../protocol/blobs.md) with `PublishBlobs`, and fetches media from `--ipfs-server-url`, which defaults to the same origin. It polls that site's activity feed to fire [triggers](../trigger.md). <!-- id:QTtOcGPk -->

# How clients talk to it <!-- id:qkwY9-4k -->

A client holds one base URL for a server. The API has one canonical prefix and two older forms, and the server answers all three.

| Base URL a client holds | Paths |
| --- | --- |
| `<origin>/hm/api/apps` | The canonical prefix: `/message`, `/ws`, `/webhooks/<triggerId>`, `/health`, `/version`, `/perf`, `/metrics`. `GET <origin>/hm/api/apps` itself lists the apps running on the server as plain JSON. |
| `<origin>/hm/api/agents` | The same routes under the older prefix, for released clients and webhook URLs that name it. |
| `<origin>` alone | The oldest form: `/api/message`, `/agents/ws` and `/agents/api/*`. |

`message` is the signed action API: every request is a DAG-CBOR envelope signed by an [account](../protocol/identity.md) key or by a key holding a [capability](../protocol/permissions.md) for the account. `ws` carries signed live subscriptions. The prefixed form lets a site's reverse proxy route one path to the server, so the server can share an origin with a [site](../protocol/sites.md). [Operations](../operate/operations.md) has the full endpoint table, [The signed API](../build/signed-api.md) the actions, and [WebSocket subscriptions](../build/websocket-subscriptions.md) the events.

Clients and servers deploy separately, and a desktop release keeps talking to hosted servers for weeks. So the wire surface carries a protocol version. Clients send it in the envelope, servers answer in the `X-Agents-Protocol` header, and a server refuses clients older than its minimum with HTTP 426. CI runs `bun run protocol:check` to catch breaking changes that did not bump the version. <!-- id:dhf6WuQB -->

# Configuration <!-- id:bFuPQ4V_ -->

Each flag has a `SEED_APPS_*` environment variable, and the older `SEED_AGENTS_*` name is read too. Flags win over variables. `src/config.ts` is the source. The server listens on 3050 by default and on 3051 in development; the [port table](../software.md) has the rest. [Operations](../operate/operations.md) lists every flag, the web and execution backends, and diagnostics. <!-- id:bVVzP_Ph -->

It stores everything in one SQLite database, `agents.sqlite`, plus a data directory for agent state files. [Persistence](../operate/persistence.md) describes the tables. <!-- id:JgSR_DRZ -->

# Running it <!-- id:uDHZk-0W -->

```sh <!-- id:tMioUDoF -->
./dev up                          # the whole stack; the agents pane runs on :3051 with hot reload
cd apps && bun run dev          # the server alone, with SearXNG and Crawl4AI expected locally
cd apps && bun check && bun test
cd apps && bun run test:build   # the compiled binary boots
```

[Development](../contribute/development.md) has the rest of the commands, the local URLs and the test map.

# How it ships <!-- id:MorvdtVJ -->

The same build runs in three places. <!-- id:7xiIpHiu -->

**In the desktop app.** `bun run build:binary` compiles the server with `bun build --compile` into `plz-out/bin/apps/seed-apps-<platform>`, and the [desktop app](./desktop.md) ships that folder as a resource. The desktop app does not start it by default. At startup the app goes through these steps and stops at the first that applies: <!-- id:c23jCXqC -->

1. `SEED_NO_APPS_SPAWN` is set: no local server.
2. `SEED_APPS_SERVER_URL` is set: attach to that server.
3. A healthy server already answers on the default port: attach to it. This is the `./dev up` case.
4. The `agentsLocalServer` setting is `on`, or it was never set and a local database from an earlier run exists: spawn the binary on the first free port from the default.

Otherwise no local server runs, and the app uses the hosted one. The switch under Settings > App environments changes the setting. A spawned server keeps its data in the app's user data folder under `agents/`, uses the desktop API bridge as its [site](../protocol/sites.md) and the [daemon](./daemon.md)'s HTTP port for `/ipfs`, binds `127.0.0.1`, and has subscription login on.

**Hosted.** Images are `seedhypermedia/apps:dev`, built from `main`, and `seedhypermedia/apps:latest`, built on release. A Watchtower container on the agents host redeploys when a tag is pushed, so pushing `latest` is a production deploy. Clients reach each hosted server on its site's own origin, for example `https://hyper.media/hm/api/apps`: the gateway proxies `/hm/api/apps` (on `*.hyper.media` subdomains too) to the host the server runs on, so the web API and the app environment share one host. <!-- id:IiTt1HiF -->

**Self-hosted.** Run the image with a volume on `/data`, a model provider configured by each [account](../protocol/identity.md), and `--hm-server-url` pointing at your site. <!-- id:BYxO5fzs -->

[Environments](../operate/environments.md) describes each of these in full, the hosted servers, and how a client chooses a server.

# Working with it <!-- id:RUi86C0e -->

## In the Seed app <!-- id:Jgb3MPaj -->

The [desktop app](./desktop.md) talks to the hosted server by default, and hosted or self-hosted servers can be added in Settings. The [web app](./web.md)'s agent pages under `/hm/agents/` and the [mobile app](./mobile.md) use the hosted server unless configured otherwise. [Agents in the app](../agent/in-the-app.md) describes the screens. <!-- id:0YhSXMcx -->

## CLI <!-- id:K-BtnXe- -->

The [CLI](./cli.md) has no agents commands. Agents use the same [Seed API](../build/web-api.md) the CLI uses, so anything an agent publishes can be read with `seed-cli`. <!-- id:B5OQX2U0 -->

## SDK <!-- id:CBEBBKag -->

The [SDK](../build/sdk.md) builds the [blobs](../protocol/blobs.md) agents publish. The agents client itself lives in `@shm/ui/agents` and the wire types in `@seed-hypermedia/apps-protocol`; neither is published to npm. <!-- id:aT1t4H8c -->

## Web API <!-- id:0W7lmP96 -->

The service's own API is the signed action API above. It is separate from the [Seed API](../build/web-api.md). For Hypermedia reads and writes, the service is an ordinary client of a [site](../protocol/sites.md)'s `/api`. <!-- id:yyT1jLaL -->

## Agents <!-- id:pMxZdw1U -->

This service is the runtime for [Seed Agents](../agent.md). External agents such as Claude Code do not run inside it. They use the [CLI](./cli.md) and the [Seed API](../build/web-api.md), as described in [Using Seed from your own agent](../build/agents.md). <!-- id:F1tiOQ00 -->

# See also <!-- id:uvu8f832 -->

- [Seed Agents](../agent.md), the concepts: what an agent is and how the runtime behaves.
- [App](../app.md), [Tool](../tool.md) and [Trigger](../trigger.md), the documents this server runs.
- [Operations](../operate/operations.md), [Environments](../operate/environments.md) and [Persistence](../operate/persistence.md), for running it.
- [Development](../contribute/development.md), for changing it.
- [The signed API](../build/signed-api.md) and [WebSocket subscriptions](../build/websocket-subscriptions.md), for clients.
- [The desktop app](./desktop.md), [The web app](./web.md), [The mobile app](./mobile.md) <!-- id:t3VsoOoU -->
