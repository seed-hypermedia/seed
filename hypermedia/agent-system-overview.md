---
name: System overview
summary: Seed Agents is a local-first, account-scoped agent system. It lets the desktop app configure an agent server, store provider secrets, create agents, work in…
---
Seed Agents is a local-first, account-scoped agent system. It lets the desktop app configure an agent server, store provider secrets, create agents, work in durable sessions, stream model responses, delegate work to children, and inspect everything that executed. <!-- id:j6gFhd29 -->

# Design principles <!-- id:bHJBP28f -->

<!-- id:aTrhlaXK -->
1. **Signed control plane** — every HTTP action is wrapped in a signed DAG-CBOR envelope. <!-- id:DoPLxUzT -->
2. **Account isolation** — persisted state belongs to one Seed account; access requires ownership or an accepted agent-level reader/writer collaboration. <!-- id:JartbkEd -->
3. **Durable sessions** — sessions are append-only event logs with replay by sequence number. <!-- id:G2rHB4lC -->
4. **Live clients** — desktop clients subscribe over a signed WebSocket protocol and receive live changes. <!-- id:eZIvnI2F -->
5. **Secret redaction** — API keys are encrypted at rest and never returned in API responses. <!-- id:0HDC4TeT -->
6. **Visible tools** — tool calls and tool results are durable session events rendered in the UI. <!-- id:MArR08vh -->
7. **Shared hypermedia behavior** — `read` uses SDK code shared with CLI URL resolution, not a CLI shellout. <!-- id:1_gfqzKV -->
8. **Inspectable operation** — durable session events, the signed read actions, and diagnostic logs support debugging local workflows; there is no unauthenticated inspection surface. <!-- id:ldqXhH-1 -->
9. **Five verbs, one address space** — `read`, `write`, `call`, `delegate`, `plan` are the whole model-facing surface; new capability arrives as a new address or a new callable, not a new tool in the provider payload. <!-- id:Y-pjolWg -->
10. **Configuration is content** — an agent's tools and memory are documents in its Space, addressable and readable by the agent and by its owner alike. <!-- id:5lhl3lKX -->
11. **The log is symmetric** — the user holds the same verbs the agent does, every event names its actor, and there is no side channel between them. <!-- id:3AOgn7T0 -->
12. **Everything that executes is a run** — turns, children, and scripts are rows in one tree that is also the queue, so waiting is free and a crash is recoverable. <!-- id:H7vDrg4J -->

The vocabulary above is defined once in [`glossary.md`](./agent-glossary.md). <!-- id:1RALufCn -->

# Major components <!-- id:LF0S8XBg -->

