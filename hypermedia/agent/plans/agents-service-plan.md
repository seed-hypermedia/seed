---
name: Agents Service Plan
summary: The original 2026 plan for the standalone agents service, its signed CBOR API, SQLite persistence and first desktop UI, kept as a historical record of where the runtime started.
---
Status: historical record from the first build of the service (mid 2026). Much of it shipped and much of it changed since: the action catalogue, tables and UI it sketches are superseded by the [signed API](../signed-api.md), [persistence](../persistence.md) and [desktop and web UI](../desktop-ui.md) pages, which describe what exists. The [roadmap](../roadmap.md) is the only live forward-looking page. <!-- id:8vzdkmsX -->

The `agents` service is a standalone service in the Seed Hypermedia ecosystem. It hosts long-running AI agents on behalf of Seed accounts, stores agent/session state durably, exposes signed CBOR APIs, streams session events, and is consumed by desktop and eventually web clients. <!-- id:rRyur5us -->

This is a living implementation plan. The immediate goal is to build a small but robust server-first slice, then layer on a simple UI for exercising the workflow end-to-end. <!-- id:hhusltGF -->

# Goals <!-- id:J32OToY7 -->

1. Run a standalone Bun service, similar in operational shape to `vault/`. <!-- id:Dgpbks9L -->
2. Let a Seed account configure model providers/secrets on an agent server. <!-- id:lAWOzsRF -->
3. Let an account create agents with a system prompt, provider key, and model. <!-- id:VYLFhR4m -->
4. Let an account create chat-like sessions for an agent. <!-- id:x4XV6iYW -->
5. Let clients send signed messages to sessions and receive durable streamed responses. <!-- id:nWpZA8KP -->
6. Persist enough state in SQLite to safely restart and resume. <!-- id:GbTV043x -->
7. Keep the desktop GUI simple but usable for manual testing. <!-- id:KHP9YYeU -->
8. Provide a lightweight agent-server frontend for server status and dev diagnostics, so opening the agent server in a browser shows health/connection information before desktop integration is involved. <!-- id:JdMVY1cW -->
9. Design APIs and route names so the same workflow can later work on web at URLs such as `/hm/agents`. <!-- id:IkRxd3H9 -->

# Non-goals for the first slice <!-- id:QaaYaycV -->

- Polished GUI design. <!-- id:-GoOOQ62 -->
- Multi-tenant billing or quota enforcement beyond basic authorization and safe limits. <!-- id:7qajkmwP -->
- Full Pi interactive UI parity. <!-- id:40s5Kln2 -->
- Complex agent orchestration beyond one agent responding in one session. <!-- id:bR4813Hd -->
- Browser-hosted agent execution. Agents run on the server. <!-- id:K8z9dpvR -->

# Key existing repo patterns <!-- id:MKeR6nBU -->

- `vault/` is the closest standalone Bun service reference: <!-- id:8_HRE8og -->
  - Bun workspace with its own `package.json`, `bun.lock`, `build.ts`, `Dockerfile`, `src/main.ts`, `src/config.ts`, `src/sqlite.ts`, `src/sqlite-schema.sql`, tests. <!-- id:mZft8j1R -->
  - `vault/AGENTS.md` requires Bun commands and `bun check`, `bun test` before finishing vault-like work. <!-- id:y6WjX6y- -->
  - API types live in `src/api.ts`; implementation in `src/api-service.ts`; route wiring in `src/main.ts`. <!-- id:tofze78b -->
- Permanent Seed auth/signing patterns live in backend and client code: <!-- id:ycWWJGOe -->
  - Backend CBOR blob signing/verification: `backend/blob/blob.go` (`Sign`, `Verify`, `BaseBlob`). <!-- id:uraLY1xv -->
  - Agent capabilities already exist as a role: `backend/blob/blob_capability.go` with `RoleAgent`. <!-- id:xbsZMdEM -->
  - Client capability creation/resolution: `frontend/packages/client/src/capability.ts`. <!-- id:acCv3Jzz -->
  - CBOR libraries already used in TS/Bun: `@ipld/dag-cbor`, `cborg`. <!-- id:ePrMka-m -->
