---
name: "Seed Agents Knowledgebase"
summary: "This directory is the canonical knowledgebase for the Seed Agents feature. It is intended for future coding agents, product reviewers, and humans who need…"
---
This directory is the canonical knowledgebase for the Seed Agents feature. It is intended for future coding agents,
product reviewers, and humans who need to understand what exists, how it works, what is complete, and what should happen
next.

## What Seed Agents is

Seed Agents is an account-scoped agent runtime — "the Harness" — composed of:

- a standalone Bun service in `agents/`;
- a signed DAG-CBOR HTTP API for provider, secret, agent, session, tool, and run operations;
- a signed WebSocket subscription API for live account/agent/session/run updates;
- SQLite persistence for durable state and event replay;
- encrypted server-side provider secrets;
- a Pi SDK-backed model execution loop with streaming responses and tool calls;
- a desktop UI for configuring servers/providers/agents and working with sessions.

The runtime is built on three nouns and five verbs. The nouns: an agent's **Space** (`~/memory/`, `~/tools/`), the
session **Log** (append-only, every event stamped with an actor), and the **Runs** table (every turn, child, and script,
which doubles as the dispatch queue). The verbs — `read`, `write`, `call`, `delegate`, `plan` — are the entire
model-facing tool surface and are always on; everything that used to be its own tool is now an address form of a verb or
a callable dispatched through `call`. [`glossary.md`](./agent-glossary.md) defines this vocabulary and is the sanctioned
wording for these docs; do not restate it here, point at it.

## Quick status

Completed and usable locally:

- signed HTTP action API;
- signed WebSocket subscriptions;
- SQLite persistence and migrations gate;
- encrypted secrets and redacted provider/secret responses;
- model-provider CRUD, provider listing, and provider-backed model listing for model dropdowns;
- agent CRUD and session CRUD, including inline session-title editing;
- pending agent invitations plus accepted reader/writer collaborators, with agent-wide read/write enforcement, plus
  owner-set public read and public chat flags (any signed account can view, or view and message, the agent by id);
- durable session event replay;
- schedule triggers for interval, weekly, and one-time proactive sessions;
- Pi SDK-backed chat execution;
- streaming assistant text over WebSocket;
- desktop chat message rendering shared with the assistant panel, including formatted markdown bubbles and raw-markdown
  inspection for message text;
- rich Seed block editing for agent prompts, trigger prompts, and agent session chat input, with markdown conversion
  before signed submissions;
- visible durable tool call/result events, each stamped with the actor that produced it;
- the five verbs as the whole model-facing surface: `read` and `write` over one address space (`~/memory/…`,
  `~/tools/…`, `hm://…`, `ipfs://…`, `https://…`, `activity:`, `attachment:…`, `thread:…`, `run:…`), `call` for callable
  tools, `delegate` for children, `plan` for the visible checklist;
- `read` using shared Seed Hypermedia URL resolution;
- tools as content-addressed documents in `~/tools/`: builtin bindings, authored lambdas, and MCP projections alike,
  each a DAG-CBOR document whose CID is its version, listed for the owner through `ListAgentTools`;
- remote **MCP servers**, connected per account like model providers and enabled per agent: every tool a server
  advertises is an `mcp` tool document named `<server>__<tool>`, dispatched through `call` over a lazy per-run
  connection, promoted like any other tool, and managed from the Tools tab (`mcp.md`);
- touch-expand and promotion: a wrong or unexpanded `call` answers with the tool's contract instead of an error, and a
  contract that has entered the transcript promotes that callable to a first-class provider tool for the rest of the
  thread — derived purely from durable events, so it survives restarts;
- `search`, `web_search`, and `execute` as callable tools: self-hosted SearXNG search, a tiered MediaWiki → in-process
  static (Readability + Turndown) → Crawl4AI reader behind `read https://…`, and TypeScript/Python/shell execution in
  ephemeral hardware-isolated microVMs with the agent's memory mounted at `/workspace`;
