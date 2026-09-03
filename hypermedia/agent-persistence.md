---
name: Persistence
summary: Agents persistence is SQLite-based. The canonical schema is agents/src/sqlite-schema.sql; open/migration validation lives in agents/src/sqlite.ts.
---
Agents persistence is SQLite-based. The canonical schema is `agents/src/sqlite-schema.sql`; open/migration validation lives in `agents/src/sqlite.ts`. <!-- id:DYT_n4RC -->

# Database path <!-- id:j0t-DcAj -->

Default: <!-- id:6ogMTmam -->

```text <!-- id:9lb0S7a3 -->
agents/data/agents.sqlite
```

Configured by: <!-- id:7nPiFx19 -->
  - `SEED_AGENTS_DB_PATH` <!-- id:pqL5JwrE -->
  - `--db-path` <!-- id:LwP_GSzP -->

# Schema gate <!-- id:lgiSEokt -->

On startup, `sqlite.open()` either: <!-- id:2_LU9c3d -->
  - initializes a fresh DB from `sqlite-schema.sql` and stamps it at `desiredVersion`; <!-- id:V1m1E6il -->
  - opens a DB at or behind the desired version and applies the pending migrations; <!-- id:xo8ZSgZb -->
  - rejects a DB whose version is unknown, unparseable, ahead of this binary, or predates version tracking (a legacy `schema_version` key, or no `server_config` table at all). <!-- id:dtQ5gnzT -->

The service does not silently run against unknown schema state; on rejection `main.ts` serves a 500 on every route and logs both versions. <!-- id:Cxj6ftns -->

Migrations live in the `migrations` array in `sqlite.ts` and are **prepend-only**: new entries go at the top of the literal and the array is `.reverse()`d, so index order equals apply order and `desiredVersion` is simply `migrations.length`. Each migration applies inside its own savepoint within one transaction; a failure rolls the whole batch back. `sqlite-schema.sql` is the fresh-install baseline and must be kept equivalent to baseline + every migration. <!-- id:hd8VJE3g -->

# Tables <!-- id:6sX7nWzL -->

## `server_config` <!-- id:I2FSAlh0 -->

Stores server-local config blobs. <!-- id:Wq6WHwVL -->

Current key: <!-- id:KmXMNCOC -->
  - `secret_encryption_key_v1` — AES-GCM key for encrypted secrets. <!-- id:yX_cmm70 -->

Production caveat: storing encrypted secrets and the encryption key in the same DB is better than plaintext API responses/logs but not equivalent to KMS/keychain-backed storage. <!-- id:exECGDvm -->

## `accounts` <!-- id:8jYfBAMc -->

Stores account IDs known to this server. <!-- id:frCqxSmy -->

Rows are created/updated as account-owned resources are written. <!-- id:iOuECVKn -->

## `account_authorizations` <!-- id:en8YUkFs -->

Stores local delegated signers for an account. <!-- id:DMxxBN5j -->

Accepted roles: <!-- id:AUhcLlli -->
  - `OWNER` <!-- id:istckNfK -->
  - `AGENT` <!-- id:7Sxpm7Vh -->

Used by `auth.isAuthorizedSigner()` and tests; future production delegation/capability UX is still incomplete. <!-- id:8DmCCEfl -->

## `model_providers` <!-- id:VXoNLYPE -->

Stores account-scoped provider config. <!-- id:9NUHE0IW -->

Important columns: <!-- id:Q01M8fxi -->
  - `account_id` <!-- id:P2G4tANl -->
  - `name` <!-- id:DY9cEP1i -->
  - `type` <!-- id:EjRMi1DM -->
  - `config_cbor` <!-- id:DB0t_Yc0 -->

`config_cbor` encodes `ModelProviderConfig`: <!-- id:RhAjr3Mr -->

```ts <!-- id:cHQbXjHb -->
type ModelProviderConfig = {
  type: string
  modelDefaults?: Record<string, unknown>
  secretRefs?: Record<string, string>
  baseUrl?: string
}
```

The `(account_id, name)` pair is unique. <!-- id:AA_0_QUV -->

