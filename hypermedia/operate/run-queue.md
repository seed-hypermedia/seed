---
name: Run queue
summary: This page explains the run queue from the operator's side, covering how many runs execute at once, what happens to runs across a restart, which failures are retried, and when the queue stops taking work.
---
Every piece of work an [agent](../agent.md) does in an [app environment](../software/app-environment.md) is a [run](../agent/runs.md). A run is a row in the `runs` table, and that table is also the queue the server takes work from (`apps/src/runs.ts`). This page covers what an operator sets and watches: how many runs execute at once, what a restart does, what is retried, and what stops the queue.

The first thing to check when runs do not start: `curl <server>/api/health` and read `dispatch`. `{"paused": true, "reason": …}` means the queue has stopped; see [When dispatch pauses](#when-dispatch-pauses).

The idea of a run, its statuses and the tree of runs are explained in [runs](../agent/runs.md).

# Queues and concurrency <!-- id:jIKj9Ovy -->

- **Interactive turns go first.** `MessageSession` claims the turn for a person's message itself, so the message does not wait behind background work. <!-- id:db3BA2As -->
- **Everything else uses the `background` queue.** That is [trigger](../trigger.md) firings, sessions an agent starts, delegated model children and script children.
- **Agent runs have a limit.** At most `SEED_APPS_MAX_CONCURRENT_MODEL_RUNS` agent runs hold a provider stream at once. The default is 8, and the flag is `--max-concurrent-model-runs`.
- **Script runs have their own limit.** At most `SEED_APPS_MAX_CONCURRENT_WORKFLOWS` scripts run at once. The default is 32, and the flag is `--max-concurrent-workflows`. Scripts hold no provider stream. Because the two limits are separate, a script that waits for its children can never hold them up.
- **Scripts can run on a worker thread.** `SEED_APPS_WORKFLOW_WORKER=1` runs scripts on a worker thread instead of on the server's main thread.
- **One live agent run per session.** The server enforces this when it claims a run. <!-- id:ST5DHKVV -->
- **Leases are recorded and not enforced.** A claim writes a lease of 60 seconds. Nothing reads it. There is one server process, so at startup the boot sweep puts back in the queue every run the last process left claimed or running. <!-- id:YD2c9GyO -->

Almost everything shares one thread, so choose limits that fit the host. [Diagnosing a stalled server](./stalled-server.md) shows how to see whether the thread is too busy.

# Across a restart

Restarting the server is always safe. At startup the **boot sweep** does this: <!-- id:fGRoe2ad -->

1. It puts back in the queue every run that a dead process left `claimed` or `running`. Runs that were already queued continue.
2. An agent run continues by replaying the stored events of its session.
3. A crash can happen between a stored `tool_call` and its `tool_result`. The [effect outbox](../agent/effect-outbox.md) answers such a call. If the effect finished, the answer is its receipt. If it did not, the answer says the call was interrupted and names the effect. So the request to the provider is complete, and the model knows what to check.
4. It marks every effect the dead process left running as interrupted.
5. A script run continues by replaying its [journal](../agent/journal.md).

After the server is ready, a second pass handles any child that finished without waking its [parked](../agent/park.md) parent, and removes old receipts. Health reports that pass as `bootRecovery`; see [endpoints and health](./endpoints-and-health.md#while-the-server-starts).

# Retries

The server decides from the kind of failure whether to try again: <!-- id:it4z5p55 -->

- **Retried:** a provider answer in the 500 range, and network failures. The wait doubles each time, from 5 seconds up to 5 minutes.
- **Not retried:** validation errors and configuration errors. They fail at once.

`maxAttempts` is 3 (`AGENT_RUN_MAX_ATTEMPTS`) for background agent runs: trigger firings, sessions an agent starts, delegated model children. It is 1 for interactive turns, because a person is waiting. It is also 1 for script runs, which continue from their journal and never start again.

# Parked runs

A parked run uses no resources and takes no place under the limits. [Park](../agent/park.md) lists the four reasons a run parks, and [wake source](../agent/wake-source.md) says what wakes each. The dispatcher looks once a second for timers that are due.

# When dispatch pauses

The queue takes a run only while the file system that holds the database has at least `SEED_APPS_MIN_FREE_DISK_MIB` free. The default is 512 MiB. Below it:

- queued runs stay `queued`;
- runs that are already executing finish;
- health reports `dispatch: {paused: true, reason}`, with the numbers in `disk`;
- the log says `[agents/runs] dispatch paused`.

The queue starts again by itself once there is room, and the log says `[agents/runs] dispatch resumed`. The [effect outbox](../agent/effect-outbox.md) explains why a turn must not start on a full disk.

# Script limits

A [script](../agent/script.md) runs inside these limits (see `apps/src/workflow-host.ts`): <!-- id:4CrPGBii -->

- one QuickJS-WASM realm per run;
- 64 MiB of memory;
- 2 seconds of pure computing between two awaits;
- 256 KiB of source;
- 5,000 journal entries or 8 MiB of journal per run (`WORKFLOW_JOURNAL_MAX_ENTRIES` and `WORKFLOW_JOURNAL_MAX_BYTES` in `api-service.ts`).

A loop that must run for a long time gets around the journal limit with [`ctx.continueAsNew`](../agent/continue-as-new.md). It ends the run and starts a new one that carries only the state the script names.

# See also

- [Runs](../agent/runs.md), the concept: kinds, statuses, the run tree
- [Park](../agent/park.md) and [wake source](../agent/wake-source.md)
- [Journal](../agent/journal.md), how a script run continues
- [Effect outbox](../agent/effect-outbox.md), how interrupted tool calls are answered
- [Debugging runs](./debugging-runs.md), starts from what you see
- [Persistence](./persistence.md#runs), the `runs` table
- [Configuration](./configuration.md), the settings named here
- [Testing the app environment](../contribute/testing-the-app-environment.md), how tests wait for the queue