- per-agent persistent memory filesystem behind the `read`/`write` verbs, with signed agent-memory actions, chunked
  uploads of any size, binary/media support, and a desktop Memory tab (editing, media previews, downloads, URL download,
  IPFS publishing);
- grants rather than tool toggles: `definition.tools` narrows the callable set and carries the `publish` grant for
  signed public writing; the verbs themselves are never grantable. Server-side HM account-key creation/selection backs
  signing;
- durable run records + dispatch queue under every agent execution: lease-based crash recovery (boot sweep + interrupted
  tool-call repair), derived session status, persisted per-run usage with child rollup;
- `delegate` in both kinds: model children (a verbatim markdown brief, optional typed `output` schema delivered through
  `return_result`, parking and resume, durable session lineage) and script children (agent-authored JavaScript in a
  QuickJS realm with content-keyed journal replay, determinism lint, fuel/memory/journal caps, and a ctx API of
  call/delegate/parallel/sleep/waitForEvent/continueAsNew/step/plan/now/log/progress);
- unified obligations: a run that ends owing a typed result or unfinished plan steps is asked once to settle everything
  it owes, and carries any remaining debt in the open as `RunInfo.unmetObligations`;
- the `plan` verb's live checklist on sessions, with runtime settlement — a step whose attached children all succeeded
  closes itself (`resolvedBy: 'runtime'`), and a fully settled plan records `settledAt`;
- a symmetric log: the user runs the same `read`/`write`/`call` verbs through `InvokeSessionTool`, and the results land
  on the shared log as `actor: 'user'` events the agent reads as ground truth;
- run actions (`GetRun`/`ListRuns`/`CancelRun`/`SignalRun`/`GetRunJournal`) and `runs/<rootRunId>` WebSocket
  subscriptions with journal replay;
- wake sources for day-scale work: `ctx.waitForEvent` parks a run for nothing until a signal, an activity event, or a
  timeout, and a trigger can carry a `wake` continuation instead of starting a new thread;
- agent introspection: `read`/`write ~/triggers/<name>` (the agent creates, edits, enables, disables, and deletes its
  own triggers directly, on the existing `agent_triggers` rows), `read ~/self` (the agent's own definition, grants,
  triggers, and memory summary), and `read thread:` (list and search the account's conversations by title and recent
  message text), with the Space index advertising active triggers and the triggers affordance;
- a record/replay model-gate harness (`agents/e2e/run.ts`, replayed offline by `agents/src/e2e-replay.test.ts` — whose
  cassettes are stale since the verb collapse, so that replay currently **skips**) and a live gate against a real server
  and model (`agents/e2e/live-gate.ts`), plus a blind simulated-model gate methodology (see `operations.md`);
- desktop progress surfaces: the pinned run card with Activity drawer, session nesting with lazy sub-session
  disclosures, and child-session breadcrumb/banner/composer lock;
- live local sync subscriptions for `hm://` documents and comments produced by a remote agent while that exact session
  is mounted in the desktop (full page or selected sidebar session), so result links resolve immediately without syncing
  background sessions;
- desktop Agents routes, provider dialogs, create-agent dialog, agent detail, Tools tab, session page;
- diagnostic logging for OpenAI streaming and WebSocket subscription/fanout.

Important incomplete work:

- Provider types are registry-driven: OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Groq, xAI, Ollama, and a generic
  Custom (OpenAI-compatible) endpoint are configurable and mapped through Pi; all non-OpenAI types still need
  real-provider smoke coverage.
- Running sessions can be stopped with the signed `StopSession` action from desktop or API clients.
- Signed actions include a timestamp and the server rejects requests more than 30 seconds from local time; nonce caching
  is still future hardening.
- WebSocket server-to-client messages are JSON and not individually signed.
- Grants are coarse: the callable set plus a single `publish` grant. The five verbs are always on by design — including
  `write` to `~/memory/`, which is never gated — so per-address or per-destination policy does not exist yet.
