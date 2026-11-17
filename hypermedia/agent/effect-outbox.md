---
name: Effect outbox
summary: The effect outbox records every side effect of a tool call before it begins and again when it ends, so a turn that resumes after a restart never performs the same effect twice.
---
The **effect outbox** is the [app environment](../software/app-environment.md)'s record of what a tool call did to the world. An effect is anything that changes something, such as publishing a [document](../protocol/documents.md). The server saves a row before the effect begins and completes the row when the effect ends.

The row matters after a crash. When a turn resumes, the server runs the cut-off call again, and the row says what to do: run the effect, answer from its **receipt** (the saved result), or report that the effect was interrupted. For example, a publish that already happened is not sent a second time. The table is `effect_outbox` in [persistence](../operate/persistence.md).

# Why

[Pi Durable](./durable-sessions.md), the library that runs the model loop (the harness), records that a tool call is about to run. After a restart it can run a call again when the tool is safe to repeat. For any other tool it can only say "interrupted and may have partially run". A model that reads that usually does the thing again. For a publish that had already reached the [daemon](../software/daemon.md), that would mean a second Change and a second version.

Seed knows more than the harness does. The verb that performs an effect can say whether the effect began and whether it finished. The outbox is where it says so. Three rules follow:

- the record of an effect exists before the effect;
- a retry finds a receipt;
- a write the database refuses ends the turn.

# What is recorded

Not every call gets a row. Some calls are safe to repeat, so the server repeats them freely:

- the verbs that do not act on the world: [`read`](./read.md), [`plan`](./plan.md) and [`status`](./tools.md);
- the read-only [callables](./callables.md): `search`, `query`, `attributes` (which reads a document's [attributes](../metadata.md)) and `web_search`;
- [`continue_session`](./session-continuation.md) and `return_result`. The first finds its own continuation row. The second only sets the turn's state.

Every other call gets a row, named by its kind:

| Call | Kind |
| --- | --- |
| `write hm://…` | `publish` |
| `write ipfs://…` | `ipfs-upload` |
| `write ~/memory/…` | `memory-write` |
| `write ~/self` and other space addresses | `space-write` |
| `write ~/triggers/…` | `trigger-write` |
| `write ~/tools/…` | `tool-write` |
| `call execute`, or a promoted [`execute`](./code-execution.md) | `execute` |
| `call browser` | `browser` |
| any other callable or MCP tool | `call:<name>` |
| [`delegate`](./delegate.md) | `delegate` |

A [`write`](./write.md) to `~/self` or `~/tools/` is always refused. The server gives the call its kind before it refuses it, so a row for it can exist.

A `write` with `dryRun: true` is a read. The kind is what an interrupted result shows the model, so it names the one thing to check.

A row is found by its [session](./session.md) and tool call id. The harness keeps that id the same when it runs a call again. The row also carries a digest of the call's arguments. It records the [account](../protocol/identity.md), run, tool and kind, a status, the process that owns it while it runs, and the receipt: the text and details the tool returned, or its error.

Image bytes are never stored. A result larger than 64 KiB keeps only the first 16 KiB of its text. The log and the store already hold the full result, and the receipt is only for the rare rerun that lost it.

# A call's life

1. The server decides what kind the call is. A read runs at once.
2. For an effect, the server saves the row as `running`. If the database refuses the insert, the tool answers with an error, nothing has happened in the world, and the turn ends in an error once it settles.
3. The tool runs.
4. The server settles the row: `succeeded` with the receipt, or `failed` with the error. The result goes back to the harness, which saves it to the store.

If the process dies at any point in this sequence, it leaves a row the next process can read.

# After a restart

Seed tells the harness that every Seed tool is safe to run again. So a cut-off call runs again when its turn resumes, and the server decides from the row:

- **No row.** The effect never began. It runs now.
- **`succeeded` or `failed`.** The effect ended before the restart. The receipt is returned as the result, and the effect does not run again. A receipt that parked the turn on a delegated [child](./child.md) parks it again.
- **Still `running`, but its run is over.** The server cannot tell whether the effect happened. At start, the server marks every row a dead process left as `interrupted`. The call is answered with a message that names the effect and tells the model to check before it repeats it: "Interrupted while publishing to a Hypermedia address. The server process ended before this effect completed. It may have completed. Check the result before repeating it." When the run failed and the process kept going, the message says that instead.

One kind needs no receipt. A `delegate` call's effect is the child run it enqueued; if that run exists, the spawn finished, and the call is answered the way the first run answered it.

When the turn is picked up by a different run, because the first run failed or was canceled across the restart, the log is repaired from the same rows. [Durable sessions](./durable-sessions.md) tells the whole restart story.

# When the database refuses a write

A full disk shows up as a refused write. Three writes matter during a turn, and each one ends it:

- The durable store refusing a commit closes the harness, and the turn fails at once.
- The log refusing a projected event lets the run finish the turn, and then fails it with "The turn could not be recorded". The next open of the session writes what was missed.
- The outbox refusing an intent or a receipt fails the run the same way.

Before any of that happens, the queue stops starting turns. `SEED_APPS_MIN_FREE_DISK_MIB` (default 512, flag `--min-free-disk-mib`, zero disables) is the free space the database's file system must have before another run is claimed. Below it, queued runs stay queued, interactive messages and retries are stored and wait, runs already in flight continue, and `/api/health` reports `disk` and `dispatch: {paused: true, reason}`. The server measures free space at most once a second. It starts runs again by itself once space is back. See the [run queue](../operate/run-queue.md) page.

# Housekeeping

When the server starts, after the run queue's own sweep, every `running` row becomes `interrupted`. Settled rows are deleted after two days. The server checks at start and once an hour. Deleting a session deletes its rows.

# What this does not cover

- A script child's `ctx.call` is journaled by the [journal](./journal.md), which has its own replay rules. It runs a call again when the call was interrupted after it ran and before its result was journaled.
- A receipt for a `publish` proves the daemon accepted the [blobs](../protocol/blobs.md), not that the network has indexed them. The write verb's own check that the result is visible is separate from the outbox.
- The server cannot make `execute` safe to repeat. The receipt turns "did it run?" into a yes, a no, or a named unknown.
- A lease is written on each row but only read to tell this process's own in-flight row from a dead one. A multi-process server would need the lease expiry enforced.

# See also

- [Durable sessions](./durable-sessions.md)
- [Journal](./journal.md)
- [Runs](./runs.md)
- [Persistence](../operate/persistence.md)
- [Run queue](../operate/run-queue.md)
- [Troubleshooting](../operate/troubleshooting.md)
