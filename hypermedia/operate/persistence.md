---
name: Persistence
summary: "The database schema of the app environment: one SQLite file with a schema gate, a table-by-table reference, its open settings, secret encryption, and the files kept beside it."
---
An [app environment](../software/app-environment.md), the server behind [Seed Agents](../agent.md), keeps its state in one SQLite database. The canonical schema is `apps/src/sqlite-schema.sql`. Open and migration validation live in `apps/src/sqlite.ts`. What an agent publishes as signed [blobs](../protocol/blobs.md) goes to the HM server. This database holds the app environment's own runtime state. This page is the reference for that database, table by table. The concepts the tables store are explained under [agents](../agent.md); each entry links its concept page. <!-- id:DYT_n4RC -->

# Files on disk <!-- id:cXgkgXPk -->

The database path is `./data/agents.sqlite` by default, relative to the working directory, and the data directory is `./data`. They are set with `SEED_APPS_DB_PATH` and `SEED_APPS_DATA_DIR`, or `--db-path` and `--data-dir` (see [configuration](./configuration.md)). The Docker image sets them to `/data/agents.sqlite` and `/data`. A server started from `apps/` keeps: <!-- id:4jlD-xvi -->

```text <!-- id:mvRKXMGP -->
apps/data/agents.sqlite
apps/data/agents.sqlite-shm
apps/data/agents.sqlite-wal
apps/data/agents/<agentId>/
```

SQLite is authoritative for everything except bytes on disk. An agent's state directory is created with the agent and holds its `memory/` filesystem (the `~/memory/` half of its [Space](../agent/space.md)) plus session-private [attachments](../agent/attachment.md). It is removed with the agent. Each session's [durable store](../agent/durable-sessions.md) is in the database, not in this directory. Staged chunked uploads live under the data dir until they are committed or expire. <!-- id:dWWK_HDM -->

A backup is the database file together with the data directory.

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

The encrypted secrets and the encryption key sit in the same DB. That beats plaintext in API responses or logs, but it is weaker than KMS or keychain-backed storage. See [security](../agent/security.md). <!-- id:exECGDvm -->

## `accounts` <!-- id:8jYfBAMc -->

Stores account IDs known to this server. <!-- id:frCqxSmy -->

Rows are created or updated as account-owned resources are written. An account id is a Seed [account](../protocol/identity.md) [principal](../principal.md). <!-- id:iOuECVKn -->

## `account_authorizations` <!-- id:en8YUkFs -->

Stores local delegated signers for an account. <!-- id:DMxxBN5j -->

Columns: `account_id`, `signer_id`, `role`, and for delegations proven by a [capability](../capability.md) blob, `capability` and `capability_cid`. Accepted roles: <!-- id:AUhcLlli -->
  - `OWNER` <!-- id:istckNfK -->
  - `AGENT` <!-- id:7Sxpm7Vh -->

