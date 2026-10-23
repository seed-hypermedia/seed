---
name: Runs
summary: "Runs are everything that executes: every turn, child, and script is a durable row in one tree that doubles as the dispatch queue, so nothing runs that the server cannot see, resume, or cancel."
---
**Runs**: everything that executes. Every turn, [child](./child.md), and [script](./script.md) is a run row in a tree, and the same table is the dispatch queue. Waiting runs hold no resources (see [park](./park.md)). The table is `runs` in [persistence](./persistence.md). <!-- id:Dnidzb7V -->

A run is the unit the server schedules, leases, retries, cancels, and bills. A person never creates one directly: sending a message starts a run for that turn, a [trigger](./trigger.md) firing starts one, and a running agent starts more by delegating. A run page in the [desktop and web UI](./desktop-ui.md) is the durable record of one run; the `/hm/agents/run/<id>` web route and the session's run card show the same row. <!-- id:V_K1cK_3 -->

# Kinds and origins <!-- id:ECk2DDkg -->

A run has a `kind`: **agent**, a model turn with a transcript session (`sessionId`), or **workflow**, a script executing in the engine with a [journal](./journal.md) and no session. Its `origin` records the mechanism that started it, never the person: `user` (a chat message), `trigger` (a firing), `agent` (a model child spawned with `delegate`), `workflow` (spawned by a script), or `system`. Every run is created with a `title`: the message excerpt, the child's [brief](./brief.md) title, or the script name. <!-- id:9jEwhU51 -->

# The run tree <!-- id:3f2pfogT -->

Runs form trees. The run that a message or a firing started is a **root run**; every run it spawns, and every run those spawn, carries the same `rootRunId`, its own `parentRunId`, and a `depth` (0 for the root). The tree is what `ListRuns {rootRunId}` returns and what a `runs/<rootRunId>` [WebSocket subscription](./websocket-subscriptions.md) replays, in creation order. A child spawned by a model turn also records `parentToolCallId`, the tool call in the parent's transcript that spawned it, which is how a delegate row finds its child while it is still working. A run started by `ctx.continueAsNew` is linked to its predecessor by `continuedFromRunId` and shares its root. Depth and fan-out are bounded by the [delegation budget](./tools.md) of the root (`maxDepth`, `maxChildren`), set by the session's thoroughness. <!-- id:ML55nHXr -->

The pages of a tree read like one piece of work: the root run page shows its children under the plan steps they were [attached](./attachment.md) to, each child row opens that child's own page, and cancelling a run cancels its whole subtree. <!-- id:hu-oOSeJ -->

# Status <!-- id:stj3DZtp -->

<!-- id:WDPpgJPk -->
| Status <!-- col:gpOs65YT --> | UI label <!-- col:8yNAVMFs --> | Meaning <!-- col:V4KZXCxO --> <!-- id:tdKmh2rH --> |
| --- | --- | --- |
| `queued` | Queued | in the table, waiting for an executor; `not_before` may hold it until a time <!-- id:8sdM4ohz --> |
| `claimed` | Starting | an executor took a 60-second lease and is preparing it <!-- id:g8xynqNE --> |
| `running` | Running | executing: a model turn is streaming or a script is between effects <!-- id:rWJC0r-C --> |
| `waiting` | Waiting | parked without resources, with a `wait` saying why <!-- id:S4u2bPgF --> |
| `succeeded` | Finished | done; the output is on the row <!-- id:AYXHdL1V --> |
| `failed` | Failed | done with an `error` (code, message, and for a script the tool and `callSeq` it came from) <!-- id:AgNIUfKE --> |
| `canceled` | Canceled | stopped by a person or by a parent's cancellation <!-- id:W9wujVHk --> |

`wait.reason` is one of `children` (parked on spawned children, with `pendingChildren`), `timer` (a sleep or an event wait's timeout, with `wakeAt`), `event` (`ctx.waitForEvent`, which an activity event or a `SignalRun` answers; `answerWith` names the signal a person can send), or `budget-pause` (the run stopped rather than spend more and is waiting for a person). See [park and wait](./park.md) and [wake source](./wake-source.md). <!-- id:8kYQLDMf -->

A run that ends with work it promised and did not deliver, an undelivered [typed result](./typed-result.md) or plan steps neither finished nor written off, carries `unmetObligations` on the row rather than being quietly written off. <!-- id:4PpRqDbm -->

# The dispatch queue <!-- id:ILGikvV3 -->

The same table is the queue. An executor claims the next `queued` run whose `not_before` has passed, fair-share across accounts (the account holding the fewest claimed or running runs goes first), interactive runs before background ones, oldest first. Claiming sets `status = 'claimed'`, records the executor as `lease_owner` with a `lease_expires_at` sixty seconds out, and bumps `attempt`. When the server starts it requeues every run it left claimed or running, so a crash never wedges a run and the attempt already counted is kept; a run that fails with a retryable error is requeued with backoff until `max_attempts` (1 by default) is spent. A parked timer writes its wake time to `not_before`, and one sweep requeues every waiting run whose time has come. [Operations](./operations.md) has the queue settings and how to watch it. <!-- id:AB4bWtO- -->

# Plan, usage, and the rest of the row <!-- id:zeBDmPtL -->

A run may own a `plan`, the visible checklist of [steps](./step.md) with their status; the server stamps `ownerRunId` and records `settledAt` when every step has stopped moving. `usage` is the run's token usage with its children's rolled up. `sourceText` on a workflow run is the exact module it executes, shown under **Code** on the run page. `childRunCount` is how many children it spawned. <!-- id:JRTu47ir -->

# Working with it <!-- id:jtdsKEKd -->

- `GetRun`, `ListRuns` (by `sessionId`, `agentId`, `rootRunId`, or the account), `GetRunJournal`, `CancelRun`, and `SignalRun` in the [signed API](./signed-api.md). <!-- id:RSNQbhNE -->
- `runs/<rootRunId>` in [WebSocket subscriptions](./websocket-subscriptions.md) for live status, progress, activity, and journal. <!-- id:OSaSwCGm -->
- On a run page: the status pill and title, one line of origin and timing, the error chip, parked-run actions (answer a signal, resume), the work hierarchy with **Tool calls**, and the **Code** and **Activity** drawers. <!-- id:8KrVBvlY -->

# See also <!-- id:4mLVAhTt -->

- [Space](./space.md) <!-- id:F089j8_o -->
- [Log](./log.md) <!-- id:ksh_Ocrh -->
- [Child](./child.md) <!-- id:00EAYv4c -->
- [Park and wait](./park.md) <!-- id:t0WCiO48 -->
- [Journal](./journal.md) <!-- id:um8xEkxt -->
- [Persistence](./persistence.md) <!-- id:DCs1TMmW -->
- [Operations: run queue](./operations.md) <!-- id:EfQoLhH0 -->
