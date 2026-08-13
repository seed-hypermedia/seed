# System overview

Seed Agents is a local-first, account-scoped agent system. It lets the desktop app configure an agent server, store
provider secrets, create agents, work in durable sessions, stream model responses, delegate work to children, and
inspect everything that executed.

## Design principles

1. **Signed control plane** — every HTTP action is wrapped in a signed DAG-CBOR envelope.
2. **Account isolation** — persisted state belongs to one Seed account and server queries must prove ownership.
3. **Durable sessions** — sessions are append-only event logs with replay by sequence number.
4. **Live clients** — desktop clients subscribe over a signed WebSocket protocol and receive live changes.
5. **Secret redaction** — API keys are encrypted at rest and never returned in API responses.
6. **Visible tools** — tool calls and tool results are durable session events rendered in the UI.
7. **Shared hypermedia behavior** — `read` uses SDK code shared with CLI URL resolution, not a CLI shellout.
8. **Inspectable operation** — the service exposes `/agents` and diagnostic logs for debugging local workflows.
9. **Five verbs, one address space** — `read`, `write`, `call`, `delegate`, `plan` are the whole model-facing surface;
   new capability arrives as a new address or a new callable, not a new tool in the provider payload.
10. **Configuration is content** — an agent's tools and memory are documents in its Space, addressable and readable by
    the agent and by its owner alike.
11. **The log is symmetric** — the user holds the same verbs the agent does, every event names its actor, and there is
    no side channel between them.
12. **Everything that executes is a run** — turns, children, and scripts are rows in one tree that is also the queue, so
    waiting is free and a crash is recoverable.

The vocabulary above is defined once in [`GLOSSARY.md`](../../GLOSSARY.md) at the repo root.

## Major components

```text
Desktop app
  ├─ Local agents server subprocess (same artifact as the Docker image)
  │    configured with the desktop's own HM API server as its hmServerUrl
  ├─ Agents routes: list, detail, session
  ├─ Assistant sidebar: sessions of any agent on any configured server
  ├─ Provider and create-agent dialogs
  ├─ daemon-backed signing for the selected account
  ├─ signed CBOR HTTP client
  ├─ signed WebSocket subscription hook
  └─ chat message renderer shared with the desktop assistant panel

Agents service (Bun)
  ├─ /api/message signed action API
  ├─ /agents/ws signed subscription API
  ├─ /agents status and live session inspector UI
  ├─ SQLite persistence (state, and the runs table that is also the queue)
  ├─ AES-GCM secret storage
  ├─ Pi SDK-backed model execution loop
  ├─ the five verbs (read / write / call / delegate / plan)
  ├─ tool documents in ~/tools + the <space> index in every system prompt
  ├─ run queue: leases, boot sweep, park/resume, wake sources
  ├─ QuickJS script engine with a content-keyed journal
  └─ diagnostic logging

Shared Seed libraries
  ├─ @shm/shared/blobs for Ed25519 signatures/principals
  ├─ @shm/shared/cbor for canonical DAG-CBOR
  ├─ @seed-hypermedia/client for URL resolution and markdown conversion
  └─ desktop daemon for selected-account signing
```

## End-to-end user flow

1. User opens the desktop **Agents** page.
2. Desktop reads the default agent server URL and checks `/agents/api/health`.
3. Desktop opens a signed WebSocket subscription for the selected account.
4. User configures a model provider in the **Model providers** dialog.
5. Desktop sends signed `SetSecret` and `SetModelProvider` actions.
6. User creates an agent in the **Create agent** dialog.
7. Desktop sends signed `CreateAgent`.
8. Server persists the agent and broadcasts account changes.
9. User opens agent detail and creates/opens a session.
10. Desktop subscribes to `sessions/<sessionId>` over WebSocket.
11. User sends a message with signed `MessageSession`.
12. Server appends a durable user message and creates a `runs` row for the turn, claimed inline on the `interactive`
    queue. Session status is a derived mirror of run state, so it reads `streaming` from here on.
13. Server creates an in-memory Pi SDK session configured from the Seed provider record, encrypted secret, the agent's
    system prompt (its own instructions plus the shared runtime prompt and its `<space>` index), and the tool set: the
    five verbs, plus any callables the transcript shows this thread has already expanded.
14. Pi runs the provider/model loop and emits streaming/tool/final events.
15. Server emits `session-partial` service events for model text deltas, cumulative usage, and the current activity
    phase.