## `secrets` <!-- id:sTmPWMgz -->

Stores encrypted account-scoped secret values. <!-- id:OGDW2bl3 -->

Important columns: <!-- id:S-AAWdDn -->
  - `account_id` <!-- id:VWvA-g9A -->
  - `name` <!-- id:37PKQJw7 -->
  - `ciphertext` <!-- id:tz2wuw4H -->
  - `metadata_cbor` <!-- id:yiL2pe66 -->

Secrets are never returned in plaintext through the API. <!-- id:EcDoqU3q -->

## `agents` <!-- id:Kwjfutzr -->

Stores agent definitions. <!-- id:RNtw1Aty -->

Important columns: <!-- id:OppHXSY2 -->
  - `account_id` <!-- id:oebAwFfP -->
  - `definition_cbor` <!-- id:t9NAtsIu -->
  - `state_dir` <!-- id:SuxIz7up -->
  - `status` <!-- id:8euzUug0 -->

`definition_cbor` encodes `AgentDefinition`. <!-- id:HGpQYrDd -->

`state_dir` points at the per-agent directory under the service data dir. Its `memory/` subdirectory is the agent's private memory filesystem (see `agents/src/agent-memory.ts`) — the `~/memory/` half of its Space — reached by the agent through the `read`/`write` verbs and by its owner through the signed agent-memory actions. It lives on disk, not in SQLite, and is removed with the rest of `state_dir` when the agent is deleted. <!-- id:-gYgCaP- -->

Current agent statuses: <!-- id:NAqi4SCE -->
  - `idle` <!-- id:VhhxO0jb -->
  - `running` <!-- id:Qz87bdUx -->
  - `stopped` <!-- id:agXBj4Zt -->
  - `error` <!-- id:gLyK9kT7 -->

Most runtime work currently operates at the session level; agent status is not yet a rich run-state machine. <!-- id:_IjMhSVq -->

## `agent_collaborators` <!-- id:e3TdADGB -->

Stores pending invitations and accepted agent-level access grants, keyed by `(agent_id, account_id)`. The `account_id` is the invited/collaborating Seed account; the agent's owning account remains on `agents.account_id` and all agent content continues to be stored under that owner. <!-- id:4UrnT8a7 -->

Important columns: <!-- id:UGC0f3j9 -->
  - `role` — `reader` or `writer`; <!-- id:oAyBLzIa -->
  - `status` — `pending` or `accepted`; <!-- id:m7czTs_k -->
  - `accepted_at` — acceptance time, NULL while pending; <!-- id:5t_8TYy2 -->
  - `created_at`, `updated_at`. <!-- id:dS_KLpBe -->

Readers may inspect agent settings, memory, tools, triggers, sessions, transcripts, runs, and attachments. Writers may also mutate those agent-scoped resources and interact with sessions. Collaborators cannot manage this table or delete the agent; those remain owner-only. Deleting an agent deletes its collaboration rows. <!-- id:8WlImd4u -->

## `agent_triggers` <!-- id:qcPEzEQt -->

Stores saved agent-scoped trigger definitions for HM activity triggers and schedule triggers. <!-- id:Lcnhvxo7 -->

Important columns: <!-- id:SZNhzQWh -->
  - `account_id` <!-- id:Hjoch3-2 -->
  - `agent_id` <!-- id:1FRCuhrX -->
  - `name` <!-- id:yhvT7nLH -->
  - `enabled` <!-- id:jLPXT2nW -->
  - `source_cbor` <!-- id:ctG5GIZj -->
  - `prompt` <!-- id:eEHz2x6q -->
  - `continuation_cbor` <!-- id:qIG3vkc3 -->
  - `last_checked_at` <!-- id:KqX-K7_B -->
  - `last_fired_at` <!-- id:n5f1z_MO -->
  - `last_error` <!-- id:NiOPT991 -->

`source_cbor` encodes `AgentTriggerSource`: document-comment, user-mention, site-update, schedule, and run-completed. Schedule triggers store interval, weekly-days/time, or one-time run configuration inside this CBOR blob; no additional schedule table is required. <!-- id:DySCuqjj -->

