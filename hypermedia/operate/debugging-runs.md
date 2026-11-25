---
name: Debugging runs
summary: This page starts from what you see when a run misbehaves, such as a session stuck in streaming, a queue that does not move, an interrupted tool call, a parent that never resumes, a failing script or a plan that changes by itself, and gives the checks for each.
---
A [run](../agent/runs.md) is one piece of work an [agent](../agent.md) does: a turn of a conversation, a [trigger](../trigger.md) firing, a delegated child or a script. This page is for when a run does not do what you expect. Find what you see in the headings below. Each entry gives the checks to make with the [signed API](../build/signed-api.md), in order.

The first thing to check is the state of the runs themselves: `ListRuns {sessionId}` for one session, or `ListRuns {rootRunId}` for a whole tree. Other symptoms are in [troubleshooting](./troubleshooting.md).

# Session stuck in `streaming` <!-- id:9Avd0DG9 -->

A session's `streaming` status is a copy of the state of its runs. So a crash cannot leave it stuck: at startup the boot sweep puts interrupted runs back in the queue, and the status is worked out again. If a session still shows `streaming`: <!-- id:lgnWLAMl -->
  1. Run `ListRuns {sessionId}` and check whether the latest root run is live (`queued`, `claimed`, `running`, or `waiting`). The mirror says `streaming` if and only if it is. <!-- id:jvdfm_lR -->
  2. A run that is `waiting` is [parked](../agent/park.md), and `wait_cbor.reason` says what it waits for. For `children`, look at the tree with `ListRuns {rootRunId}` and check the status of each [child](../agent/child.md). `timer` wakes at its time. `event` needs a [wake source](../agent/wake-source.md). `budget-pause` waits for a person to resume it, but no run reaches it, because the server never gives a run a time budget. When a person can answer an event wait, the run's `wait.answerWith` names the signal, and the Answer button on the card sends it. <!-- id:CQeTvjby -->
  3. `StopSession` stops the live turn and cancels every run that started from the session, with all their children. `CancelRun` on one run id is the narrower tool: it cancels that run and everything below it. <!-- id:_4-Jmfw6 -->
  4. Restarting the server is always safe. The boot sweep and the pass after it recover from every crash these pages describe. <!-- id:KkC31s6i -->

# Runs stay `queued` and nothing starts

1. Check `/api/health`. `dispatch: {paused: true, reason}` means the queue has stopped taking runs, and the reason says why.
2. The one cause is too little free disk where the database lives: less than `SEED_APPS_MIN_FREE_DISK_MIB` (512 MiB by default). The `disk` field shows the numbers.
3. Free some disk. The queue starts again by itself within a second.

While the queue is paused, runs that are already executing finish. Queued runs wait, including the turn for a message a person just sent.