- Desktop settings already include assistant provider UI: <!-- id:2bFsIDki -->
  - Main process provider persistence and OAuth/API-key handling: `frontend/apps/desktop/src/app-ai-config.ts`. <!-- id:esKmoPcI -->
  - Settings page and advanced tab: `frontend/apps/desktop/src/pages/settings.tsx`. <!-- id:6KYZ6F6U -->
  - Existing local assistant loop: `frontend/apps/desktop/src/app-chat.ts`. <!-- id:whu6NBwt -->
- Desktop routes are centrally typed in `frontend/packages/shared/src/routes.ts` and rendered in `frontend/apps/desktop/src/pages/main.tsx`. <!-- id:JALh6cR3 -->
- Desktop settings storage uses `frontend/apps/desktop/src/app-settings.ts`. <!-- id:kaw4loSI -->
- Desktop menu/shortcuts are in `frontend/apps/desktop/src/app-menu.ts` and focused-window global shortcuts in `frontend/apps/desktop/src/app-windows.ts`. <!-- id:WFZ-yOh7 -->

# Architecture <!-- id:4kPFmvMu -->

## Topology <!-- id:bDdFzTOe -->

```text <!-- id:nx5Xy4R6 -->
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

The service should be self-hostable. The desktop app stores a list of agent server URLs in advanced settings and can connect to several servers at once. There may also be a default hosted agent server. <!-- id:1-EMxfmi -->

## Service package <!-- id:26e8PFiN -->

Create a new top-level package, likely `agents/`, patterned after `vault/`: <!-- id:q6sU9csg -->

```text <!-- id:TV4lhWir -->
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

Use Bun for this subtree. Add `@mariozechner/pi-coding-agent` as a runtime dependency for the Pi SDK when implementation starts. <!-- id:G4tZyHhz -->

# Data model <!-- id:85MUZA_r -->

Use a single SQLite database plus a state directory. <!-- id:KkFC5HsK -->

## SQLite tables <!-- id:k98tzwiZ -->

Initial schema proposal: <!-- id:mBk9RarH -->