Used by `auth.isAuthorizedSigner()`. A row with role `AGENT` is written when an envelope's capability delegation verifies (see the [signed API](../build/signed-api.md)), which is how a web or device key acts for a vault account. <!-- id:8DmCCEfl -->

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
  authMode?: 'api-key' | 'subscription'
}
```

The `(account_id, name)` pair is unique. See [model providers](../agent/model-providers.md). <!-- id:AA_0_QUV -->

## `secrets` <!-- id:sTmPWMgz -->

Stores encrypted account-scoped secret values. <!-- id:OGDW2bl3 -->

Important columns: <!-- id:S-AAWdDn -->
  - `account_id` <!-- id:VWvA-g9A -->
  - `name` <!-- id:37PKQJw7 -->
  - `ciphertext` <!-- id:tz2wuw4H -->
  - `metadata_cbor` <!-- id:yiL2pe66 -->

Secrets are never returned in plaintext through the API. They hold provider keys, sign-in credentials, MCP header values and the agents' signing keys; see [identity](../agent/identity.md) and [security](../agent/security.md). <!-- id:EcDoqU3q -->

## `agents` <!-- id:Kwjfutzr -->

Stores agent definitions. <!-- id:RNtw1Aty -->

Important columns: <!-- id:OppHXSY2 -->
  - `account_id` <!-- id:oebAwFfP -->
  - `definition_cbor` <!-- id:t9NAtsIu -->
  - `state_dir` <!-- id:SuxIz7up -->
  - `public_read`, `public_chat`: whether any signed account may read, or chat with, the agent <!-- id:bR2JwOTR -->
  - `status` <!-- id:8euzUug0 -->

`definition_cbor` encodes `AgentDefinition`. <!-- id:HGpQYrDd -->

`state_dir` points at the per-agent directory under the service data dir. Its `memory/` subdirectory is the agent's private memory filesystem (see `apps/src/agent-memory.ts`). It is the `~/memory/` half of its [Space](../agent/space.md). The agent reaches it through the [`read`](../agent/read.md) and [`write`](../agent/write.md) verbs, and its owner through the signed agent-memory actions. It lives on disk, outside SQLite, and is removed with the rest of `state_dir` when the agent is deleted. <!-- id:-gYgCaP- -->

Current agent statuses: <!-- id:NAqi4SCE -->
  - `idle` <!-- id:VhhxO0jb -->
  - `running` <!-- id:Qz87bdUx -->
  - `stopped` <!-- id:agXBj4Zt -->
  - `error` <!-- id:gLyK9kT7 -->

Activity rollup (`activity_at`, `activity_kind`, `message_at`, `message_from`, `activity_session_id`): the latest transcript activity across the agent's sessions, written on every appended session event. Tool calls, spawns, and results, and every event of a delegated child session, move only `activity_at` and `activity_kind`. A message from a person, a trigger, or the agent in a top-level session also moves the `message_*` columns and `activity_session_id`. It is exposed as `AgentInfo.activity` together with a `busy` flag derived from live runs, so unread indicators read the agents list and never enumerate sessions. NULL until the first event. <!-- id:9iteVK4p -->

Most runtime work happens at the session level, and the `runs` table holds what is executing. <!-- id:_IjMhSVq -->

## `agent_id_aliases`

Maps an `alias` to an `agent_id`, so an agent stays reachable under an id it had before. Rows are removed with the agent.

## `agent_collaborators` <!-- id:e3TdADGB -->

Stores pending invitations and accepted agent-level access grants, keyed by `(agent_id, account_id)`. The `account_id` is the invited or collaborating Seed account. The agent's owning account stays on `agents.account_id`, and all agent content is still stored under that owner. <!-- id:4UrnT8a7 -->

Important columns: <!-- id:UGC0f3j9 -->
  - `role`: `reader` or `writer`; <!-- id:oAyBLzIa -->
  - `status`: `pending` or `accepted`; <!-- id:m7czTs_k -->
  - `accepted_at`: acceptance time, NULL while pending; <!-- id:5t_8TYy2 -->
  - `created_at`, `updated_at`. <!-- id:dS_KLpBe -->

## `agent_triggers` <!-- id:qcPEzEQt -->

Stores saved agent-scoped [trigger](../agent/triggers.md) definitions: activity triggers, schedule triggers, webhook triggers, and run-completed triggers. <!-- id:Lcnhvxo7 -->

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

`merged_into` marks a trigger retired by combination. It is disabled and immutable, retaining its original firing history. The surviving trigger receives the combined conditions and the selected shared action in one transaction. <!-- id:O7fVX4T5 -->

`continuation_cbor` encodes what a firing does: `{kind: 'newThread', …}`, `{kind: 'wake', signal, runId?, payload?}`, `{kind: 'tool', tool, input?, onFailure?}`, or `{kind: 'script', script, input?, onFailure?}`. NULL means start a new thread. See [triggers](../agent/triggers.md). <!-- id:k2ecZ612 -->

Rows are written by the signed CRUD actions and by the agent itself through `write ~/triggers/<name>` (`writeTriggerAddress`), which honors `enabled` as written. The agent manages its own triggers directly. See [security](../agent/security.md). <!-- id:G0Ps3gr8 -->

The table also carries a `cooldown_ms` column that nothing reads or writes. It is vestigial: no protocol field sets it and no monitor consults it. <!-- id:FMdhJkiz -->

## `trigger_event_claims`

Records `(account_id, trigger_id, activity_key)` for activity admission, so one activity event is admitted once per trigger. Combining imports the union of both triggers' claims; deleting a predecessor does not delete claims already imported into the survivor. Original firing rows keep their IDs and trigger associations even when both predecessors handled the same event. <!-- id:6P304Jsc -->

## `sessions` <!-- id:k-ewoWAb -->

Stores chat-like sessions. <!-- id:ktF8u_Cq -->

Important columns: <!-- id:Ejf_lPGv -->
  - `account_id` <!-- id:cYVVn0XO -->
  - `agent_id` <!-- id:GKRZ2UpZ -->
  - `title` <!-- id:xX5YWsNl -->
  - `title_source` (`system`, `agent`, or `user`) <!-- id:PLBjUJGo -->
  - `status` <!-- id:0MQePZ9f -->
  - `parent_session_id`: set on sessions spawned by another session (model children of [`delegate`](../agent/delegate.md), script children's `ctx.delegate`, and agent-started sessions). Lineage-aware clients exclude rows with a parent from the top-level `ListSessions` view by passing `includeChildren: false` <!-- id:bxVGp7n4 -->
  - `run_id`: the run this session is the transcript of, for sessions created as run children <!-- id:s4aSdsge -->
  - `plan_cbor`: the live checklist written by the [`plan`](../agent/plan.md) verb (a `RunPlan`) <!-- id:1ZMzBqx4 -->
  - `model_override_cbor`: the session's quick-switched provider and model, when it differs from the agent's <!-- id:sjl2EKrl -->
  - `description`: the live status the agent maintains with the `status` verb <!-- id:Shdo5e_p -->
  - `thoroughness`: the session's delegation preset override (`quick`, `normal`, or `deep`) <!-- id:Qf3K5gBg -->

`title_source` protects a title the user typed. Rows start as `system`, `UpdateSession` writes `user`, and `agent` is written when the agent or the automatic namer titles the session. No automatic path overwrites a `user` row. See [session](../agent/session.md). <!-- id:3-r89YEl -->

`plan_cbor` carries `RunPlan`: `{title?, steps: [{id, label, status, resolvedBy?}], settledAt?}`. `resolvedBy` and `settledAt` come from the runtime and never from the model. See [plan](../agent/plan.md) and [step](../agent/step.md). <!-- id:GhYFW3mf -->

Current session statuses: <!-- id:Y7bhU8xC -->
  - `idle` <!-- id:AIwpD2UF -->
  - `streaming` <!-- id:ruJ2ioba -->
  - `stopped` <!-- id:lxiLBz5J -->
  - `error` <!-- id:lr-a7i8F -->

`status` is a **derived mirror** of run state. It is `streaming` iff a non-terminal agent run references the session, `error` when the session's latest run failed, and `idle` otherwise. Canceled runs also mirror to `idle`. The `runs` table holds the truth about liveness, so a crash can never leave a session stuck in `streaming`. <!-- id:D2AGZrqn -->

Deleting a session detaches its rows and does not cascade. Its runs keep their history with `session_id` nulled, and child sessions promote to top level (`parent_session_id` nulled). <!-- id:q1tDrj6T -->

Latest message (`message_at`, `message_from`): the per-session half of the agent rollup above, written on every appended message from a person, a trigger, or the agent in a top-level session. Tool activity and child sessions never move it. Exposed as `SessionInfo.activity`, so a session list can mark which chats hold something unread. <!-- id:wYqb8zHh -->

## `runs` <!-- id:owVHA5ZD -->

Every execution is a durable row in `runs`: an interactive turn, a trigger firing, an agent-started session, a delegated model child, a script child. See [Runs](../agent/runs.md). The table is also the dispatch queue (see `apps/src/runs.ts`). Runs form a tree via `parent_run_id`, with a denormalized `root_run_id` so one [WebSocket subscription](../build/websocket-subscriptions.md) covers a whole tree. <!-- id:J9QpEEMz -->

Important columns: <!-- id:KBSutS-f -->
  - `id`, `account_id`, `root_run_id`, `parent_run_id`, `depth` <!-- id:5EAmAwDS -->
  - `parent_tool_call_id`: the parent's `delegate` call that spawned this run. It is also in the run's input payload, but only a column can be read back without decoding every run. The column lets a delegate row in a transcript find its child _while that child is still working_, before any result exists. <!-- id:ckmeLyT4 -->
  - `continued_from_run_id`: the run this one continues. [`ctx.continueAsNew`](../agent/continue-as-new.md) ends a run and starts a successor that carries only the state it declared, so a day-scale loop never grows an unbounded journal. The two rows are one piece of work. <!-- id:TYylRUY4 -->
  - `kind`: `agent` (a model turn, with a transcript session) or `workflow` (a [script](../agent/script.md) child in the QuickJS engine) <!-- id:JqfAKDTg -->
  - `agent_id`, `session_id` (transcript session for agent runs; NULL for script runs), `trigger_firing_id` <!-- id:EklbAJZc -->
  - `origin`: `user`, `trigger`, `agent`, or `workflow` (`system` is in the type but nothing enqueues it) <!-- id:zvRVgNFS -->
  - `title`, `model` <!-- id:hsCyN0Ht -->
  - `source_cid`, `source_text`: for script runs, the JS module and its `sha256:` digest <!-- id:KJdGZTeX -->
  - `input_cbor`, `output_cbor`, `error_cbor` (`{code, message, retryable?, httpStatus?, stack?, tool?, callSeq?, detail?, unmetObligations?}`; `tool` and `callSeq` join a script's failure to the journaled call, and `stack` frames of `workflow.js:LINE` index into `source_text`) <!-- id:2ap3z4qw -->
  - `status`: `queued`, `claimed`, `running`, `waiting`, `succeeded`, `failed`, `canceled` <!-- id:-cdheKz4 -->
  - `wait_cbor`: why a run is parked, one of four reasons: `children` (spawned children, with `toolCallIds`), `timer` (`wakeAt`), `event` (`ctx.waitForEvent`, with `timeoutAt`), `budget-pause` (it stopped before spending more, with a `note`). See [park](../agent/park.md) and [wake source](../agent/wake-source.md). The wire shape `RunWaitInfo` differs a little: it carries `pendingChildren` (a count) instead of the ids, maps an event wait's `timeoutAt` to `wakeAt` and a budget pause's `note` to `label`, and `answerWith` names the signal that would answer the wait by hand, when one can. <!-- id:FE_KLF0y -->
  - `attempt`, `max_attempts`, `not_before` (backoff or timer wake), `queue` (`interactive` or `background`) <!-- id:rbRG2Dva -->
  - `lease_owner`, `lease_expires_at`: written on claim (the queue instance, and sixty seconds out) and cleared on park or requeue. The expiry is recorded but never read: with one service process, the boot sweep simply requeues every row the previous process left claimed or running <!-- id:SEprW4Bh -->
  - `budget_cbor`, `usage_cbor` (persisted per turn boundary, child usage rolled up into the parent on finalize) <!-- id:H9i6CZmm -->
  - `plan_cbor`: a workflow's own `ctx.step` and `ctx.plan` snapshot, or the immutable copy of a session plan written onto its owning agent run when that plan settles. The copy keeps completed checklist history after the session starts a new mutable plan <!-- id:SszS3VLK -->

A run's `output_cbor` or `error_cbor` may also carry `unmetObligations`: what the run committed to and had not delivered when it ended. That is an undelivered [typed result](../agent/typed-result.md) (`{kind: 'typed-result'}`), or plan steps left neither finished nor written off (`{kind: 'plan', steps}`). See [runs](../agent/runs.md). <!-- id:0g9nHuH1 -->

Deleting a trigger detaches its runs (`trigger_firing_id` nulled) before deleting firings. <!-- id:fYlkMgPD -->

## `run_event_waits` <!-- id:Yp8kmeEv -->

One row per outstanding `ctx.waitForEvent`: `(run_id, wait_id)` primary key plus `account_id`, `match_cbor` (the wait criteria: a `{signal}` for a person or system answering, or `{eventType, resource, author}` for the activity feed), `timeout_at`, and `created_at`, indexed by `(account_id, created_at)`. <!-- id:_cnNE1la -->

A wait is transient run state, not configuration, so it has its own table and is not a marker on `agent_triggers`. A running script creates the row, and it is deleted the moment the wait is delivered, times out, or its run dies. See [park](../agent/park.md) and [wake source](../agent/wake-source.md). <!-- id:j-cdZ4lN -->

## `mcp_servers` <!-- id:Qid3zZGO -->

One row per remote [MCP server](../agent/mcp.md) an account has connected, unique on `(account_id, name)`: `id`, `config_cbor` (`{url, transport?, headers?, secretRefs?}`; secret header values live in `secrets` under the `mcp-<name>-<header>` convention and are referenced by name), `tools_cbor` (the `McpToolInfo[]` from the last **successful** discovery, kept across a later failed refresh), `status_cbor` (`{state, error?, checkedAt?}`), timestamps. Agents reference servers by name from `definition.mcpServers`. Deleting a server scrubs those references, the projected documents, and its owned secrets. See [`mcp.md`](../agent/mcp.md). <!-- id:2mYeVV8g -->

## `tool_documents` <!-- id:ENCjNUXP -->

Every tool an agent holds is a content-addressed [tool document](../agent/tool-document.md), one row per `(account_id, agent_id, name)`: `kind` (`builtin`, `lambda`, or `mcp`), `cid`, `doc_cbor`, `enabled`, timestamps. <!-- id:1FRih0_f -->

`doc_cbor` is the canonical DAG-CBOR encoding of a `ToolDocument` (`apps/src/tool-documents.ts`): `{name, kind, summary, description, input, output?, source?, runtime?, binding?, server?, remoteName?}`. `cid` is the [CIDv1](../cid.md) over exactly those bytes, the same encoding the hypermedia network uses for blobs. The CID is the tool's version. It changes on every edit. <!-- id:oKNZJ5i3 -->

Builtin rows are materialized (and refreshed when the shipped registry contract changes, detected by CID mismatch) by `ensureBuiltinToolDocuments`, which runs whenever the Space index or a `~/tools` listing is built and on `ListAgentTools`. Builtins carry a `binding` (the runtime executor id) and no source. `lambda` rows hold authored source from an earlier design: nothing in the service creates them, and the server moves an agent's lambdas into its memory under `tools/<name>/` and removes the rows. Builtins cannot be deleted. They are withheld through the agent's [grants](../agent/grants.md) instead. <!-- id:lWMq9D5P -->

`mcp` rows are projections of `mcp_servers.tools_cbor` filtered by the agent's `definition.mcpServers`, named `<server>__<tool>` and carrying `server` and `remoteName`. `syncMcpToolDocuments` reconciles them (rewrite on CID change, delete when the server is disabled or gone) eagerly on agent and server writes and opportunistically on every listing and run start. They cannot be deleted or replaced by a lambda. A lambda that already holds the name wins. <!-- id:JIVPpvvD -->

## `agent_drafts` <!-- id:EtofX1F7 -->

Hypermedia write [drafts](../protocol/documents.md) (`write hm://…` with `options.action: 'draft.create'` and friends): per-account rows holding the draft content as CBOR (`content_format` + `content_cbor`), optional `metadata_cbor`, the signing identity (`signer_secret_name`), and the edit and location targets the draft will publish against. Indexed by account + `updated_at`, by agent, and by `status`. <!-- id:bilvz92M -->

