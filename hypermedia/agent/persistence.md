---
name: Persistence
summary: "Where the agents server keeps its state: one SQLite database with a schema gate, a table-by-table reference, secret encryption, durable replay, and the transaction rules."
---
A [Seed Agents](../agent.md) server keeps its state in one SQLite database. The canonical schema is `agents/src/sqlite-schema.sql`. Open and migration validation live in `agents/src/sqlite.ts`. What an agent publishes as signed [blobs](../protocol/blobs.md) goes to the HM server. This database holds the agents server's own runtime state. <!-- id:DYT_n4RC -->

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

The service never runs against an unknown schema state. On rejection, `main.ts` serves a 500 on every route and logs both versions. <!-- id:Cxj6ftns -->

Migrations live in the `migrations` array in `sqlite.ts` and are **prepend-only**: new entries go at the top of the literal and the array is `.reverse()`d. Index order then equals apply order, and `desiredVersion` is `migrations.length`. Each migration applies inside its own savepoint within one transaction, and a failure rolls the whole batch back. `sqlite-schema.sql` is the fresh-install baseline and must stay equivalent to baseline + every migration. <!-- id:hd8VJE3g -->

# Tables <!-- id:6sX7nWzL -->

## `server_config` <!-- id:I2FSAlh0 -->

Stores server-local config blobs. <!-- id:Wq6WHwVL -->

Current key: <!-- id:KmXMNCOC -->
  - `secret_encryption_key_v1`: AES-GCM key for encrypted secrets. <!-- id:yX_cmm70 -->

Production caveat: the encrypted secrets and the encryption key sit in the same DB. That beats plaintext in API responses or logs, but it is weaker than KMS or keychain-backed storage. <!-- id:exECGDvm -->

## `accounts` <!-- id:8jYfBAMc -->

Stores account IDs known to this server. <!-- id:frCqxSmy -->

Rows are created or updated as account-owned resources are written. An account id is a Seed [account](../protocol/identity.md) [principal](../principal.md). <!-- id:iOuECVKn -->

## `account_authorizations` <!-- id:en8YUkFs -->

Stores local delegated signers for an account. <!-- id:DMxxBN5j -->

Accepted roles: <!-- id:AUhcLlli -->
  - `OWNER` <!-- id:istckNfK -->
  - `AGENT` <!-- id:7Sxpm7Vh -->

Used by `auth.isAuthorizedSigner()` and tests. The production UX for delegation and [capabilities](../protocol/permissions.md) is still incomplete. <!-- id:8DmCCEfl -->

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

`state_dir` points at the per-agent directory under the service data dir. Its `memory/` subdirectory is the agent's private memory filesystem (see `agents/src/agent-memory.ts`). It is the `~/memory/` half of its [Space](./space.md). The agent reaches it through the [`read`](./read.md) and [`write`](./write.md) verbs, and its owner through the signed agent-memory actions. It lives on disk, outside SQLite, and is removed with the rest of `state_dir` when the agent is deleted. <!-- id:-gYgCaP- -->

Current agent statuses: <!-- id:NAqi4SCE -->
  - `idle` <!-- id:VhhxO0jb -->
  - `running` <!-- id:Qz87bdUx -->
  - `stopped` <!-- id:agXBj4Zt -->
  - `error` <!-- id:gLyK9kT7 -->

Activity rollup (`activity_at`, `activity_kind`, `message_at`, `message_from`, `activity_session_id`): the latest transcript activity across the agent's sessions, written on every appended session event. Tool calls, spawns, and results, and every event of a delegated child session, move only `activity_at` and `activity_kind`. A message from a person, a trigger, or the agent in a top-level session also moves the `message_*` columns and `activity_session_id`. It is exposed as `AgentInfo.activity` together with a `busy` flag derived from live runs, so unread indicators read the agents list and never enumerate sessions. NULL until the first event. <!-- id:9iteVK4p -->

Most runtime work happens at the session level. Agent status is not a rich run-state machine yet. <!-- id:_IjMhSVq -->

## `agent_collaborators` <!-- id:e3TdADGB -->