```sql <!-- id:h9x-Qfv5 -->
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

Notes: <!-- id:juR16RJV -->
  - Store flexible agent definitions as CBOR to avoid premature schema lock-in. <!-- id:pF0QIOsm -->
  - Keep `seq` monotonic per session so websocket clients can resume or reconcile. <!-- id:jqBvlxgl -->
  - Secrets should be encrypted at rest. First slice may use a server master key in `server_config` or environment; production needs a real key-management story. <!-- id:70dmdLpo -->
  - Per-agent state directories should be under a configured data directory and never derived directly from user-controlled strings. <!-- id:pqW0TbPR -->

# Agent definition <!-- id:pulg3T8w -->

Agent definitions are flexible JSON/CBOR records. First supported fields: <!-- id:rNpTpy6t -->

```ts <!-- id:U5JsNCTB -->
type AgentDefinition = {
  name: string
  systemPrompt: string
  modelProvider: string
  model: string
  tools?: string[]
  metadata?: Record<string, unknown>
}
```

Validation boundaries: <!-- id:UYXbYHN9 -->
  - Trim and validate names/prompts at API boundary. <!-- id:im8h5qcU -->
  - Limit prompt size and metadata size. <!-- id:qiLb2dBQ -->
  - Require `modelProvider` to resolve in the same account. <!-- id:tLew65x9 -->
  - Do not log secret values or full provider configs. <!-- id:nGaETQqT -->

# Auth model <!-- id:H3avmYWH -->

Every mutating action must be signed. The request envelope follows Seed blob conventions. <!-- id:YpJiY8U7 -->

```ts <!-- id:IFoXB3CY -->
type SignedActionEnvelope = {
  type: 'AgentsAction'
  signer: Uint8Array
  sig: Uint8Array
  account: Uint8Array
  action: AgentAction
}
```

Signing rule: <!-- id:OQ9ozN6c -->
  1. Decode CBOR into an opaque map. <!-- id:LzrrPzWE -->
  2. Copy `sig`, replace it with the expected zero-filled signature bytes. <!-- id:OlrU2vZ8 -->
  3. Re-encode canonical CBOR. <!-- id:j2zPtdut -->
  4. Verify with `signer`. <!-- id:xKW3GmNd -->
  5. Authorize `signer` for `account`: <!-- id:uqi6H52r -->
     - signer equals account, or <!-- id:Qcue5Sws -->
     - signer has an `AGENT` capability for the account, or <!-- id:BbXKnxRt -->
     - signer is present in local `account_authorizations` for this service. <!-- id:IQp2b5mx -->

The backend already recognizes `RoleAgent` capabilities. The agents service needs a narrow resolver that can validate a capability CID or ask the backend for capabilities for the account. The first implementation can make capability validation an explicit dependency with a fake/test resolver, then wire the real backend resolver. <!-- id:EuCjF6nU -->

Read-only actions can be more permissive, but still need careful scoping: <!-- id:QjCc9acW -->
  - Public metadata can be readable by any account. <!-- id:Av-rd2V3 -->
  - Secrets and provider configs are only readable by their owner and should generally return redacted values. <!-- id:JsLqrVOz -->
  - Session content should require account ownership/delegation unless explicitly made shareable later. <!-- id:DmsVVaEs -->

# REST API <!-- id:3boumRiO -->

Use one CBOR endpoint first: <!-- id:2Vqq5TcI -->

```text <!-- id:Gc439D2t -->
POST /api/message
Content-Type: application/cbor
Accept: application/cbor
```

Request body is `SignedActionEnvelope`. Response is CBOR. <!-- id:5KcpY5d1 -->

## Action types <!-- id:B9bTXnwM -->

### `SetModelProvider` <!-- id:nm9t6XGT -->

Create or update a named provider scoped to `account`. <!-- id:_accEmK7 -->

```ts <!-- id:w3RS92oa -->
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

### `SetSecret` <!-- id:oMVqFHKP -->

Set a value in the account's secret store. <!-- id:ejiTsJQu -->

```ts <!-- id:xRcV45iW -->
type SetSecret = {
  _: 'SetSecret'
  name: string
  value: Uint8Array
  metadata?: Record<string, unknown>
}
```

Server stores encrypted value, not plaintext. <!-- id:YzEIB9z7 -->

### `CreateAgent` <!-- id:DoohF5SQ -->

```ts <!-- id:Jl9l7GPo -->
type CreateAgent = {
  _: 'CreateAgent'
  definition: AgentDefinition
}
```

Returns `{agentId}`. <!-- id:LT3y2lvP -->

### `GetAgent` <!-- id:_DUX1BAy -->

Returns metadata for one agent plus `sessionCount` (top-level sessions). The sessions themselves are paginated: list them with `ListSessions {agentId, includeChildren: false, cursor}`. <!-- id:Dyt6zCqe -->

```ts <!-- id:EjwJ3aru -->
type GetAgent = {
  _: 'GetAgent'
  agentId: string
}
```

### `ListAgents` <!-- id:WGWfK_WJ -->

Useful for initial UI load. <!-- id:VGDatgQy -->

```ts <!-- id:4Nk402ql -->
type ListAgents = {
  _: 'ListAgents'
}
```

### `CreateSession` <!-- id:AQrVUdFR -->

```ts <!-- id:Nkajwhu8 -->
type CreateSession = {
  _: 'CreateSession'
  agentId: string
  title?: string
}
```

Returns `{sessionId}`. <!-- id:6foJWvLb -->

### `GetSession` <!-- id:-DZKe-_y -->

Returns session metadata plus durable events, optionally after a sequence. <!-- id:xaNyjk0b -->

```ts <!-- id:AN7-Ihwj -->
type GetSession = {
  _: 'GetSession'
  sessionId: string
  afterSeq?: number
}
```

### `MessageSession` <!-- id:o8eIRNJu -->