`continuation_cbor` encodes what a firing does — `{kind: 'newThread'}` or `{kind: 'wake', signal, runId?, payload?}`. NULL means the only thing triggers used to do: start a new thread. The event-bus milestone moves this (and the rest of a trigger) into a Space document; the column is where it lives until then. <!-- id:k2ecZ612 -->

Rows are written by the signed CRUD actions and by the agent itself through `write ~/triggers/<name>` (`writeTriggerAddress`), which honors `enabled` as written — the agent manages its own triggers directly (see `security.md`). <!-- id:G0Ps3gr8 -->

The table also carries a `cooldown_ms` column that nothing reads or writes. It is vestigial — no protocol field sets it and no monitor consults it. <!-- id:FMdhJkiz -->

## `sessions` <!-- id:k-ewoWAb -->

Stores chat-like sessions. <!-- id:ktF8u_Cq -->

Important columns: <!-- id:Ejf_lPGv -->
  - `account_id` <!-- id:cYVVn0XO -->
  - `agent_id` <!-- id:GKRZ2UpZ -->
  - `title` <!-- id:xX5YWsNl -->
  - `title_source` (`system`, `agent`, or `user`) <!-- id:PLBjUJGo -->
  - `status` <!-- id:0MQePZ9f -->
  - `parent_session_id` — set on sessions spawned by another session (model children of `delegate`, script children's `ctx.delegate`, and agent-started sessions); lineage-aware clients exclude rows with a parent from the top-level `ListSessions` view by passing `includeChildren: false` <!-- id:bxVGp7n4 -->
  - `run_id` — the run this session is the transcript of, for sessions created as run children <!-- id:s4aSdsge -->
  - `plan_cbor` — the live checklist written by the `plan` verb (a `RunPlan`) <!-- id:1ZMzBqx4 -->

`title_source` protects a title the user typed. Rows start `system`; `UpdateSession` writes `user`, and every automatic titling path refuses to overwrite a `user` row. Today the automatic path is `#ensureSessionTitled`, a dedicated minimal model call made when a turn parks or finalizes with the session still untitled (enabled by `SEED_AGENTS_SESSION_TITLE_GENERATION`); it deliberately leaves `title_source` at `system`, so the user can still rename. The third value, `agent`, is written only by `#setSessionTitleFromAgent`, which no code path calls — the in-turn `set_session_title` tool it belonged to was deliberately deleted (`api-service.test.ts` asserts it never reappears in the tool list), and the function has outlived it. <!-- id:3-r89YEl -->

`plan_cbor` carries `RunPlan`: `{title?, steps: [{id, label, status, resolvedBy?}], settledAt?}`. Two fields are the runtime's own word rather than the model's, and `normalizeRunPlan` cannot be talked into either. `resolvedBy: 'runtime'` marks a step the runtime closed because every child attached to it came back succeeded — only success is ever derived this way. `settledAt` stamps the moment every step became terminal (done/failed/skipped), so a client watching only the snapshot knows when the checklist finished; a later edit that reopens a step clears it. <!-- id:GhYFW3mf -->

Current session statuses: <!-- id:Y7bhU8xC -->
  - `idle` <!-- id:AIwpD2UF -->
  - `streaming` <!-- id:ruJ2ioba -->
  - `stopped` <!-- id:lxiLBz5J -->
  - `error` <!-- id:lr-a7i8F -->

`status` is now a **derived mirror** of run state, maintained for client compatibility: `streaming` iff a non-terminal agent run references the session, `error` when the session's latest run failed, else `idle` (canceled runs also mirror to `idle` so old clients see the pre-runs behavior). Liveness truth lives in the `runs` table, so a crash can never permanently wedge a session in `streaming` — the boot sweep requeues interrupted runs and the mirror re-derives. <!-- id:D2AGZrqn -->

Deleting a session detaches rather than cascades: its runs keep their history with `session_id` nulled, and child sessions promote to top level (`parent_session_id` nulled). <!-- id:q1tDrj6T -->

## `runs` <!-- id:0MmFRnGP -->

Every execution — an interactive turn, a trigger firing, an agent-started session, a delegated model child, a script child — is a durable row in `runs`. The table doubles as the dispatch queue (see `agents/src/runs.ts`); runs form a tree via `parent_run_id` with a denormalized `root_run_id` so one WebSocket subscription covers a whole tree. <!-- id:dqTBE6dB -->

Important columns: <!-- id:naM83lJs -->
  - `id`, `account_id`, `root_run_id`, `parent_run_id`, `depth` <!-- id:P9V2mfQv -->
  - `parent_tool_call_id` — the parent's `delegate` call that spawned this run. It also rides in the run's input payload, but only a column can be read back without decoding every run: this is what lets a delegate row in a transcript find its child _while that child is still working_, before any result exists. <!-- id:7319vANI -->
  - `continued_from_run_id` — the run this one continues. `ctx.continueAsNew` ends a run and starts a successor carrying only the state it declared, so a day-scale loop never grows an unbounded journal; the two rows are one piece of work. <!-- id:5SzUA-kk -->
  - `kind` — `agent` (a model turn, with a transcript session) or `workflow` (a script child in the QuickJS engine) <!-- id:AgK7ueNe -->
  - `agent_id`, `session_id` (transcript session for agent runs; NULL for script runs), `trigger_firing_id` <!-- id:CbRvp75P -->
  - `origin` — `user`, `trigger`, `agent`, `workflow`, or `system` <!-- id:bjNC78Ui -->
  - `title`, `model` <!-- id:b8er4ePw -->
  - `source_cid`, `source_text` — script runs: the JS module and its `sha256:` digest <!-- id:1eGD_U2B -->
  - `input_cbor`, `output_cbor`, `error_cbor` (`{code, message, retryable?, httpStatus?}`) <!-- id:lQHrI-EL -->
  - `status` — `queued`, `claimed`, `running`, `waiting`, `succeeded`, `failed`, `canceled` <!-- id:kk_8fzzB -->
  - `wait_cbor` — why a run is parked, one of four reasons: `children` (spawned children, with `toolCallIds`), `timer` (`wakeAt`), `event` (`ctx.waitForEvent`), `budget-pause` (it stopped rather than spend more). `RunWaitInfo.answerWith` names the signal that would answer the wait by hand, when one can. <!-- id:ABiAFoPR -->
  - `attempt`, `max_attempts`, `not_before` (backoff/timer wake), `queue` (`interactive` or `background`) <!-- id:OAH8GJqV -->
  - `lease_owner`, `lease_expires_at` — crash recovery: the boot sweep requeues rows a dead process left claimed/running <!-- id:dPUUmhsr -->
  - `budget_cbor`, `usage_cbor` (persisted per turn boundary, child usage rolled up into the parent on finalize) <!-- id:n6QuqbkC -->
  - `plan_cbor` — a workflow's own `ctx.step`/`ctx.plan` snapshot, or the immutable copy of a session plan written onto its owning agent run when that plan settles; the latter keeps completed checklist history after the session starts a new mutable plan <!-- id:7c5vRbTH -->

A run's `output_cbor`/`error_cbor` may also carry `unmetObligations`: what the run committed to and had not delivered when it ended — an undelivered typed result (`{kind: 'typed-result'}`) or plan steps left neither finished nor written off (`{kind: 'plan', steps}`). Nearly every run keeps its word, so the presence of the field is the signal. A run with budget left is asked once to settle every open obligation at the same time; one that runs out leaves the notice on the log instead of quietly writing the debt off. <!-- id:3oX16Lcj -->

Deleting a trigger detaches its runs (`trigger_firing_id` nulled) before deleting firings. <!-- id:FB13Cr6t -->

## `run_event_waits` <!-- id:Yp8kmeEv -->

One row per outstanding `ctx.waitForEvent`: `(run_id, wait_id)` primary key plus `account_id`, `match_cbor` (the wait criteria — a `{signal}` for a person or system answering, or `{eventType, resource, author}` for the activity feed), `timeout_at`, and `created_at`, indexed by `(account_id, created_at)`. <!-- id:_cnNE1la -->

Waits get their own table rather than a marker on `agent_triggers` deliberately: a trigger is user configuration — listed and edited in the desktop, carrying prompts and continuations — while a wait is transient run state, created by a running script and deleted the moment it is delivered, times out, or its run dies. Sharing the table would mean filtering the marker out of every trigger listing and mutation forever, and a leaked row would read to its owner as a trigger they never made. <!-- id:j-cdZ4lN -->

## `mcp_servers` <!-- id:Qid3zZGO -->

One row per remote MCP server an account has connected, unique on `(account_id, name)`: `id`, `config_cbor` (`{url, transport?, headers?, secretRefs?}` — secret header values live in `secrets` under the `mcp-<name>-<header>` convention and are referenced by name), `tools_cbor` (the `McpToolInfo[]` from the last **successful** discovery, kept across a later failed refresh), `status_cbor` (`{state, error?, checkedAt?}`), timestamps. Agents reference servers by name from `definition.mcpServers`; deleting a server scrubs those references, the projected documents, and its owned secrets. See [`mcp.md`](./agent-mcp.md). <!-- id:2mYeVV8g -->

## `tool_documents` <!-- id:ENCjNUXP -->

Every tool an agent holds is a content-addressed document, one row per `(account_id, agent_id, name)`: `kind` (`builtin`, `lambda`, or `mcp`), `cid`, `doc_cbor`, `enabled`, timestamps. <!-- id:1FRih0_f -->

`doc_cbor` is the canonical DAG-CBOR encoding of a `ToolDocument` (`agents/src/tool-documents.ts`) — `{name, kind, summary, description, input, output?, source?, runtime?, binding?}` — and `cid` is the CIDv1 over exactly those bytes, the same encoding the hypermedia network uses for blobs. The CID is the tool's version: it changes on every edit, so "what exactly can this agent run" is always answerable, and publishing a tool to the network later means publishing bytes that already exist. <!-- id:oKNZJ5i3 -->

Builtin rows are materialized (and refreshed when the shipped registry contract changes, detected by CID mismatch) by `ensureBuiltinToolDocuments`, which runs whenever the Space index or a `~/tools` listing is built and on `ListAgentTools`. Builtins carry a `binding` — the runtime executor id — and no source; lambdas carry authored TypeScript or Python source that runs in the `execute` sandbox when called by name through the `call` verb. Authored documents are validated before they are ever stored (name pattern `^[a-z][a-z0-9_-]{1,63}$`, 16 KiB description cap, 256 KiB source cap, input/output schemas run through `validateJsonSchemaShape`), because both the Space index and the `call` verb trust stored documents. A lambda may not take a builtin's or a verb's name, and builtins cannot be deleted — they are withheld through the agent's grants instead. <!-- id:lWMq9D5P -->

`mcp` rows are projections of `mcp_servers.tools_cbor` filtered by the agent's `definition.mcpServers`, named `<server>__<tool>` and carrying `server` and `remoteName`. `syncMcpToolDocuments` reconciles them (rewrite on CID change, delete when the server is disabled or gone) eagerly on agent and server writes and opportunistically on every listing and run start. They cannot be deleted or replaced by a lambda; a lambda that already holds the name wins. <!-- id:JIVPpvvD -->

## `agent_drafts` <!-- id:EtofX1F7 -->

Hypermedia write drafts (`write hm://…` with `options.action: 'draft.create'` and friends): per-account rows holding the draft content as CBOR (`content_format` + `content_cbor`), optional `metadata_cbor`, the signing identity (`signer_secret_name`), and the edit/location targets the draft will publish against. Indexed by account + `updated_at`, by agent, and by `status`. <!-- id:bilvz92M -->

## `run_journal` <!-- id:5paw7ekv -->

Append-only journal for script (workflow) runs — the execution spine that makes replay-from-top resume safe. Rows are `(run_id, seq, entry_cbor, created_at)` with `seq` monotonic per run. Each entry carries a `callSeq` correlating the entries of one `ctx` call (`call`/`result`, `timer`/`fired` — the `(run_id, seq)` primary key cannot repeat) and a `key`: the effect's **deterministic content key** (`tool|name|inputJSON`, `agent|specJSON`, `sleep|ms`, …). Replay matches by key with FIFO per-key group consumption, not by arrival order — continuation ordering after `ctx.parallel` depends on real completion timing, so order-based matching misfiles results on resume. A live effect with no journaled group executes fresh (the run's source is pinned via `source_cid`/`source_text`); groups left unconsumed at success log a warning. Entry kinds: `call`, `result`, `timer`, `fired`, `wait`, `event`, `now`, `log`, `step`, `plan` (see `WorkflowJournalEntry` in `agents/src/workflow-host.ts`) — `wait`/`event` are the two halves of a `ctx.waitForEvent`, the registration and its resolution (a delivered payload, or nothing at all on timeout). A call entry may carry a `description`: the human-readable narration a script attaches to an effect, which rides the entry as display metadata and stays out of the replay key. Caps: 5,000 entries or 8 MiB per run, after which the run fails `journal-cap`. Entries are streamed to `runs/<rootRunId>` subscribers as `append` events and replayed on subscribe. <!-- id:v46sJNRU -->

