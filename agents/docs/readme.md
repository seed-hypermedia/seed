# Seed Agents Knowledgebase

This directory is the canonical knowledgebase for the Seed Agents feature. It is intended for future coding agents,
product reviewers, and humans who need to understand what exists, how it works, what is complete, and what should happen
next.

## What Seed Agents is

Seed Agents is an account-scoped agent runtime composed of:

- a standalone Bun service in `agents/`;
- a signed DAG-CBOR HTTP API for provider, secret, agent, and session operations;
- a signed WebSocket subscription API for live account/agent/session updates;
- SQLite persistence for durable state and event replay;
- encrypted server-side provider secrets;
- a Pi SDK-backed model execution loop with streaming responses and tool calls;
- a `read` tool that shares URL-resolution behavior with the CLI through internal Seed SDK code;
- a desktop UI for configuring servers/providers/agents and chatting with sessions;
- a built-in `/agents` server inspector UI for debugging server state.

## Quick status

Completed and usable locally:

- signed HTTP action API;
- signed WebSocket subscriptions;
- SQLite persistence and migrations gate;
- encrypted secrets and redacted provider/secret responses;
- model-provider CRUD, provider listing, and provider-backed model listing for model dropdowns;
- agent CRUD and session CRUD, including inline session-title editing;
- durable session event replay;
- schedule triggers for interval, weekly, and one-time proactive sessions;
- Pi SDK-backed chat execution;
- streaming assistant text over WebSocket;
- desktop chat message rendering shared with the assistant panel, including formatted markdown bubbles and raw-markdown
  inspection for message text;
- rich Seed block editing for agent prompts, trigger prompts, and agent session chat input, with markdown conversion
  before signed submissions;
- visible durable tool call/result events;
- `read` using shared Seed Hypermedia URL resolution;
- `web_search` and `web_read` web research tools: self-hosted SearXNG search plus a tiered MediaWiki → in-process static
  (Readability + Turndown) → Crawl4AI reader, with no third-party API keys;
- per-agent tool toggles plus server-side HM account-key creation/selection for signing/publishing tools;
- desktop Agents routes, provider dialogs, create-agent dialog, agent detail, Tools tab, session page;
- server-side `/agents` live session inspector;
- diagnostic logging for OpenAI streaming and WebSocket subscription/fanout.

Important incomplete work:

- Provider types are registry-driven: OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Groq, xAI, Ollama, and a generic
  Custom (OpenAI-compatible) endpoint are configurable and mapped through Pi; all non-OpenAI types still need
  real-provider smoke coverage.
- Running sessions can be stopped with the signed `StopSession` action from desktop or API clients.
- Signed actions include a timestamp and the server rejects requests more than 30 seconds from local time; nonce caching
  is still future hardening.
- WebSocket server-to-client messages are JSON and not individually signed.
- Tool permissions are coarse; `read` is always available in OpenAI execution.

## Start here reading order

1. [System overview](./system-overview.md) — architecture, boundaries, lifecycle, completed/incomplete status.
2. [Implementation history](./implementation-history.md) — notes on the recent commits that built this feature.
3. [Operations](./operations.md) — how to run, configure, inspect, and troubleshoot the service locally.
4. [Desktop UI](./desktop-ui.md) — desktop routes, dialogs, streaming chat UX, and server settings.
5. [Signed API](./signed-api.md) — HTTP CBOR envelope, actions, responses, idempotency, signing caveats.
6. [WebSocket subscriptions](./websocket-subscriptions.md) — signed subscribe handshake, live events, partial streaming,
   logs.
7. [Persistence](./persistence.md) — SQLite schema and data lifecycle.
8. [Model providers](./model-providers.md) — provider records, secrets, OpenAI execution, unsupported providers.
9. [Tools](./tools.md) — tool-call lifecycle and `read` behavior.
10. [Prompt injection map](./prompt-injection-map.md) — where hosted-agent and desktop-assistant prompts are defined,
    assembled, and sent to providers.
11. [Security](./security.md) — current security model and hardening gaps.
12. [Development](./development.md) — safe extension workflow, validation commands, doc-maintenance rules.
13. [Troubleshooting](./troubleshooting.md) — fast diagnostic paths for streaming, signing, providers, and tools.
14. [Pi SDK migration project](./pi-sdk-migration.md) — research and implementation plan for using Pi as the agentic
    loop.
15. [Agent triggers plan](./agent-triggers-plan.md) — proactive triggers that create sessions from HM activity or
    schedules.
16. [Future projects](./future-projects.md) — larger future work packages.
17. [Roadmap](./roadmap.md) — prioritized next steps and code-improvement opportunities.

## Canonical code entry points

Agents service:

- `agents/src/main.ts` — Bun HTTP/WebSocket server, CORS, `/agents` inspector routes, live event fanout.
- `agents/protocol/src/index.ts` — canonical shared protocol types for signed actions/responses/session events/WebSocket
  events.