Append a user message and start or continue the agent loop. <!-- id:nTBamf5Z -->

```ts <!-- id:qF91d7Mt -->
type MessageSession = {
  _: 'MessageSession'
  sessionId: string
  content: Array<{type: 'text'; text: string}>
  clientMessageId?: string
}
```

`clientMessageId` gives idempotency across retries. <!-- id:HwXbWfMy -->

### `StopSession` <!-- id:Mv3OofL9 -->

Abort an active streaming run. <!-- id:zWT8Ax31 -->

```ts <!-- id:S09y9CpY -->
type StopSession = {
  _: 'StopSession'
  sessionId: string
}
```

### `StopAgent` <!-- id:rNHx3nRc -->

Stop all active sessions for an agent and mark it stopped. <!-- id:eMcePhE4 -->

```ts <!-- id:lHKVg57p -->
type StopAgent = {
  _: 'StopAgent'
  agentId: string
}
```

### `SetAccountAgentAuthorization` <!-- id:OgKDFhze -->

Manage the list of signers allowed to run agents for an account on this server. <!-- id:ELoiu73i -->

```ts <!-- id:q4IJ9KkP -->
type SetAccountAgentAuthorization = {
  _: 'SetAccountAgentAuthorization'
  signer: Uint8Array
  role: 'AGENT' | 'NONE'
  capability?: string
}
```

Only the account key or a stronger admin/owner rule should be allowed to mutate this list. <!-- id:umYijyB0 -->

# WebSocket API <!-- id:ONfhJQXp -->

Endpoint: <!-- id:g9Dn5if0 -->

```text <!-- id:-F75b75s -->
GET /api/ws
```

Messages are CBOR maps with `_` as the type discriminator. <!-- id:RQwkY6i6 -->

## Client messages <!-- id:d4PzBBv- -->

```ts <!-- id:cq-FNBnA -->
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

The WebSocket itself may start unauthenticated for public reads, but private subscriptions must include signed subscription setup or a short-lived token minted by signed REST action. Do not leak private session events to unauthenticated sockets. <!-- id:DQh9_n4l -->

## Server messages <!-- id:zXEsl5N7 -->

```ts <!-- id:g3hg_Ehy -->
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

Durable events should use `append`. Token-level response streaming can use `appendPartial`, and final assistant messages should be persisted as durable `append` events. <!-- id:r5jtL7of -->

# Pi SDK integration <!-- id:YHM2gApc -->

Use `@mariozechner/pi-coding-agent` SDK inside the agents service. <!-- id:oVP1Mcla -->

Initial approach: <!-- id:w47QoNMI -->
  1. Load agent definition from SQLite. <!-- id:U3lvgS1x -->
  2. Resolve provider config and secrets. <!-- id:mjdOjRg- -->
  3. Create a `SessionManager` backed by service state, or initially use an in-memory/Pi JSONL session per Seed session plus a SQLite event log. <!-- id:2y9CgFn5 -->
  4. Configure the system prompt from agent definition. <!-- id:qblmSbKU -->
  5. Configure tools conservatively. The first hosted version should probably start read/no-tools or a carefully sandboxed state directory, not arbitrary host filesystem access. <!-- id:OaTKexjW -->
  6. Subscribe to session events and append durable session events. <!-- id:OgHl6kSY -->
  7. Stream deltas to websocket subscribers. <!-- id:TJMBMyAe -->
  8. On restart, derive active sessions from SQLite and mark interrupted streams as `error` or `idle` with an interruption event. <!-- id:LsO8fPPr -->

Open implementation question: whether to implement a custom `SessionManager` immediately or store Pi JSONL under the agent/session state directory and mirror user/assistant events into SQLite. For the first slice, mirroring JSONL is likely faster and safer; a custom store can come later. <!-- id:rQBcm_55 -->

# Desktop UI plan <!-- id:NJhsb4Tg -->

Keep the GUI simple. <!-- id:bjsHGFo7 -->

## Settings <!-- id:WUBUwSyf -->

