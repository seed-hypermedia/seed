---
name: The agents service
summary: The Seed Agents server as a program, a Bun process with one SQLite database that the desktop app bundles and hosted containers run, with its code map, ports, configuration, backends and deployments.
---
The agents service is the program that runs Seed Agents. It stores agents, their sessions and every run in a SQLite database, calls language models, executes tools, watches the Hypermedia network for [triggers](../agent/triggers.md), and publishes signed [blobs](../protocol/blobs.md) through a Seed [site](../protocol/sites.md). It is a server with no web pages of its own: the [desktop app](./desktop.md), the [web app](./web.md) and the [mobile app](./mobile.md) are its clients. This page describes the software. [Seed Agents](../agent.md) explains what an agent is and how to use one. <!-- id:XahmX6O- -->

The same build runs in three places. The desktop app ships it as a compiled binary and starts one for you. The hosted servers run it as a Docker image. You can also [self-host](../build/self-hosting.md) that image. <!-- id:7xiIpHiu -->

# Where the code is <!-- id:m2SxIwMF -->

`agents/`, package `@seed-hypermedia/agents`: a separate Bun workspace. Use Bun commands inside it, never pnpm. It is built on [Pi](https://github.com/badlogic/pi-mono) (`@mariozechner/pi-ai` and `pi-coding-agent`, pinned to 0.70.x) for model calls and the agent loop, the MCP SDK for connecting to remote [MCP servers](../agent/mcp.md), QuickJS for scripts, and microsandbox microVMs for code execution. It consumes `@seed-hypermedia/client` and `@shm/shared` through `file:` dependencies, which copy the packages at install time. <!-- id:YveM76cu -->

<!-- id:p0g-x6aC -->
| Path <!-- col:XVydtKVl --> | What it holds <!-- col:pxciYz7N --> <!-- id:QY9BBlKE --> |
| --- | --- |
| `src/main.ts` | Startup, the HTTP routes and the WebSocket server. <!-- id:Y0Xw5Kqi --> |
| `src/config.ts` | Every flag and its environment variable; the top code comment is the configuration reference. <!-- id:2V09w8mX --> |
| `src/api-service.ts` | The signed action handlers, by far the largest file. <!-- id:WgUneRMx --> |
| `src/auth.ts` | Envelope signature checks and capability-based authorization. <!-- id:IKVKS0ev --> |
| `src/runs.ts`, `src/workflow-*.ts` | The run queue and the workflow engine. <!-- id:Jy_5I5KZ --> |
| `src/activity-monitor.ts`, `src/activity-triggers.ts`, `src/schedule-*.ts` | [Trigger](../agent/triggers.md) monitors. <!-- id:FzH_JMtW --> |
| `src/mcp.ts`, `src/web-tools.ts`, `src/code-exec.ts` | MCP client, web search and read, sandboxed execution. <!-- id:jyOzESXQ --> |
| `src/sqlite-schema.sql`, `src/sqlite.ts` | The schema and its version check. <!-- id:24lfD2VY --> |
| `protocol/` | `@seed-hypermedia/agents-protocol`: the wire types shared with clients, `PROTOCOL.md` and the `surface.json` snapshot. <!-- id:FQhl_OyT --> |
| `frontend/packages/ui/src/agents/` | The client side: the signed client, React Query models and chat UI used by desktop, web and mobile. <!-- id:-w9W9xSC --> |

[Development](../agent/development.md) has the full code map and the conventions. <!-- id:jIOkr9Wm -->

# How it talks to Hypermedia <!-- id:oU9tXlHs -->

The service talks to a Seed [site](../protocol/sites.md) and never to a [daemon](./daemon.md) directly. `--hm-server-url` names the site, `https://hyper.media` by default. The service reads through the [SDK](../build/sdk.md)'s `createSeedClient` against that site's `/api/<Key>` routes (the [Seed API](../build/web-api.md)), publishes signed [blobs](../protocol/blobs.md) with `PublishBlobs`, and fetches media from `--ipfs-server-url`, which defaults to the same origin. <!-- id:QTtOcGPk -->

The activity monitor polls that site's activity feed every 5 seconds, 50 events a page and at most 5 pages a poll, to fire [comment](../protocol/comments.md), mention and site-update [triggers](../agent/triggers.md). Agents sign with their own [keys](../protocol/identity.md). A person lets an agent publish in their space by delegating a [capability](../protocol/permissions.md) to it. See [Seed Agents](../agent.md) and [security](../agent/security.md). <!-- id:ssdcQlwz -->

# How clients talk to it <!-- id:qkwY9-4k -->

<!-- id:VlKDU77F -->
| Route <!-- col:wL6MYKvJ --> | Purpose <!-- col:dFiPLdaD --> <!-- id:_DxqWjRZ --> |
| --- | --- |
| `POST /api/message`, `POST /agents/api/message` | The signed action API: every request is a [DAG-CBOR](../protocol/blobs.md) envelope signed by an [account](../protocol/identity.md) key or by a key holding a [capability](../protocol/permissions.md) for the account. See [the signed API](../agent/signed-api.md). <!-- id:aVbXTJV8 --> |
| `/agents/ws` | Signed WebSocket subscriptions for live session and run updates. See [WebSocket subscriptions](../agent/websocket-subscriptions.md). <!-- id:9r7h_1IE --> |
| `POST /agents/api/webhooks/:triggerId` and `/:triggerId/:secret` | Webhook [triggers](../agent/triggers.md). <!-- id:S-WSjzSN --> |
| `GET /api/health`, `GET /api/version` | Status, build, protocol version, and which optional backends are enabled. <!-- id:X9ZH9iKU --> |
| `GET /api/perf`, `GET /api/perf/sessions/:sessionId` | Timing diagnostics. <!-- id:7hcUlxhn --> |

The message, health, version and perf routes answer both with and without the `/agents` prefix, so the service can share an origin with a [site](../protocol/sites.md). The WebSocket and webhook routes exist only under `/agents`. <!-- id:ThqayOc_ -->

Clients and servers deploy separately, and a desktop release keeps talking to hosted servers for weeks. So the wire surface carries a protocol version. Clients send it in the envelope, servers answer in the `X-Agents-Protocol` header, and a server refuses clients older than its minimum with HTTP 426. CI runs `bun run protocol:check` to catch breaking changes that did not bump the version. <!-- id:dhf6WuQB -->

# Storage <!-- id:76le7B-O -->

One SQLite database, `agents.sqlite`, plus a data directory for agent state files. The tables fall into these groups: [accounts](../protocol/identity.md) and authorizations; model providers, [MCP servers](../agent/mcp.md) and secrets; agents, collaborators and [triggers](../agent/triggers.md); sessions, session events and continuations; runs, the run journal and event waits; trigger firings and activity watermarks; [tool documents](../agent/tool-document.md); and drafts. Session events are stored as [DAG-CBOR](../protocol/blobs.md), including full tool inputs. Secrets are encrypted with a key the server generates and keeps in its own `server_config` table. A copy of the whole database therefore holds everything needed to decrypt them. [Persistence](../agent/persistence.md) describes the tables. <!-- id:JgSR_DRZ -->

If the stored schema version does not match the code, the server starts in a mode that answers every request with a schema-mismatch error. <!-- id:BRCVfx4n -->

# Configuration <!-- id:bFuPQ4V_ -->

Each flag has a `SEED_AGENTS_*` environment variable. Flags win over variables. The most used: <!-- id:bVVzP_Ph -->

<!-- id:FRc-vp7f -->
| Flag <!-- col:Tri4QPRY --> | Default <!-- col:c7pawPMo --> | Meaning <!-- col:YdYKpJtF --> <!-- id:_NY3C04l --> |
| --- | --- | --- |
| `--server-port` | 3050 | Listen port. Development sets 3051 through `.env.vars`. <!-- id:Hw7InjsX --> |
| `--server-hostname` | `0.0.0.0` | Bind address. The [desktop app](./desktop.md) passes `127.0.0.1`. <!-- id:2UOvk6OY --> |
| `--db-path`, `--data-dir` | `./data/agents.sqlite`, `./data` | Storage; `/data/...` in the image. <!-- id:1tmnyFTk --> |
| `--hm-server-url`, `--ipfs-server-url` | `https://hyper.media`, same | The Seed [site](../protocol/sites.md) to use. <!-- id:4vZSDQ3f --> |
| `--searxng-url`, `--crawler-url`, `--crawler-token` | unset | Web search and browser-rendered reads; unset disables them. <!-- id:AsRzaScw --> |
| `--exec-backend` | `microsandbox` | Code execution; empty disables it. <!-- id:bX0IoNrV --> |
| `--max-concurrent-model-runs` | 8 | Model runs at once. Everything shares one event loop, so size this to the host. <!-- id:vhKVmYpD --> |
| `--max-concurrent-workflows` | 32 | Workflow runs at once. <!-- id:HJ6ghPFb --> |
| `--subscription-auth` | off | Offer "Sign in with ChatGPT"-style provider login. <!-- id:qeaObqsq --> |
| `--log-level` | `info` | `debug` turns on per-delta and per-poll lines. <!-- id:QKdV1tEu --> |

[Operations](../agent/operations.md) lists every flag, the web and execution backends, and diagnostics. <!-- id:fccnUExV -->

# Running it <!-- id:uDHZk-0W -->

```sh <!-- id:tMioUDoF -->
./dev up                          # the whole stack; the agents pane runs on :3051 with hot reload
cd agents && bun run dev          # the server alone, with SearXNG and Crawl4AI expected locally
cd agents && bun check && bun test
cd agents && bun run test:build   # the compiled binary boots
```

`./dev up` also starts the web backends from `agents/dev/web-backends/docker-compose.yml`: SearXNG on `127.0.0.1:8899` and Crawl4AI on `127.0.0.1:11235`. When the copied `frontend/packages/*` change, the dev script reinstalls them and restarts the server, so they do not go stale. <!-- id:V-wXKyUH -->

# Deployments <!-- id:MorvdtVJ -->

**In the desktop app.** `bun run build:binary` compiles the server with `bun build --compile` into `plz-out/bin/agents/seed-agents-<platform>`, and the [desktop app](./desktop.md) ships that folder as a resource. At startup the app skips the server if `SEED_NO_AGENTS_SPAWN` is set, attaches to `SEED_AGENTS_SERVER_URL` if given, attaches to a healthy server already on the default port (the `./dev up` case), and otherwise spawns the binary on the first free port from 3050. The spawned server keeps its data in the app's user data folder under `agents/`, uses the desktop API bridge as its [site](../protocol/sites.md) and the [daemon](./daemon.md)'s HTTP port for `/ipfs`, and has subscription login on. <!-- id:c23jCXqC -->

**Hosted.** Images are `seedhypermedia/agents:dev`, built from `main`, and `seedhypermedia/agents:latest`, built on release. A Watchtower container on the agents host redeploys when a tag is pushed, so pushing `latest` is a production deploy. <!-- id:IiTt1HiF -->

<!-- id:K1JGMcDQ -->
| Server <!-- col:HN6aWcmo --> | Image <!-- col:D6xbwiK7 --> | Site it uses <!-- col:_7AxZeTv --> <!-- id:OTLS0d33 --> |
| --- | --- | --- |
| `https://agentic.seed.hyper.media` | `latest` | `https://hyper.media` <!-- id:fALJ7RzU --> |
| `https://staging.agentic.seed.hyper.media` | a `dev` build | `https://staging.hyper.media` <!-- id:JRdvk-Eo --> |
| `https://dev.agentic.seed.hyper.media` | `dev` | `https://dev.hyper.media` <!-- id:fShITKT6 --> |

**Self-hosted.** Run the image with a volume on `/data`, a model provider configured by each [account](../protocol/identity.md), and `--hm-server-url` pointing at your site. [Environments](../agent/environments.md) explains how clients choose a server and how a site advertises one with the `agentServerUrl` metadata key. <!-- id:BYxO5fzs -->

# Working with it <!-- id:RUi86C0e -->

## In the Seed app <!-- id:Jgb3MPaj -->

The Agents section of the [desktop app](./desktop.md) talks to the bundled local server by default and can add hosted or self-hosted servers. The [web app](./web.md)'s `/hm/agents` page and the [mobile app](./mobile.md) use the hosted server unless configured otherwise. <!-- id:0YhSXMcx -->

## CLI <!-- id:K-BtnXe- -->

The [CLI](./cli.md) has no agents commands. Agents use the same [Seed API](../build/web-api.md) the CLI uses, so anything an agent publishes can be read with `seed-cli`. <!-- id:B5OQX2U0 -->

## SDK <!-- id:CBEBBKag -->

The [SDK](../build/sdk.md) builds the [blobs](../protocol/blobs.md) agents publish. The agents client itself lives in `@shm/ui/agents` and the wire types in `@seed-hypermedia/agents-protocol`; neither is published to npm. <!-- id:aT1t4H8c -->

## Web API <!-- id:0W7lmP96 -->

The service's own API is the signed action API above. It is separate from the [Seed API](../build/web-api.md). For Hypermedia reads and writes, the service is an ordinary client of a [site](../protocol/sites.md)'s `/api`. <!-- id:yyT1jLaL -->

## Agents <!-- id:pMxZdw1U -->

This service is the runtime for [Seed Agents](../agent.md). External agents such as Claude Code do not run inside it. They use the [CLI](./cli.md) and the [Seed API](../build/web-api.md), as described in [Building agents on Seed](../build/agents.md). <!-- id:F1tiOQ00 -->

# See also <!-- id:uvu8f832 -->

- [Seed Agents](../agent.md), [Operations](../agent/operations.md), [Environments](../agent/environments.md), [Development](../agent/development.md) <!-- id:6g-el_oN -->
- [The desktop app](./desktop.md), [The web app](./web.md), [The mobile app](./mobile.md) <!-- id:t3VsoOoU -->
