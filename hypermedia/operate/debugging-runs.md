---
name: Debugging runs
summary: "A symptom-first guide to runs that do not behave: a session stuck in streaming, a queue that does not move, interrupted tool calls, parents that never resume, failing scripts, and plans that change by themselves."
---
This page is for the moment a [run](../agent/runs.md) does not do what you expect. Each entry starts from what you see, gives the checks to make with the [signed API](../build/signed-api.md), and links the page that explains the behaviour. Other symptoms are in [troubleshooting](./troubleshooting.md).

# Session stuck in `streaming` <!-- id:9Avd0DG9 -->

A session's `streaming` status mirrors [run](../agent/runs.md) state, so a crash cannot wedge it: the boot sweep requeues interrupted runs and the status is derived again. If a session still shows `streaming`: <!-- id:lgnWLAMl -->
  1. Run `ListRuns {sessionId}` and check whether the latest root run is live (`queued`, `claimed`, `running`, or `waiting`). The mirror says `streaming` if and only if it is. <!-- id:jvdfm_lR -->
  2. A run `waiting` is [parked](../agent/park.md), and `wait_cbor.reason` says on what. For `children`, inspect the tree with `ListRuns {rootRunId}` and check each [child](../agent/child.md)'s status. `timer` wakes on schedule, `event` needs a [wake source](../agent/wake-source.md), and `budget-pause` waits for a person to resume it. When a person can answer an event wait, the run's `wait.answerWith` names the signal and the card's Answer button sends it. <!-- id:CQeTvjby -->
  3. `StopSession` aborts the live turn AND cancels every run rooted at the session, including descendants. `CancelRun` on any run id is the finer kill switch, and it cascades to that run's subtree. <!-- id:_4-Jmfw6 -->
  4. Restarting the service is always safe: sweep and reconcile recover every documented crash window. <!-- id:KkC31s6i -->

# Runs stay `queued` and nothing starts

Check `/api/health`. `dispatch: {paused: true, reason}` means the queue has stopped claiming runs, and the reason says why; the one cause is free disk space under the database below `SEED_APPS_MIN_FREE_DISK_MIB` (default 512 MiB), shown in `disk`. Runs already in flight finish; queued ones, including the turn behind a message a person just sent, wait. Free space and dispatch resumes on its own within a second. Setting the floor to `0` turns the check off, and then a turn that starts on a full disk fails with "The turn could not be recorded" instead. See the [run queue](./run-queue.md#when-dispatch-pauses).

# A tool result says "Interrupted while …"

The call was cut off mid-effect and the [effect outbox](../agent/effect-outbox.md) could not tell whether it finished. The text names the effect (publishing, writing a memory file, running code, a named callable) and says whether the server process died or only the run ended. The model is told to check before repeating it; a person can do the same from the named address. A call that finished before the restart is answered from its receipt and never shows this text; a call that never began simply runs. The row is in `effect_outbox`, keyed by `<session_id>:<tool_call_id>`.

# A delegate row says "Starting the child…" but the child is alive <!-- id:s0To9423 -->

The row links to its child through the parent transcript's `tool_spawn` event. [`delegate`](../agent/delegate.md) appends that event as soon as the child run and session exist, so you can open a live delegation while the child is still queued or its model is still processing the prompt. A call whose spawn threw before the child was enqueued has no such event, and the row falls back to the run tree, where the child run's `parent_tool_call_id` names the call. If a row with a live child still shows the spinner text, check `GetSession` for a `tool_spawn` with that `toolCallId`. <!-- id:HHClNS7Y -->

# Children ran but the parent never resumed <!-- id:hSOtRslw -->

Checklist, in order: <!-- id:3hMFhTPK -->
  1. **Was the child awaited?** `delegate` with `await: false` is detached by design. The child joins the parent's run tree (visible in the progress card), but it never resolves a result and never wakes the parent. Check the parent transcript for the `delegate` input the model sent. If the model keeps detaching work whose result it needs, report it as a prompt problem. The verb's description steers the model to the awaited default. <!-- id:2jUcM9sM -->
  2. Run `ListRuns {rootRunId}` on the parent's root and check whether the children are terminal while the parent is `waiting`. The parent's `wait_cbor.toolCallIds` should shrink as each child's finalizer appends the durable `delegate` tool_result. A restart runs `#reconcileWaitingRunsAtBoot`, which replays any child that finalized without resolving its parent. That pass exists because a child's terminal commit and its parent's wait resolution are separate transactions. <!-- id:qVv02EZb -->
  3. A child that never delivered a required [typed result](../agent/typed-result.md) does not vanish quietly. The parent run records `unmetObligations: [{kind: 'typed-result'}]`, which `GetRun` returns and the card shows. <!-- id:0bGn2DdH -->
  4. Where errors surface: a failed run's `error_cbor` shows in `RunInfo.error` and on the card. Failed script effects appear as `result {status: 'failed'}` [journal](../agent/journal.md) entries, visible in the card's Activity drawer and in `GetRunJournal`. Agent-run failures also append a durable session `error` event after retries run out. <!-- id:kUlpL23z -->

# Script child misbehaving <!-- id:H5mKTBzC -->

- `GetRunJournal {runId}` is the flight recorder for a [script](../agent/script.md) run: every effect (`call` and `result`), timer, wait and event, log, step, and plan change, in order. The desktop Activity drawer renders the same stream. <!-- id:54qlgZW1 -->
- `fuel-exhausted` means more than 2s of pure compute between awaits: move heavy work into `ctx.call('execute', …)`. `journal-cap` means more than 5,000 entries or 8 MiB: split the job, or bound a long loop with [`ctx.continueAsNew`](../agent/continue-as-new.md). `workflow-deadlock` means the script awaited a promise that did not come from `ctx`. <!-- id:y3nBAF_m -->
- Sleeps of 60s or more park the run (`waiting` + `not_before`). The dispatcher wakes due timers every second. <!-- id:_2iWQq2C -->
- A resumed script replays its source against the [journal](../agent/journal.md), matching effects by content key and not by arrival order. An effect whose key has no journaled group executes fresh. A `{description}` narration stays out of the key, so editing a label does not invalidate a journal. <!-- id:L_CPnU0z -->

# A plan step closed itself, or a checklist froze <!-- id:3P_emtsM -->

In both cases the runtime is keeping the card accurate, and both show in the [plan](../agent/plan.md) snapshot: <!-- id:F7NA6psv -->
  - A [step](../agent/step.md) marked `done` with `resolvedBy: 'runtime'` was closed by the runtime: every child [attached](../agent/attachment.md) to that step came back succeeded. The runtime only derives success this way. It does not decide what a failed child means. <!-- id:OZrCmakv -->
  - A plan with `settledAt` set has had every step reach a terminal status. At that point the card can leave the pinned slot and freeze into the log. An edit that reopens a step clears `settledAt`. <!-- id:9Qz3i792 -->
  - A settled plan disappears from `SessionInfo.plan` on the next user message, and the settled copy stays on the run that owned it (`RunInfo.plan`). [Plan](../agent/plan.md) explains retirement. <!-- id:TqxWfNmA -->

# See also

- [Runs](../agent/runs.md), [park](../agent/park.md) and [wake source](../agent/wake-source.md), the concepts
- [Journal](../agent/journal.md) and [script](../agent/script.md), for script runs
- [Effect outbox](../agent/effect-outbox.md), for interrupted tool calls
- [Run queue](./run-queue.md), the operator's settings
- [Persistence](./persistence.md), the tables behind `ListRuns` and `GetRunJournal`
- [Troubleshooting](./troubleshooting.md), every other symptom
