---
name: Run queue
summary: The operator's view of the run queue, covering its two queues and concurrency caps, what happens to runs across a restart, how failures are retried, and when dispatch pauses.
---
Every agent execution in an [app environment](../software/app-environment.md) is a [run](../agent/runs.md), a durable row in the `runs` table, and that table is also the dispatch queue (`apps/src/runs.ts`). The concept, the statuses and the run tree are explained in [runs](../agent/runs.md). This page covers what an operator sets and watches: how many runs execute at once, what a restart does, what is retried, and what stops the queue.

# Queues and concurrency <!-- id:jIKj9Ovy -->

- **Queues**: interactive user turns are claimed inline by `MessageSession`, so a person's message does not wait behind background work. Everything else (trigger firings, agent-started sessions, delegated model children, script children) dispatches on the `background` queue. Agent runs are capped at `SEED_APPS_MAX_CONCURRENT_MODEL_RUNS` (default 8, flag `--max-concurrent-model-runs`) concurrent provider streams. Script runs get their own pool, `SEED_APPS_MAX_CONCURRENT_WORKFLOWS` (default 32, `--max-concurrent-workflows`; they hold no provider stream), so a script awaiting its children can never starve them. `SEED_APPS_WORKFLOW_WORKER=1` runs scripts in a separate worker process instead of on the server's thread. <!-- id:db3BA2As -->
- **One live agent run per session** is enforced at claim time (lease-based). <!-- id:ST5DHKVV -->
- **Leases** are recorded for 60 seconds on claim but not enforced: with one service process, the boot sweep requeues every run the previous process left claimed or running. <!-- id:YD2c9GyO -->

Everything shares one thread, so size the caps to the host. [Diagnosing a stalled server](./stalled-server.md) shows how to see whether the thread is saturated.

# Across a restart

- **Boot sweep**: on service construction, runs a dead process left `claimed` or `running` are requeued, and any queued backlog resumes. Agent runs resume by replaying their durable session events. A crash between a persisted `tool_call` and its `tool_result` is answered from the [effect outbox](../agent/effect-outbox.md): the receipt when the effect finished, an interrupted result naming the effect when it did not, so the provider request is well-formed and the model knows what to check. The same sweep marks every effect the dead process left running as interrupted. Script runs resume by [journal](../agent/journal.md) replay. <!-- id:fGRoe2ad -->

After the server is ready, a reconcile pass replays any child that finished without resolving its [parked](../agent/park.md) parent, and settled receipts are pruned. The health endpoint reports that pass as `bootRecovery`; see [endpoints and health](./endpoints-and-health.md#while-the-server-starts). Restarting the service is always safe.

# Retries

- **Retry classification**: provider 5xx and network failures are retryable with exponential backoff (base 5s, cap 5min). Validation and config errors fail immediately. `maxAttempts` is 3 (`AGENT_RUN_MAX_ATTEMPTS`) for background agent runs: trigger firings, agent-started sessions, delegated model children. It is 1 for interactive turns, which have a person waiting, and for script runs, which resume from their journal and never restart. <!-- id:it4z5p55 -->

# Parked runs

A parked run holds no resources and no concurrency slot. [Park](../agent/park.md) lists the four reasons a run parks and [wake source](../agent/wake-source.md) what wakes each. The dispatcher's 1-second interval wakes due timers.

# When dispatch pauses

The queue claims a run only while the file system that holds the database has at least `SEED_APPS_MIN_FREE_DISK_MIB` free (default 512 MiB). Below it, runs stay `queued`, runs already in flight finish, and health reports `dispatch: {paused: true, reason}` with the figures in `disk`. Dispatch resumes on its own once space is free. The log says `[agents/runs] dispatch paused` and `[agents/runs] dispatch resumed`. The [effect outbox](../agent/effect-outbox.md) explains why a turn must not start on a full disk.

# Script limits

[Script](../agent/script.md) execution bounds (see `apps/src/workflow-host.ts`): QuickJS-WASM realm per run, 64 MiB memory cap, 2s pure-compute fuel between awaits, 256 KiB source cap, and journal caps of 5,000 entries / 8 MiB per run (`WORKFLOW_JOURNAL_MAX_ENTRIES` / `WORKFLOW_JOURNAL_MAX_BYTES` in `api-service.ts`). A long-lived loop escapes the journal cap with [`ctx.continueAsNew`](../agent/continue-as-new.md), which ends the run and starts a successor carrying only the declared state. <!-- id:4CrPGBii -->

# See also

- [Runs](../agent/runs.md), the concept: kinds, statuses, the run tree
- [Park](../agent/park.md) and [wake source](../agent/wake-source.md)
- [Journal](../agent/journal.md), how a script run resumes
- [Effect outbox](../agent/effect-outbox.md), how interrupted tool calls are answered
- [Debugging runs](./debugging-runs.md), symptom first
- [Persistence](./persistence.md#runs), the `runs` table
- [Configuration](./configuration.md), the settings named here
- [Testing the app environment](../contribute/testing-the-app-environment.md), how tests wait for the queue
