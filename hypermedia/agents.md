---
name: Seed Agents Knowledgebase
summary: This directory is the canonical knowledgebase for the Seed Agents feature. It is intended for future coding agents, product reviewers, and humans who need…
---
This directory is the canonical knowledgebase for the Seed Agents feature. It is intended for future coding agents, product reviewers, and humans who need to understand what exists, how it works, what is complete, and what should happen next. <!-- id:PnjVgoZk -->

# What Seed Agents is <!-- id:leJIxF2G -->

Seed Agents is an account-scoped agent runtime — "the Harness" — composed of: <!-- id:3UeuZ8RQ -->
  - a standalone Bun service in `agents/`; <!-- id:6eXsKGAc -->
  - a signed DAG-CBOR HTTP API for provider, secret, agent, session, tool, and run operations; <!-- id:6gHwFs2S -->
  - a signed WebSocket subscription API for live account/agent/session/run updates; <!-- id:LNZqE9Gt -->
  - SQLite persistence for durable state and event replay; <!-- id:yvPy-79C -->
  - encrypted server-side provider secrets; <!-- id:dWbLjQux -->
  - a Pi SDK-backed model execution loop with streaming responses and tool calls; <!-- id:jqccPPSR -->
  - a desktop UI for configuring servers/providers/agents and working with sessions. <!-- id:94KeE4GI -->

The runtime is built on three nouns and five verbs. The nouns: an agent's **Space** (`~/memory/`, `~/tools/`), the session **Log** (append-only, every event stamped with an actor), and the **Runs** table (every turn, child, and script, which doubles as the dispatch queue). The verbs — `read`, `write`, `call`, `delegate`, `plan` — are the entire model-facing tool surface and are always on; everything that used to be its own tool is now an address form of a verb or a callable dispatched through `call`. [`glossary.md`](./agent-glossary.md) defines this vocabulary and is the sanctioned wording for these docs; do not restate it here, point at it. <!-- id:N8Qe0rh- -->

# Quick status <!-- id:jHVtdYWD -->

