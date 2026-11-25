---
name: Persistence
summary: This page lists every table and column of the one SQLite file an app environment keeps its state in, and explains the schema check at startup, the open settings, how secrets are encrypted, and the files kept beside the database.
---
An [app environment](../software/app-environment.md) keeps its state in one SQLite file. This page lists every table in it, with the exact column names, so you can query the file or read a backup. <!-- id:DYT_n4RC -->

The first thing to check: the schema is in `apps/src/sqlite-schema.sql`, and that file is the source of every name here. The code that opens the database and runs migrations is `apps/src/sqlite.ts`.

What an agent publishes does not live here. It goes to the HM server as signed [blobs](../protocol/blobs.md). This database holds only the server's own working state. The ideas behind the tables are explained under [agents](../agent.md), and each table below links its concept page.

# Files on disk <!-- id:cXgkgXPk -->

By default the database is `./data/agents.sqlite` and the data directory is `./data`, both relative to the working directory. You set them with `SEED_APPS_DB_PATH` and `SEED_APPS_DATA_DIR`, or with `--db-path` and `--data-dir`; see [configuration](./configuration.md). The Docker image sets them to `/data/agents.sqlite` and `/data`. A server started from `apps/` keeps: <!-- id:4jlD-xvi -->

```text <!-- id:mvRKXMGP -->
apps/data/agents.sqlite
apps/data/agents.sqlite-shm
apps/data/agents.sqlite-wal
apps/data/agents/<agentId>/
```

The database is the record of everything except the files on disk: <!-- id:dWWK_HDM -->