Add an advanced settings section for agent servers: <!-- id:C7e9rHrc -->
  - List configured agent server URLs. <!-- id:l4dhc3MW -->
  - Add/remove URL. <!-- id:JsDqi9Hw -->
  - Mark default server. <!-- id:oIatgYMR -->
  - Show connection status. <!-- id:m8Ffd9_F -->

Implementation references: <!-- id:PD9knCxh -->
  - Settings UI: `frontend/apps/desktop/src/pages/settings.tsx`. <!-- id:M4bFhE4Y -->
  - Settings persistence: `frontend/apps/desktop/src/app-settings.ts`. <!-- id:qr8H2PEA -->
  - Existing gateway settings patterns: `frontend/apps/desktop/src/models/gateway-settings`. <!-- id:gGABrRAW -->

## Routes/pages <!-- id:sJka01np -->

Add route keys in `frontend/packages/shared/src/routes.ts`: <!-- id:-lWwu1lI -->
  - `agents` — list all agents across connected servers. <!-- id:Db_SRjTJ -->
  - `agent` — detail page for one agent and its sessions. <!-- id:IZxw-sFG -->
  - `agent-session` — chat/session view. <!-- id:TRZXO6CN -->
  - Possibly `agent-new` — creation form, or fold this into `agents`. <!-- id:O-Emds4d -->

Wire render cases in `frontend/apps/desktop/src/pages/main.tsx`. <!-- id:431tiMFp -->

## Shortcut/menu <!-- id:5-QsI9s0 -->

Add a desktop shortcut/menu item for agents, likely in `frontend/apps/desktop/src/app-menu.ts`. Avoid colliding with existing global shortcuts in `app-windows.ts` (`Cmd/Ctrl+B`, `Cmd/Ctrl+F`, `Cmd/Ctrl+1..5`). Candidate: `Cmd/Ctrl+Shift+A`, but verify platform conventions before finalizing. <!-- id:RV0qzPCI -->

## Server status frontend <!-- id:bA44t5ig -->

The standalone agent server should continue to serve a minimal frontend at `/agents` for direct browser-based status checks. This page is not the primary product UI, but it should show at least server availability, WebSocket connectivity, and enough diagnostic information to confirm the daemon/service is alive before debugging desktop or web clients. <!-- id:akDYdJZp -->

## UX flow <!-- id:zfroHlN6 -->

1. User opens Agents page. <!-- id:X59sgnv2 -->
2. If no servers are configured, prompt to add one, with hosted default prefilled if available. <!-- id:B0Rm1g0Y -->
3. If no agents exist, show a simple empty state and New Agent button. <!-- id:ZzOUm5zN -->
4. New Agent page/form: <!-- id:-blP7oY3 -->
   - system prompt <!-- id:_W-gAInr -->
   - model provider <!-- id:6v9_InCP -->
   - model <!-- id:riIn-xnh -->
   - server <!-- id:4jj-NBDO -->
5. Agent detail page: <!-- id:2mYhKRNz -->
   - metadata <!-- id:2PSJcJiF -->
   - session list <!-- id:cCsQoVSx -->
   - start session button <!-- id:2qokLNuY -->
6. Session page: <!-- id:93tq_Hs4 -->
   - message list <!-- id:p3hPpeLV -->
   - composer <!-- id:4l2tfvCf -->
   - streaming response <!-- id:_JDWY29N -->
   - stop button <!-- id:eYZLz1BV -->
7. Model Providers and Secrets page: <!-- id:J95uHMtt -->
   - link from Agents page <!-- id:7BmAvhcg -->
   - can reuse concepts from existing Assistant Providers UI, but provider secrets should be stored on the selected agent server, not only in desktop local config. <!-- id:ILO8Thg4 -->

# Web plan <!-- id:EgRoE1GF -->

