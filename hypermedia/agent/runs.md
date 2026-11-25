---
name: Runs
summary: Runs are everything that executes, where every turn, child and script is a saved row in one tree that is also the queue, so nothing runs that the server cannot see, resume or cancel.
---
A **run** is one piece of work the server executes. Every turn, every [child](./child.md), and every [script](./script.md) is a run. Each run is one saved row in a table, the rows form a tree, and the same table is the queue of work to do. For example, one message starts one run; if the agent delegates to three children, that makes four runs in one tree. <!-- id:Dnidzb7V -->

A run is the unit the server schedules, retries, cancels, and counts usage for. A person never creates one directly. Sending a message starts a run for that turn, a [trigger](../trigger.md) firing starts one, and a running [agent](../agent.md) starts more by delegating. In the [Seed app](../software/desktop.md), you read a run that has a session inside that session, where its run card shows it. Only a run without a session, such as a script or a firing that made no session, has its own run page (see [Agents in the Seed app](./in-the-app.md)). The `/hm/agents/run/<id>` web route shows that page. For a run with a session, the route opens the session instead. A waiting run holds no resources (see [park](./park.md)). The table is `runs` in [persistence](../operate/persistence.md). <!-- id:sPYIhitw -->

# Kinds and origins <!-- id:rUs_WgEA -->

A run has a `kind`:

- **agent**: a model turn. Its transcript is a [session](./session.md) (`sessionId`).
- **workflow**: a script that runs in the script engine. It has a [journal](./journal.md) and no session. In the code and the API a script run has the kind `workflow`. The two words mean the same thing.

Its `origin` records what started it, never which person:

- `user`: a chat message;
- `trigger`: a firing;
- `agent`: a model child started with [`delegate`](./delegate.md);
- `workflow`: started by a script;
- `system`.

Every run is created with a `title`: the start of the message, the title of the child's [brief](./brief.md), or the script name. <!-- id:wH_mYTWu -->

# The run tree <!-- id:vWU7nOa8 -->

Runs form a tree. The run that a message or a firing started is the **root run**, and every run it starts is under it.

- Every run in a tree carries the same `rootRunId`, its own `parentRunId`, and a `depth` (0 for the root).
- `ListRuns {rootRunId}` returns the tree, and a `runs/<rootRunId>` [WebSocket subscription](../build/websocket-subscriptions.md) replays it, in the order the runs were created.
- A child that a model turn started also records `parentToolCallId`: the tool call in the parent's transcript that started it. This is how a delegate row finds its child while the child is still working.
- A run started by `ctx.continueAsNew` is linked to the run before it by `continuedFromRunId` and shares its root. See [continueAsNew](./continue-as-new.md).
- The [delegation budget](./delegation-budgets.md) of the root limits how deep the tree may go and how many children a run may start (`maxDepth`, `maxChildren`). The session's thoroughness sets it. <!-- id:ePQvLPMY -->

A tree reads like one piece of work. A run's card or page shows its children under the plan steps they were [attached](./attachment.md) to. Each child row opens that child: its transcript when it has a session, its run page when it is a script. Cancelling a run cancels every run under it. <!-- id:ThJY3mv9 -->

# Status <!-- id:PB-W4SMv -->

<!-- id:PMBGOPTN -->
| Status <!-- col:hhfroCb3 --> | UI label <!-- col:rl14qbKM --> | Meaning <!-- col:tX4fLT0Z --> <!-- id:0q2sczo4 --> |
| --- | --- | --- |
| `queued` | Queued | in the table, waiting for an executor; `not_before` may hold it until a time <!-- id:y0ByWEn6 --> |
| `claimed` | Starting | an executor took a 60-second lease and is preparing it <!-- id:cQeoO2xi --> |
| `running` | Running | executing: a model turn is streaming or a script is between effects <!-- id:016aWs0o --> |
| `waiting` | Waiting | parked without resources, with a `wait` saying why <!-- id:Pah57RUy --> |
| `succeeded` | Finished | done; the output is on the row <!-- id:k7jDa7Pu --> |
| `failed` | Failed | done with an `error` (code, message, and for a script the tool and `callSeq` it came from) <!-- id:TPBUGQl5 --> |
| `canceled` | Canceled | stopped by a person or by a parent's cancellation <!-- id:zunv_MIh --> |