## `run_journal` <!-- id:5paw7ekv -->

Append-only [journal](../agent/journal.md) for script (workflow) runs. It makes replay-from-top resume safe. Rows are `(run_id, seq, entry_cbor, created_at)` with `seq` monotonic per run (the count of the run's entries plus one at append). Each entry carries a `callSeq` that ties together the entries of one `ctx` call (`call` and `result`, `timer` and `fired`, `wait` and `event`; the `(run_id, seq)` primary key cannot repeat). The first entry of each group also carries a `key`, the effect's deterministic content key (`tool|name|inputJSON`, `agent|specJSON`, `sleep|ms`, …), which replay matches on; the [journal](../agent/journal.md) page explains replay. Entry kinds: `call`, `result`, `timer`, `fired`, `wait`, `event`, `now`, `log`, `step`, `plan` (see `WorkflowJournalEntry` in `apps/src/workflow-host.ts`). A call entry may carry a `description`, display metadata that stays out of the key. Caps: 5,000 entries or 8 MiB per run, after which the run fails `journal-cap`. [Retention](./database-retention.md) cuts the large payloads of finished runs to previews. Entries are streamed to `runs/<rootRunId>` subscribers as `append` events and replayed on subscribe. <!-- id:v46sJNRU -->

## `session_continuations` <!-- id:9Xgpa9dY -->

One row per continuation edge created by `continue_session`: the predecessor and successor sessions, the origin session of the chain, the tool call and initiating event, the `reason`, and `manifest_cbor`, the successor's exact starting point (handoff, cited sources, what was loaded and what was left cold). A successor has exactly one row, and `(predecessor_session_id, tool_call_id)` is unique so a retried call cannot create a second successor. The [session continuation](../agent/session-continuation.md) page describes the manifest. <!-- id:_dzv470k -->

## `webhook_trigger_credentials` <!-- id:TtGHJCLW -->

One row per webhook trigger: `secret_hash`, which delivery requests are checked against, and `secret_ciphertext`, the encrypted secret that `GetAgentTrigger` returns to editors. The secret is created with the trigger. See [triggers](../agent/triggers.md). <!-- id:lJhN6P_Y -->

## `trigger_firings` <!-- id:uumzqV0y -->

Tracks activity events or scheduled occurrences that matched a trigger and the sessions created from those matches. The activity and schedule monitors use this table for durable idempotency and trigger session history. <!-- id:7O3A-Snl -->

Important columns: <!-- id:ANfEJZZZ -->
  - `account_id` <!-- id:_8uhovWA -->
  - `agent_id` <!-- id:DU-zPqMg -->
  - `trigger_id` <!-- id:UqkJ_5oc -->
  - `activity_key` <!-- id:r89Qat-g -->
  - `session_id` <!-- id:xrmU1MzV -->
  - `run_id`: the headless run a `tool` or `script` continuation started <!-- id:7YSpiFUR -->
  - `activity_cbor` <!-- id:k7sPpiN5 -->
  - `context_cbor`: the snapshot of the trigger's name, prompt, and matched conditions at admission. Session attribution reads that snapshot instead of the current configuration; a firing without one falls back to the trigger's current view <!-- id:fSLM683o -->
  - `body_digest`: a webhook body's digest, so a reused `Idempotency-Key` with a different body is refused <!-- id:2lL7K56C -->
  - `status` <!-- id:s90Evv96 -->
  - `error` <!-- id:bR4PVqOd -->

`(account_id, trigger_id, activity_key)` is unique so feed retries or schedule monitor retries cannot create duplicate firings for the same trigger. Activity firings are admitted through `trigger_event_claims` first (see `agent_triggers` above); schedule, webhook, and run-completed firings dedupe on this row alone. Schedule triggers use stable keys in the form `schedule:<triggerId>:<scheduledAt>`, webhooks `webhook:<Idempotency-Key>` (or a random key when the sender sends none). <!-- id:7nrxtaqU -->

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
  - `pi_entry_id`: the entry of the session's [durable store](../agent/durable-sessions.md) this event was projected from, or NULL for an event anything else wrote <!-- id:8gwpEAQM -->

`seq` is monotonic per session, allocated as the session's highest `seq` plus one, which assumes a single service process writes the database. Events are returned by `GetSession` and replayed on session WebSocket subscriptions; both take `afterSeq` and return the events after it (see the [signed API](../build/signed-api.md)). <!-- id:Z2L22h8_ -->

This is the [Log](../agent/log.md). Every entry has an [`actor`](../agent/actor.md) that says who did it. Only `user` and `system` are ever stamped on the row; the agent's own messages and tool calls carry no `actor` and derive `agent` from their shape, and a message a trigger started is a `user` message. <!-- id:hEKK4O4C -->

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
  reasoningLevel?: ReasoningLevel | 'off' | 'default'
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

`delegate` appends `tool_spawn` the moment its child exists, naming the child run, and the session for a model child. It is not replayed to the model, and it never stands in for the `tool_result`. See [delegate](../agent/delegate.md). <!-- id:7F49NC1k -->

`actor` and `meta` are both optional: the agent's own events are never stamped, and some stored rows carry neither. Never treat either as required structure. `sessionEventActor()` in the protocol package derives the actor of an unstamped event from its shape (a user-role message is `user`, an error is `system`, everything else is `agent`). `trigger` is declared in the type and never written. `meta` is display detail. Signed user messages stamp both the acting Seed `accountId` and the exact `signerId`. They may differ when the account uses an authorized device or delegate signer. <!-- id:j6h3LrFf -->

Plan updates are **not** durable events. The `plan` verb writes `sessions.plan_cbor` in place, so the plan snapshot carries its own `settledAt` timestamp. <!-- id:8BUVq0H3 -->

Live assistant partials are not persisted here. <!-- id:hVJvv6g6 -->

## `session_durable_files`

Each session has a [Pi Durable](../agent/durable-sessions.md) store, kept in the `session_durable_files` table. Its columns are `session_id`, `file`, `seq`, and `data`. The store is Pi Durable's own set of append-only JSONL files, and each file is the `data` of its rows read in `seq` order. An append inserts one row. A file that has collected many rows is rewritten as one row the next time it is read, which is once per turn. The rows reference `sessions` with `ON DELETE CASCADE`. <!-- id:DTWUpd64 -->

The log in `session_events` stays the canonical record, and a store that is missing is rebuilt from it on the session's next turn. The two are tied together by `session_events.pi_entry_id` on one side and the store's `seed.sync` document on the other. [Durable sessions](../agent/durable-sessions.md) says what the store holds, and [retention](./database-retention.md) when an idle session's store is dropped. <!-- id:WXHg7ar_ -->

Deleting a session deletes its store. A backup of the database includes every store. <!-- id:Wu9rrQqz -->

## `transcript_privacy`

Reader privacy per transcript, keyed by `(kind, id)` where `kind` is `session` or `run`. `private` is set once any event or journal entry up to `scanned_seq` carried browser or private-memory data. `sessions_json` and `runs_json` list the sessions and runs the scanned entries read from, whose privacy the transcript inherits.

## `action_idempotency` <!-- id:wyE61ixJ -->

Stores request and response CBOR keyed by account, action, and client ID. <!-- id:sQt2zUpM -->

Used by: <!-- id:1-pLN2bq -->
  - `CreateAgent.clientRequestId` <!-- id:5S91YEt2 -->
  - `CreateAgentTrigger.clientRequestId` <!-- id:ECizc0Ax -->
  - `CreateSigningIdentity.clientRequestId` <!-- id:b9ZgTYVF -->
  - `CreateSession.clientRequestId` <!-- id:4UzSr3of -->
  - `MessageSession.clientMessageId` <!-- id:iwI-KDbN -->

Same client ID with identical request bytes replays the response. Same client ID with different request bytes returns `409`. <!-- id:xDb-SvJk -->

## `effect_outbox`

The intent and receipt of every side effect a tool call performs; see the [effect outbox](../agent/effect-outbox.md). One row per call, `id` = `<session_id>:<tool_call_id>`, with `account_id`, `session_id` (cascades on session delete), `run_id`, `tool_call_id`, `tool`, `kind` (`publish`, `memory-write`, `execute`, `delegate`, `call:<name>`, and so on), `input_digest` (SHA-256 of the call's arguments), `status` (`running`, `succeeded`, `failed`, `interrupted`), `attempt`, `lease_owner` and `lease_expires_at` (the process running it), `response_cbor` (the receipt: the text and details the tool returned), `error`, `created_at`, `updated_at`, `completed_at`. The row is inserted and committed before the effect begins and settled when it ends. The boot sweep marks every `running` row `interrupted`; settled rows are pruned after two days.

## `app_runs`

One row per [app](../app.md) running on this server: `app_id`, `space_uid`, `started_by` (the account that started it), `private_config_ciphertext` (its private config, encrypted), `created_at`, `updated_at`.

## `app_tool_calls`

Every call of a running app's tools: `id`, `app_id`, `tool_id`, `caller`, `tool_version`, `input_json`, `output_json`, `error`, `duration_ms`, `created_at`, indexed by `(tool_id, created_at)`. Anyone who can read the tool can read its calls.

# Open settings and planner statistics <!-- id:VGWqFzrf -->

Every open sets `journal_mode=WAL`, `synchronous=NORMAL` and `temp_store=MEMORY`, and applies three sizes from [configuration](./configuration.md): the page cache (`SEED_APPS_SQLITE_CACHE_MIB`, 256 MiB by default), memory-mapped reads (`SEED_APPS_SQLITE_MMAP_MIB`, 1024 MiB by default, capped by SQLite's compiled maximum) and the size the WAL file is truncated back to after a checkpoint (`SEED_APPS_SQLITE_WAL_LIMIT_MIB`, 64 MiB). The startup log prints the values in effect. Every SQLite statement runs on the server's only thread, so a read that misses the cache blocks everything else; the cache and the mapping keep hot reads in memory.

Every open also runs `ANALYZE` on the small planner tables (`PLANNER_STATISTICS_TABLES`: accounts, agents, collaborators, triggers, runs, sessions, continuations and firings), deliberately leaving out `session_events` and `run_journal`. Without statistics the planner rates every candidate index alike and can pick the account-wide index for a per-session run lookup; the hot queries also pin their index with `INDEXED BY`. Nothing runs `VACUUM`; see [database retention](./database-retention.md). <!-- id:afAY8b18 -->

# Secret encryption <!-- id:Mm3c29X6 -->

Implementation: `encryptSecret()` and `decryptSecret()` in `api-service.ts`. <!-- id:dxI-WpyJ -->

Current scheme: <!-- id:YUGhL6E1 -->
  - AES-GCM; <!-- id:XUp42Aad -->
  - 32-byte server-local key; <!-- id:Cux_dY-p -->
  - 12-byte random nonce per write; <!-- id:HEJUY1cA -->
  - stored ciphertext is `nonce || encryptedBytes || tag`, with the 16-byte GCM authentication tag last (`aes-256-gcm`). <!-- id:JHUEh3sA -->

The key is the `secret_encryption_key_v1` row of `server_config`. Secrets carry no version or rotation metadata, and there is no KMS or keychain option for the key. [Security](../agent/security.md) covers what this protects against.

# Transaction policy <!-- id:vdysksJ3 -->

Do not hold write transactions during provider or tool network calls. <!-- id:OivYbqs7 -->

`CreateAgent` and `CreateSession` can use short idempotent transactions. `MessageSession` must avoid long SQLite transactions because it does model and network work. Concurrent collaborators append synchronously through the single service process, then enqueue independently. The run queue serializes model turns per session without delaying event persistence. <!-- id:xhxd1qEb -->

# See also <!-- id:k2bxwaw_ -->

- [How agents work](../agent/how-it-works.md) <!-- id:J8bWdg5Q -->
- [Signed API](../build/signed-api.md) <!-- id:Axl4bTkZ -->
- [Runs](../agent/runs.md) <!-- id:Rk2fkzzC -->
- [Log](../agent/log.md) <!-- id:Aa-ObMEx -->
- [Session](../agent/session.md)
- [Journal](../agent/journal.md)
- [Identity](../agent/identity.md)
- [Durable sessions](../agent/durable-sessions.md) <!-- id:LAZPp-8q -->
- [Effect outbox](../agent/effect-outbox.md)
- [Security](../agent/security.md) <!-- id:7k0_A0Pk -->
- [Database retention](./database-retention.md)
- [Configuration](./configuration.md)
- [Operations](./operations.md) <!-- id:shyewYK8 -->
