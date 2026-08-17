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

- initializes a fresh DB from `sqlite-schema.sql` and stamps it at `desiredVersion`;
- opens a DB at or behind the desired version and applies the pending migrations;
- rejects a DB whose version is unknown, unparseable, ahead of this binary, or predates version tracking (a legacy
  `schema_version` key, or no `server_config` table at all).

The service does not silently run against unknown schema state; on rejection `main.ts` serves a 500 on every route and
logs both versions.

Migrations live in the `migrations` array in `sqlite.ts` and are **prepend-only**: new entries go at the top of the
literal and the array is `.reverse()`d, so index order equals apply order and `desiredVersion` is simply
`migrations.length`. Each migration applies inside its own savepoint within one transaction; a failure rolls the whole
batch back. `sqlite-schema.sql` is the fresh-install baseline and must be kept equivalent to baseline + every migration.

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
private memory filesystem (see `agents/src/agent-memory.ts`) — the `~/memory/` half of its Space — reached by the agent
through the `read`/`write` verbs and by its owner through the signed agent-memory actions. It lives on disk, not in
SQLite, and is removed with the rest of `state_dir` when the agent is deleted.

Current agent statuses:

- `idle`
- `running`
- `stopped`
- `error`

Most runtime work currently operates at the session level; agent status is not yet a rich run-state machine.

### `agent_collaborators`

Stores pending invitations and accepted agent-level access grants, keyed by `(agent_id, account_id)`. The `account_id`
is the invited/collaborating Seed account; the agent's owning account remains on `agents.account_id` and all agent
content continues to be stored under that owner.

Important columns:

- `role` — `reader` or `writer`;
- `status` — `pending` or `accepted`;
- `accepted_at` — acceptance time, NULL while pending;
- `created_at`, `updated_at`.

Readers may inspect agent settings, memory, tools, triggers, sessions, transcripts, runs, and attachments. Writers may
also mutate those agent-scoped resources and interact with sessions. Collaborators cannot manage this table or delete
the agent; those remain owner-only. Deleting an agent deletes its collaboration rows.

### `agent_triggers`

Stores saved agent-scoped trigger definitions for HM activity triggers and schedule triggers.

Important columns:

- `account_id`
- `agent_id`
- `name`
- `enabled`
- `source_cbor`
- `prompt`
- `continuation_cbor`
- `last_checked_at`
- `last_fired_at`
- `last_error`

`source_cbor` encodes `AgentTriggerSource`: document-comment, user-mention, site-update, schedule, and run-completed.
Schedule triggers store interval, weekly-days/time, or one-time run configuration inside this CBOR blob; no additional
schedule table is required.

`continuation_cbor` encodes what a firing does — `{kind: 'newThread'}` or `{kind: 'wake', signal, runId?, payload?}`.
NULL means the only thing triggers used to do: start a new thread. The event-bus milestone moves this (and the rest of a
trigger) into a Space document; the column is where it lives until then.

The table also carries a `cooldown_ms` column that nothing reads or writes. It is vestigial — no protocol field sets it
and no monitor consults it.

### `sessions`

Stores chat-like sessions.

Important columns:

- `account_id`
- `agent_id`
- `title`
- `title_source` (`system`, `agent`, or `user`)
- `status`
- `parent_session_id` — set on sessions spawned by another session (model children of `delegate`, script children's
  `ctx.delegate`, and agent-started sessions); lineage-aware clients exclude rows with a parent from the top-level
  `ListSessions` view by passing `includeChildren: false`
- `run_id` — the run this session is the transcript of, for sessions created as run children
- `plan_cbor` — the live checklist written by the `plan` verb (a `RunPlan`)

`title_source` protects a title the user typed. Rows start `system`; `UpdateSession` writes `user`, and every automatic
titling path refuses to overwrite a `user` row. Today the automatic path is `#ensureSessionTitled`, a dedicated minimal
model call made when a turn parks or finalizes with the session still untitled (enabled by
`SEED_AGENTS_SESSION_TITLE_GENERATION`); it deliberately leaves `title_source` at `system`, so the user can still
rename. The third value, `agent`, is written only by `#setSessionTitleFromAgent`, which no code path calls — the in-turn
`set_session_title` tool it belonged to was deliberately deleted (`api-service.test.ts` asserts it never reappears in
the tool list), and the function has outlived it.

`plan_cbor` carries `RunPlan`: `{title?, steps: [{id, label, status, resolvedBy?}], settledAt?}`. Two fields are the
runtime's own word rather than the model's, and `normalizeRunPlan` cannot be talked into either. `resolvedBy: 'runtime'`
marks a step the runtime closed because every child attached to it came back succeeded — only success is ever derived
this way. `settledAt` stamps the moment every step became terminal (done/failed/skipped), so a client watching only the
snapshot knows when the checklist finished; a later edit that reopens a step clears it.

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