Completed and usable locally: <!-- id:QygqfsL- -->
  - signed HTTP action API; <!-- id:Z0qiv8u9 -->
  - signed WebSocket subscriptions; <!-- id:TA8PKDGT -->
  - SQLite persistence and migrations gate; <!-- id:oJWWxM2y -->
  - encrypted secrets and redacted provider/secret responses; <!-- id:jEy9DlRN -->
  - model-provider CRUD, provider listing, and provider-backed model listing for model dropdowns; <!-- id:pUCiQZfI -->
  - agent CRUD and session CRUD, including inline session-title editing; <!-- id:_vn6uI7U -->
  - pending agent invitations plus accepted reader/writer collaborators, with agent-wide read/write enforcement, plus owner-set public read and public chat flags (any signed account can view, or view and message, the agent by id); <!-- id:Mj4yDp_8 -->
  - durable session event replay; <!-- id:JvVTe9CC -->
  - schedule triggers for interval, weekly, and one-time proactive sessions; <!-- id:9GD2PbNo -->
  - Pi SDK-backed chat execution; <!-- id:tHQZLkYR -->
  - streaming assistant text over WebSocket; <!-- id:NIG888Y8 -->
  - desktop chat message rendering shared with the assistant panel, including formatted markdown bubbles and raw-markdown inspection for message text; <!-- id:CvGSlO3c -->
  - rich Seed block editing for agent prompts, trigger prompts, and agent session chat input, with markdown conversion before signed submissions; <!-- id:kbNjezZ8 -->
  - visible durable tool call/result events, each stamped with the actor that produced it; <!-- id:rv-ZGvGc -->
  - the five verbs as the whole model-facing surface: `read` and `write` over one address space (`~/memory/…`, `~/tools/…`, `hm://…`, `ipfs://…`, `https://…`, `activity:`, `attachment:…`, `thread:…`, `run:…`), `call` for callable tools, `delegate` for children, `plan` for the visible checklist; <!-- id:-fMlLMMe -->
  - `read` using shared Seed Hypermedia URL resolution; <!-- id:K0SYUzuf -->
  - tools as content-addressed documents in `~/tools/`: builtin bindings, authored lambdas, and MCP projections alike, each a DAG-CBOR document whose CID is its version, listed for the owner through `ListAgentTools`; <!-- id:POxfVINy -->
  - remote **MCP servers**, connected per account like model providers and enabled per agent: every tool a server advertises is an `mcp` tool document named `<server>__<tool>`, dispatched through `call` over a lazy per-run connection, promoted like any other tool, and managed from the Tools tab (`mcp.md`); <!-- id:wENM42s0 -->
  - touch-expand and promotion: a wrong or unexpanded `call` answers with the tool's contract instead of an error, and a contract that has entered the transcript promotes that callable to a first-class provider tool for the rest of the thread — derived purely from durable events, so it survives restarts; <!-- id:P0qouwDf -->
  - `search`, `web_search`, and `execute` as callable tools: self-hosted SearXNG search, a tiered MediaWiki → in-process static (Readability + Turndown) → Crawl4AI reader behind `read https://…`, and TypeScript/Python/shell execution in ephemeral hardware-isolated microVMs with the agent's memory mounted at `/workspace`; <!-- id:SeulBtW5 -->
  - per-agent persistent memory filesystem behind the `read`/`write` verbs, with signed agent-memory actions, chunked uploads of any size, binary/media support, and a desktop Memory tab (editing, media previews, downloads, URL download, IPFS publishing); <!-- id:xd7k5RQG -->
  - grants rather than tool toggles: `definition.tools` narrows the callable set and carries the `publish` grant for signed public writing; the verbs themselves are never grantable. Server-side HM account-key creation/selection backs signing; <!-- id:qeTFBnhl -->
  - durable run records + dispatch queue under every agent execution: lease-based crash recovery (boot sweep + interrupted tool-call repair), derived session status, persisted per-run usage with child rollup; <!-- id:iCzGuMgd -->
  - `delegate` in both kinds: model children (a verbatim markdown brief, optional typed `output` schema delivered through `return_result`, parking and resume, durable session lineage) and script children (agent-authored JavaScript in a QuickJS realm with content-keyed journal replay, determinism lint, fuel/memory/journal caps, and a ctx API of call/delegate/parallel/sleep/waitForEvent/continueAsNew/step/plan/now/log/progress); <!-- id:7gpfJqYg -->
  - unified obligations: a run that ends owing a typed result or unfinished plan steps is asked once to settle everything it owes, and carries any remaining debt in the open as `RunInfo.unmetObligations`; <!-- id:Nzfp3YKP -->
  - the `plan` verb's live checklist on sessions, with runtime settlement — a step whose attached children all succeeded closes itself (`resolvedBy: 'runtime'`), and a fully settled plan records `settledAt`; <!-- id:-kcVmSD9 -->
  - a symmetric log: the user runs the same `read`/`write`/`call` verbs through `InvokeSessionTool`, and the results land on the shared log as `actor: 'user'` events the agent reads as ground truth; <!-- id:Faftw83V -->
  - run actions (`GetRun`/`ListRuns`/`CancelRun`/`SignalRun`/`GetRunJournal`) and `runs/<rootRunId>` WebSocket subscriptions with journal replay; <!-- id:C9vXVN3q -->
  - wake sources for day-scale work: `ctx.waitForEvent` parks a run for nothing until a signal, an activity event, or a timeout, and a trigger can carry a `wake` continuation instead of starting a new thread; <!-- id:DdnVf4ZT -->
  - agent introspection: `read`/`write ~/triggers/<name>` (the agent creates, edits, enables, disables, and deletes its own triggers directly, on the existing `agent_triggers` rows), `read ~/self` (the agent's own definition, grants, triggers, and memory summary), and `read thread:` (list and search the account's conversations by title and recent message text), with the Space index advertising active triggers and the triggers affordance; <!-- id:sO_sZGlX -->
  - a record/replay model-gate harness (`agents/e2e/run.ts`, replayed offline by `agents/src/e2e-replay.test.ts` — whose cassettes are stale since the verb collapse, so that replay currently **skips**) and a live gate against a real server and model (`agents/e2e/live-gate.ts`), plus a blind simulated-model gate methodology (see `operations.md`); <!-- id:cE18-AWm -->
  - desktop progress surfaces: the pinned run card with Activity drawer, session nesting with lazy sub-session disclosures, and child-session breadcrumb/banner/composer lock; <!-- id:R7lhL3G9 -->
  - live local sync subscriptions for `hm://` documents and comments produced by a remote agent while that exact session is mounted in the desktop (full page or selected sidebar session), so result links resolve immediately without syncing background sessions; <!-- id:Im-jo3Vy -->
  - desktop Agents routes, provider dialogs, create-agent dialog, agent detail, Tools tab, session page; <!-- id:9qvLE6nO -->
  - diagnostic logging for OpenAI streaming and WebSocket subscription/fanout. <!-- id:Bi6NouwS -->

