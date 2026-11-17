---
name: Database retention
summary: This page explains what keeps the app environment's SQLite file from growing forever, the settings that control it, and how to shrink a file that has already grown.
---
An [app environment](../software/app-environment.md) keeps everything in one SQLite file, described in [persistence](./persistence.md). This page covers what limits that file's growth, how the retention task runs, and how to make the file smaller.

The first thing to check: search the log for `[agents/retention]`. Each pass of the task writes a summary there.

# What is bounded

Every read that misses the cache is a random read on the volume, so a smaller file is a faster server. Three things keep the file from growing forever (`apps/src/db-retention.ts`):

- **Stored tool output has a limit.** The server stores the output of a tool result so people can look at it. A string longer than `SEED_APPS_TOOL_OUTPUT_STORE_LIMIT_KIB` keeps its beginning and a `[truncated for storage: …]` marker. The model sees the same as before: it never reads more than 32 KiB of a result. Workflow scripts still get whole results.
- **Idle sessions lose their durable store.** A session's [durable store](../agent/durable-sessions.md) is a second copy of its transcript, kept for the model. When a session has been idle for `SEED_APPS_RETENTION_DURABLE_IDLE_DAYS` and has no live run, the server deletes the store in one transaction. The session's next turn builds it again from the log, the same way it does for a lost store. Nothing in the transcript changes.
- **Journals of finished workflow runs are made smaller.** A finished run is never replayed. So `SEED_APPS_RETENTION_JOURNAL_DAYS` after a run finished, each journal entry larger than 16 KiB keeps its kind, call, tool, status and error. Its inputs and outputs become short previews marked `compacted`.

The server also removes settled [effect outbox](../agent/effect-outbox.md) receipts after two days. It removes nothing else by age: session events, runs and idempotency rows stay.

# The retention task

The second and third rules above run as one background task:

- It runs every `SEED_APPS_RETENTION_INTERVAL_MINS`. The first pass runs 15 minutes after start.
- It works in small steps and uses at most `SEED_APPS_RETENTION_MIB_PER_SEC` of disk.
- It logs one line for each day of data it touched and a summary for each pass, tagged `[agents/retention]`.
- A durable store larger than `SEED_APPS_RETENTION_MAX_STORE_MIB` is left for the offline pass below, because a store is deleted in one transaction.

`SEED_APPS_RETENTION=report` logs what the task would remove and removes nothing. `SEED_APPS_RETENTION=off` never runs the task. [Configuration](./configuration.md) has every default.

# Shrinking the file

Deleting rows frees pages inside the file for later use. It does not make the file smaller, and nothing in the server runs `VACUUM`. To shrink a database:

1. Stop the server.
2. Run `apps/scripts/db-retention.ts`. It does one pass at full speed. Add `--report` to see what it would do first.
3. Run `VACUUM INTO` a new file.
4. Put the new file in place of the old one, and start the server.

`apps/scripts/db-size-report.ts` estimates where the bytes are without reading the whole file. It is safe to run on a live server.

# See also

- [Persistence](./persistence.md), the tables and the open settings
- [Durable sessions](../agent/durable-sessions.md), what a durable store is and how it is built again
- [Journal](../agent/journal.md), what a compacted entry keeps
- [Configuration](./configuration.md), the `SEED_APPS_RETENTION_*` and `SEED_APPS_SQLITE_*` settings
- [Logs](./logs.md), the `[agents/retention]` lines
