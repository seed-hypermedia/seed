---
name: The app environment
summary: The app environment is the server that runs Seed Agents and apps, and this page says where its code is, how clients reach it, how it ships, and where to read more.
---
The app environment is the server that runs [Seed Agents](../agent.md) and [apps](../app.md). People do not open it directly. They use it through the [desktop app](./desktop.md), the [web app](./web.md) and the [mobile app](./mobile.md), which are its clients. It is a Bun server with one SQLite database and no web pages of its own. <!-- id:XahmX6O- -->

This page is the map of the program. Other pages cover the rest:

- [Seed Agents](../agent.md) explains what an agent is and how the runtime behaves.
- [Operating an app environment](../operate/operations.md) is the starting point for running a server.
- [Development](../contribute/development.md) is the guide to changing the code.

# Where the code is <!-- id:m2SxIwMF -->

The code is in `apps/`, package `@seed-hypermedia/apps`. It is a separate Bun workspace, so use Bun commands inside it and never pnpm. It is built on these parts: <!-- id:YveM76cu -->

- [Pi](https://github.com/earendil-works/pi): `@earendil-works/pi-ai` for model calls and `@earendil-works/pi-durable` for the agent loop. Both are pinned to an exact version in `apps/package.json`.
- The MCP SDK, to connect to remote [MCP servers](../agent/mcp.md).
- QuickJS, to run [scripts](../agent/script.md).
- microsandbox microVMs, to run code in a sandbox.
- `@seed-hypermedia/client` and `@shm/shared`, two of the [shared packages](./packages.md). They are `file:` dependencies, so Bun copies them at install time.

<!-- id:p0g-x6aC -->
| Path <!-- col:XVydtKVl --> | What it holds <!-- col:pxciYz7N --> <!-- id:QY9BBlKE --> |
| --- | --- |
| `src/main.ts` | Startup, the HTTP routes and the WebSocket server. <!-- id:Y0Xw5Kqi --> |
| `src/config.ts` | Every flag and its environment variable. [Configuration](../operate/configuration.md) is the reference. <!-- id:2V09w8mX --> |
| `src/api-service.ts` | The signed action handlers, by far the largest file. <!-- id:WgUneRMx --> |
| `src/durable-session.ts` | The per-session [Pi Durable store](../agent/durable-sessions.md) the model turn runs on. <!-- id:5dMbNOWF --> |
| `src/auth.ts` | The signature check on each request, and authorization by [capability](../protocol/permissions.md). <!-- id:IKVKS0ev --> |
| `src/runs.ts`, `src/workflow-*.ts` | The [run](../agent/runs.md) queue and the script engine. <!-- id:Jy_5I5KZ --> |
| `src/activity-monitor.ts`, `src/activity-triggers.ts`, `src/schedule-*.ts` | [Trigger](../agent/triggers.md) monitors. <!-- id:FzH_JMtW --> |
| `src/mcp.ts`, `src/web-tools.ts`, `src/code-exec.ts` | MCP client, web search and read, sandboxed execution. <!-- id:jyOzESXQ --> |
| `src/sqlite-schema.sql`, `src/sqlite.ts` | The schema and its version check. <!-- id:24lfD2VY --> |
| `protocol/` | `@seed-hypermedia/apps-protocol`: the wire types shared with clients, `PROTOCOL.md` and the `surface.json` snapshot. <!-- id:FQhl_OyT --> |
| `frontend/packages/ui/src/agents/` | The client side: the signed client, React Query models and chat UI used by desktop, web and mobile. <!-- id:-w9W9xSC --> |

[Code map](../contribute/code-map.md) has the file-by-file map, and [Development](../contribute/development.md) has the conventions. <!-- id:jIOkr9Wm -->

# How it talks to the daemon <!-- id:oU9tXlHs -->

The app environment never talks to a [daemon](./daemon.md) directly. It talks to a Seed [site](../protocol/sites.md), and the site talks to its daemon. `--hm-server-url` names the site, which is `https://hyper.media` by default. The server does four things with that site: <!-- id:QTtOcGPk -->

- It reads through the [SDK](../build/sdk.md)'s `createSeedClient`, which calls the site's `/api/<Key>` routes. These routes are the [Seed API](../build/web-api.md).
- It publishes signed [blobs](../protocol/blobs.md) with the `PublishBlobs` action.
- It fetches media from `--ipfs-server-url`, which defaults to the same origin.
- It polls the site's activity feed to fire [triggers](../trigger.md).

# How clients talk to it <!-- id:qkwY9-4k -->

A client holds one base URL for a server. The API has one main prefix and two older forms. The server answers all three.

| Base URL a client holds | Paths |
| --- | --- |
| `<origin>/hm/api/apps` | The main prefix: `/message`, `/ws`, `/webhooks/<triggerId>`, `/health`, `/version`, `/perf`, `/metrics`. `GET <origin>/hm/api/apps` itself lists the apps running on the server as plain JSON. |
| `<origin>/hm/api/agents` | The same routes under the older prefix, for released clients and webhook URLs that name it. |
| `<origin>` alone | The oldest form: `/api/message`, `/agents/ws` and `/agents/api/*`. |

`message` is the signed action API. Every request is a [DAG-CBOR](../schema/dag-cbor.md) envelope. An [account](../protocol/identity.md) key signs it, or a key that holds a [capability](../protocol/permissions.md) for the account. `ws` carries signed live subscriptions.

The prefix lets a site's reverse proxy send one path to the server. So the server can share an origin with a [site](../protocol/sites.md).

Three pages hold the reference: [Endpoints and health](../operate/endpoints-and-health.md) has the full endpoint table, [The signed API](../build/signed-api.md) has the actions, and [WebSocket subscriptions](../build/websocket-subscriptions.md) has the events.

Clients and servers are released separately, and a desktop release keeps talking to hosted servers for weeks. So every message carries a protocol version: <!-- id:dhf6WuQB -->

- A client sends its version in the envelope.
- A server answers with its version in the `X-Agents-Protocol` header.
- A server refuses a client older than its minimum with HTTP 426.

CI runs `bun run protocol:check` to catch a breaking change that did not raise the version.

# Configuration <!-- id:bFuPQ4V_ -->

Each flag has a `SEED_APPS_*` environment variable. The server also reads the older `SEED_AGENTS_*` name. A flag wins over a variable. `src/config.ts` is the source. <!-- id:bVVzP_Ph -->

The server listens on 3050 by default and on 3051 in development. The [port table](../software.md) has the other programs' ports. [Configuration](../operate/configuration.md) lists every setting, and [operating an app environment](../operate/operations.md) routes to the backends and the diagnostics.

The server stores everything in one SQLite database, `agents.sqlite`, plus a data directory for agent state files. [Persistence](../operate/persistence.md) describes the tables. <!-- id:JgSR_DRZ -->

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

**In the desktop app.** `bun run build:binary` compiles the server with `bun build --compile` into `plz-out/bin/apps/seed-apps-<platform>`. The [desktop app](./desktop.md) ships that folder as a resource. The desktop app starts the server by default, to run [tools](../tool.md) only. At startup the app goes through these steps and stops at the first one that applies: <!-- id:c23jCXqC -->

1. `SEED_NO_APPS_SPAWN` is set: no local server.
2. `SEED_APPS_SERVER_URL` is set: attach to that server.
3. A healthy server already answers on the default port: attach to it. This is the `./dev up` case.
4. The `agentsLocalServer` setting is not `off`, and something is checked for the server to run: spawn the binary on the first free port from the default. A development build spawns it only when the setting is `on`, so that it does not take the port of the server `./dev up` runs.

If no step applies, no local server runs and the app uses the hosted one. The switch under Settings > App environments changes the setting.

**What the local server runs.** Three checks under that switch pick from tools on their own, apps and agents. The setting `localAppEnvironmentFeatures` holds the list, and the app passes it to the server as `--features`. The server refuses the rest itself, for every client that reaches it.

- Out of the box only tools is checked. Agents and apps keep sessions, memory and triggers that grow and work in the background, so they are opt-in.
- A tool that is in no app or agent then runs on your computer. Its code, the files it is given and its secrets do not leave the machine.
- The app offers the local server for a new app or agent only when that is checked.
- An install that already ran agents locally keeps all three.

A server that the app spawns is set up like this:

- It keeps its data in the app's user data folder, under `agents/`.
- It uses the desktop app's API bridge as its [site](../protocol/sites.md), and the [daemon](./daemon.md)'s HTTP port for `/ipfs`.
- It binds `127.0.0.1`.
- It has subscription login on.
- It starts one sandbox right away. The first sandbox after the machine starts takes most of a minute, and this way a person's first tool run does not wait for it. While it lasts, the tool's page says that the sandbox is being prepared.

**Hosted.** The image is published under two names, `seedhypermedia/apps` and `seedhypermedia/agents`. The tag `dev` is built from `main`, and the tag `latest` is built on release. A Watchtower container on the agents host redeploys when a tag is pushed, so pushing `latest` is a production deploy. Clients reach each hosted server on its site's own origin, for example `https://hyper.media/hm/api/apps`. The gateway proxies `/hm/api/apps` to the host the server runs on, also on `*.hyper.media` subdomains. So the Seed API and the app environment share one host. <!-- id:IiTt1HiF -->

**Self-hosted.** Run the image with a volume on `/data` and with `--hm-server-url` pointing at your site. Each [account](../protocol/identity.md) sets up its own model provider. [Running your own app environment](../operate/self-hosted-app-environment.md) has the steps. <!-- id:BYxO5fzs -->

[Environments](../operate/environments.md) describes each of these in full, the hosted servers, and how a client chooses a server.

# Working with it <!-- id:RUi86C0e -->

## In the Seed app <!-- id:Jgb3MPaj -->

The [desktop app](./desktop.md) puts apps and agents on the hosted server by default and runs tools on its own local one. Hosted or self-hosted servers can be added in Settings. The [web app](./web.md)'s agent pages under `/hm/agents/` and the [mobile app](./mobile.md) use the hosted server unless configured otherwise. [Agents in the app](../agent/in-the-app.md) describes the screens. <!-- id:0YhSXMcx -->

## CLI <!-- id:K-BtnXe- -->

The [CLI](./cli.md) has no agents commands. Agents use the same [Seed API](../build/web-api.md) the CLI uses, so anything an agent publishes can be read with [`seed-cli`](../build/cli.md). <!-- id:B5OQX2U0 -->

## SDK <!-- id:CBEBBKag -->

The [SDK](../build/sdk.md) builds the [blobs](../protocol/blobs.md) that agents publish. The agents client itself is in `@shm/ui/agents`, and the wire types are in `@seed-hypermedia/apps-protocol`. Neither is published to npm under that name. To use them from your own app, install `@seed-hypermedia/apps-ui`, which bundles both. See [Embedding the agents UI](../build/apps-ui.md). <!-- id:aT1t4H8c -->

## Seed API <!-- id:0W7lmP96 -->

The server's own API is the signed action API above. It is separate from the [Seed API](../build/web-api.md). For Hypermedia reads and writes, the server is an ordinary client of a [site](../protocol/sites.md)'s `/api`. <!-- id:yyT1jLaL -->

## Agents <!-- id:pMxZdw1U -->

This server is the runtime for [Seed Agents](../agent.md). External agents such as Claude Code do not run inside it. They use the [CLI](./cli.md) and the [Seed API](../build/web-api.md), as described in [Using Seed from your own agent](../build/agents.md). <!-- id:F1tiOQ00 -->

# See also <!-- id:uvu8f832 -->

- [Seed Agents](../agent.md), the concepts: what an agent is and how the runtime behaves.
- [App](../app.md), [Tool](../tool.md) and [Trigger](../trigger.md), the [documents](../protocol/documents.md) this server runs.
- [Operating an app environment](../operate/operations.md), [Configuration](../operate/configuration.md), [Environments](../operate/environments.md) and [Persistence](../operate/persistence.md), for running it.
- [Development](../contribute/development.md) and [Code map](../contribute/code-map.md), for changing it.
- [The signed API](../build/signed-api.md) and [WebSocket subscriptions](../build/websocket-subscriptions.md), for clients.
- [The desktop app](./desktop.md), [The web app](./web.md), [The mobile app](./mobile.md) <!-- id:t3VsoOoU -->