Stores pending invitations and accepted agent-level access grants, keyed by `(agent_id, account_id)`. The `account_id` is the invited or collaborating Seed account. The agent's owning account stays on `agents.account_id`, and all agent content is still stored under that owner. <!-- id:4UrnT8a7 -->

Important columns: <!-- id:UGC0f3j9 -->
  - `role`: `reader` or `writer`; <!-- id:oAyBLzIa -->
  - `status`: `pending` or `accepted`; <!-- id:m7czTs_k -->
  - `accepted_at`: acceptance time, NULL while pending; <!-- id:5t_8TYy2 -->
  - `created_at`, `updated_at`. <!-- id:dS_KLpBe -->

## `agent_triggers` <!-- id:qcPEzEQt -->

Stores saved agent-scoped [trigger](./triggers.md) definitions for HM activity triggers and schedule triggers. <!-- id:Lcnhvxo7 -->

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

`source_cbor` encodes `AgentTriggerSource`: document-comment, user-mention, comment-reply, document-author-comment, site-update, activity, schedule, webhook, and run-completed. An activity source contains a nonempty list of `{id, source}` alternatives, limited to the activity filters. Legacy single-source rows remain valid without rewriting their CBOR or changing their identities. Schedule triggers store interval, weekly days and time, or one-time run configuration inside this CBOR value. There is no separate schedule table. <!-- id:DySCuqjj -->

`merged_into` marks a trigger retired by combination. It is disabled and immutable, retaining its original firing history. The surviving trigger receives the combined conditions and the selected shared action in one transaction.

`trigger_event_claims` records `(account_id, trigger_id, activity_key)` for activity admission. The migration seeds it from existing firings, including canonical blob-key aliases for old raw mention keys. Combining imports the union of both triggers' claims; deleting a predecessor does not delete claims already imported into the survivor. Original firing rows keep their IDs and trigger associations even when both predecessors handled the same event.

New activity firings store `context_cbor` with the name, prompt, and matched conditions observed at admission. Session attribution reads that snapshot instead of the current configuration. Legacy firings retain their existing fallback; combination captures their current view before changing the surviving configuration, without claiming historical condition-match information that was never recorded.

`continuation_cbor` encodes what a firing does: `{kind: 'newThread'}` or `{kind: 'wake', signal, runId?, payload?}`. See [trigger continuations](./trigger-continuations.md). NULL means the only thing triggers used to do: start a new thread. The event-bus milestone moves this, and the rest of a trigger, into a Space document. Until then it lives in this column. <!-- id:k2ecZ612 -->

Rows are written by the signed CRUD actions and by the agent itself through `write ~/triggers/<name>` (`writeTriggerAddress`), which honors `enabled` as written. The agent manages its own triggers directly. See [security](./security.md). <!-- id:G0Ps3gr8 -->

The table also carries a `cooldown_ms` column that nothing reads or writes. It is vestigial: no protocol field sets it and no monitor consults it. <!-- id:FMdhJkiz -->

## `sessions` <!-- id:k-ewoWAb -->

Stores chat-like sessions. <!-- id:ktF8u_Cq -->

