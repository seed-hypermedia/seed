# Persistence

Agents persistence is SQLite-based. The canonical schema is `agents/src/sqlite-schema.sql`; open/migration validation
lives in `agents/src/sqlite.ts`.

## Database path

Default:

```text
agents/data/agents.sqlite
```

Configured by:

- `SEED_AGENTS_DB_PATH`
- `--db-path`

## Schema gate

On startup, `sqlite.open()` either:

- initializes a fresh DB;
- opens a DB with the expected migration version;
- rejects a mismatched/unknown DB version.

The service does not silently run against unknown schema state.

## Tables

### `server_config`

Stores server-local config blobs.

Current key:

- `secret_encryption_key_v1` — AES-GCM key for encrypted secrets.

Production caveat: storing encrypted secrets and the encryption key in the same DB is better than plaintext API
responses/logs but not equivalent to KMS/keychain-backed storage.

### `accounts`

Stores account IDs known to this server.

Rows are created/updated as account-owned resources are written.

### `account_authorizations`

Stores local delegated signers for an account.

Accepted roles:

- `OWNER`
- `AGENT`

Used by `auth.isAuthorizedSigner()` and tests; future production delegation/capability UX is still incomplete.

### `model_providers`

Stores account-scoped provider config.

Important columns:

- `account_id`
- `name`
- `type`
- `config_cbor`

`config_cbor` encodes `ModelProviderConfig`:

```ts
type ModelProviderConfig = {
  type: string
  modelDefaults?: Record<string, unknown>
  secretRefs?: Record<string, string>
  baseUrl?: string
}
```

The `(account_id, name)` pair is unique.

### `mcp_servers`

Stores account-scoped remote MCP server config (see `mcp.md`).

Important columns:

- `account_id`
- `name`
- `config_cbor`

`config_cbor` encodes `McpServerConfig`:

```ts
type McpServerConfig = {
  url: string
  transport?: 'http' | 'sse'
  headers?: Record<string, string>
  secretRefs?: Record<string, string> // header name -> secret name in `secrets`
}
```

The `(account_id, name)` pair is unique. Secret-backed auth headers are stored in `secrets` and referenced by name;
deleting an MCP server also deletes the header secrets it owns (`mcp-<name>-…`).

### `secrets`

Stores encrypted account-scoped secret values.

Important columns:

- `account_id`
- `name`
- `ciphertext`
- `metadata_cbor`

Secrets are never returned in plaintext through the API.

### `agents`

Stores agent definitions.

Important columns:

- `account_id`
- `definition_cbor`
- `state_dir`
- `status`

`definition_cbor` encodes `AgentDefinition`.

Current agent statuses:

- `idle`
- `running`
- `stopped`
- `error`

Most runtime work currently operates at the session level; agent status is not yet a rich run-state machine.

### `agent_triggers`

Stores saved agent-scoped trigger definitions for HM activity triggers and schedule triggers.

Important columns:

- `account_id`
- `agent_id`
- `name`
- `enabled`
- `source_cbor`
- `prompt`
- `cooldown_ms`
- `last_checked_at`
- `last_fired_at`
- `last_error`

`source_cbor` encodes `AgentTriggerSource` values such as document-comment, user-mention, site-update, and schedule
filters. Schedule triggers store interval, weekly-days/time, or one-time run configuration inside this CBOR blob; no
additional schedule table is required.

### `sessions`

Stores chat-like sessions.

Important columns:

- `account_id`
- `agent_id`
- `title`
- `title_source` (`system`, `agent`, or `user`)
- `status`

`title_source` lets the hidden `set_session_title` runtime tool update generated/system titles while preserving any
title manually saved by the user through `UpdateSession`.

Current session statuses:

- `idle`
- `streaming`
- `stopped`
- `error`

`MessageSession` sets `streaming` during execution, then `idle` or `error`.

### `trigger_firings`

Tracks activity events or scheduled occurrences that matched a trigger and the sessions created from those matches. The
activity and schedule monitors use this table for durable idempotency and trigger session history.

Important columns:

- `account_id`
- `agent_id`
- `trigger_id`
- `activity_key`
- `session_id`
- `activity_cbor`
- `status`
- `error`

`(account_id, trigger_id, activity_key)` is unique so feed retries or schedule monitor retries cannot create duplicate
firings for the same trigger. Schedule triggers use stable keys in the form `schedule:<triggerId>:<scheduledAt>`.

### `activity_watermarks`

Stores per-account HM activity feed progress for the activity trigger monitor.

Important columns:

- `account_id`
- `server_url`
- `cursor_cbor`
- `last_poll_at`
- `last_success_at`
- `last_error`

### `session_events`

Append-only durable event log.

Important columns:

- `session_id`
- `seq`
- `event_cbor`
- `created_at`

`seq` is monotonic per session. Events are returned by `GetSession` and replayed on session WebSocket subscriptions.

Current event payloads:

```ts
type SessionEventPayload =
  | {type: 'message'; role: 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string}
  | {type: 'tool_call'; id: string; name: string; input: unknown}
  | {type: 'tool_result'; toolCallId: string; name: string; output?: unknown; error?: string}
  | {type: 'error'; message: string}
  | Record<string, unknown>
```

Live assistant partials are not persisted here.

### `action_idempotency`

Stores account/action/client-ID request and response CBOR.

Used by:

- `CreateAgent.clientRequestId`
- `CreateSession.clientRequestId`
- `MessageSession.clientMessageId`

Same client ID with identical request bytes replays the response. Same client ID with different request bytes returns
`409`.

## Secret encryption

Implementation: `encryptSecret()` and `decryptSecret()` in `api-service.ts`.

Current scheme:

- AES-GCM;
- 32-byte server-local key;
- 12-byte random nonce per write;
- stored ciphertext is `nonce || encryptedBytes`.

## Durable replay

`GetSession` accepts `afterSeq`:

```ts
{
  _: 'GetSession', sessionId, afterSeq
}
```

It returns events with `seq > afterSeq`.

Session WebSocket subscriptions use the same replay logic when `afterSeq` is supplied.

## Transaction policy

Do not hold write transactions during provider/tool network calls.

`CreateAgent` and `CreateSession` can use short idempotent transactions. `MessageSession` must avoid long SQLite
transactions because it performs model/network work.

## Improvement areas

- Move from `MAX(seq)+1` event sequence allocation to a stronger per-session sequence allocator if concurrent appends
  become possible.
- Add run records to distinguish durable session state from each model execution attempt.
- Add retention/pruning for old events and idempotency rows.
- Add secret versioning/rotation metadata.
- Add audit log tables for provider/secret/tool/security events.
- Add KMS/keychain option for secret encryption key.