Design shared client code so desktop and web can both target `/hm/agents` eventually. <!-- id:G0iUsttU -->
  - Keep API client in a shared package or a small service-specific client package. <!-- id:el-0tujy -->
  - Do not assume Electron APIs in protocol code. <!-- id:o2wFLqwh -->
  - Use signed CBOR actions from account keys, not desktop-only local sessions. <!-- id:KaCceAG- -->
  - Use route shape that can map cleanly to `/hm/agents`, `/hm/agents/:agentId`, and `/hm/agents/:agentId/sessions/:sessionId`. <!-- id:IZHyt9Vm -->

# Implementation milestones <!-- id:WcXI90jk -->

## Milestone 1 — server skeleton and protocol tests <!-- id:ukLIqRK0 -->

Deliverables: <!-- id:xh0lvwK4 -->
  - New `agents/` Bun package patterned after `vault/`. <!-- id:uSXNirLl -->
  - Config, SQLite open/migration support, schema baseline. <!-- id:lZVIUmU0 -->
  - CBOR encode/decode helpers. <!-- id:rFmfOQUo -->
  - Signed envelope verification with unit tests. <!-- id:XBXc-YoX -->
  - Stub authorization resolver with tests for: <!-- id:NpvlkAJR -->
    - signer equals account <!-- id:IknrR1Hx -->
    - delegated AGENT signer allowed <!-- id:5PH-mlU4 -->
    - unauthorized signer rejected <!-- id:DqId2Q0I -->
  - `/api/message` route with `ListAgents` and `CreateAgent` implemented. <!-- id:3qrONDD_ -->

Validation: <!-- id:Vn--6foP -->

```bash <!-- id:hojO68zg -->
cd agents
bun check
bun test
```

## Milestone 2 — agents/sessions persistence <!-- id:H4jD7wdK -->

Deliverables: <!-- id:U-o4VeCy -->
  - `SetModelProvider`, `SetSecret`, `GetAgent`, `CreateSession`, `GetSession`. <!-- id:Wx_BspEf -->
  - Redacted provider/secret reads. <!-- id:vyM2InWs -->
  - Idempotency for create/message where relevant. <!-- id:DnBkMUrL -->
  - Database tests for migrations and CRUD. <!-- id:fbZJAg48 -->

## Milestone 3 — Pi SDK response loop <!-- id:FMagZQgA -->

Deliverables: <!-- id:2KFb8HhH -->
  - `MessageSession` starts an agent run. <!-- id:cKmFP-ir -->
  - User and assistant messages persisted as session events. <!-- id:NiNhBEun -->
  - Stop/abort support via `StopSession`. <!-- id:XNAYb_-o -->
  - Restart behavior defined and tested. <!-- id:ToDF7iNq -->
  - Conservative tool policy and per-agent state directory. <!-- id:8NNW09FC -->

## Milestone 4 — websocket streaming <!-- id:2B6tNDOe -->

Deliverables: <!-- id:6YikH2ZW -->
  - `/api/ws` with `sub`/`unsub`. <!-- id:vl-LQDlv -->
  - Session event replay by `afterSeq`. <!-- id:OPMXWFth -->
  - Streaming partials and final durable events. <!-- id:j2fduiZR -->
  - Tests for subscription isolation and replay. <!-- id:zeBGhJMp -->

## Milestone 5 — desktop minimal UI <!-- id:ydeUhg8r -->

Deliverables: <!-- id:cYmF2GdT -->
  - Agent server URL settings. <!-- id:zcsWq61Z -->
  - Agents list page. <!-- id:l7p2x2vl -->
  - New agent form. <!-- id:R6o17qAA -->
  - Agent detail/session list. <!-- id:HeviFrsI -->
  - Simple chat session page with streaming and stop. <!-- id:gDpC5Qwd -->
  - Manual end-to-end smoke test against local service. <!-- id:0Sr8Achi -->

Validation: <!-- id:_8nzPbPV -->

```bash <!-- id:Dm6cFdz0 -->
pnpm typecheck
pnpm test
pnpm audit
pnpm format:write
```

Follow `frontend/AGENTS.md` and use frontend agent-ci for full parity before pushing. <!-- id:0X6gf1MI -->

## Milestone 6 — hardening <!-- id:zrjQ75kg -->