```text <!-- id:9rdPDFNJ -->
Desktop app
  ├─ Local agents server subprocess (same artifact as the Docker image)
  │    configured with the desktop's typed HM API bridge plus its daemon's direct IPFS endpoint
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

# End-to-end user flow <!-- id:29tMaHyG -->

1. User opens the desktop **Agents** page. <!-- id:1xHbNrzu -->
2. Desktop reads the default agent server URL and checks `/agents/api/health`. <!-- id:iJTq1h2g -->
3. Desktop opens a signed WebSocket subscription for the selected account. <!-- id:tn8sA958 -->
4. User configures a model provider in the **Model providers** dialog. <!-- id:Ckat4Ybf -->
5. Desktop sends signed `SetSecret` and `SetModelProvider` actions. <!-- id:TNB496ji -->
6. User creates an agent in the **Create agent** dialog. <!-- id:6rIhCXQw -->
7. Desktop sends signed `CreateAgent`. <!-- id:Mw42bAcf -->
8. Server persists the agent and broadcasts account changes. <!-- id:U2T3lUGx -->
9. User opens agent detail and creates/opens a session. <!-- id:Mx7jRmmi -->
10. Desktop subscribes to `sessions/<sessionId>` over WebSocket. <!-- id:o4auo92c -->
11. A writer sends a message with signed `MessageSession`; other accepted writers may send at the same time. <!-- id:HR9VWSNS -->
12. Server immediately appends each durable user message with its acting account and exact signer, broadcasts it, and creates a `runs` row. The first turn is claimed inline on the `interactive` queue; concurrent turns remain queued in append order because only one model turn may own a session. Session status is a derived mirror of run state, so it reads `streaming` while any of those turns remain live. <!-- id:oRXM5vFs -->
13. Server creates an in-memory Pi SDK session configured from the Seed provider record, encrypted secret, the agent's system prompt (its own instructions plus the shared runtime prompt and its `<space>` index), and the tool set: the five verbs, plus any callables the transcript shows this thread has already expanded. <!-- id:XnosbwT5 -->
14. Pi runs the provider/model loop and emits streaming/tool/final events. <!-- id:5aLPYqqC -->
15. Server emits `session-partial` service events for model text deltas, cumulative usage, and the current activity phase. <!-- id:Tmz1FBxK -->
16. WebSocket sends `appendPartial` events to subscribed desktop clients. <!-- id:t5ien6K3 -->
17. Desktop renders the partial through the shared assistant markdown renderer. <!-- id:5V6t_xTb -->
18. Tool calls/results are translated from Pi events and appended as durable Seed events stamped `actor: 'agent'`. A `call` for a tool the thread has not expanded returns that tool's contract instead of an error (touch-expand), and the contract's presence in the transcript promotes the tool for the rest of the thread. <!-- id:aSLd8Isz -->
19. If the turn used `delegate`, each child gets its own run row (a model child with its own session, or a script child in the QuickJS engine); the parent's run parks on them without holding resources and resumes when they resolve. <!-- id:nKBBy1Gx -->
20. Final assistant message is appended as a durable event; the run finalizes, rolling child usage up, settling plan steps whose children all succeeded, and recording any obligation it ended without meeting. <!-- id:ZwcfQgzb -->
21. Session status re-derives to `idle`, or `error` when the latest run failed. <!-- id:2lxTmx1B -->

# Completed capabilities <!-- id:9UY_uh_E -->

## Server <!-- id:4Y9bCXsB -->

- Bun standalone service with configurable host/port/db/data dir. <!-- id:4LiSzWvH -->
- `/api/message` and `/agents/api/message` signed CBOR action routes. <!-- id:tZu7kMWo -->
- `/api/health` and `/agents/api/health` JSON health routes. <!-- id:DEcuBaGj -->
- `/agents/ws` signed WebSocket subscription endpoint. <!-- id:w0JhfKLo -->
- No browser UI or unauthenticated data routes; everything else is a 404. <!-- id:ERQ0V57X -->
- Graceful shutdown for WebSockets and SQLite. <!-- id:cCtN6O8W -->

## Persistence <!-- id:C_BJ2Z-T -->

- SQLite schema, version gate, and prepend-only migrations. <!-- id:fvsEGXdQ -->
- Accounts and local account authorization table. <!-- id:72tGFpPU -->
- Provider config table. <!-- id:qif5Dl3t -->
- AES-GCM encrypted secrets. <!-- id:C8oZwlYq -->
- Agent definitions and per-agent state directories. <!-- id:XzwNmuZl -->
- Sessions and durable session events. <!-- id:aSBPPy31 -->
- Tool documents per agent (`tool_documents`), addressed by CID. <!-- id:2NHGmCh6 -->
- Runs, run journals, and outstanding event waits (`runs`, `run_journal`, `run_event_waits`). <!-- id:GvE0H7TR -->
- Idempotency table for client request/message IDs. <!-- id:RZlMVIHT -->

## Agent runtime <!-- id:AAxrzi8V -->

- Agent create/list/get/update/delete. <!-- id:GWMCE9_k -->
- Agent invitations, acceptance/decline, revocation, and reader/writer collaborator roles. Readers can inspect the complete agent; writers can additionally mutate and interact, but only owners manage access or delete the agent. <!-- id:pwPlTOBC -->
- Session create/get/list/message/stop/retry/delete. <!-- id:D2RZH2GQ -->
- Cross-agent session listing (`ListSessions`) with composite keyset pagination. <!-- id:8iuaH3pW -->
- Pi SDK-backed model execution for OpenAI-compatible, Anthropic, and Google provider mappings. <!-- id:lAWFWbOd -->
- Text streaming translated from Pi events into Seed WebSocket partials. <!-- id:NSfbrCwb -->
- Durable user/assistant/error/tool events, each carrying its actor. <!-- id:98lUOPrW -->
- The five verbs registered as Seed-owned Pi custom tools, with callables dispatched through `call` rather than exposed to the provider. <!-- id:w4i5NWLg -->
- Tool result size limiting (256 KiB). <!-- id:l4qFQAxD -->
- The run queue: two queues, lease-based claiming, boot sweep, retry classification with backoff, cancellation cascade, timer and event wakes. <!-- id:5fTXXpUY -->

## Desktop <!-- id:HoIeFoE4 -->

- Agents list, server, detail, and session routes with sidebar/menu/shortcut integration. <!-- id:KVIyJNrf -->
- Local agents server lifecycle: attaches to an already-running server in development, spawns the bundled binary in a packaged app. See [Desktop agent unification](./agent-desktop-agent-unification.md). <!-- id:o29cW4lm -->
- Assistant sidebar backed by agent sessions rather than a separate chat runtime, listing sessions from every configured server including the local one. <!-- id:KM6x2pZe -->
- Default and multi-server settings. <!-- id:OuuPfvPJ -->
- Provider management dialog for OpenAI/Anthropic/Google records/secrets. <!-- id:5OYSu8Vw -->
- Create-agent dialog with configured-provider selection. <!-- id:JhGY7o_O -->
- Agent detail page with editable name/model/system prompt and a Settings collaborator invite/member panel. <!-- id:x5czSImM -->
- Session page with debounced inline title editing, optimistic user messages, durable events, live assistant partials, and shared chat rendering. <!-- id:Dy_Snpcf -->
- A mounted remote session page or currently selected Assistant-sidebar session keeps agent-created/referenced `hm://` documents and comments subscribed on the desktop's local node, including recursive target discovery for comments and exact versions for document write results; background sessions do not sync. <!-- id:JyyRewW4 -->
- User/assistant bubbles, markdown, streaming cursor, and tool-call bubbles shared with the desktop assistant panel. <!-- id:uWhyPwax -->
- Tools tab over `ListAgentTools`: the callable grants an owner can toggle, and for an authored lambda a dialog with its full document — contract, source, and content address. <!-- id:VVqVjmDP -->
- The pinned run card with its Activity drawer, nested child sessions, and the parked-run Answer action that sends a `SignalRun`. <!-- id:2IpFHfyj -->
- The composer's wrench palette, which runs `read`/`write`/`call` as the user through `InvokeSessionTool`. <!-- id:e_7FcNsV -->
- WebSocket diagnostic logs and robust message parsing. <!-- id:Gow06xE6 -->

