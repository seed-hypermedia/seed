---
name: Effect Outbox
summary: "Every side effect a tool call performs is recorded before it begins and receipted when it ends, so a turn resumed after a restart knows whether a cut-off call never began, finished, or is unknown, and never performs the effect twice."
---
The **effect outbox** is the agents server's record of what a tool call did to the world. A row is committed before the effect begins and settled when it ends. When a turn resumes after a process death, the call is run again, and the row says what to do: run the effect, answer from its receipt, or report it interrupted. The table is `effect_outbox` in [persistence](./persistence.md); the code is `agents/src/effect-outbox.ts`.

# Why

[Pi Durable](./durable-sessions.md) records the intent of a tool call before the tool runs. After a restart it can rerun a call whose tool is safe to repeat, and for any other tool it can only say "interrupted and may have partially run". Before the outbox that was the answer for every `write`, `call`, and `delegate` a restart cut off, and the model's usual response to it was to do the thing again. For a publish that had already reached the daemon, that meant a second Change and a second version.

Seed knows more than the harness does. The verb that performs an effect can say whether the effect began and whether it finished. The outbox is where it says so, and it closes the bug class behind the 2026-09-10 incident, where a full disk let a turn finish as a success with a tool call the log never recorded: the record of an effect must exist before the effect, a retry must find a receipt, and a write the database refuses must end the turn.

# What is recorded

Not every call. The verbs that only read (`read`, `plan`, `status`) and the read-only callables (`search`, `query`, `attributes`, `web_search`) are repeated freely, as before. Every other call gets a row, named by its kind:

| Call | Kind |
| --- | --- |
| `write hm://…` | `publish` |
| `write ipfs://…` | `ipfs-upload` |
| `write ~/memory/…` | `memory-write` |
| `write ~/triggers/…` | `trigger-write` |
| `write ~/tools/…` | `tool-write` |
| `call execute`, or a promoted `execute` | `execute` |
| `call browser` | `browser` |
| any other callable, authored tool or MCP tool | `call:<name>` |
| `delegate` | `delegate` |

A `write` with `dryRun: true` is a read. The kind is what an interrupted result shows the model, so it names the one thing to check.

A row is keyed by session and tool call id, which the harness keeps stable across a rerun, and carries a digest of the call's arguments. It records the account, run, tool and kind, a status, the process that owns it while it runs, and the receipt: the text and details the tool returned, or its error. Image bytes are never stored.

# A call's life

1. The turn's tool wrapper classifies the call. A read runs at once.
2. For an effect, the wrapper inserts the row as `running` and commits. If the database refuses the insert, the tool answers with an error, nothing has happened in the world, and the turn ends in an error once it settles.
3. The tool runs.
4. The row is settled: `succeeded` with the receipt, or `failed` with the error. The result goes back to the harness, which commits it to the store.

A process death anywhere in this sequence leaves a row the next process can read.

# After a restart

Every Seed tool is registered with the harness as safe to rerun, so a cut-off call is run again when its turn resumes, and the wrapper decides from the row:

- **No row.** The effect never began. It runs now.
- **`succeeded` or `failed`.** The effect ended before the restart. The receipt is returned as the result, and the effect does not run again. A receipt that parked the turn on a delegated [child](./child.md) parks it again.
- **`running` under a process that is gone.** Nobody knows how the effect ended. The boot sweep marks it `interrupted`, and the call is answered with a result that names the effect: "Interrupted by a service restart while publishing to a Hypermedia address. It may have completed before the restart. Check the result before repeating it."

One kind recovers on its own. A `delegate` call's effect is the child run it enqueued; if that run exists, the spawn finished, and the call is answered the way the first run answered it.

When the turn is picked up by a different run (the first run failed or was canceled across the restart), the log is repaired instead, as [durable sessions](./durable-sessions.md) describes. That repair reads the same rows: a call with a receipt gets the receipt as its `tool_result`, one that failed gets its error, one cut off mid-effect gets the interrupted result naming the effect. Only a call with no row gets the generic "interrupted by a service restart" text.

# When the database refuses a write

A full disk shows up as a refused write. Three writes matter during a turn, and all three now end it:

- The durable store refusing a commit closes the harness, and the turn fails at once. This was already so.
- The log refusing a projected event used to be logged and caught up at the next open while the run finished as a success. The run still finishes the turn, then fails with "The turn could not be recorded", and the next open of the session writes what was missed.
- The outbox refusing an intent or a receipt fails the run the same way.

Before any of that, the queue stops starting turns. `SEED_AGENTS_MIN_FREE_DISK_MIB` (default 512, flag `--min-free-disk-mib`, zero disables) is the free space the database's file system must have before another run is claimed. Below it, queued runs stay queued, interactive messages are stored and wait, runs already in flight continue, and `/api/health` reports `disk` and `dispatch: {paused: true, reason}`. Dispatch resumes on its own once space is back. See [operations](./operations.md).

# Housekeeping

At boot, after the run queue's own sweep, every `running` row becomes `interrupted`. Settled rows are pruned after seven days, at boot and once an hour. Deleting a session deletes its rows.

# What this does not cover

- A script child's `ctx.call` is journaled by the [journal](./journal.md), which has its own replay rules and still re-executes a call interrupted between execution and its journaled result.
- A receipt for a `publish` proves the daemon accepted the blobs, not that the network has indexed them. The write verb's visibility retry is unchanged.
- `execute` cannot be made idempotent by the server. The receipt turns "did it run?" into a yes, a no, or a named unknown.
- A lease is written on each row but only read to tell this process's own in-flight row from a dead one. A multi-process server would need the lease expiry enforced.

# See also

- [Durable sessions](./durable-sessions.md)
- [Runs](./runs.md)
- [Persistence](./persistence.md)
- [Operations](./operations.md)
- [Troubleshooting](./troubleshooting.md)