Every execution — an interactive turn, a trigger firing, an agent-started session, a delegated model child, a script
child — is a durable row in `runs`. The table doubles as the dispatch queue (see `agents/src/runs.ts`); runs form a tree
via `parent_run_id` with a denormalized `root_run_id` so one WebSocket subscription covers a whole tree.

Important columns:

- `id`, `account_id`, `root_run_id`, `parent_run_id`, `depth`
- `parent_tool_call_id` — the parent's `delegate` call that spawned this run. It also rides in the run's input payload,
  but only a column can be read back without decoding every run: this is what lets a delegate row in a transcript find
  its child _while that child is still working_, before any result exists.
- `continued_from_run_id` — the run this one continues. `ctx.continueAsNew` ends a run and starts a successor carrying
  only the state it declared, so a day-scale loop never grows an unbounded journal; the two rows are one piece of work.
- `kind` — `agent` (a model turn, with a transcript session) or `workflow` (a script child in the QuickJS engine)
- `agent_id`, `session_id` (transcript session for agent runs; NULL for script runs), `trigger_firing_id`
- `origin` — `user`, `trigger`, `agent`, `workflow`, or `system`
- `title`, `model`
- `source_cid`, `source_text` — script runs: the JS module and its `sha256:` digest
- `input_cbor`, `output_cbor`, `error_cbor` (`{code, message, retryable?, httpStatus?}`)
- `status` — `queued`, `claimed`, `running`, `waiting`, `succeeded`, `failed`, `canceled`
- `wait_cbor` — why a run is parked, one of four reasons: `children` (spawned children, with `toolCallIds`), `timer`
  (`wakeAt`), `event` (`ctx.waitForEvent`), `budget-pause` (it stopped rather than spend more). `RunWaitInfo.answerWith`
  names the signal that would answer the wait by hand, when one can.
- `attempt`, `max_attempts`, `not_before` (backoff/timer wake), `queue` (`interactive` or `background`)
- `lease_owner`, `lease_expires_at` — crash recovery: the boot sweep requeues rows a dead process left claimed/running
- `budget_cbor`, `usage_cbor` (persisted per turn boundary, child usage rolled up into the parent on finalize)
- `plan_cbor` — a workflow's own `ctx.step`/`ctx.plan` snapshot, or the immutable copy of a session plan written onto
  its owning agent run when that plan settles; the latter keeps completed checklist history after the session starts a
  new mutable plan

A run's `output_cbor`/`error_cbor` may also carry `unmetObligations`: what the run committed to and had not delivered
when it ended — an undelivered typed result (`{kind: 'typed-result'}`) or plan steps left neither finished nor written
off (`{kind: 'plan', steps}`). Nearly every run keeps its word, so the presence of the field is the signal. A run with
budget left is asked once to settle every open obligation at the same time; one that runs out leaves the notice on the
log instead of quietly writing the debt off.

Deleting a trigger detaches its runs (`trigger_firing_id` nulled) before deleting firings.

### `run_event_waits`

One row per outstanding `ctx.waitForEvent`: `(run_id, wait_id)` primary key plus `account_id`, `match_cbor` (the wait
criteria — a `{signal}` for a person or system answering, or `{eventType, resource, author}` for the activity feed),
`timeout_at`, and `created_at`, indexed by `(account_id, created_at)`.

Waits get their own table rather than a marker on `agent_triggers` deliberately: a trigger is user configuration —
listed and edited in the desktop, carrying prompts and continuations — while a wait is transient run state, created by a
running script and deleted the moment it is delivered, times out, or its run dies. Sharing the table would mean
filtering the marker out of every trigger listing and mutation forever, and a leaked row would read to its owner as a
trigger they never made.

### `tool_documents`

Every tool an agent holds is a content-addressed document, one row per `(account_id, agent_id, name)`: `kind` (`builtin`
or `lambda`), `cid`, `doc_cbor`, `enabled`, timestamps.

`doc_cbor` is the canonical DAG-CBOR encoding of a `ToolDocument` (`agents/src/tool-documents.ts`) —
`{name, kind, summary, description, input, output?, source?, runtime?, binding?}` — and `cid` is the CIDv1 over exactly
those bytes, the same encoding the hypermedia network uses for blobs. The CID is the tool's version: it changes on every
edit, so "what exactly can this agent run" is always answerable, and publishing a tool to the network later means
publishing bytes that already exist.

Builtin rows are materialized (and refreshed when the shipped registry contract changes, detected by CID mismatch) by
`ensureBuiltinToolDocuments`, which runs whenever the Space index or a `~/tools` listing is built and on
`ListAgentTools`. Builtins carry a `binding` — the runtime executor id — and no source; lambdas carry authored
TypeScript or Python source that runs in the `execute` sandbox when called by name through the `call` verb. Authored
documents are validated before they are ever stored (name pattern `^[a-z][a-z0-9_-]{1,63}$`, 16 KiB description cap, 256
KiB source cap, input/output schemas run through `validateJsonSchemaShape`), because both the Space index and the `call`
verb trust stored documents. A lambda may not take a builtin's or a verb's name, and builtins cannot be deleted — they
are withheld through the agent's grants instead.