- `agent_triggers.cooldown_ms` is a vestigial column with no protocol field and no reader.

## Start here reading order

0. [Glossary](./agent-glossary.md) — the sanctioned vocabulary: three nouns, five verbs, delegation, plans, tools, triggers.
   Read it first; the rest of these docs assume its words.
1. [System overview](./agent-system-overview.md) — architecture, boundaries, lifecycle, completed/incomplete status.
2. [Implementation history](./agent-implementation-history.md) — notes on the recent commits that built this feature.
3. [Operations](./agent-operations.md) — how to run, configure, inspect, and troubleshoot the service locally.
4. [Environments](./agent-environments.md) — the five places the server runs (dev, CI-built apps, local builds, production,
   self-hosted) and how each must be configured.
5. [Desktop UI](./agent-desktop-ui.md) — desktop routes, dialogs, streaming chat UX, and server settings.
6. [Desktop agent unification](./agent-desktop-agent-unification.md) — running this service locally as a desktop subprocess
   and replacing the old assistant runtime with agent sessions.
7. [Signed API](./agent-signed-api.md) — HTTP CBOR envelope, actions, responses, idempotency, signing caveats.
8. [WebSocket subscriptions](./agent-websocket-subscriptions.md) — signed subscribe handshake, live events, partial streaming,
   logs.
9. [Persistence](./agent-persistence.md) — SQLite schema and data lifecycle.
10. [Model providers](./agent-model-providers.md) — provider records, secrets, OpenAI execution, unsupported providers.
11. [Tools](./agent-tools.md) — tool-call lifecycle and `read` behavior.
    - [MCP servers](./agent-mcp.md) — remote MCP servers as tool documents: discovery, projection, runtime, actions, UI.
    - [Session continuation](./agent-session-continuation.md) — `continue_session`: fresh successor sessions at semantic
      boundaries instead of compaction; projection manifests, context meter, guarded navigation.
12. [Prompt injection map](./agent-prompt-injection-map.md) — where hosted-agent and desktop-assistant prompts are defined,
    assembled, and sent to providers.
13. [Security](./agent-security.md) — current security model and hardening gaps.
14. [Development](./agent-development.md) — safe extension workflow, validation commands, doc-maintenance rules.
15. [Troubleshooting](./agent-troubleshooting.md) — fast diagnostic paths for streaming, signing, providers, and tools.
16. [Pi SDK migration project](./agent-pi-sdk-migration.md) — research and implementation plan for using Pi as the agentic
    loop.
17. [Agent triggers plan](./agent-triggers-plan.md) — proactive triggers that create sessions from HM activity or
    schedules.
18. [Workflows v1 plan](./agent-workflows-v1-plan.md) — the implemented plan for durable runs, delegated children, the script
    engine, and the progress UX, with as-built divergences at the end.
