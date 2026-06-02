# Agents Service Plan

The `agents` service is a standalone service in the Seed Hypermedia ecosystem. It hosts long-running AI agents on behalf of Seed accounts, stores agent/session state durably, exposes signed CBOR APIs, streams session events, and is consumed by desktop and eventually web clients.

This is a living implementation plan. The immediate goal is to build a small but robust server-first slice, then layer on a simple UI for exercising the workflow end-to-end.

## Goals

1. Run a standalone Bun service, similar in operational shape to `vault/`.
2. Let a Seed account configure model providers/secrets on an agent server.
3. Let an account create agents with a system prompt, provider key, and model.
4. Let an account create chat-like sessions for an agent.
5. Let clients send signed messages to sessions and receive durable streamed responses.
6. Persist enough state in SQLite to safely restart and resume.
7. Keep the desktop GUI simple but usable for manual testing.
8. Provide a lightweight agent-server frontend for server status and dev diagnostics, so opening the agent server in a browser shows health/connection information before desktop integration is involved.
9. Design APIs and route names so the same workflow can later work on web at URLs such as `/hm/agents`.

## Non-goals for the first slice

- Polished GUI design.
- Multi-tenant billing or quota enforcement beyond basic authorization and safe limits.
- Full Pi interactive UI parity.
- Complex agent orchestration beyond one agent responding in one session.
- Browser-hosted agent execution. Agents run on the server.

## Key existing repo patterns

- `vault/` is the closest standalone Bun service reference:
  - Bun workspace with its own `package.json`, `bun.lock`, `build.ts`, `Dockerfile`, `src/main.ts`, `src/config.ts`, `src/sqlite.ts`, `src/sqlite-schema.sql`, tests.
  - `vault/AGENTS.md` requires Bun commands and `bun check`, `bun test` before finishing vault-like work.
  - API types live in `src/api.ts`; implementation in `src/api-service.ts`; route wiring in `src/main.ts`.
- Permanent Seed auth/signing patterns live in backend and client code:
  - Backend CBOR blob signing/verification: `backend/blob/blob.go` (`Sign`, `Verify`, `BaseBlob`).
  - Agent capabilities already exist as a role: `backend/blob/blob_capability.go` with `RoleAgent`.
  - Client capability creation/resolution: `frontend/packages/client/src/capability.ts`.
  - CBOR libraries already used in TS/Bun: `@ipld/dag-cbor`, `cborg`.
- Desktop settings already include assistant provider UI:
  - Main process provider persistence and OAuth/API-key handling: `frontend/apps/desktop/src/app-ai-config.ts`.
  - Settings page and advanced tab: `frontend/apps/desktop/src/pages/settings.tsx`.
  - Existing local assistant loop: `frontend/apps/desktop/src/app-chat.ts`.
- Desktop routes are centrally typed in `frontend/packages/shared/src/routes.ts` and rendered in `frontend/apps/desktop/src/pages/main.tsx`.
- Desktop settings storage uses `frontend/apps/desktop/src/app-settings.ts`.
- Desktop menu/shortcuts are in `frontend/apps/desktop/src/app-menu.ts` and focused-window global shortcuts in `frontend/apps/desktop/src/app-windows.ts`.

## Architecture

### Topology

```text
Desktop/Web client
  ├─ local account key signs CBOR action envelopes
  ├─ HTTP POST /api/message for commands
  └─ WebSocket /api/ws for subscriptions and streaming

Agents service (Bun)
  ├─ verifies signatures/capabilities
  ├─ stores secrets, providers, agents, sessions, events in SQLite
  ├─ runs Pi SDK agent loops in process
  └─ writes per-agent state directories for tool/workspace files

Seed backend
  └─ authoritative account/capability data, including AGENT capabilities
```

The service should be self-hostable. The desktop app stores a list of agent server URLs in advanced settings and can connect to several servers at once. There may also be a default hosted agent server.

### Service package

Create a new top-level package, likely `agents/`, patterned after `vault/`:

```text
agents/
  AGENTS.md
  package.json
  bun.lock
  Dockerfile
  build.ts
  tsconfig.json
  src/
    main.ts
    config.ts
    api.ts
    api-service.ts
    auth.ts
    cbor.ts
    sqlite.ts
    sqlite-schema.sql
    ws.ts
    agent-runtime.ts
    setupTests.ts
    *.test.ts
```

Use Bun for this subtree. Add `@mariozechner/pi-coding-agent` as a runtime dependency for the Pi SDK when implementation starts.

## Data model

Use a single SQLite database plus a state directory.

### SQLite tables

Initial schema proposal:

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE account_authorizations (
  account_id TEXT NOT NULL,
  signer TEXT NOT NULL,
  role TEXT NOT NULL, -- OWNER | AGENT
  capability TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, signer),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
) WITHOUT ROWID;