### `agent_drafts`

Hypermedia write drafts (`write hm://…` with `options.action: 'draft.create'` and friends): per-account rows holding the
draft content as CBOR (`content_format` + `content_cbor`), optional `metadata_cbor`, the signing identity
(`signer_secret_name`), and the edit/location targets the draft will publish against. Indexed by account + `updated_at`,
by agent, and by `status`.

### `run_journal`

Append-only journal for script (workflow) runs — the execution spine that makes replay-from-top resume safe. Rows are
`(run_id, seq, entry_cbor, created_at)` with `seq` monotonic per run. Each entry carries a `callSeq` correlating the
entries of one `ctx` call (`call`/`result`, `timer`/`fired` — the `(run_id, seq)` primary key cannot repeat) and a
`key`: the effect's **deterministic content key** (`tool|name|inputJSON`, `agent|specJSON`, `sleep|ms`, …). Replay
matches by key with FIFO per-key group consumption, not by arrival order — continuation ordering after `ctx.parallel`
depends on real completion timing, so order-based matching misfiles results on resume. A live effect with no journaled
group executes fresh (the run's source is pinned via `source_cid`/`source_text`); groups left unconsumed at success log
a warning. Entry kinds: `call`, `result`, `timer`, `fired`, `wait`, `event`, `now`, `log`, `step`, `plan` (see
`WorkflowJournalEntry` in `agents/src/workflow-host.ts`) — `wait`/`event` are the two halves of a `ctx.waitForEvent`,
the registration and its resolution (a delivered payload, or nothing at all on timeout). A call entry may carry a
`description`: the human-readable narration a script attaches to an effect, which rides the entry as display metadata
and stays out of the replay key. Caps: 5,000 entries or 8 MiB per run, after which the run fails `journal-cap`. Entries
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

This is the **Log**: a shared workspace log, not a chat transcript. Every entry carries an `actor` saying who did it,
because the user holds the same verbs the agent does — a verb run through `InvokeSessionTool` appends its `tool_call`
and `tool_result` here stamped `actor: 'user'`, and the agent reads them on its next turn exactly as it reads its own.

Current event payloads:

```ts
type SessionActor = 'user' | 'agent' | 'system' | 'trigger'

type SessionEventMeta = {
  accountId?: string // Seed account that originated a user message
  signerId?: string // exact cryptographic signer from its verified action envelope
  model?: string // model that produced the message
  provider?: string // provider it ran on
  usage?: AgentRunUsage // this turn's tokens, not the run's cumulative total
  durationMs?: number // wall time for this message or tool call
}

type SessionEventPayload =
  | {
      type: 'message'
      role: 'user' | 'assistant' | 'tool'
      content: string
      toolCallId?: string
      rawMarkdown?: string
      blocks?: AgentMessageBlock[]
      contextLines?: string[] // client `context` parts; fed to the model, never part of `content`
      attachments?: SessionAttachmentInfo[]
      actor?: SessionActor
      meta?: SessionEventMeta
    }
  | {type: 'tool_call'; id: string; name: string; input: unknown; actor?: SessionActor}
  | {
      type: 'tool_result'
      toolCallId: string
      name: string
      output?: unknown
      error?: string
      actor?: SessionActor
      meta?: SessionEventMeta
    }
  | {type: 'error'; message: string; actor?: SessionActor}
  | Record<string, unknown>
```

`actor` and `meta` are both optional because events predating them exist. Never treat either as required structure:
`sessionEventActor()` in the protocol package derives the actor of an older event from its shape (a user-role message is
`user`, an error is `system`, everything else is `agent`), and `meta` is display detail that is simply absent on older
rows. New signed user messages always stamp both the acting Seed `accountId` and exact `signerId`; they may differ when
the account uses an authorized device/delegate signer. Model replay preserves that distinction by prefixing signed human
messages with their authoritative `accountId`; for shared agents the system prompt also carries the accepted member
roster, roles, and best-effort profile display names.

Plan updates are **not** durable events — the `plan` verb writes `sessions.plan_cbor` in place, which is why the plan
snapshot carries its own `settledAt` timestamp.

Live assistant partials are not persisted here.

### `action_idempotency`

Stores account/action/client-ID request and response CBOR.

Used by:

- `CreateAgent.clientRequestId`
- `CreateAgentTrigger.clientRequestId`
- `CreateSigningIdentity.clientRequestId`
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
transactions because it performs model/network work. Concurrent collaborators append synchronously through the single
service process, then enqueue independently; the run queue serializes model turns per session without delaying event
persistence.

## Improvement areas

- Move from `MAX(seq)+1` event sequence allocation to a stronger per-session sequence allocator before supporting
  multiple service processes writing the same database.
- Add retention/pruning for old events, runs, journals, and idempotency rows.
- Add secret versioning/rotation metadata.
- Add audit log tables for provider/secret/tool/security events.
- Add KMS/keychain option for secret encryption key.