`wait.reason` says why a run is waiting:

- `children`: the run is parked on children it started, listed in `pendingChildren`;
- `timer`: a sleep, or the timeout of an event wait, with `wakeAt`;
- `event`: `ctx.waitForEvent`, which an activity event or a `SignalRun` answers. `answerWith` names the signal a person can send.

The type has a fourth reason, `budget-pause`. No run pauses on a budget, because the server never gives a run a time budget. See [park and wait](./park.md) and [wake source](./wake-source.md). <!-- id:X5a51fc7 -->

A run can end with work it promised and did not deliver: a [typed result](./typed-result.md) it never returned, or plan steps it neither finished nor wrote off. Such a run carries `unmetObligations` on its row. Nothing is quietly dropped. See [obligations](./obligations.md). <!-- id:nitHyk66 -->

The server ends a turn whose model goes silent. If the model sends nothing for 8 minutes while no tool is running, the turn ends with an error. The error asks you to send the message again.

# The dispatch queue <!-- id:OrfuF3IF -->

The same table is the queue. An executor is the part of the server that runs a run. It claims the next `queued` run whose `not_before` time has passed, in this order:

1. the account with the fewest claimed or running runs goes first, so every account gets a fair share;
2. interactive runs go before background runs;
3. the oldest run goes first.

Claiming a run sets `status = 'claimed'`. It records the executor as `lease_owner`, sets `lease_expires_at` sixty seconds ahead, and adds one to `attempt`. A lease is the executor's short claim on the run.

Three more rules keep the queue safe:

- When the server starts, it puts back in the queue every run it had claimed or was running. So a crash never leaves a run stuck. The attempt that was already counted stays counted. At the same time the [effect outbox](./effect-outbox.md) settles the tool effects those runs left unfinished.
- A run is claimed only while the disk that holds the database has enough free space. See the [run queue](../operate/run-queue.md) page.
- A run that fails with an error worth retrying goes back in the queue after a wait, until it has used its `max_attempts`: 1 for a turn a person is watching, 3 for a background agent run.

A parked timer writes its wake time to `not_before`, and one sweep puts back in the queue every waiting run whose time has come. The [run queue](../operate/run-queue.md) page has the queue settings and how to watch it. <!-- id:UAQ2f0rD -->

# Plan, usage, and the rest of the row <!-- id:2NZmH3vD -->

- `plan`: a run may own the visible checklist of [steps](./step.md) with their status; see [plan](./plan.md). The server writes `ownerRunId`, and records `settledAt` when every step has stopped moving.
- `usage`: the run's token usage, with its children's added in.
- `sourceText`: on a workflow run, the exact code it executes. The run page shows it under **Code**.
- `childRunCount`: how many children the run started. <!-- id:lkoMu_3U -->

# Working with it <!-- id:RpPALUnw -->

- `GetRun`, `ListRuns` (by `sessionId`, `agentId`, `rootRunId`, or the [account](../protocol/identity.md)), `GetRunJournal`, `CancelRun`, and `SignalRun` in the [signed API](../build/signed-api.md). <!-- id:_aE4Nl4B -->
- `runs/<rootRunId>` in [WebSocket subscriptions](../build/websocket-subscriptions.md) for live status, progress, activity, and journal. <!-- id:Rysvxm7n -->
- On a run page (only for a run without a session): the status pill and title, one line of origin and timing, the error chip, the actions for a parked run (answer a signal), the tree of work with **Tool calls**, and the **Code** and **Activity** drawers. <!-- id:_jI8XSAO -->

# See also <!-- id:ewgk70Sj -->

- [Space](./space.md) <!-- id:F089j8_o -->
- [Session](./session.md)
- [Log](./log.md) <!-- id:ksh_Ocrh -->
- [Child](./child.md) <!-- id:00EAYv4c -->
- [Park and wait](./park.md) <!-- id:t0WCiO48 -->
- [Journal](./journal.md) <!-- id:um8xEkxt -->
- [Persistence](../operate/persistence.md) <!-- id:DCs1TMmW -->
- [Run queue](../operate/run-queue.md) <!-- id:EfQoLhH0 -->