# Known incomplete areas <!-- id:7Kit49Vm -->

<!-- id:y8Sembfy -->
- Anthropic and Google are mapped through Pi but still need real-provider smoke coverage before being considered production-complete. <!-- id:YsLNlO21 -->
- Signed-action timestamps reject requests more than 30 seconds from server time, but nonce caching is still missing. <!-- id:qZUKtz61 -->
- No production KMS/OS-keychain secret key storage. <!-- id:3g510zpO -->
- Grants stop at the callable set plus a single `publish` grant; there is no per-address or per-destination policy engine, and memory writes are ungated by design. <!-- id:nJ6r4hkB -->
- Providers can be deleted (`DeleteModelProvider`, which also removes the API-key secret), but there is no general secret-deletion action. <!-- id:iDJldMWp -->
- Triggers and plans are still SQLite rows rather than documents in the Space; the event-bus milestone that moves them is only partly built (see [harness/m6-event-bus-design.md](./agent-harness-m6-event-bus-design.md)). <!-- id:OoUMhsD3 -->
- No full WebSocket heartbeat/backpressure/subscription-limit protocol. <!-- id:RfSHih36 -->
- No long-term retention/pruning policy for events, runs, or journals. <!-- id:PujE4u8_ -->

See [Future projects](./agent-future-projects.md) and [Roadmap](./agent-roadmap.md). <!-- id:ycSmp720 -->
