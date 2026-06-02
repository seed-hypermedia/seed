# System overview

Seed Agents is a local-first, account-scoped agent system. It lets the desktop app configure an agent server, store
provider secrets, create agents, run chat sessions, stream model responses, and inspect durable session history.

## Design principles

1. **Signed control plane** — every HTTP action is wrapped in a signed DAG-CBOR envelope.
2. **Account isolation** — persisted state belongs to one Seed account and server queries must prove ownership.
3. **Durable sessions** — sessions are append-only event logs with replay by sequence number.
4. **Live clients** — desktop clients subscribe over a signed WebSocket protocol and receive live changes.
5. **Secret redaction** — API keys are encrypted at rest and never returned in API responses.
6. **Visible tools** — tool calls and tool results are durable session events rendered in the UI.
7. **Shared hypermedia behavior** — `read` uses SDK code shared with CLI URL resolution, not a CLI shellout.
8. **Inspectable operation** — the service exposes `/agents` and diagnostic logs for debugging local workflows.

## Major components

```text
Desktop app
  ├─ Agents routes: list, detail, session
  ├─ Provider and create-agent dialogs
  ├─ daemon-backed signing for the selected account
  ├─ signed CBOR HTTP client
  ├─ signed WebSocket subscription hook
  └─ chat message renderer shared with the desktop assistant panel

Agents service (Bun)
  ├─ /api/message signed action API
  ├─ /agents/ws signed subscription API
  ├─ /agents status and live session inspector UI
  ├─ SQLite persistence
  ├─ AES-GCM secret storage
  ├─ Pi SDK-backed model execution loop
  ├─ read tool
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
12. Server appends a durable user message and sets session status to `streaming`.
13. Server creates an in-memory Pi SDK session configured from the Seed provider record, encrypted secret, system
    prompt, and approved tools.
14. Pi runs the provider/model loop and emits streaming/tool/final events.
15. Server emits `session-partial` service events for model text deltas.
16. WebSocket sends `appendPartial` events to subscribed desktop clients.
17. Desktop renders the partial through the shared assistant markdown renderer.
18. Tool calls/results are translated from Pi events and appended as durable Seed events.
19. Final assistant message is appended as a durable event.
20. Session status returns to `idle` or becomes `error` if execution failed.

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

- SQLite schema and version gate.
- Accounts and local account authorization table.
- Provider config table.
- AES-GCM encrypted secrets.
- Agent definitions and per-agent state directories.
- Sessions and durable session events.
- Idempotency table for client request/message IDs.

### Agent runtime

- Agent create/list/get/update.
- Session create/get/message.
- Pi SDK-backed model execution for OpenAI-compatible, Anthropic, and Google provider mappings.
- Text streaming translated from Pi events into Seed WebSocket partials.
- Durable user/assistant/error/tool events.
- `read` registered as a Seed-owned Pi custom tool.
- Tool result size limiting.

### Desktop

- Agents list, server, detail, and session routes with sidebar/menu/shortcut integration.
- Default and multi-server settings.
- Provider management dialog for OpenAI/Anthropic/Google records/secrets.
- Create-agent dialog with configured-provider selection.
- Agent detail page with editable name/model/system prompt.
- Session page with debounced inline title editing, optimistic user messages, durable events, live assistant partials,
  and shared chat rendering.
- User/assistant bubbles, markdown, streaming cursor, and tool-call bubbles shared with the desktop assistant panel.
- WebSocket diagnostic logs and robust message parsing.

## Known incomplete areas

- Anthropic and Google are mapped through Pi but still need real-provider smoke coverage before being considered
  production-complete.
- No stop/cancel controls for active runs.
- Signed-action timestamps reject requests more than 30 seconds from server time, but nonce caching is still missing.
- No production KMS/OS-keychain secret key storage.
- No explicit tool permission UI or policy engine.
- No provider deletion/secret deletion API.
- No full WebSocket heartbeat/backpressure/subscription-limit protocol.
- No long-term retention/pruning policy.

See [Future projects](./future-projects.md) and [Roadmap](./roadmap.md).