- `agents/src/api.ts` — compatibility re-export of the shared protocol package for service-local imports.
- `agents/src/api-service.ts` — business logic, persistence operations, Pi SDK-backed model execution, tools,
  subscription verification.
- `agents/src/web-tools.ts` — self-hosted `web_search` (SearXNG) and tiered `web_read` (MediaWiki/static/Crawl4AI)
  implementations.
- `agents/src/auth.ts` — signed envelope verification and local account authorization.
- `agents/src/sqlite.ts` — open/schema validation/migration gate.
- `agents/src/sqlite-schema.sql` — canonical schema.
- `agents/src/cbor.ts` — DAG-CBOR request/response helpers.
- `agents/src/config.ts` — env and CLI config.
- `agents/src/frontend/app.tsx` — built-in server inspector UI.

Desktop:

- `frontend/apps/desktop/src/agents-client.ts` — imports shared protocol types, plus URL helpers, signed CBOR HTTP
  sender, WS URL, and timestamped action signing.
- `frontend/apps/desktop/src/models/agents.ts` — React Query hooks, server settings, CRUD actions, signed WS
  subscription hook, partial streaming state.
- `frontend/apps/desktop/src/pages/agents.tsx` — compatibility entry that renders the Agents list route.
- `frontend/apps/desktop/src/pages/agents/` — separate Agents list, server, detail, session, and shared dialog modules.
- `frontend/apps/desktop/src/components/assistant-panel.tsx` — desktop assistant panel, also using shared chat
  rendering.
- `frontend/apps/desktop/src/components/assistant-message-rendering.tsx` — shared user/assistant message, markdown,
  streaming cursor, raw-markdown info dialog, and tool-call bubble rendering used by both desktop assistant and Agents
  chat.
- `frontend/apps/desktop/src/pages/agents/prompt-editor.tsx` — shared rich prompt editor and block-to-markdown helper
  used by agent/trigger prompt editing and rich session-message submission.
- `frontend/packages/shared/src/routes.ts` — route schemas for `agents`, `agent`, and `agent-session`.

Shared Hypermedia/CLI behavior:

- `frontend/packages/client/src/resource-read.ts` — `resolveIdWithClient()` shared by CLI-like reads and the agent tool.
- `frontend/apps/cli/src/utils/resolve-id.ts` — CLI wrapper around the shared resolver.
- `frontend/packages/client/src/hm-resolver.ts` — lower-level URL-to-HM-ID resolver.
- `frontend/packages/client/src/blocks-to-markdown.ts` — markdown conversion used by tool/CLI paths.

## Common commands

Run agents server:

```bash
direnv exec . bash -lc 'cd agents && bun src/main.ts'
```

Build the agents deployment image:

```bash
docker build -t seedhypermedia/agents:dev . -f ./agents/Dockerfile
```

Run desktop:

```bash
direnv exec . bash -lc './dev run-desktop'
```

Validate agents service:

```bash
direnv exec . bash -lc 'cd agents && bun check && bun test'
direnv exec . bash -lc 'cd agents && bun run test:build'
direnv exec . bash -lc 'cd agents && bun run test:docker'
direnv exec . bash -lc 'cd agents && bun run test:trigger'
```

Validate frontend:

```bash
direnv exec . bash -lc 'pnpm typecheck'
direnv exec . bash -lc 'pnpm test'
```

Known caveat: `pnpm audit` currently fails on existing repo dependency vulnerabilities unrelated to the agents feature.
Do not claim audit success unless it actually passes.

## Local URLs

- Agent server base: `http://localhost:3050`
- Built-in inspector: `http://localhost:3050/agents`
- Health: `http://localhost:3050/agents/api/health`
- Status JSON: `http://localhost:3050/agents/api/status`
- Signed API: `POST http://localhost:3050/api/message`
- WebSocket: `ws://localhost:3050/agents/ws`

## Historical context

The older high-level plan at `docs/plans/agents.md` is useful historical context, but this directory is the current
source of truth. If the old plan conflicts with `agents/docs`, prefer `agents/docs` and update the stale reference.

## Documentation maintenance contract

Future agents should update these docs as part of the same change that modifies behavior. Do not wait for a human to
request documentation updates.

Use this routing table:

- protocol/action changes → `signed-api.md`, `desktop-ui.md`, `development.md`
- WebSocket/live streaming changes → `websocket-subscriptions.md`, `operations.md`
- database/migration changes → `persistence.md`
- provider/runtime changes → `model-providers.md`, `pi-sdk-migration.md`, `roadmap.md`
- tool changes → `tools.md`, `security.md`
- security/auth/logging changes → `security.md`, `operations.md`
- UI workflow changes → `desktop-ui.md`
- completed/started major work → `implementation-history.md`, `roadmap.md`, `future-projects.md`
- any new doc → link it from this `readme.md`