19. [The Harness plan](./agent-harness-plan.md) — the milestone-by-milestone plan for the current architecture, with inline
    **Built:** notes wherever the build diverged, an as-built status table, and per-milestone adversarial reviews under
    [`harness/reviews/`](https://github.com/seed-hypermedia/seed/tree/main/hypermedia). [M6 event bus design](./agent-harness-m6-event-bus-design.md) covers the part
    that is only partly built.
20. [Future projects](./agent-future-projects.md) — larger future work packages.
21. [Roadmap](./agent-roadmap.md) — prioritized next steps and code-improvement opportunities.
22. [Performance squeeze plan](./agent-perf-squeeze-plan.md) — the measured 2026-08 production bottlenecks (sandbox CPU,
    provider egress, log volume) and the workstreams removing them, including session-scoped long-lived sandboxes.
23. [Multi-server architecture](./agent-multi-server-architecture.md) — the three-phase path off a single host, with the
    scaling and cost model.
24. [Agent speed plan](./agent-speed-plan.md) — the perceived-latency project: per-stage instrumentation (`/api/perf`,
    `scripts/bench-exec.ts`), first measurements, and the workstreams. Its two design companions:
    [warm microVM pool](./agent-exec-warm-pool.md) for keeping sandboxes alive between `execute` calls, and
    [model comms latency](./agent-model-comms-latency.md) for prompt caching, server-side conversation state, and byte-stable
    prefixes.

## Canonical code entry points

Agents service:

- `agents/src/main.ts` — Bun HTTP/WebSocket server, CORS, live event fanout.
- `agents/protocol/src/index.ts` — canonical shared protocol types for signed actions/responses/session events/WebSocket
  events.
- `agents/src/api.ts` — compatibility re-export of the shared protocol package for service-local imports.
- `agents/src/api-service.ts` — business logic, persistence operations, Pi SDK-backed model execution, the verb
  implementations and Space index, subscription verification. The heart of the service.
- `agents/protocol/src/tool-registry.ts` — the five verbs and the callable tools: model-facing descriptions, JSON
  schemas, and render metadata. Editing a description here changes what every agent reads.
- `agents/src/tool-documents.ts` — tools as content-addressed documents: the lambda ABI, builtin materialization, the
  MCP projection (`syncMcpToolDocuments`), authoring validation, contract markdown.
- `agents/src/mcp.ts` — remote MCP servers: connect (Streamable HTTP / SSE), discover tools, proxy calls, and the lazy
  per-run connection pool.
- `agents/src/web-tools.ts` — self-hosted `web_search` (SearXNG) and the tiered web reader (MediaWiki/static/Crawl4AI)
  behind `read https://…`.
- `agents/src/agent-memory.ts` — sandboxed per-agent memory filesystem behind the `read`/`write` verbs and the signed
  agent-memory actions.
- `agents/src/code-exec.ts` — sandboxed code execution (microsandbox microVMs) against the agent memory workspace, for
  both the `execute` tool and authored lambdas.
- `agents/src/runs.ts` — durable run records + the dispatch queue (leases, retries, cancellation cascade, timer wakes).
- `agents/src/run-events.ts` — waiting runs and what wakes them: `run_event_waits` rows, activity matching, signals.
- `agents/src/workflow-host.ts` — the QuickJS script engine: lint, realm prelude, journaled effect pump, replay.
- `agents/src/json-schema.ts` — bounded JSON Schema validator for typed child results and authored tool contracts.
- `agents/e2e/run.ts` — record/replay model gate (replays offline; `--record` spends real tokens).
- `agents/e2e/live-gate.ts` — scripted scenarios against a real server and model.
- `agents/src/auth.ts` — signed envelope verification and local account authorization.
- `agents/src/sqlite.ts` — open/schema validation/migration gate.
- `agents/src/sqlite-schema.sql` — canonical schema.
- `agents/src/cbor.ts` — DAG-CBOR request/response helpers.
- `agents/src/config.ts` — env and CLI config.

Desktop:

- `frontend/apps/desktop/src/agents-client.ts` — imports shared protocol types, plus URL helpers, signed CBOR HTTP
  sender, WS URL, and timestamped action signing.
- `frontend/apps/desktop/src/models/agents.ts` — React Query hooks, server settings, CRUD actions, signed WS
  subscription hook, partial streaming state.
- `frontend/apps/desktop/src/pages/agents.tsx` — compatibility entry that renders the Agents list route.
- `frontend/apps/desktop/src/pages/agents/` — separate Agents list, server, detail, session, memory-tab, tools, and
  shared dialog modules, plus `user-tool-palette.tsx` (the composer's wrench palette, which runs verbs as the user
  through `InvokeSessionTool`) and `run-parked-actions.tsx` (answering a parked run).
- `frontend/packages/ui/src/agents/assistant-panel.tsx` — the assistant sidebar (agent picker, session picker, draft and
  session chat), shared by desktop (`pages/main.tsx`, toggled from the footer) and web
  (`frontend/apps/web/app/web-assistant-host.tsx`, mounted above the Remix outlet so route changes never remount it, fed
  the current page's navigation/universal-app contexts through `site-context-bridge.tsx`; toggled from the account
  menu's "Agents" item; open/session state in `assistant-panel-state.tsx`; body lazy-loaded so it stays out of the
  initial bundle; full-screen with a "Back to page" bar on narrow screens). Its selection resolver, session-ref codec,
  and window-context derivation live beside it.
- `frontend/apps/desktop/src/components/assistant-message-rendering.tsx` — shared user/assistant message, markdown,
  streaming cursor, raw-markdown info dialog, and tool-call bubble rendering used by both desktop assistant and Agents
  chat.
- `frontend/apps/desktop/src/pages/agents/run-card.tsx` — the pinned run/progress card (active/parked/terminal/todo
  states) and its Activity drawer over the run tree's journal.
- `frontend/apps/desktop/src/components/session-children.tsx` — shared session status dot + lazy sub-session disclosure
  used by the sidebar and the agent-detail Sessions tab.
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
direnv exec . bash -lc 'cd agents && bun src/main.ts'   # plain
direnv exec . bash -lc 'cd agents && bun run dev'       # hot reload, dev web backends, subscription auth on
direnv exec . bash -lc './dev up'                       # the whole stack in one mprocs TUI
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

`bun check` runs typecheck and the formatter together; `bun test` includes `e2e-replay.test.ts`, which replays the
recorded model gates offline (no API key, no network).

Validate frontend:

```bash
direnv exec . bash -lc 'pnpm typecheck'
direnv exec . bash -lc 'pnpm test'
direnv exec . bash -lc 'pnpm format:check'
```

Known caveat: `pnpm audit` currently fails on existing repo dependency vulnerabilities unrelated to the agents feature.
Do not claim audit success unless it actually passes.

## Local URLs

The dev shell sets `SEED_AGENTS_HTTP_PORT=3051` (`.env.vars`), so the dev server never shares a port with the 3050
default a release/packaged build uses (`src/config.ts`).

- Agent server base: `http://localhost:3051`
- Health: `http://localhost:3051/agents/api/health`
- Signed API: `POST http://localhost:3051/api/message`
- WebSocket: `ws://localhost:3051/agents/ws`

## Historical context

The older high-level plan at `docs/plans/agents.md` is useful historical context, but this directory is the current
source of truth. If the old plan conflicts with `agents/docs`, prefer `agents/docs` and update the stale reference.

## Documentation maintenance contract

Future agents should update these docs as part of the same change that modifies behavior. Do not wait for a human to
request documentation updates.

Use this routing table:

- protocol/action changes → `signed-api.md`, `desktop-ui.md`, `development.md`
- desktop-local-server / sidebar changes → `desktop-agent-unification.md`
- WebSocket/live streaming changes → `websocket-subscriptions.md`, `operations.md`
- database/migration changes → `persistence.md`
- provider/runtime changes → `model-providers.md`, `pi-sdk-migration.md`, `roadmap.md`
- verb/tool changes (`agents/protocol/src/tool-registry.ts`, `tool-documents.ts`) → `tools.md`, `security.md`
- MCP server/projection changes (`agents/src/mcp.ts`, `syncMcpToolDocuments`) → `mcp.md`, `tools.md`, `security.md`
- new vocabulary for a mechanism → `glossary.md`, then use its words here
- architecture milestones → `harness/plan.md` (as-built notes) and its `harness/reviews/`
- security/auth/logging changes → `security.md`, `operations.md`
- UI workflow changes → `desktop-ui.md`
- completed/started major work → `implementation-history.md`, `roadmap.md`, `future-projects.md`
- any new doc → link it from this `readme.md`