Important columns: <!-- id:Ejf_lPGv -->
  - `account_id` <!-- id:cYVVn0XO -->
  - `agent_id` <!-- id:GKRZ2UpZ -->
  - `title` <!-- id:xX5YWsNl -->
  - `title_source` (`system`, `agent`, or `user`) <!-- id:PLBjUJGo -->
  - `status` <!-- id:0MQePZ9f -->
  - `parent_session_id`: set on sessions spawned by another session (model children of [`delegate`](./delegate.md), script children's `ctx.delegate`, and agent-started sessions). Lineage-aware clients exclude rows with a parent from the top-level `ListSessions` view by passing `includeChildren: false` <!-- id:bxVGp7n4 -->
  - `run_id`: the run this session is the transcript of, for sessions created as run children <!-- id:s4aSdsge -->
  - `plan_cbor`: the live checklist written by the [`plan`](./plan.md) verb (a `RunPlan`) <!-- id:1ZMzBqx4 -->
  - `model_override_cbor`: the session's quick-switched provider and model, when it differs from the agent's <!-- id:sjl2EKrl -->
  - `description`: the live status the agent maintains with the `status` verb <!-- id:Shdo5e_p -->
  - `thoroughness`: the session's delegation preset override (`quick`, `normal`, or `deep`) <!-- id:Qf3K5gBg -->

`title_source` protects a title the user typed. Rows start as `system`. `UpdateSession` writes `user`, and every automatic titling path refuses to overwrite a `user` row. Today the automatic path is `#ensureSessionTitled`, a small dedicated model call made when a turn parks or finalizes with the session still untitled (enabled by `SEED_AGENTS_SESSION_TITLE_GENERATION`). It leaves `title_source` at `system` on purpose, so the user can still rename. The third value, `agent`, is written only by `#setSessionTitleFromAgent`, and no code path calls it. The in-turn `set_session_title` tool it belonged to was deleted on purpose (`api-service.test.ts` asserts it never reappears in the tool list), and the function outlived it. <!-- id:3-r89YEl -->

`plan_cbor` carries `RunPlan`: `{title?, steps: [{id, label, status, resolvedBy?}], settledAt?}`. Two fields come from the runtime and never from the model, and `normalizeRunPlan` accepts neither from model input. `resolvedBy: 'runtime'` marks a step the runtime closed because every child attached to it came back succeeded. Only success is ever derived this way. `settledAt` stamps the moment every step became terminal (done, failed, or skipped), so a client watching only the snapshot knows when the checklist finished. A later edit that reopens a step clears it. <!-- id:GhYFW3mf -->

Current session statuses: <!-- id:Y7bhU8xC -->
  - `idle` <!-- id:AIwpD2UF -->
  - `streaming` <!-- id:ruJ2ioba -->
  - `stopped` <!-- id:lxiLBz5J -->
  - `error` <!-- id:lr-a7i8F -->

`status` is a **derived mirror** of run state, kept for client compatibility. It is `streaming` iff a non-terminal agent run references the session, `error` when the session's latest run failed, and `idle` otherwise. Canceled runs also mirror to `idle`, so old clients see the pre-runs behavior. The `runs` table holds the truth about liveness, so a crash can never leave a session stuck in `streaming`. The boot sweep requeues interrupted runs and the mirror re-derives. <!-- id:D2AGZrqn -->

Deleting a session detaches its rows and does not cascade. Its runs keep their history with `session_id` nulled, and child sessions promote to top level (`parent_session_id` nulled). <!-- id:q1tDrj6T -->

Latest message (`message_at`, `message_from`): the per-session half of the agent rollup above, written on every appended message from a person, a trigger, or the agent in a top-level session. Tool activity and child sessions never move it. Exposed as `SessionInfo.activity`, so a session list can mark which chats hold something unread. <!-- id:wYqb8zHh -->

## `runs` <!-- id:owVHA5ZD -->

Every execution is a durable row in `runs`: an interactive turn, a trigger firing, an agent-started session, a delegated model child, a script child. See [Runs](./runs.md). The table is also the dispatch queue (see `agents/src/runs.ts`). Runs form a tree via `parent_run_id`, with a denormalized `root_run_id` so one [WebSocket subscription](./websocket-subscriptions.md) covers a whole tree. <!-- id:J9QpEEMz -->

Important columns: <!-- id:KBSutS-f -->
  - `id`, `account_id`, `root_run_id`, `parent_run_id`, `depth` <!-- id:5EAmAwDS -->
  - `parent_tool_call_id`: the parent's `delegate` call that spawned this run. It is also in the run's input payload, but only a column can be read back without decoding every run. The column lets a delegate row in a transcript find its child _while that child is still working_, before any result exists. <!-- id:ckmeLyT4 -->
  - `continued_from_run_id`: the run this one continues. [`ctx.continueAsNew`](./continue-as-new.md) ends a run and starts a successor that carries only the state it declared, so a day-scale loop never grows an unbounded journal. The two rows are one piece of work. <!-- id:TYylRUY4 -->
  - `kind`: `agent` (a model turn, with a transcript session) or `workflow` (a [script](./script.md) child in the QuickJS engine) <!-- id:JqfAKDTg -->
  - `agent_id`, `session_id` (transcript session for agent runs; NULL for script runs), `trigger_firing_id` <!-- id:EklbAJZc -->
  - `origin`: `user`, `trigger`, `agent`, `workflow`, or `system` <!-- id:zvRVgNFS -->
  - `title`, `model` <!-- id:hsCyN0Ht -->
  - `source_cid`, `source_text`: for script runs, the JS module and its `sha256:` digest <!-- id:KJdGZTeX -->
  - `input_cbor`, `output_cbor`, `error_cbor` (`{code, message, retryable?, httpStatus?}`) <!-- id:2ap3z4qw -->
  - `status`: `queued`, `claimed`, `running`, `waiting`, `succeeded`, `failed`, `canceled` <!-- id:-cdheKz4 -->
  - `wait_cbor`: why a run is parked, one of four reasons: `children` (spawned children, with `toolCallIds`), `timer` (`wakeAt`), `event` (`ctx.waitForEvent`), `budget-pause` (it stopped before spending more). See [park](./park.md) and [wake source](./wake-source.md). `RunWaitInfo.answerWith` names the signal that would answer the wait by hand, when one can. <!-- id:FE_KLF0y -->
  - `attempt`, `max_attempts`, `not_before` (backoff or timer wake), `queue` (`interactive` or `background`) <!-- id:rbRG2Dva -->
  - `lease_owner`, `lease_expires_at`: crash recovery. The boot sweep requeues rows a dead process left claimed or running <!-- id:SEprW4Bh -->
  - `budget_cbor`, `usage_cbor` (persisted per turn boundary, child usage rolled up into the parent on finalize) <!-- id:H9i6CZmm -->
  - `plan_cbor`: a workflow's own `ctx.step` and `ctx.plan` snapshot, or the immutable copy of a session plan written onto its owning agent run when that plan settles. The copy keeps completed checklist history after the session starts a new mutable plan <!-- id:SszS3VLK -->

A run's `output_cbor` or `error_cbor` may also carry `unmetObligations`: what the run committed to and had not delivered when it ended. That is an undelivered [typed result](./typed-result.md) (`{kind: 'typed-result'}`), or plan steps left neither finished nor written off (`{kind: 'plan', steps}`). Nearly every run keeps its word, so the presence of the field is the signal. A run with budget left is asked once to settle every open obligation at the same time. A run that runs out leaves a notice on the log and does not quietly write the debt off. <!-- id:0g9nHuH1 -->

Deleting a trigger detaches its runs (`trigger_firing_id` nulled) before deleting firings. <!-- id:fYlkMgPD -->

## `run_event_waits` <!-- id:Yp8kmeEv -->

One row per outstanding `ctx.waitForEvent`: `(run_id, wait_id)` primary key plus `account_id`, `match_cbor` (the wait criteria: a `{signal}` for a person or system answering, or `{eventType, resource, author}` for the activity feed), `timeout_at`, and `created_at`, indexed by `(account_id, created_at)`. <!-- id:_cnNE1la -->

Waits have their own table on purpose, with no marker on `agent_triggers`. A trigger is user configuration: listed and edited in the desktop, carrying prompts and continuations. A wait is transient run state. A running script creates it, and it is deleted the moment it is delivered, times out, or its run dies. Sharing the table would mean filtering the marker out of every trigger listing and mutation forever, and a leaked row would look to its owner like a trigger they never made. <!-- id:j-cdZ4lN -->

## `mcp_servers` <!-- id:Qid3zZGO -->

One row per remote [MCP server](./mcp.md) an account has connected, unique on `(account_id, name)`: `id`, `config_cbor` (`{url, transport?, headers?, secretRefs?}`; secret header values live in `secrets` under the `mcp-<name>-<header>` convention and are referenced by name), `tools_cbor` (the `McpToolInfo[]` from the last **successful** discovery, kept across a later failed refresh), `status_cbor` (`{state, error?, checkedAt?}`), timestamps. Agents reference servers by name from `definition.mcpServers`. Deleting a server scrubs those references, the projected documents, and its owned secrets. See [`mcp.md`](./mcp.md). <!-- id:2mYeVV8g -->

## `tool_documents` <!-- id:ENCjNUXP -->

Every tool an agent holds is a content-addressed [tool document](./tool-document.md), one row per `(account_id, agent_id, name)`: `kind` (`builtin`, `lambda`, or `mcp`), `cid`, `doc_cbor`, `enabled`, timestamps. <!-- id:1FRih0_f -->

`doc_cbor` is the canonical DAG-CBOR encoding of a `ToolDocument` (`agents/src/tool-documents.ts`): `{name, kind, summary, description, input, output?, source?, runtime?, binding?}`. `cid` is the [CIDv1](../cid.md) over exactly those bytes, the same encoding the hypermedia network uses for blobs. The CID is the tool's version. It changes on every edit, so you can always answer "what exactly can this agent run", and publishing a tool to the network later means publishing bytes that already exist. <!-- id:oKNZJ5i3 -->

Builtin rows are materialized (and refreshed when the shipped registry contract changes, detected by CID mismatch) by `ensureBuiltinToolDocuments`, which runs whenever the Space index or a `~/tools` listing is built and on `ListAgentTools`. Builtins carry a `binding` (the runtime executor id) and no source. Lambdas carry authored TypeScript or Python source that runs in the `execute` sandbox when called by name through the [`call`](./call.md) verb. Authored documents are validated before they are ever stored (name pattern `^[a-z][a-z0-9_-]{1,63}$`, 16 KiB description cap, 256 KiB source cap, input and output schemas run through `validateJsonSchemaShape`), because both the Space index and the `call` verb trust stored documents. A lambda may not take a builtin's or a verb's name. Builtins cannot be deleted. They are withheld through the agent's [grants](./grants.md) instead. <!-- id:lWMq9D5P -->

`mcp` rows are projections of `mcp_servers.tools_cbor` filtered by the agent's `definition.mcpServers`, named `<server>__<tool>` and carrying `server` and `remoteName`. `syncMcpToolDocuments` reconciles them (rewrite on CID change, delete when the server is disabled or gone) eagerly on agent and server writes and opportunistically on every listing and run start. They cannot be deleted or replaced by a lambda. A lambda that already holds the name wins. <!-- id:JIVPpvvD -->

## `agent_drafts` <!-- id:EtofX1F7 -->

Hypermedia write [drafts](../protocol/documents.md) (`write hm://…` with `options.action: 'draft.create'` and friends): per-account rows holding the draft content as CBOR (`content_format` + `content_cbor`), optional `metadata_cbor`, the signing identity (`signer_secret_name`), and the edit and location targets the draft will publish against. Indexed by account + `updated_at`, by agent, and by `status`. <!-- id:bilvz92M -->

## `run_journal` <!-- id:5paw7ekv -->

Append-only [journal](./journal.md) for script (workflow) runs. It makes replay-from-top resume safe. Rows are `(run_id, seq, entry_cbor, created_at)` with `seq` monotonic per run. Each entry carries a `callSeq` that ties together the entries of one `ctx` call (`call` and `result`, `timer` and `fired`; the `(run_id, seq)` primary key cannot repeat). Each entry also carries a `key`: the effect's **deterministic content key** (`tool|name|inputJSON`, `agent|specJSON`, `sleep|ms`, …). Replay matches by key, consuming each key's group FIFO. It does not match by arrival order, because continuation ordering after `ctx.parallel` depends on real completion timing, and order-based matching misfiles results on resume. A live effect with no journaled group executes fresh (the run's source is pinned via `source_cid` and `source_text`). Groups left unconsumed at success log a warning. Entry kinds: `call`, `result`, `timer`, `fired`, `wait`, `event`, `now`, `log`, `step`, `plan` (see `WorkflowJournalEntry` in `agents/src/workflow-host.ts`). `wait` and `event` are the two halves of a `ctx.waitForEvent`: the registration and its resolution (a delivered payload, or nothing at all on timeout). A call entry may carry a `description`, the human-readable narration a script attaches to an effect. It is display metadata and stays out of the replay key. Caps: 5,000 entries or 8 MiB per run, after which the run fails `journal-cap`. Entries are streamed to `runs/<rootRunId>` subscribers as `append` events and replayed on subscribe. <!-- id:v46sJNRU -->

## `session_continuations` <!-- id:9Xgpa9dY -->

One row per continuation edge created by `continue_session`: the predecessor and successor sessions, the origin session of the chain, the tool call and initiating event, the `reason`, and `manifest_cbor`, the successor's exact starting point (handoff, cited sources, what was loaded and what was left cold). A successor has exactly one row, and `(predecessor_session_id, tool_call_id)` is unique so a retried call cannot create a second successor. The [session continuation](./session-continuation.md) page describes the manifest. <!-- id:_dzv470k -->

## `webhook_trigger_credentials` <!-- id:TtGHJCLW -->

One row per webhook trigger: `secret_hash`, which delivery requests are checked against, and `secret_ciphertext`, the encrypted secret that `GetAgentTrigger` returns to editors. The secret is created with the trigger. See [triggers](./triggers.md). <!-- id:lJhN6P_Y -->

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

This is the [Log](./log.md), a shared workspace log. Every entry carries an [`actor`](./actor.md) that says who did it, because the user holds the same verbs the agent does. A verb run through `InvokeSessionTool` appends its `tool_call` and `tool_result` here stamped `actor: 'user'`, and the agent reads them on its next turn exactly as it reads its own. <!-- id:hEKK4O4C -->

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

`delegate` appends `tool_spawn` the moment its child exists, before the child has run a step. It names the child run, and the session for a model child. The call stays parked without a `tool_result` until the child finishes, so this event lets a transcript open the child while it works. It is not replayed to the model, and it never stands in for the result, which the child's finalizer appends later. <!-- id:7F49NC1k -->

`actor` and `meta` are both optional because events predating them exist. Never treat either as required structure. `sessionEventActor()` in the protocol package derives the actor of an older event from its shape (a user-role message is `user`, an error is `system`, everything else is `agent`). `meta` is display detail, absent on older rows. New signed user messages always stamp both the acting Seed `accountId` and the exact `signerId`. They may differ when the account uses an authorized device or delegate signer. Model replay keeps that distinction by prefixing signed human messages with their authoritative `accountId`. For shared agents the system prompt also carries the accepted member roster, roles, and best-effort profile display names. <!-- id:j6h3LrFf -->

Plan updates are **not** durable events. The `plan` verb writes `sessions.plan_cbor` in place, so the plan snapshot carries its own `settledAt` timestamp. <!-- id:8BUVq0H3 -->

Live assistant partials are not persisted here. <!-- id:hVJvv6g6 -->

## `action_idempotency` <!-- id:wyE61ixJ -->

Stores request and response CBOR keyed by account, action, and client ID. <!-- id:sQt2zUpM -->

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

Do not hold write transactions during provider or tool network calls. <!-- id:OivYbqs7 -->

`CreateAgent` and `CreateSession` can use short idempotent transactions. `MessageSession` must avoid long SQLite transactions because it does model and network work. Concurrent collaborators append synchronously through the single service process, then enqueue independently. The run queue serializes model turns per session without delaying event persistence. <!-- id:xhxd1qEb -->

# Improvement areas <!-- id:NV3ktPqh -->

- Move from `MAX(seq)+1` event sequence allocation to a stronger per-session sequence allocator before supporting multiple service processes writing the same database. <!-- id:XAgvn-lC -->
- Add retention and pruning for old events, runs, journals, and idempotency rows. <!-- id:qjLPUmix -->
- Add secret versioning and rotation metadata. <!-- id:fAvMKVFW -->
- Add audit log tables for provider, secret, tool, and security events. <!-- id:-k7byRQx -->
- Add a KMS or keychain option for the secret encryption key. <!-- id:EXFKEj_j -->

# See also

- [System overview](./system-overview.md)
- [Signed API](./signed-api.md)
- [Runs](./runs.md)
- [Log](./log.md)
- [Security](./security.md)
- [Operations](./operations.md)