Important incomplete work: <!-- id:JtelYxuX -->
  - Provider types are registry-driven: OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Groq, xAI, Ollama, and a generic Custom (OpenAI-compatible) endpoint are configurable and mapped through Pi; all non-OpenAI types still need real-provider smoke coverage. <!-- id:zAfO4JPV -->
  - Running sessions can be stopped with the signed `StopSession` action from desktop or API clients. <!-- id:2NHBkzl7 -->
  - Signed actions include a timestamp and the server rejects requests more than 30 seconds from local time; nonce caching is still future hardening. <!-- id:76bKKq7d -->
  - WebSocket server-to-client messages are JSON and not individually signed. <!-- id:umlPY4HH -->
  - Grants are coarse: the callable set plus a single `publish` grant. The five verbs are always on by design — including `write` to `~/memory/`, which is never gated — so per-address or per-destination policy does not exist yet. <!-- id:pOBjEb2G -->
  - `agent_triggers.cooldown_ms` is a vestigial column with no protocol field and no reader. <!-- id:rSm-8GWQ -->

# Start here reading order <!-- id:waZJtO97 -->

1. [Glossary](./agent-glossary.md) — the sanctioned vocabulary: three nouns, five verbs, delegation, plans, tools, triggers. Read it first; the rest of these docs assume its words. <!-- id:wy6v88cs -->
2. [System overview](./agent-system-overview.md) — architecture, boundaries, lifecycle, completed/incomplete status. <!-- id:yiVgkwBy -->
3. [Implementation history](./agent-implementation-history.md) — notes on the recent commits that built this feature. <!-- id:jWmf4Ib3 -->
4. [Operations](./agent-operations.md) — how to run, configure, inspect, and troubleshoot the service locally. <!-- id:CkzZwxzm -->
5. [Environments](./agent-environments.md) — the five places the server runs (dev, CI-built apps, local builds, production, self-hosted) and how each must be configured. <!-- id:TIEo9Fjq -->
6. [Desktop UI](./agent-desktop-ui.md) — desktop routes, dialogs, streaming chat UX, and server settings. <!-- id:hCYPtL5R -->
7. [Desktop agent unification](./agent-desktop-agent-unification.md) — running this service locally as a desktop subprocess and replacing the old assistant runtime with agent sessions. <!-- id:ZCjihFSX -->
8. [Signed API](./agent-signed-api.md) — HTTP CBOR envelope, actions, responses, idempotency, signing caveats. <!-- id:sCgCsOJH -->
9. [WebSocket subscriptions](./agent-websocket-subscriptions.md) — signed subscribe handshake, live events, partial streaming, logs. <!-- id:H1bsUlFL -->
10. [Persistence](./agent-persistence.md) — SQLite schema and data lifecycle. <!-- id:Lnt3QsVN -->
11. [Model providers](./agent-model-providers.md) — provider records, secrets, OpenAI execution, unsupported providers. <!-- id:yXvQH70X -->
12. [Tools](./agent-tools.md) — tool-call lifecycle and `read` behavior. <!-- id:KGBqHjS9 -->
    - [MCP servers](./agent-mcp.md) — remote MCP servers as tool documents: discovery, projection, runtime, actions, UI. <!-- id:nBG4qV_k -->
    - [Session continuation](./agent-session-continuation.md) — `continue_session`: fresh successor sessions at semantic boundaries instead of compaction; projection manifests, context meter, guarded navigation. <!-- id:0bqVomwP -->