CREATE TABLE model_providers (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- openai | anthropic | gemini | ollama | custom-openai | etc.
  config_cbor BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, name)
) WITHOUT ROWID;

CREATE TABLE secrets (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  metadata_cbor BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, name)
) WITHOUT ROWID;

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  definition_cbor BLOB NOT NULL,
  state_dir TEXT NOT NULL,
  status TEXT NOT NULL, -- idle | running | stopped | error
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX agents_by_account ON agents(account_id, updated_at DESC);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  title TEXT,
  status TEXT NOT NULL, -- idle | streaming | stopped | error
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX sessions_by_agent ON sessions(agent_id, updated_at DESC);

CREATE TABLE session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq INTEGER NOT NULL,
  event_cbor BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, seq)
) WITHOUT ROWID;

CREATE TABLE server_config (
  key TEXT PRIMARY KEY,
  value BLOB NOT NULL
) WITHOUT ROWID;
```

Notes:

- Store flexible agent definitions as CBOR to avoid premature schema lock-in.
- Keep `seq` monotonic per session so websocket clients can resume or reconcile.
- Secrets should be encrypted at rest. First slice may use a server master key in `server_config` or environment; production needs a real key-management story.
- Per-agent state directories should be under a configured data directory and never derived directly from user-controlled strings.

## Agent definition

Agent definitions are flexible JSON/CBOR records. First supported fields:

```ts
type AgentDefinition = {
  name: string
  systemPrompt: string
  modelProvider: string
  model: string
  tools?: string[]
  metadata?: Record<string, unknown>
}
```

Validation boundaries:

- Trim and validate names/prompts at API boundary.
- Limit prompt size and metadata size.
- Require `modelProvider` to resolve in the same account.
- Do not log secret values or full provider configs.

## Auth model

Every mutating action must be signed. The request envelope follows Seed blob conventions.

```ts
type SignedActionEnvelope = {
  type: 'AgentsAction'
  signer: Uint8Array
  sig: Uint8Array
  account: Uint8Array
  action: AgentAction
}
```

Signing rule:

1. Decode CBOR into an opaque map.
2. Copy `sig`, replace it with the expected zero-filled signature bytes.
3. Re-encode canonical CBOR.
4. Verify with `signer`.
5. Authorize `signer` for `account`:
   - signer equals account, or
   - signer has an `AGENT` capability for the account, or
   - signer is present in local `account_authorizations` for this service.

The backend already recognizes `RoleAgent` capabilities. The agents service needs a narrow resolver that can validate a capability CID or ask the backend for capabilities for the account. The first implementation can make capability validation an explicit dependency with a fake/test resolver, then wire the real backend resolver.

Read-only actions can be more permissive, but still need careful scoping:

- Public metadata can be readable by any account.
- Secrets and provider configs are only readable by their owner and should generally return redacted values.
- Session content should require account ownership/delegation unless explicitly made shareable later.

## REST API

Use one CBOR endpoint first:

```text
POST /api/message
Content-Type: application/cbor
Accept: application/cbor
```

Request body is `SignedActionEnvelope`. Response is CBOR.

### Action types

#### `SetModelProvider`

Create or update a named provider scoped to `account`.

```ts
type SetModelProvider = {
  _: 'SetModelProvider'
  name: string
  provider: {
    type: string
    modelDefaults?: Record<string, unknown>
    secretRefs?: Record<string, string>
    baseUrl?: string
  }
}
```

#### `SetSecret`

Set a value in the account's secret store.

```ts
type SetSecret = {
  _: 'SetSecret'
  name: string
  value: Uint8Array
  metadata?: Record<string, unknown>
}
```

Server stores encrypted value, not plaintext.

#### `CreateAgent`

```ts
type CreateAgent = {
  _: 'CreateAgent'
  definition: AgentDefinition
}
```

Returns `{agentId}`.

#### `GetAgent`

Returns metadata and session list for one agent.

```ts
type GetAgent = {
  _: 'GetAgent'
  agentId: string
}
```

#### `ListAgents`

Useful for initial UI load.

```ts
type ListAgents = {
  _: 'ListAgents'
}
```

#### `CreateSession`

```ts
type CreateSession = {
  _: 'CreateSession'
  agentId: string
  title?: string
}
```

Returns `{sessionId}`.

#### `GetSession`

Returns session metadata plus durable events, optionally after a sequence.

```ts
type GetSession = {
  _: 'GetSession'
  sessionId: string
  afterSeq?: number
}
```

#### `MessageSession`

Append a user message and start or continue the agent loop.

```ts
type MessageSession = {
  _: 'MessageSession'
  sessionId: string
  content: Array<{type: 'text'; text: string}>
  clientMessageId?: string
}
```

`clientMessageId` gives idempotency across retries.

#### `StopSession`

Abort an active streaming run.

```ts
type StopSession = {
  _: 'StopSession'
  sessionId: string
}
```

#### `StopAgent`

Stop all active sessions for an agent and mark it stopped.

```ts
type StopAgent = {
  _: 'StopAgent'
  agentId: string
}
```

#### `SetAccountAgentAuthorization`

Manage the list of signers allowed to run agents for an account on this server.

```ts
type SetAccountAgentAuthorization = {
  _: 'SetAccountAgentAuthorization'
  signer: Uint8Array
  role: 'AGENT' | 'NONE'
  capability?: string
}
```

Only the account key or a stronger admin/owner rule should be allowed to mutate this list.

## WebSocket API

Endpoint:

```text
GET /api/ws
```

Messages are CBOR maps with `_` as the type discriminator.

### Client messages

```ts
type Subscribe = {
  _: 'sub'
  key: `agents/${string}` | `sessions/${string}` | `account/${string}`
  afterSeq?: number
}