Deliverables: <!-- id:KL7lEyx5 -->
  - Size limits and rate limits. <!-- id:MJmZKswy -->
  - Secret encryption/key-rotation plan. <!-- id:zvo3NFIH -->
  - Capability resolver wired to real backend data. <!-- id:8dW0YSPM -->
  - Structured logs without secret leakage. <!-- id:FygZ_6gy -->
  - Docker/deploy path. <!-- id:aROjsmKl -->
  - Load/restart tests for in-flight sessions. <!-- id:k83Z56Dc -->

# Testing strategy <!-- id:uqhh3d82 -->

Server tests should cover: <!-- id:mAPhidjZ -->
  - CBOR round trips and malformed payloads. <!-- id:wDcBjQfB -->
  - Signature verification and zero-signature canonicalization. <!-- id:GV-gQttL -->
  - Authorization decisions. <!-- id:XbXhEtzf -->
  - SQLite schema initialization/migration mismatch behavior. <!-- id:_31BQOr0 -->
  - Secret encryption/redaction. <!-- id:6MKTKQOC -->
  - Agent/session CRUD. <!-- id:RcCz8S00 -->
  - Message idempotency. <!-- id:83XEGXr2 -->
  - Session event ordering and replay. <!-- id:gswAS4W1 -->
  - WebSocket subscription isolation. <!-- id:nzS7pV8H -->
  - Pi SDK loop with a fake model/provider where possible. <!-- id:kdTp1P6L -->

GUI tests should stay focused: <!-- id:gpxJwjex -->
  - Settings can add/remove an agent server URL. <!-- id:aJuO-ItW -->
  - Agents page empty states render. <!-- id:NMCCb0Yj -->
  - New agent form sends expected signed action. <!-- id:PZ8S-Ghx -->
  - Session page appends user message and displays streamed assistant output from a mocked server. <!-- id:R-uYgabH -->

# Risks and open questions <!-- id:uTBPnqzt -->

1. **Secret storage**: decide whether first release can use a server-local master key, environment key, or must integrate with a KMS-like mechanism immediately. <!-- id:PwcqcjVH -->
2. **Capability validation**: decide whether the agents service queries Seed backend over gRPC/HTTP or consumes published capability blobs directly. <!-- id:bp0yKOV8 -->
3. **Pi session persistence**: decide whether to mirror Pi JSONL initially or implement a custom SQLite-backed session manager. <!-- id:vZUM4POW -->
4. **Tool sandboxing**: hosted agents must not get arbitrary host filesystem/shell access. Define first supported tool set explicitly. <!-- id:LVa01YKJ -->
5. **Provider portability**: desktop currently has local assistant provider config; agent server provider config should be separate but may reuse UI concepts. <!-- id:yrrCb-Ps -->
6. **Web auth**: web clients need signing access and a safe subscription-auth story. <!-- id:x0-yrt5r -->
7. **Multi-server aggregation**: desktop Agents page needs stable IDs that include server URL plus agent/session ID to avoid collisions. <!-- id:uV0ZRa8x -->

# Immediate next step <!-- id:RV8w2P1M -->

Start Milestone 1. Create `agents/` as a Bun service skeleton copied conceptually from `vault/`, but with a smaller API surface: <!-- id:IR2_wIKx -->
  1. Add `agents/AGENTS.md`, `package.json`, `tsconfig.json`, `src/main.ts`, `src/config.ts`, `src/sqlite.ts`, `src/sqlite-schema.sql`, `src/api.ts`, `src/cbor.ts`, `src/auth.ts`, and tests. <!-- id:rkbq7l8z -->
  2. Implement schema initialization and migration versioning. <!-- id:x_ePbhLR -->
  3. Implement signed CBOR envelope verification. <!-- id:JjpEQPXX -->
  4. Implement `POST /api/message` with `ListAgents` and `CreateAgent`. <!-- id:HAnc1DkT -->
  5. Run `cd agents && bun check && bun test`. <!-- id:Aib2xYW1 -->