16. WebSocket sends `appendPartial` events to subscribed desktop clients.
17. Desktop renders the partial through the shared assistant markdown renderer.
18. Tool calls/results are translated from Pi events and appended as durable Seed events stamped `actor: 'agent'`. A
    `call` for a tool the thread has not expanded returns that tool's contract instead of an error (touch-expand), and
    the contract's presence in the transcript promotes the tool for the rest of the thread.
19. If the turn used `delegate`, each child gets its own run row (a model child with its own session, or a script child
    in the QuickJS engine); the parent's run parks on them without holding resources and resumes when they resolve.
20. Final assistant message is appended as a durable event; the run finalizes, rolling child usage up, settling plan
    steps whose children all succeeded, and recording any obligation it ended without meeting.
21. Session status re-derives to `idle`, or `error` when the latest run failed.

## Completed capabilities

### Server

- Bun standalone service with configurable host/port/db/data dir.
- `/api/message` and `/agents/api/message` signed CBOR action routes.
- `/api/health` and `/agents/api/health` JSON health routes.
- `/agents/api/status` and `/agents/api/session` debug JSON routes for inspector UI.
- `/agents/ws` signed WebSocket subscription endpoint.
- `/agents` built-in inspector UI.
- Graceful shutdown for WebSockets and SQLite.

### Persistence

- SQLite schema, version gate, and prepend-only migrations.
- Accounts and local account authorization table.
- Provider config table.
- AES-GCM encrypted secrets.
- Agent definitions and per-agent state directories.
- Sessions and durable session events.
- Tool documents per agent (`tool_documents`), addressed by CID.
- Runs, run journals, and outstanding event waits (`runs`, `run_journal`, `run_event_waits`).
- Idempotency table for client request/message IDs.

### Agent runtime

- Agent create/list/get/update/delete.
- Session create/get/list/message/stop/retry/delete.
- Cross-agent session listing (`ListSessions`) with composite keyset pagination.
- Pi SDK-backed model execution for OpenAI-compatible, Anthropic, and Google provider mappings.
- Text streaming translated from Pi events into Seed WebSocket partials.
- Durable user/assistant/error/tool events, each carrying its actor.
- The five verbs registered as Seed-owned Pi custom tools, with callables dispatched through `call` rather than exposed
  to the provider.
- Tool result size limiting (256 KiB).
- The run queue: two queues, lease-based claiming, boot sweep, retry classification with backoff, cancellation cascade,
  timer and event wakes.

### Desktop

- Agents list, server, detail, and session routes with sidebar/menu/shortcut integration.
- Local agents server lifecycle: attaches to an already-running server in development, spawns the bundled binary in a
  packaged app. See [Desktop agent unification](./desktop-agent-unification.md).
- Assistant sidebar backed by agent sessions rather than a separate chat runtime, listing sessions from every configured
  server including the local one.
- Default and multi-server settings.
- Provider management dialog for OpenAI/Anthropic/Google records/secrets.
- Create-agent dialog with configured-provider selection.
- Agent detail page with editable name/model/system prompt.
- Session page with debounced inline title editing, optimistic user messages, durable events, live assistant partials,
  and shared chat rendering.
- User/assistant bubbles, markdown, streaming cursor, and tool-call bubbles shared with the desktop assistant panel.
- Tools tab over `ListAgentTools`: the callable grants an owner can toggle, and for an authored lambda a dialog with its
  full document — contract, source, and content address.
- The pinned run card with its Activity drawer, nested child sessions, and the parked-run Answer action that sends a
  `SignalRun`.
- The composer's wrench palette, which runs `read`/`write`/`call` as the user through `InvokeSessionTool`.
- WebSocket diagnostic logs and robust message parsing.

## Known incomplete areas

- Anthropic and Google are mapped through Pi but still need real-provider smoke coverage before being considered
  production-complete.
- Signed-action timestamps reject requests more than 30 seconds from server time, but nonce caching is still missing.
- No production KMS/OS-keychain secret key storage.
- Grants stop at the callable set plus a single `publish` grant; there is no per-address or per-destination policy
  engine, and memory writes are ungated by design.
- Providers can be deleted (`DeleteModelProvider`, which also removes the API-key secret), but there is no general
  secret-deletion action.
- Triggers and plans are still SQLite rows rather than documents in the Space; the event-bus milestone that moves them
  is only partly built (see [harness/m6-event-bus-design.md](./harness/m6-event-bus-design.md)).
- No full WebSocket heartbeat/backpressure/subscription-limit protocol.
- No long-term retention/pruning policy for events, runs, or journals.

See [Future projects](./future-projects.md) and [Roadmap](./roadmap.md).