type Unsubscribe = {
  _: 'unsub'
  key: string
}
```

The WebSocket itself may start unauthenticated for public reads, but private subscriptions must include signed subscription setup or a short-lived token minted by signed REST action. Do not leak private session events to unauthenticated sockets.

### Server messages

```ts
type Append = {
  _: 'append'
  key: string
  seq: number
  event: unknown
}

type AppendPartial = {
  _: 'appendPartial'
  key: string
  partialId: string
  patch: unknown
}

type Change = {
  _: 'change'
  key: string
  value: unknown // recursive object merge
}

type Reset = {
  _: 'reset'
  key: string
  value: unknown
}
```

Durable events should use `append`. Token-level response streaming can use `appendPartial`, and final assistant messages should be persisted as durable `append` events.

## Pi SDK integration

Use `@mariozechner/pi-coding-agent` SDK inside the agents service.

Initial approach:

1. Load agent definition from SQLite.
2. Resolve provider config and secrets.
3. Create a `SessionManager` backed by service state, or initially use an in-memory/Pi JSONL session per Seed session plus a SQLite event log.
4. Configure the system prompt from agent definition.
5. Configure tools conservatively. The first hosted version should probably start read/no-tools or a carefully sandboxed state directory, not arbitrary host filesystem access.
6. Subscribe to session events and append durable session events.
7. Stream deltas to websocket subscribers.
8. On restart, derive active sessions from SQLite and mark interrupted streams as `error` or `idle` with an interruption event.

Open implementation question: whether to implement a custom `SessionManager` immediately or store Pi JSONL under the agent/session state directory and mirror user/assistant events into SQLite. For the first slice, mirroring JSONL is likely faster and safer; a custom store can come later.

## Desktop UI plan

Keep the GUI simple.

### Settings

Add an advanced settings section for agent servers:

- List configured agent server URLs.
- Add/remove URL.
- Mark default server.
- Show connection status.

Implementation references:

- Settings UI: `frontend/apps/desktop/src/pages/settings.tsx`.
- Settings persistence: `frontend/apps/desktop/src/app-settings.ts`.
- Existing gateway settings patterns: `frontend/apps/desktop/src/models/gateway-settings`.

### Routes/pages

Add route keys in `frontend/packages/shared/src/routes.ts`:

- `agents` — list all agents across connected servers.
- `agent` — detail page for one agent and its sessions.
- `agent-session` — chat/session view.
- Possibly `agent-new` — creation form, or fold this into `agents`.

Wire render cases in `frontend/apps/desktop/src/pages/main.tsx`.

### Shortcut/menu

Add a desktop shortcut/menu item for agents, likely in `frontend/apps/desktop/src/app-menu.ts`. Avoid colliding with existing global shortcuts in `app-windows.ts` (`Cmd/Ctrl+B`, `Cmd/Ctrl+F`, `Cmd/Ctrl+1..5`). Candidate: `Cmd/Ctrl+Shift+A`, but verify platform conventions before finalizing.

### Server status frontend

The standalone agent server should continue to serve a minimal frontend at `/agents` for direct browser-based status checks. This page is not the primary product UI, but it should show at least server availability, WebSocket connectivity, and enough diagnostic information to confirm the daemon/service is alive before debugging desktop or web clients.

### UX flow

1. User opens Agents page.
2. If no servers are configured, prompt to add one, with hosted default prefilled if available.
3. If no agents exist, show a simple empty state and New Agent button.
4. New Agent page/form:
   - system prompt
   - model provider
   - model
   - server
5. Agent detail page:
   - metadata
   - session list
   - start session button
6. Session page:
   - message list
   - composer
   - streaming response
   - stop button
7. Model Providers and Secrets page:
   - link from Agents page
   - can reuse concepts from existing Assistant Providers UI, but provider secrets should be stored on the selected agent server, not only in desktop local config.

## Web plan

Design shared client code so desktop and web can both target `/hm/agents` eventually.

- Keep API client in a shared package or a small service-specific client package.
- Do not assume Electron APIs in protocol code.
- Use signed CBOR actions from account keys, not desktop-only local sessions.
- Use route shape that can map cleanly to `/hm/agents`, `/hm/agents/:agentId`, and `/hm/agents/:agentId/sessions/:sessionId`.

## Implementation milestones

### Milestone 1 — server skeleton and protocol tests

Deliverables:

- New `agents/` Bun package patterned after `vault/`.
- Config, SQLite open/migration support, schema baseline.
- CBOR encode/decode helpers.
- Signed envelope verification with unit tests.
- Stub authorization resolver with tests for:
  - signer equals account
  - delegated AGENT signer allowed
  - unauthorized signer rejected
- `/api/message` route with `ListAgents` and `CreateAgent` implemented.

Validation:

```bash
cd agents
bun check
bun test
```

### Milestone 2 — agents/sessions persistence

Deliverables:

- `SetModelProvider`, `SetSecret`, `GetAgent`, `CreateSession`, `GetSession`.
- Redacted provider/secret reads.
- Idempotency for create/message where relevant.
- Database tests for migrations and CRUD.

### Milestone 3 — Pi SDK response loop

Deliverables:

- `MessageSession` starts an agent run.
- User and assistant messages persisted as session events.
- Stop/abort support via `StopSession`.
- Restart behavior defined and tested.
- Conservative tool policy and per-agent state directory.

### Milestone 4 — websocket streaming

Deliverables:

- `/api/ws` with `sub`/`unsub`.
- Session event replay by `afterSeq`.
- Streaming partials and final durable events.
- Tests for subscription isolation and replay.

### Milestone 5 — desktop minimal UI

Deliverables:

- Agent server URL settings.
- Agents list page.
- New agent form.
- Agent detail/session list.
- Simple chat session page with streaming and stop.
- Manual end-to-end smoke test against local service.

Validation:

```bash
pnpm typecheck
pnpm test
pnpm audit
pnpm format:write
```

Follow `frontend/AGENTS.md` and use frontend agent-ci for full parity before pushing.

### Milestone 6 — hardening

Deliverables:

- Size limits and rate limits.
- Secret encryption/key-rotation plan.
- Capability resolver wired to real backend data.
- Structured logs without secret leakage.
- Docker/deploy path.
- Load/restart tests for in-flight sessions.

## Testing strategy

Server tests should cover:

- CBOR round trips and malformed payloads.
- Signature verification and zero-signature canonicalization.
- Authorization decisions.
- SQLite schema initialization/migration mismatch behavior.
- Secret encryption/redaction.
- Agent/session CRUD.
- Message idempotency.
- Session event ordering and replay.
- WebSocket subscription isolation.
- Pi SDK loop with a fake model/provider where possible.

GUI tests should stay focused:

- Settings can add/remove an agent server URL.
- Agents page empty states render.
- New agent form sends expected signed action.
- Session page appends user message and displays streamed assistant output from a mocked server.

## Risks and open questions

1. **Secret storage**: decide whether first release can use a server-local master key, environment key, or must integrate with a KMS-like mechanism immediately.
2. **Capability validation**: decide whether the agents service queries Seed backend over gRPC/HTTP or consumes published capability blobs directly.
3. **Pi session persistence**: decide whether to mirror Pi JSONL initially or implement a custom SQLite-backed session manager.
4. **Tool sandboxing**: hosted agents must not get arbitrary host filesystem/shell access. Define first supported tool set explicitly.
5. **Provider portability**: desktop currently has local assistant provider config; agent server provider config should be separate but may reuse UI concepts.
6. **Web auth**: web clients need signing access and a safe subscription-auth story.
7. **Multi-server aggregation**: desktop Agents page needs stable IDs that include server URL plus agent/session ID to avoid collisions.

## Immediate next step

Start Milestone 1. Create `agents/` as a Bun service skeleton copied conceptually from `vault/`, but with a smaller API surface:

1. Add `agents/AGENTS.md`, `package.json`, `tsconfig.json`, `src/main.ts`, `src/config.ts`, `src/sqlite.ts`, `src/sqlite-schema.sql`, `src/api.ts`, `src/cbor.ts`, `src/auth.ts`, and tests.
2. Implement schema initialization and migration versioning.
3. Implement signed CBOR envelope verification.
4. Implement `POST /api/message` with `ListAgents` and `CreateAgent`.
5. Run `cd agents && bun check && bun test`.