## `trigger_firings` <!-- id:uumzqV0y -->

Tracks activity events or scheduled occurrences that matched a trigger and the sessions created from those matches. The activity and schedule monitors use this table for durable idempotency and trigger session history. <!-- id:7O3A-Snl -->

Important columns: <!-- id:ANfEJZZZ -->
  - `account_id` <!-- id:_8uhovWA -->
  - `agent_id` <!-- id:DU-zPqMg -->
  - `trigger_id` <!-- id:UqkJ_5oc -->
  - `activity_key` <!-- id:r89Qat-g -->
  - `session_id` <!-- id:xrmU1MzV -->
  - `activity_cbor` <!-- id:k7sPpiN5 -->
  - `status` <!-- id:s90Evv96 -->
  - `error` <!-- id:bR4PVqOd -->

`(account_id, trigger_id, activity_key)` is unique so feed retries or schedule monitor retries cannot create duplicate firings for the same trigger. Schedule triggers use stable keys in the form `schedule:<triggerId>:<scheduledAt>`. <!-- id:7nrxtaqU -->

## `activity_watermarks` <!-- id:02j3J54F -->

Stores per-account HM activity feed progress for the activity trigger monitor. <!-- id:Rfbrf3zi -->

Important columns: <!-- id:L__qFi0r -->
  - `account_id` <!-- id:Y_BNJ9CB -->
  - `server_url` <!-- id:SRnPhOyO -->
  - `cursor_cbor` <!-- id:u7wWQbmO -->
  - `last_poll_at` <!-- id:lppifjVW -->
  - `last_success_at` <!-- id:Ibrlt8ja -->
  - `last_error` <!-- id:sMSZ6ouk -->

