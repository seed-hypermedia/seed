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

`state_dir` points at the per-agent directory under the service data dir. Its `memory/` subdirectory is the agent's
private memory filesystem (see `agents/src/agent-memory.ts`), read and written by both the `memory_*` session tools and
the signed agent-memory actions. It lives on disk, not in SQLite, and is removed with the rest of `state_dir` when the
agent is deleted.

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
- `parent_session_id` — set on sessions spawned by another session (`sub_session` children, workflow `ctx.agent`
  children, and `start_session`-started sessions); top-level `ListSessions` excludes rows with a parent by default
- `run_id` — the run this session is the transcript of, for sessions created as run children
- `plan_cbor` — the live todo snapshot written by the hidden `update_plan` tool (a `RunPlan`)

`title_source` lets the hidden `set_session_title` runtime tool update generated/system titles while preserving any
title manually saved by the user through `UpdateSession`.

Current session statuses:

- `idle`
- `streaming`
- `stopped`
- `error`

`status` is now a **derived mirror** of run state, maintained for client compatibility: `streaming` iff a non-terminal
agent run references the session, `error` when the session's latest run failed, else `idle` (canceled runs also mirror
to `idle` so old clients see the pre-runs behavior). Liveness truth lives in the `runs` table, so a crash can never
permanently wedge a session in `streaming` — the boot sweep requeues interrupted runs and the mirror re-derives.

Deleting a session detaches rather than cascades: its runs keep their history with `session_id` nulled, and child
sessions promote to top level (`parent_session_id` nulled).

### `runs`

Every execution — an interactive turn, a trigger firing, an agent-started session, a `sub_session` child, a workflow —
is a durable row in `runs`. The table doubles as the dispatch queue (see `agents/src/runs.ts`); runs form a tree via
`parent_run_id` with a denormalized `root_run_id` so one WebSocket subscription covers a whole tree.

Important columns:

- `id`, `account_id`, `root_run_id`, `parent_run_id`, `depth`
- `kind` — `agent` or `workflow`
- `agent_id`, `session_id` (transcript session for agent runs; NULL for workflows), `trigger_firing_id`
- `origin` — `user`, `trigger`, `agent`, `workflow`, or `system`
- `title`, `model`
- `source_cid`, `source_text` — workflow runs: the JS module and its `sha256:` digest
- `input_cbor`, `output_cbor`, `error_cbor` (`{code, message, retryable?, httpStatus?}`)
- `status` — `queued`, `claimed`, `running`, `waiting`, `succeeded`, `failed`, `canceled`
- `wait_cbor` — why a run is parked: `{reason: 'children', toolCallIds}` or `{reason: 'timer', wakeAt}`
- `attempt`, `max_attempts`, `not_before` (backoff/timer wake), `queue` (`interactive` or `background`)
- `lease_owner`, `lease_expires_at` — crash recovery: the boot sweep requeues rows a dead process left claimed/running
- `budget_cbor`, `usage_cbor` (persisted per turn boundary, child usage rolled up into the parent on finalize)
- `plan_cbor` — workflow step/plan snapshot fed by `ctx.step`/`ctx.plan`

Deleting a trigger detaches its runs (`trigger_firing_id` nulled) before deleting firings.

### `run_journal`

Append-only journal for workflow runs — the execution spine that makes replay-from-top resume safe. Rows are
`(run_id, seq, entry_cbor, created_at)` with `seq` monotonic per run. Each entry carries a `callSeq` correlating the
entries of one `ctx` call (`call`/`result`, `timer`/`fired` — the `(run_id, seq)` primary key cannot repeat) and a
`key`: the effect's **deterministic content key** (`tool|name|inputJSON`, `agent|specJSON`, `sleep|ms`, …). Replay
matches by key with FIFO per-key group consumption, not by arrival order — continuation ordering after `ctx.parallel`
depends on real completion timing, so order-based matching misfiles results on resume. A live effect with no journaled
group executes fresh (the run's source is pinned via `source_cid`/`source_text`); groups left unconsumed at success log
a warning. Entry kinds: `call`, `result`, `timer`, `fired`, `now`, `log`, `step`, `plan` (see `WorkflowJournalEntry` in
`agents/src/workflow-host.ts`). Caps: 5,000 entries or 8 MiB per run, after which the run fails `journal-cap`. Entries
are streamed to `runs/<rootRunId>` subscribers as `append` events and replayed on subscribe.

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
- Add retention/pruning for old events, runs, journals, and idempotency rows.
- Add secret versioning/rotation metadata.
- Add audit log tables for provider/secret/tool/security events.
- Add KMS/keychain option for secret encryption key.
