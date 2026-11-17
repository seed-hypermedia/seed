---
name: Database retention
summary: What keeps the app environment's SQLite file from growing without bound, the settings that control it, and how to shrink a file that has already grown.
---
An [app environment](../software/app-environment.md) keeps everything in one SQLite file, described in [persistence](./persistence.md). This page covers what bounds that file's growth, how the retention task runs, and how to shrink the file offline.

# What is bounded

The service keeps everything in one SQLite file, and every read that misses the cache is a random read on the volume. Three things keep the file from growing without bound (`apps/src/db-retention.ts`):

- **Stored tool output is capped.** A tool result's output is stored for people to inspect; strings past `SEED_APPS_TOOL_OUTPUT_STORE_LIMIT_KIB` keep their head and a `[truncated for storage: …]` marker. The model's view is unchanged: it never reads more than 32 KiB of a result. Workflow scripts still receive whole results.
- **Durable stores of idle sessions are dropped.** A session's [durable store](../agent/durable-sessions.md) is a second, model-facing copy of its transcript. Once the session has been idle for `SEED_APPS_RETENTION_DURABLE_IDLE_DAYS` and has no live run, the store is deleted in one transaction; the session's next turn rebuilds it from the log, as it does for a lost store. Nothing in the transcript changes.
- **Journals of finished workflow runs are compacted.** A finished run is never replayed, so `SEED_APPS_RETENTION_JOURNAL_DAYS` after it finished, journal entries larger than 16 KiB keep their kind, call, tool, status and error, and their inputs and outputs become previews marked `compacted`.

Settled [effect outbox](../agent/effect-outbox.md) receipts are pruned after two days. Nothing else is pruned by age: session events, runs and idempotency rows are kept.

# The retention task

The last two run as a background task every `SEED_APPS_RETENTION_INTERVAL_MINS`, in small steps throttled to `SEED_APPS_RETENTION_MIB_PER_SEC`, and log a line per day of data they touched plus a summary per pass (`[agents/retention]`). Set `SEED_APPS_RETENTION=report` to see what would go without removing anything.

The first pass runs 15 minutes after start. A durable store larger than `SEED_APPS_RETENTION_MAX_STORE_MIB` is left for the offline pass, because a store is dropped in one transaction. `SEED_APPS_RETENTION=off` never runs the task. [Configuration](./configuration.md) has every default.

# Shrinking the file

Deleting rows frees pages for reuse but does not shrink the file, and nothing in the server runs `VACUUM`. To shrink a database: stop the service, run `apps/scripts/db-retention.ts` (one unthrottled pass, with `--report` to preview), then `VACUUM INTO` a new file and swap it in. `apps/scripts/db-size-report.ts` estimates where the bytes are without reading the whole file and is safe on a live server.

# See also

- [Persistence](./persistence.md), the tables and the open settings
- [Durable sessions](../agent/durable-sessions.md), what a durable store is and how it is rebuilt
- [Journal](../agent/journal.md), what a compacted entry keeps
- [Configuration](./configuration.md), the `SEED_APPS_RETENTION_*` and `SEED_APPS_SQLITE_*` settings
- [Logs](./logs.md), the `[agents/retention]` lines