## `session_events` <!-- id:Ebv_fNMR -->

Append-only durable event log. <!-- id:HOjQrrGK -->

Important columns: <!-- id:bbrswilN -->
  - `session_id` <!-- id:dGTAU5JR -->
  - `seq` <!-- id:b9TA_zNM -->
  - `event_cbor` <!-- id:yIGBDyrA -->
  - `created_at` <!-- id:QbWGSPxU -->

`seq` is monotonic per session. Events are returned by `GetSession` and replayed on session WebSocket subscriptions. <!-- id:Z2L22h8_ -->

This is the **Log**: a shared workspace log, not a chat transcript. Every entry carries an `actor` saying who did it, because the user holds the same verbs the agent does — a verb run through `InvokeSessionTool` appends its `tool_call` and `tool_result` here stamped `actor: 'user'`, and the agent reads them on its next turn exactly as it reads its own. <!-- id:hEKK4O4C -->

Current event payloads: <!-- id:lAZ-9Wuw -->

```ts <!-- id:Z7AVyUok -->
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
      type: 'tool_spawn'
      toolCallId: string
      name: string
      runId: string
      sessionId?: string
      title: string
      actor?: SessionActor
    }
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

`tool_spawn` is appended by `delegate` the moment its child exists — before the child has run a step — and names the child run (and session, for a model child). The call stays parked without a `tool_result` until the child finishes, so this event is what lets a transcript open the child while it works; it is not replayed to the model, and it never stands in for the result, which the child's finalizer appends later. <!-- id:7F49NC1k -->

`actor` and `meta` are both optional because events predating them exist. Never treat either as required structure: `sessionEventActor()` in the protocol package derives the actor of an older event from its shape (a user-role message is `user`, an error is `system`, everything else is `agent`), and `meta` is display detail that is simply absent on older rows. New signed user messages always stamp both the acting Seed `accountId` and exact `signerId`; they may differ when the account uses an authorized device/delegate signer. Model replay preserves that distinction by prefixing signed human messages with their authoritative `accountId`; for shared agents the system prompt also carries the accepted member roster, roles, and best-effort profile display names. <!-- id:j6h3LrFf -->

Plan updates are **not** durable events — the `plan` verb writes `sessions.plan_cbor` in place, which is why the plan snapshot carries its own `settledAt` timestamp. <!-- id:8BUVq0H3 -->

Live assistant partials are not persisted here. <!-- id:hVJvv6g6 -->

## `action_idempotency` <!-- id:wyE61ixJ -->

Stores account/action/client-ID request and response CBOR. <!-- id:sQt2zUpM -->

Used by: <!-- id:1-pLN2bq -->
  - `CreateAgent.clientRequestId` <!-- id:5S91YEt2 -->
  - `CreateAgentTrigger.clientRequestId` <!-- id:ECizc0Ax -->
  - `CreateSigningIdentity.clientRequestId` <!-- id:b9ZgTYVF -->
  - `CreateSession.clientRequestId` <!-- id:4UzSr3of -->
  - `MessageSession.clientMessageId` <!-- id:iwI-KDbN -->

Same client ID with identical request bytes replays the response. Same client ID with different request bytes returns `409`. <!-- id:xDb-SvJk -->

# Secret encryption <!-- id:Mm3c29X6 -->

Implementation: `encryptSecret()` and `decryptSecret()` in `api-service.ts`. <!-- id:dxI-WpyJ -->

Current scheme: <!-- id:YUGhL6E1 -->
  - AES-GCM; <!-- id:XUp42Aad -->
  - 32-byte server-local key; <!-- id:Cux_dY-p -->
  - 12-byte random nonce per write; <!-- id:HEJUY1cA -->
  - stored ciphertext is `nonce || encryptedBytes`. <!-- id:JHUEh3sA -->

# Durable replay <!-- id:lQynYlVv -->

`GetSession` accepts `afterSeq`: <!-- id:X399CcQZ -->

```ts <!-- id:ahqMWKFN -->
{
  _: 'GetSession', sessionId, afterSeq
}
```

It returns events with `seq > afterSeq`. <!-- id:TiBn9vUJ -->

Session WebSocket subscriptions use the same replay logic when `afterSeq` is supplied. <!-- id:PuvZNhfL -->

# Transaction policy <!-- id:vdysksJ3 -->

Do not hold write transactions during provider/tool network calls. <!-- id:OivYbqs7 -->

`CreateAgent` and `CreateSession` can use short idempotent transactions. `MessageSession` must avoid long SQLite transactions because it performs model/network work. Concurrent collaborators append synchronously through the single service process, then enqueue independently; the run queue serializes model turns per session without delaying event persistence. <!-- id:xhxd1qEb -->

# Improvement areas <!-- id:NV3ktPqh -->

- Move from `MAX(seq)+1` event sequence allocation to a stronger per-session sequence allocator before supporting multiple service processes writing the same database. <!-- id:XAgvn-lC -->
- Add retention/pruning for old events, runs, journals, and idempotency rows. <!-- id:qjLPUmix -->
- Add secret versioning/rotation metadata. <!-- id:fAvMKVFW -->
- Add audit log tables for provider/secret/tool/security events. <!-- id:-k7byRQx -->
- Add KMS/keychain option for secret encryption key. <!-- id:EXFKEj_j -->