13. [Prompt injection map](./agent-prompt-injection-map.md) — where hosted-agent and desktop-assistant prompts are defined, assembled, and sent to providers. <!-- id:o4G1iJaN -->
14. [Security](./agent-security.md) — current security model and hardening gaps. <!-- id:0GTW6WER -->
15. [Development](./agent-development.md) — safe extension workflow, validation commands, doc-maintenance rules. <!-- id:0Zyq0q0h -->
16. [Troubleshooting](./agent-troubleshooting.md) — fast diagnostic paths for streaming, signing, providers, and tools. <!-- id:jd1XbgzL -->
17. [Pi SDK migration project](./agent-pi-sdk-migration.md) — research and implementation plan for using Pi as the agentic loop. <!-- id:GfUgUz6t -->
18. [Agent triggers plan](./agent-triggers-plan.md) — proactive triggers that create sessions from HM activity or schedules. <!-- id:YB9LibrL -->
19. [Workflows v1 plan](./agent-workflows-v1-plan.md) — the implemented plan for durable runs, delegated children, the script engine, and the progress UX, with as-built divergences at the end. <!-- id:-7zEn_4j -->
20. [The Harness plan](./agent-harness-plan.md) — the milestone-by-milestone plan for the current architecture, with inline **Built:** notes wherever the build diverged, an as-built status table, and per-milestone adversarial reviews under [`harness/reviews/`](https://github.com/seed-hypermedia/seed/tree/main/hypermedia). [M6 event bus design](./agent-harness-m6-event-bus-design.md) covers the part that is only partly built. <!-- id:z_5l6m1I -->
21. [Future projects](./agent-future-projects.md) — larger future work packages. <!-- id:hBbqVvBl -->
22. [Roadmap](./agent-roadmap.md) — prioritized next steps and code-improvement opportunities. <!-- id:gYVT54tz -->
23. [Performance squeeze plan](./agent-perf-squeeze-plan.md) — the measured 2026-08 production bottlenecks (sandbox CPU, provider egress, log volume) and the workstreams removing them, including session-scoped long-lived sandboxes. <!-- id:YFOYJ6n1 -->
24. [Multi-server architecture](./agent-multi-server-architecture.md) — the three-phase path off a single host, with the scaling and cost model. <!-- id:1vTtMEtQ -->
25. [Agent speed plan](./agent-speed-plan.md) — the perceived-latency project: per-stage instrumentation (`/api/perf`, `scripts/bench-exec.ts`), first measurements, and the workstreams. Its two design companions: [warm microVM pool](./agent-exec-warm-pool.md) for keeping sandboxes alive between `execute` calls, and [model comms latency](./agent-model-comms-latency.md) for prompt caching, server-side conversation state, and byte-stable prefixes. <!-- id:iyyVcmvY -->

# Canonical code entry points <!-- id:IUcE3dhQ -->

Agents service: <!-- id:_ol0QB9a -->
  - `agents/src/main.ts` — Bun HTTP/WebSocket server, CORS, live event fanout. <!-- id:b2aNN1I- -->
  - `agents/protocol/src/index.ts` — canonical shared protocol types for signed actions/responses/session events/WebSocket events. <!-- id:R0RI7JsM -->
  - `agents/src/api.ts` — compatibility re-export of the shared protocol package for service-local imports. <!-- id:9m7yWCxC -->
  - `agents/src/api-service.ts` — business logic, persistence operations, Pi SDK-backed model execution, the verb implementations and Space index, subscription verification. The heart of the service. <!-- id:bw99Days -->
  - `agents/protocol/src/tool-registry.ts` — the five verbs and the callable tools: model-facing descriptions, JSON schemas, and render metadata. Editing a description here changes what every agent reads. <!-- id:hVgHc10i -->
  - `agents/src/tool-documents.ts` — tools as content-addressed documents: the lambda ABI, builtin materialization, the MCP projection (`syncMcpToolDocuments`), authoring validation, contract markdown. <!-- id:uoiXKpAE -->
  - `agents/src/mcp.ts` — remote MCP servers: connect (Streamable HTTP / SSE), discover tools, proxy calls, and the lazy per-run connection pool. <!-- id:JmTs4d-m -->
  - `agents/src/web-tools.ts` — self-hosted `web_search` (SearXNG) and the tiered web reader (MediaWiki/static/Crawl4AI) behind `read https://…`. <!-- id:07tDO3ED -->
  - `agents/src/agent-memory.ts` — sandboxed per-agent memory filesystem behind the `read`/`write` verbs and the signed agent-memory actions. <!-- id:6foT63fb -->
  - `agents/src/code-exec.ts` — sandboxed code execution (microsandbox microVMs) against the agent memory workspace, for both the `execute` tool and authored lambdas. <!-- id:t7QkzSlQ -->
  - `agents/src/runs.ts` — durable run records + the dispatch queue (leases, retries, cancellation cascade, timer wakes). <!-- id:AeGqZAzW -->
  - `agents/src/run-events.ts` — waiting runs and what wakes them: `run_event_waits` rows, activity matching, signals. <!-- id:BHjLM2C5 -->
  - `agents/src/workflow-host.ts` — the QuickJS script engine: lint, realm prelude, journaled effect pump, replay. <!-- id:-vILRwAK -->
  - `agents/src/json-schema.ts` — bounded JSON Schema validator for typed child results and authored tool contracts. <!-- id:QrvNicNP -->
  - `agents/e2e/run.ts` — record/replay model gate (replays offline; `--record` spends real tokens). <!-- id:1IR5RweA -->
  - `agents/e2e/live-gate.ts` — scripted scenarios against a real server and model. <!-- id:fTeKjwta -->
  - `agents/src/auth.ts` — signed envelope verification and local account authorization. <!-- id:vc5Lyj0r -->
  - `agents/src/sqlite.ts` — open/schema validation/migration gate. <!-- id:1poItfnN -->
  - `agents/src/sqlite-schema.sql` — canonical schema. <!-- id:qh0Hc8ae -->
  - `agents/src/cbor.ts` — DAG-CBOR request/response helpers. <!-- id:i32Ky7JD -->
  - `agents/src/config.ts` — env and CLI config. <!-- id:x7yhzawN -->

Desktop: <!-- id:Ji7GrJSR -->
  - `frontend/apps/desktop/src/agents-client.ts` — imports shared protocol types, plus URL helpers, signed CBOR HTTP sender, WS URL, and timestamped action signing. <!-- id:TLUNv-j0 -->
  - `frontend/apps/desktop/src/models/agents.ts` — React Query hooks, server settings, CRUD actions, signed WS subscription hook, partial streaming state. <!-- id:GLQJ188x -->
  - `frontend/apps/desktop/src/pages/agents.tsx` — compatibility entry that renders the Agents list route. <!-- id:AoOy54R2 -->
  - `frontend/apps/desktop/src/pages/agents/` — separate Agents list, server, detail, session, memory-tab, tools, and shared dialog modules, plus `user-tool-palette.tsx` (the composer's wrench palette, which runs verbs as the user through `InvokeSessionTool`) and `run-parked-actions.tsx` (answering a parked run). <!-- id:WbxCzFTT -->
  - `frontend/packages/ui/src/agents/assistant-panel.tsx` — the assistant sidebar (agent picker, session picker, draft and session chat), shared by desktop (`pages/main.tsx`, toggled from the footer) and web (`frontend/apps/web/app/web-assistant-host.tsx`, mounted above the Remix outlet so route changes never remount it, fed the current page's navigation/universal-app contexts through `site-context-bridge.tsx`; toggled from the account menu's "Agents" item; open/session state in `assistant-panel-state.tsx`; body lazy-loaded so it stays out of the initial bundle; full-screen with a "Back to page" bar on narrow screens). Its selection resolver, session-ref codec, and window-context derivation live beside it. <!-- id:Q_MMQZXI -->
  - `frontend/apps/desktop/src/components/assistant-message-rendering.tsx` — shared user/assistant message, markdown, streaming cursor, raw-markdown info dialog, and tool-call bubble rendering used by both desktop assistant and Agents chat. <!-- id:JvRgmznH -->
  - `frontend/apps/desktop/src/pages/agents/run-card.tsx` — the pinned run/progress card (active/parked/terminal/todo states) and its Activity drawer over the run tree's journal. <!-- id:1J7Ko9pM -->
  - `frontend/apps/desktop/src/components/session-children.tsx` — shared session status dot + lazy sub-session disclosure used by the sidebar and the agent-detail Sessions tab. <!-- id:V_FVVWsX -->
  - `frontend/apps/desktop/src/pages/agents/prompt-editor.tsx` — shared rich prompt editor and block-to-markdown helper used by agent/trigger prompt editing and rich session-message submission. <!-- id:8ltx59Sw -->
  - `frontend/packages/shared/src/routes.ts` — route schemas for `agents`, `agent`, and `agent-session`. <!-- id:y2Igf7-p -->

Shared Hypermedia/CLI behavior: <!-- id:BvDmGUR0 -->
  - `frontend/packages/client/src/resource-read.ts` — `resolveIdWithClient()` shared by CLI-like reads and the agent tool. <!-- id:XPMbTeOt -->
  - `frontend/apps/cli/src/utils/resolve-id.ts` — CLI wrapper around the shared resolver. <!-- id:TqXBQePM -->
  - `frontend/packages/client/src/hm-resolver.ts` — lower-level URL-to-HM-ID resolver. <!-- id:0s6IlJSO -->
  - `frontend/packages/client/src/blocks-to-markdown.ts` — markdown conversion used by tool/CLI paths. <!-- id:PcWfF6IA -->

# Common commands <!-- id:vXHdZEBN -->

Run agents server: <!-- id:ouQEpRHT -->

```bash <!-- id:sNV2S9C_ -->
direnv exec . bash -lc 'cd agents && bun src/main.ts'   # plain
direnv exec . bash -lc 'cd agents && bun run dev'       # hot reload, dev web backends, subscription auth on
direnv exec . bash -lc './dev up'                       # the whole stack in one mprocs TUI
```

Build the agents deployment image: <!-- id:YFEuhhfl -->

```bash <!-- id:RMV0CtJt -->
docker build -t seedhypermedia/agents:dev . -f ./agents/Dockerfile
```

Run desktop: <!-- id:xA590DH7 -->

```bash <!-- id:karGcsMi -->
direnv exec . bash -lc './dev run-desktop'
```

Validate agents service: <!-- id:L5MBKbsC -->

```bash <!-- id:FlweFHtE -->
direnv exec . bash -lc 'cd agents && bun check && bun test'
direnv exec . bash -lc 'cd agents && bun run test:build'
direnv exec . bash -lc 'cd agents && bun run test:docker'
direnv exec . bash -lc 'cd agents && bun run test:trigger'
```

`bun check` runs typecheck and the formatter together; `bun test` includes `e2e-replay.test.ts`, which replays the recorded model gates offline (no API key, no network). <!-- id:hPx653sL -->

Validate frontend: <!-- id:EnU6LXfx -->

```bash <!-- id:GSGvjDB7 -->
direnv exec . bash -lc 'pnpm typecheck'
direnv exec . bash -lc 'pnpm test'
direnv exec . bash -lc 'pnpm format:check'
```

Known caveat: `pnpm audit` currently fails on existing repo dependency vulnerabilities unrelated to the agents feature. Do not claim audit success unless it actually passes. <!-- id:S3G0jx-K -->

# Local URLs <!-- id:uIAf_6-7 -->

The dev shell sets `SEED_AGENTS_HTTP_PORT=3051` (`.env.vars`), so the dev server never shares a port with the 3050 default a release/packaged build uses (`src/config.ts`). <!-- id:R07Qhc85 -->
  - Agent server base: `http://localhost:3051` <!-- id:jxNJ9ATf -->
  - Health: `http://localhost:3051/agents/api/health` <!-- id:whmMqZP2 -->
  - Signed API: `POST http://localhost:3051/api/message` <!-- id:sPSRq8Pg -->
  - WebSocket: `ws://localhost:3051/agents/ws` <!-- id:4HyXVW3m -->

# Historical context <!-- id:8OK5r3cO -->

The older high-level plan at `docs/plans/agents.md` is useful historical context, but this directory is the current source of truth. If the old plan conflicts with `agents/docs`, prefer `agents/docs` and update the stale reference. <!-- id:HjiTBPwE -->

# Documentation maintenance contract <!-- id:HRbjImn7 -->

Future agents should update these docs as part of the same change that modifies behavior. Do not wait for a human to request documentation updates. <!-- id:197nPqCJ -->

Use this routing table: <!-- id:4wzDU3Fm -->
  - protocol/action changes → `signed-api.md`, `desktop-ui.md`, `development.md` <!-- id:E6pHZ8N0 -->
  - desktop-local-server / sidebar changes → `desktop-agent-unification.md` <!-- id:MbflEXX9 -->
  - WebSocket/live streaming changes → `websocket-subscriptions.md`, `operations.md` <!-- id:GmSSH7cZ -->
  - database/migration changes → `persistence.md` <!-- id:aoDO49Tn -->
  - provider/runtime changes → `model-providers.md`, `pi-sdk-migration.md`, `roadmap.md` <!-- id:0QZemSez -->
  - verb/tool changes (`agents/protocol/src/tool-registry.ts`, `tool-documents.ts`) → `tools.md`, `security.md` <!-- id:BR5r9XO7 -->
  - MCP server/projection changes (`agents/src/mcp.ts`, `syncMcpToolDocuments`) → `mcp.md`, `tools.md`, `security.md` <!-- id:fNOtrDEB -->
  - new vocabulary for a mechanism → `glossary.md`, then use its words here <!-- id:oVJOHkJq -->
  - architecture milestones → `harness/plan.md` (as-built notes) and its `harness/reviews/` <!-- id:EKIOwn0A -->
  - security/auth/logging changes → `security.md`, `operations.md` <!-- id:L-NyY2H9 -->
  - UI workflow changes → `desktop-ui.md` <!-- id:xNfiwz77 -->
  - completed/started major work → `implementation-history.md`, `roadmap.md`, `future-projects.md` <!-- id:0pUXdGBt -->
  - any new doc → link it from this `readme.md` <!-- id:AmTb04MY -->