Setting `SEED_APPS_MIN_FREE_DISK_MIB` to `0` turns the check off. Then a turn that starts on a full disk fails with "The turn could not be recorded". See the [run queue](./run-queue.md#when-dispatch-pauses).

# A tool result says "Interrupted while …"

The tool call was cut off while it was doing its work, and the [effect outbox](../agent/effect-outbox.md) could not tell whether the work finished.

- The text names the effect: publishing, writing a memory file, running code, or a named tool. It also says whether the server process died or only the run ended.
- The model is told to check before it does the work again. A person can check too, at the address the text names.
- A call that finished before the restart is answered from its receipt and never shows this text. A call that never began simply runs.

The row is in `effect_outbox`, with the `id` `<session_id>:<tool_call_id>`.

# A delegate row says "Starting the child…" but the child is alive <!-- id:s0To9423 -->

The row finds its child through the `tool_spawn` event in the parent's transcript. [`delegate`](../agent/delegate.md) adds that event as soon as the child run and its session exist. So you can open a delegation while the child is still queued, or while its model is still reading the prompt. <!-- id:HHClNS7Y -->

If starting the child failed before the child was queued, there is no such event. Then the row uses the run tree, where the child run's `parent_tool_call_id` names the call.

If a row with a live child still shows the waiting text, run `GetSession` and look for a `tool_spawn` with that `toolCallId`.

# Children ran but the parent never resumed <!-- id:hSOtRslw -->

Checklist, in order: <!-- id:3hMFhTPK -->
  1. **Did the parent wait for the child?** A `delegate` with `await: false` does not wait, on purpose. The child joins the parent's run tree, and you see it in the progress card. But it never returns a result and never wakes the parent. Look in the parent's transcript for the `delegate` input the model sent. If the model keeps starting work this way when it needs the result, report it as a problem with the prompt. The verb's description tells the model to wait by default. <!-- id:2jUcM9sM -->
  2. **Are the children finished while the parent still waits?** Run `ListRuns {rootRunId}` on the parent's root. The parent's `wait_cbor.toolCallIds` should get shorter as each child ends and adds its `delegate` tool result. A child's end and the waking of its parent are two separate transactions, so a crash can fall between them. A restart fixes this: `#reconcileWaitingRunsAtBoot` handles every child that ended without waking its parent. <!-- id:qVv02EZb -->
  3. **Did a child fail to deliver a result it owed?** A child that never delivered a required [typed result](../agent/typed-result.md) is not lost without a trace. The parent run records `unmetObligations: [{kind: 'typed-result'}]`. `GetRun` returns it and the card shows it. <!-- id:0bGn2DdH -->
  4. **Where do errors show?** The `error_cbor` of a failed run shows in `RunInfo.error` and on the card. A failed effect of a script is a `result {status: 'failed'}` entry in the [journal](../agent/journal.md); you see it in the card's Activity drawer and in `GetRunJournal`. A failed agent run also adds an `error` event to the session, after its retries run out. <!-- id:kUlpL23z -->

# Script child misbehaving <!-- id:H5mKTBzC -->

- **Read the journal first.** `GetRunJournal {runId}` returns everything a [script](../agent/script.md) run did, in order: every effect (`call` and `result`), timer, wait and event, log, step and plan change. The Activity drawer in the [desktop app](../software/desktop.md) shows the same list. <!-- id:54qlgZW1 -->
- **Know the three error codes.** `fuel-exhausted` means more than 2 seconds of pure computing between two awaits: move heavy work into `ctx.call('execute', …)`. `journal-cap` means more than 5,000 entries or 8 MiB: split the job, or limit a long loop with [`ctx.continueAsNew`](../agent/continue-as-new.md). `workflow-deadlock` means the script awaited a promise that did not come from `ctx`. <!-- id:y3nBAF_m -->
- **A long sleep parks the run.** A sleep of 60 seconds or more makes the run `waiting`, with `not_before` set. The dispatcher looks once a second for timers that are due. <!-- id:_2iWQq2C -->
- **A resumed script runs its source again against the [journal](../agent/journal.md).** It matches each effect by a key made from its content, not by the order effects arrived in. An effect whose key is not in the journal runs for real. A `{description}` label is not part of the key, so changing a label does not break a journal. <!-- id:L_CPnU0z -->

# A plan step closed itself, or a checklist froze <!-- id:3P_emtsM -->

Both are expected. The server keeps the card correct, and both show in the [plan](../agent/plan.md): <!-- id:F7NA6psv -->
  - A [step](../agent/step.md) marked `done` with `resolvedBy: 'runtime'` was closed by the server, because every child [attached](../agent/attachment.md) to that step succeeded. The server only works out success this way. It does not decide what a failed child means. <!-- id:OZrCmakv -->
  - A plan with `settledAt` set is a plan whose steps have all ended. From then on the card can leave its pinned place and stay fixed in the log. An edit that opens a step again clears `settledAt`. <!-- id:9Qz3i792 -->
  - A settled plan leaves `SessionInfo.plan` on the next user message. The settled copy stays on the run that owned it, as `RunInfo.plan`. [Plan](../agent/plan.md) explains this. <!-- id:TqxWfNmA -->

# See also

- [Runs](../agent/runs.md), [park](../agent/park.md) and [wake source](../agent/wake-source.md), the concepts
- [Journal](../agent/journal.md) and [script](../agent/script.md), for script runs
- [Effect outbox](../agent/effect-outbox.md), for interrupted tool calls
- [Run queue](./run-queue.md), the operator's settings
- [Persistence](./persistence.md), the tables behind `ListRuns` and `GetRunJournal`
- [Troubleshooting](./troubleshooting.md), every other symptom