- `agents/<agentId>/` is one agent's state directory. The server creates it with the agent and removes it with the agent. It holds the agent's `memory/` files, which are the `~/memory/` half of its [Space](../agent/space.md), and the [attachments](../agent/attachment.md) that are private to a session.
- `server-id` holds the stable id that health reports as `serverId`.
- `exec-probe/` is a work directory for the exec canary; see the [code execution backend](./code-execution-backend.md#is-code-execution-working).
- Uploads that arrive in chunks are staged under the data directory until they are committed or expire.

Each session's [durable store](../agent/durable-sessions.md) is in the database, not in these directories.

A backup is the database file together with the data directory.

# Schema gate <!-- id:lgiSEokt -->

The server never runs on a database whose schema it does not know. When it starts, `sqlite.open()` does one of three things: <!-- id:2_LU9c3d -->
  - It creates a new database from `sqlite-schema.sql` and stamps it with `desiredVersion`. <!-- id:V1m1E6il -->
  - It opens a database at or behind the wanted version and applies the migrations that are missing. <!-- id:xo8ZSgZb -->
  - It rejects the database. This happens when the version is unknown, cannot be parsed, or is newer than this binary. It also happens when the database is from before versions were tracked: it has the older `schema_version` key, or no `server_config` table at all. <!-- id:dtQ5gnzT -->

When the database is rejected, `main.ts` answers `500` on every route and logs both versions. [Troubleshooting](./troubleshooting.md#schema-mismatch) says what to do. <!-- id:Cxj6ftns -->

Migrations live in the `migrations` array in `sqlite.ts`. The rules for people who add one: <!-- id:hd8VJE3g -->

- The array is **prepend-only**. A new migration goes at the top of the literal, and the code reverses the array. So the index order is the order they are applied in, and `desiredVersion` is `migrations.length`.
- Each migration runs inside its own savepoint, and all of them run in one transaction. If one fails, the whole batch is rolled back.
- `sqlite-schema.sql` is what a new install gets. It must stay equal to the baseline plus every migration.

# Tables <!-- id:6sX7nWzL -->

## `server_config` <!-- id:I2FSAlh0 -->

Holds values that belong to this server alone. Columns: `key`, `value`. <!-- id:Wq6WHwVL -->

The keys: <!-- id:KmXMNCOC -->
  - `secret_encryption_key_v1`: the AES-GCM key for encrypted secrets. <!-- id:yX_cmm70 -->
  - `schema_migration_version`: the number the schema gate reads.
  - `retention.durable.watermark` and `retention.journal.watermark`: where the [retention](./database-retention.md) task left off.

The encrypted secrets and their key sit in the same database. That is better than plain text in API responses or logs. It is weaker than a key kept in a key management service or a system keychain. See [security](../agent/security.md). <!-- id:exECGDvm -->

## `accounts` <!-- id:8jYfBAMc -->

Holds the account IDs this server knows. Columns: `id`, `created_at`, `updated_at`. <!-- id:frCqxSmy -->

The server adds or updates a row when it writes something an account owns. An account id is the [principal](../principal.md) of a Seed [account](../protocol/identity.md). <!-- id:iOuECVKn -->

## `account_authorizations` <!-- id:en8YUkFs -->

Holds the keys that may sign for an account on this server. The primary key is `(account_id, signer)`. <!-- id:DMxxBN5j -->

Columns: `account_id`, `signer`, `role`, `created_at`, and, when a [capability](../protocol/permissions.md) blob proves the delegation, `capability` and `capability_cid`. The [capability](../capability.md) page lists that blob's fields. Accepted roles: <!-- id:AUhcLlli -->
  - `OWNER` <!-- id:istckNfK -->
  - `AGENT` <!-- id:7Sxpm7Vh -->

`auth.isAuthorizedSigner()` reads this table. The server writes a row with role `AGENT` when the capability in a signed request checks out; see the [signed API](../build/signed-api.md). This is how a key in a browser or on a device acts for an account kept in the [vault](../software/vault.md). <!-- id:8DmCCEfl -->

## `model_providers` <!-- id:VXoNLYPE -->

Holds each account's model provider settings. <!-- id:9NUHE0IW -->

Columns, besides `id`, `created_at` and `updated_at`: <!-- id:Q01M8fxi -->
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

Holds each account's secret values, encrypted. The `(account_id, name)` pair is unique. <!-- id:OGDW2bl3 -->

Columns, besides `id`, `created_at` and `updated_at`: <!-- id:S-AAWdDn -->
  - `account_id` <!-- id:VWvA-g9A -->
  - `name` <!-- id:37PKQJw7 -->
  - `ciphertext` <!-- id:tz2wuw4H -->
  - `metadata_cbor` <!-- id:yiL2pe66 -->

The API never returns a secret in plain text. The secrets are provider keys, sign-in credentials, MCP header values and the agents' signing keys; see [identity](../agent/identity.md) and [security](../agent/security.md). <!-- id:EcDoqU3q -->

## `agents` <!-- id:Kwjfutzr -->

Holds one row per agent. <!-- id:RNtw1Aty -->

Columns, besides `id`, `created_at`, `updated_at` and the activity columns described below: <!-- id:OppHXSY2 -->
  - `account_id` <!-- id:oebAwFfP -->
  - `definition_cbor` <!-- id:t9NAtsIu -->
  - `state_dir` <!-- id:SuxIz7up -->
  - `public_read`, `public_chat`: whether any signed account may read, or chat with, the agent <!-- id:bR2JwOTR -->
  - `status` <!-- id:8euzUug0 -->

`definition_cbor` encodes `AgentDefinition`. <!-- id:HGpQYrDd -->

`state_dir` is the path of the agent's directory under the data directory. Its `memory/` subdirectory holds the agent's memory files (see `apps/src/agent-memory.ts`), the `~/memory/` half of its [Space](../agent/space.md). The agent reaches them through the [`read`](../agent/read.md) and [`write`](../agent/write.md) verbs. Its owner reaches them through the signed agent-memory actions. The files are on disk, not in SQLite. The server removes them with the rest of `state_dir` when the agent is deleted. <!-- id:-gYgCaP- -->

Current agent statuses: <!-- id:NAqi4SCE -->
  - `idle` <!-- id:VhhxO0jb -->
  - `running` <!-- id:Qz87bdUx -->
  - `stopped` <!-- id:agXBj4Zt -->
  - `error` <!-- id:gLyK9kT7 -->

The activity columns are `activity_at`, `activity_kind`, `message_at`, `message_from` and `activity_session_id`. They hold the latest activity across all of the agent's sessions, and they are NULL until the first event. The server writes them every time it adds a session event: <!-- id:9iteVK4p -->

- A tool call, a spawn, a tool result, or any event of a delegated child session moves only `activity_at` and `activity_kind`.
- A message from a person, a trigger or the agent in a top-level session also moves `message_at`, `message_from` and `activity_session_id`.

The API returns these as `AgentInfo.activity`, with a `busy` flag that comes from the live runs. So a client can show unread marks from the list of agents, without reading every session.

Most work happens in sessions, and the `runs` table holds what is executing. <!-- id:_IjMhSVq -->

## `agent_id_aliases`

Maps an `alias` to an `agent_id`, so an agent stays reachable under an id it had before. Rows are removed with the agent.

## `agent_collaborators` <!-- id:e3TdADGB -->

Holds the invitations to an agent and the access people have accepted. The primary key is `(agent_id, account_id)`. Here `account_id` is the invited account. The owner of the agent stays in `agents.account_id`, and everything the agent holds is still stored under that owner. <!-- id:4UrnT8a7 -->

The other columns: <!-- id:UGC0f3j9 -->
  - `role`: `reader` or `writer`; <!-- id:oAyBLzIa -->
  - `status`: `pending` or `accepted`; <!-- id:m7czTs_k -->
  - `accepted_at`: acceptance time, NULL while pending; <!-- id:5t_8TYy2 -->
  - `created_at`, `updated_at`. <!-- id:dS_KLpBe -->

## `agent_triggers` <!-- id:qcPEzEQt -->

Holds the [triggers](../trigger.md) this server runs: activity, schedule, webhook and run-completed triggers. A trigger belongs to an agent or to an app, so a row has `agent_id` or `app_id`, and the table refuses a row with neither. [Triggers](../agent/triggers.md) is the reference for what a trigger can do. <!-- id:Lcnhvxo7 -->

Columns, besides `id`, `created_at` and `updated_at`: <!-- id:SZNhzQWh -->
  - `account_id` <!-- id:Hjoch3-2 -->
  - `agent_id`: the agent the trigger belongs to, or NULL for an app's trigger <!-- id:1FRCuhrX -->
  - `app_id`: the app the trigger belongs to, or NULL for an agent's trigger
  - `document_id`, `document_version`: the trigger document this row was made from and its version. `document_id` is NULL for a trigger stored only on this server, and it is unique
  - `author`: the account whose trigger it is
  - `name` <!-- id:yhvT7nLH -->
  - `enabled` <!-- id:jLPXT2nW -->
  - `source_cbor` <!-- id:ctG5GIZj -->
  - `prompt` <!-- id:eEHz2x6q -->
  - `continuation_cbor` <!-- id:qIG3vkc3 -->
  - `last_checked_at` <!-- id:KqX-K7_B -->
  - `last_fired_at` <!-- id:n5f1z_MO -->
  - `last_error` <!-- id:NiOPT991 -->
  - `merged_into`, `cooldown_ms`: described below

`source_cbor` holds an `AgentTriggerSource`. The kinds are document-comment, user-mention, comment-reply, document-author-comment, site-update, activity, schedule, webhook and run-completed. <!-- id:DySCuqjj -->

- An activity source holds a list of one or more `{id, source}` alternatives, limited to the activity filters. Older rows with a single source stay valid as they are.
- A schedule trigger keeps its interval, its weekly days and time, or its one-time run inside this value. There is no separate schedule table.

`merged_into` marks a trigger that was combined into another one. Such a row is disabled and cannot be changed, and it keeps its own firing history. The trigger that survives gets the combined conditions and the chosen action in one transaction. <!-- id:O7fVX4T5 -->

`continuation_cbor` holds what a firing does: `{kind: 'newThread', …}`, `{kind: 'wake', signal, runId?, payload?}`, `{kind: 'tool', tool, input?, onFailure?}`, or `{kind: 'script', script, input?, onFailure?}`. NULL means start a new thread. See [triggers](../agent/triggers.md). <!-- id:k2ecZ612 -->

Three things write rows: <!-- id:G0Ps3gr8 -->

- the signed create, update and delete actions;
- the agent itself, through `write ~/triggers/<name>` (`writeTriggerAddress`), which keeps `enabled` as the agent wrote it;
- the trigger document task, which turns a trigger document under an agent or an app on this server into a row.

An agent manages its own triggers directly; see [security](../agent/security.md).

Nothing reads or writes `cooldown_ms`. No protocol field sets it and no monitor looks at it. <!-- id:FMdhJkiz -->

## `trigger_event_claims`

Makes sure one activity event is let in only once per trigger. Columns: `account_id`, `trigger_id`, `activity_key`, which together are the primary key. <!-- id:6P304Jsc -->

When two triggers are combined, the survivor gets the claims of both. Deleting one of the old triggers does not delete the claims the survivor already got. The old firing rows keep their IDs and their trigger, even when both old triggers handled the same event.

## `sessions` <!-- id:k-ewoWAb -->

Holds one row per [session](../agent/session.md), which is one conversation with an agent. <!-- id:ktF8u_Cq -->

Columns, besides `id`, `created_at`, `updated_at` and the message columns described below: <!-- id:Ejf_lPGv -->
  - `account_id` <!-- id:cYVVn0XO -->
  - `agent_id` <!-- id:GKRZ2UpZ -->
  - `title` <!-- id:xX5YWsNl -->
  - `title_source` (`system`, `agent`, or `user`) <!-- id:PLBjUJGo -->
  - `status` <!-- id:0MQePZ9f -->
  - `parent_session_id`: set when another session started this one. That covers model children of [`delegate`](../agent/delegate.md), the children a script starts with `ctx.delegate`, and sessions an agent starts. A client passes `includeChildren: false` to `ListSessions` to leave rows with a parent out of the top-level list <!-- id:bxVGp7n4 -->
  - `run_id`: the run this session is the transcript of, for sessions created as run children <!-- id:s4aSdsge -->
  - `plan_cbor`: the live checklist written by the [`plan`](../agent/plan.md) verb (a `RunPlan`) <!-- id:1ZMzBqx4 -->
  - `model_override_cbor`: the session's quick-switched provider and model, when it differs from the agent's <!-- id:sjl2EKrl -->
  - `description`: the live status the agent maintains with the `status` verb <!-- id:Shdo5e_p -->
  - `thoroughness`: the session's delegation preset override (`quick`, `normal`, or `deep`) <!-- id:Qf3K5gBg -->

`title_source` protects a title a person typed. A row starts as `system`. `UpdateSession` writes `user`. The value becomes `agent` when the agent or the automatic namer titles the session. Nothing automatic changes the title of a `user` row. See [session](../agent/session.md). <!-- id:3-r89YEl -->

`plan_cbor` carries `RunPlan`: `{title?, steps: [{id, label, status, resolvedBy?}], settledAt?}`. `resolvedBy` and `settledAt` come from the runtime and never from the model. See [plan](../agent/plan.md) and [step](../agent/step.md). <!-- id:GhYFW3mf -->

Current session statuses: <!-- id:Y7bhU8xC -->
  - `idle` <!-- id:AIwpD2UF -->
  - `streaming` <!-- id:ruJ2ioba -->
  - `stopped` <!-- id:lxiLBz5J -->
  - `error` <!-- id:lr-a7i8F -->

The server never sets `stopped` on a session. The type allows it, and that is all.

`status` is a **copy** of the state of the session's runs. The `runs` table holds the truth, so a crash can never leave a session stuck in `streaming`: <!-- id:D2AGZrqn -->

- `streaming` if, and only if, an agent run that has not ended points at the session;
- `error` when the session's latest run failed;
- `idle` in every other case, including after a canceled run.

Deleting a session does not delete the rows that point at it. Its runs keep their history with `session_id` set to NULL. Its child sessions become top-level sessions, with `parent_session_id` set to NULL. <!-- id:q1tDrj6T -->

`message_at` and `message_from` hold the session's latest message. The server writes them for every message from a person, a trigger or the agent in a top-level session. Tool activity and child sessions never move them. The API returns them as `SessionInfo.activity`, so a list of sessions can mark the ones with something unread. <!-- id:wYqb8zHh -->

## `runs` <!-- id:owVHA5ZD -->

Holds one row for every piece of work the server executes: an interactive turn, a trigger firing, a session an agent started, a delegated model child, a script child. See [runs](../agent/runs.md). The table is also the queue the server takes work from (see `apps/src/runs.ts`). Runs form a tree through `parent_run_id`. Each row also carries `root_run_id`, so one [WebSocket subscription](../build/websocket-subscriptions.md) covers a whole tree. <!-- id:J9QpEEMz -->

Columns: <!-- id:KBSutS-f -->
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
  - `created_at`, `started_at`, `finished_at`, `updated_at`

A run's `output_cbor` or `error_cbor` may also carry `unmetObligations`: what the run committed to and had not delivered when it ended. That is an undelivered [typed result](../agent/typed-result.md) (`{kind: 'typed-result'}`), or plan steps left neither finished nor written off (`{kind: 'plan', steps}`). See [runs](../agent/runs.md). <!-- id:0g9nHuH1 -->

Deleting a trigger detaches its runs (`trigger_firing_id` nulled) before deleting firings. <!-- id:fYlkMgPD -->

## `run_event_waits` <!-- id:Yp8kmeEv -->

One row per outstanding `ctx.waitForEvent`: `(run_id, wait_id)` primary key plus `account_id`, `match_cbor` (the wait criteria: a `{signal}` for a person or system answering, or `{eventType, resource, author}` for the activity feed), `timeout_at`, and `created_at`, indexed by `(account_id, created_at)`. <!-- id:_cnNE1la -->

A wait is transient run state, not configuration, so it has its own table and is not a marker on `agent_triggers`. A running script creates the row, and it is deleted the moment the wait is delivered, times out, or its run dies. See [park](../agent/park.md) and [wake source](../agent/wake-source.md). <!-- id:j-cdZ4lN -->

## `mcp_servers` <!-- id:Qid3zZGO -->

One row per remote [MCP server](../agent/mcp.md) an account has connected, unique on `(account_id, name)`: `id`, `config_cbor` (`{url, transport?, headers?, secretRefs?}`; secret header values live in `secrets` under the `mcp-<name>-<header>` convention and are referenced by name), `tools_cbor` (the `McpToolInfo[]` from the last **successful** discovery, kept across a later failed refresh), `status_cbor` (`{state, error?, checkedAt?}`), timestamps. Agents reference servers by name from `definition.mcpServers`. Deleting a server scrubs those references, the projected documents, and its owned secrets. See [`mcp.md`](../agent/mcp.md). <!-- id:2mYeVV8g -->

## `tool_documents` <!-- id:ENCjNUXP -->

Every tool an agent holds is a content-addressed [tool document](../agent/tool-document.md), one row per `(account_id, agent_id, name)`: `kind` (`builtin`, `lambda`, or `mcp`), `cid`, `doc_cbor`, `enabled`, timestamps. <!-- id:1FRih0_f -->

`doc_cbor` is the canonical [DAG-CBOR](../schema/dag-cbor.md) encoding of a `ToolDocument` (`apps/src/tool-documents.ts`): `{name, kind, summary, description, input, output?, source?, runtime?, binding?, server?, remoteName?}`. `cid` is the [CIDv1](../cid.md) over exactly those bytes, the same encoding the hypermedia network uses for blobs. The CID is the tool's version. It changes on every edit. <!-- id:oKNZJ5i3 -->

Builtin rows are materialized (and refreshed when the shipped registry contract changes, detected by CID mismatch) by `ensureBuiltinToolDocuments`, which runs whenever the Space index or a `~/tools` listing is built and on `ListAgentTools`. Builtins carry a `binding` (the runtime executor id) and no source. `lambda` rows hold authored source from an earlier design: nothing in the service creates them, and the server moves an agent's lambdas into its memory under `tools/<name>/` and removes the rows. Builtins cannot be deleted. They are withheld through the agent's [grants](../agent/grants.md) instead. <!-- id:lWMq9D5P -->

`mcp` rows are projections of `mcp_servers.tools_cbor` filtered by the agent's `definition.mcpServers`, named `<server>__<tool>` and carrying `server` and `remoteName`. `syncMcpToolDocuments` reconciles them (rewrite on CID change, delete when the server is disabled or gone) eagerly on agent and server writes and opportunistically on every listing and run start. They cannot be deleted or replaced by a lambda. A lambda that already holds the name wins. <!-- id:JIVPpvvD -->

## `agent_drafts` <!-- id:EtofX1F7 -->

Holds the [document](../protocol/documents.md) drafts an agent keeps before it publishes them. An agent makes one with `write hm://…` and `options.action: 'draft.create'`, and changes it with the other draft actions. <!-- id:bilvz92M -->

Columns: `id`, `account_id`, `agent_id`, `signer_secret_name` (the secret that holds the key the draft will be signed with), `title`, `content_format` and `content_cbor` (the draft's content), `metadata_cbor`, `edit_target` and `location_target` (the document the draft changes and the place it will be published), `path_name`, `visibility`, `status`, `created_at`, `updated_at`, and, once published, `published_at`, `published_id` and `published_version`. The table is indexed by account and `updated_at`, by agent, and by `status`.

## `run_journal` <!-- id:5paw7ekv -->

Append-only [journal](../agent/journal.md) for script (workflow) runs. It makes replay-from-top resume safe. Rows are `(run_id, seq, entry_cbor, created_at)` with `seq` monotonic per run (the count of the run's entries plus one at append). Each entry carries a `callSeq` that ties together the entries of one `ctx` call (`call` and `result`, `timer` and `fired`, `wait` and `event`; the `(run_id, seq)` primary key cannot repeat). The first entry of each group also carries a `key`, the effect's deterministic content key (`tool|name|inputJSON`, `agent|specJSON`, `sleep|ms`, …), which replay matches on; the [journal](../agent/journal.md) page explains replay. Entry kinds: `call`, `result`, `timer`, `fired`, `wait`, `event`, `now`, `log`, `step`, `plan` (see `WorkflowJournalEntry` in `apps/src/workflow-host.ts`). A call entry may carry a `description`, display metadata that stays out of the key. Caps: 5,000 entries or 8 MiB per run, after which the run fails `journal-cap`. [Retention](./database-retention.md) cuts the large payloads of finished runs to previews. Entries are streamed to `runs/<rootRunId>` subscribers as `append` events and replayed on subscribe. <!-- id:v46sJNRU -->

## `session_continuations` <!-- id:9Xgpa9dY -->

One row per continuation edge created by `continue_session`: the predecessor and successor sessions, the origin session of the chain, the tool call and initiating event, the `reason`, and `manifest_cbor`, the successor's exact starting point (handoff, cited sources, what was loaded and what was left cold). A successor has exactly one row, and `(predecessor_session_id, tool_call_id)` is unique so a retried call cannot create a second successor. The [session continuation](../agent/session-continuation.md) page describes the manifest. <!-- id:_dzv470k -->

## `webhook_trigger_credentials` <!-- id:TtGHJCLW -->

One row per webhook trigger: `secret_hash`, which delivery requests are checked against, and `secret_ciphertext`, the encrypted secret that `GetAgentTrigger` returns to editors. The secret is created with the trigger. See [triggers](../agent/triggers.md). <!-- id:lJhN6P_Y -->

## `trigger_firings` <!-- id:uumzqV0y -->

Holds one row each time a trigger fires: an activity event or a scheduled time that matched a trigger, and the session that came from it. The monitors use this table to make sure a trigger fires once per event, and it is the history of a trigger's sessions. <!-- id:7O3A-Snl -->

Columns, besides `id` and `created_at`: <!-- id:ANfEJZZZ -->
  - `account_id` <!-- id:_8uhovWA -->
  - `agent_id`: NULL for an app's trigger <!-- id:DU-zPqMg -->
  - `app_id`: the app, for an app's trigger
  - `trigger_id` <!-- id:UqkJ_5oc -->
  - `activity_key` <!-- id:r89Qat-g -->
  - `session_id` <!-- id:xrmU1MzV -->
  - `run_id`: the headless run a `tool` or `script` continuation started <!-- id:7YSpiFUR -->
  - `tool_call_id`: the tool call this firing made, when it made one
  - `activity_cbor` <!-- id:k7sPpiN5 -->
  - `context_cbor`: the snapshot of the trigger's name, prompt, and matched conditions at admission. Session attribution reads that snapshot instead of the current configuration; a firing without one falls back to the trigger's current view <!-- id:fSLM683o -->
  - `body_digest`: a webhook body's digest, so a reused `Idempotency-Key` with a different body is refused <!-- id:2lL7K56C -->
  - `status` <!-- id:s90Evv96 -->
  - `error` <!-- id:bR4PVqOd -->

`(account_id, trigger_id, activity_key)` is unique. So a retry by the feed or by the schedule monitor cannot make a second firing for the same trigger. An activity firing first passes through `trigger_event_claims` (above). Schedule, webhook and run-completed firings rely on this row alone. The keys have fixed forms: <!-- id:7nrxtaqU -->

- a schedule trigger uses `schedule:<triggerId>:<scheduledAt>`;
- a webhook uses `webhook:<Idempotency-Key>`, or a random key when the sender sends none.

## `activity_watermarks` <!-- id:02j3J54F -->

Holds how far the activity monitor has read each account's activity feed. The primary key is `(account_id, server_url)`. <!-- id:Rfbrf3zi -->

Columns: <!-- id:L__qFi0r -->
  - `account_id` <!-- id:Y_BNJ9CB -->
  - `server_url` <!-- id:SRnPhOyO -->
  - `cursor_cbor` <!-- id:u7wWQbmO -->
  - `last_poll_at` <!-- id:lppifjVW -->
  - `last_success_at` <!-- id:Ibrlt8ja -->
  - `last_error` <!-- id:sMSZ6ouk -->

## `session_events` <!-- id:Ebv_fNMR -->

Holds every event of every session. Rows are only ever added. <!-- id:HOjQrrGK -->

Columns, besides `id`: <!-- id:bbrswilN -->
  - `session_id` <!-- id:dGTAU5JR -->
  - `seq` <!-- id:b9TA_zNM -->
  - `event_cbor` <!-- id:yIGBDyrA -->
  - `created_at` <!-- id:QbWGSPxU -->
  - `pi_entry_id`: the entry of the session's [durable store](../agent/durable-sessions.md) this event was projected from, or NULL for an event anything else wrote <!-- id:8gwpEAQM -->

`seq` only grows within a session, and `(session_id, seq)` is unique. A new event gets the session's highest `seq` plus one. This is safe because only one server process writes the database. `GetSession` returns the events, and a session's WebSocket subscription replays them. Both take `afterSeq` and return the events after it; see the [signed API](../build/signed-api.md). <!-- id:Z2L22h8_ -->

This table is the [Log](../agent/log.md). Every entry has an [`actor`](../agent/actor.md) that says who did it. Only `user` and `system` are ever written on a row. The agent's own messages and tool calls carry no `actor`, and a reader works out `agent` from their shape. A message that a trigger started is a `user` message. <!-- id:hEKK4O4C -->

The event payloads: <!-- id:lAZ-9Wuw -->

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

`delegate` adds a `tool_spawn` event the moment its child exists. The event names the child run, and the session when the child is a model. The model is never shown this event, and it never takes the place of the `tool_result`. See [delegate](../agent/delegate.md). <!-- id:7F49NC1k -->

`actor` and `meta` are both optional. Never write code that needs either: <!-- id:j6h3LrFf -->

- The agent's own events never carry an `actor`, and some stored rows carry neither field.
- `sessionEventActor()` in the protocol package works out the actor of an event that has none: a message with the user role is `user`, an error is `system`, everything else is `agent`.
- `trigger` is in the type and is never written.
- `meta` is detail for display. A signed user message carries both the `accountId` that acted and the exact `signerId`. The two differ when the account signs with an authorized device or delegate key.

A change to a plan is **not** an event. The `plan` verb writes `sessions.plan_cbor` in place, so the plan carries its own `settledAt` time. <!-- id:8BUVq0H3 -->

The partial text of a reply that is still streaming is not stored here. <!-- id:hVJvv6g6 -->

## `session_durable_files`

Each session has a [Pi Durable](../agent/durable-sessions.md) store, kept in the `session_durable_files` table. Its columns are `session_id`, `file`, `seq`, and `data`. The store is Pi Durable's own set of append-only JSONL files, and each file is the `data` of its rows read in `seq` order. An append inserts one row. A file that has collected many rows is rewritten as one row the next time it is read, which is once per turn. The rows reference `sessions` with `ON DELETE CASCADE`. <!-- id:DTWUpd64 -->

The log in `session_events` stays the canonical record, and a store that is missing is rebuilt from it on the session's next turn. The two are tied together by `session_events.pi_entry_id` on one side and the store's `seed.sync` document on the other. [Durable sessions](../agent/durable-sessions.md) says what the store holds, and [retention](./database-retention.md) when an idle session's store is dropped. <!-- id:WXHg7ar_ -->

Deleting a session deletes its store. A backup of the database includes every store. <!-- id:Wu9rrQqz -->

## `transcript_privacy`

Reader privacy per transcript, keyed by `(kind, id)` where `kind` is `session` or `run`. `private` is set once any event or journal entry up to `scanned_seq` carried browser data. `sessions_json` and `runs_json` list the sessions and runs the scanned entries read from, whose privacy the transcript inherits.

## `action_idempotency` <!-- id:wyE61ixJ -->

Lets a client send the same request twice without doing the work twice. Columns: `account_id`, `action`, `client_request_id`, which together are the primary key, then `request_cbor`, `response_cbor` and `created_at`. <!-- id:sQt2zUpM -->

These fields fill `client_request_id`: <!-- id:1-pLN2bq -->
  - `CreateAgent.clientRequestId` <!-- id:5S91YEt2 -->
  - `CreateAgentTrigger.clientRequestId` <!-- id:ECizc0Ax -->
  - `CreateSigningIdentity.clientRequestId` <!-- id:b9ZgTYVF -->
  - `CreateSession.clientRequestId` <!-- id:4UzSr3of -->
  - `MessageSession.clientMessageId` <!-- id:iwI-KDbN -->

The same client ID with the same request bytes gets the stored response again. The same client ID with different request bytes gets `409`. <!-- id:xDb-SvJk -->

## `effect_outbox`

Records what each tool call set out to do and what came of it, for every call that changes something outside the conversation. See the [effect outbox](../agent/effect-outbox.md). There is one row per call.

Columns:

- `id`: `<session_id>:<tool_call_id>`
- `account_id`
- `session_id`: the row is deleted with the session
- `run_id`, `tool_call_id`, `tool`
- `kind`: `publish`, `memory-write`, `execute`, `delegate`, `call:<name>`, and so on
- `input_digest`: the SHA-256 of the call's arguments
- `status`: `running`, `succeeded`, `failed` or `interrupted`
- `lease_owner`: the process running it
- `response_cbor`: the receipt, which is the text and details the tool returned
- `error`
- `created_at`, `updated_at`, `completed_at`

The server inserts and commits the row before the effect begins, and settles it when the effect ends. At startup the boot sweep marks every `running` row `interrupted`. Settled rows are removed after two days.

## `app_runs`

One row per [app](../app.md) running on this server: `app_id`, `space_uid`, `started_by` (the account that started it), `private_config_ciphertext` (its private config, encrypted), `created_at`, `updated_at`.

## `app_tool_calls`

Every call of a running app's tools: `id`, `app_id`, `tool_id`, `caller`, `tool_version`, `input_json`, `output_json`, `error`, `duration_ms`, `created_at`, indexed by `(tool_id, created_at)`. The server serves these rows, with inputs and outputs, without an access check. See [tool](../tool.md).

# Open settings and planner statistics <!-- id:VGWqFzrf -->

Every time the server opens the database it sets `journal_mode=WAL`, `synchronous=NORMAL` and `temp_store=MEMORY`. It also applies three sizes from [configuration](./configuration.md):

- the page cache: `SEED_APPS_SQLITE_CACHE_MIB`, 256 MiB by default;
- memory-mapped reads: `SEED_APPS_SQLITE_MMAP_MIB`, 1024 MiB by default, and never more than the maximum SQLite was built with;
- the size the WAL file is cut back to after a checkpoint: `SEED_APPS_SQLITE_WAL_LIMIT_MIB`, 64 MiB by default.

The startup log prints the values in use, on the line `[agents/sqlite] connection settings`. Every SQLite statement runs on the server's only thread. So a read that misses the cache makes everything else wait. The cache and the mapping keep the common reads in memory.

Every open also runs `ANALYZE` on the small tables the query planner needs numbers for (`PLANNER_STATISTICS_TABLES`: accounts, agents, collaborators, triggers, runs, sessions, continuations and firings). It leaves out `session_events` and `run_journal` on purpose. Without these numbers the planner treats every index alike, and it can pick the account-wide index to look up the runs of one session. The busiest queries also name their index with `INDEXED BY`. Nothing runs `VACUUM`; see [database retention](./database-retention.md). <!-- id:afAY8b18 -->

# Secret encryption <!-- id:Mm3c29X6 -->

The code is `encryptSecret()` and `decryptSecret()` in `api-service.ts`. <!-- id:dxI-WpyJ -->

The scheme: <!-- id:YUGhL6E1 -->
  - AES-GCM; <!-- id:XUp42Aad -->
  - 32-byte server-local key; <!-- id:Cux_dY-p -->
  - 12-byte random nonce per write; <!-- id:HEJUY1cA -->
  - stored ciphertext is `nonce || encryptedBytes || tag`, with the 16-byte GCM authentication tag last (`aes-256-gcm`). <!-- id:JHUEh3sA -->

The key is the `secret_encryption_key_v1` row of `server_config`. A secret carries no version and no record of key rotation. The key cannot be kept in a key management service or a system keychain. [Security](../agent/security.md) covers what this protects against.

# Transaction policy <!-- id:vdysksJ3 -->

This rule is for people who change the code: never hold a write transaction open during a network call to a provider or a tool. <!-- id:OivYbqs7 -->

- `CreateAgent` and `CreateSession` may use short transactions that are safe to repeat.
- `MessageSession` must not hold a long SQLite transaction, because it does model and network work.
- When several people write to one session at once, the single server process adds each event at once and then queues each run on its own.
- The [run queue](./run-queue.md) runs one model turn per session at a time. It does not delay the storing of events. <!-- id:xhxd1qEb -->

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
