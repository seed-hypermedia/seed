---
name: Journal
summary: A script run's journal is its durable, append-only record of every effect the script performed, so a resumed run replays its source against the record and never repeats completed work.
---
**journal**: a [script](./script.md) run's durable record of effects. Every time the script asks the host for something with an effect in the world, such as calling a tool, spawning a [child](./child.md), sleeping, or waiting for an event, the host writes a **journal entry** before and after doing it. To resume a run after a park or a restart, the runtime runs the source again from the top and answers each effect from the journal instead of performing it; only effects with no journaled result execute for real. Completed effects therefore never run twice, and a script can safely park for days. The table is `run_journal` in [persistence](./persistence.md), keyed by run id and a per-run sequence number `seq`. <!-- id:6LiAAWRR -->

Only script runs have a journal. A model run's record is its session [log](./log.md); a script has no transcript, so the journal is also what a person sees of it: the **Activity** drawer on a [run page](./desktop-ui.md) is the journal, one line per entry, and the **Tool calls** list is the journal's call entries paired with their results. <!-- id:i98ZVBBM -->

# Journal entries <!-- id:NzcNQsdp -->

An entry is one JSON value with a `kind`. Every entry also carries `callSeq`, the number of the `ctx` call it belongs to (the call and its result share one), and most carry `key`, a content key of the effect that replay matches on. Replay matches by content rather than by position because the continuation order after `ctx.parallel` depends on real completion timing, so a live run and its replay see effects in different orders. <!-- id:zRFTW3yp -->

<!-- id:FAj7N-pu -->
| `kind` <!-- col:NFVGWcsD --> | Written when <!-- col:po_ZW_bl --> | What it carries <!-- col:JJ1KH6pT --> <!-- id:7VTqNTua --> |
| --- | --- | --- |
| `call` | the script calls `ctx.call` (`op: 'tool'`) or `ctx.delegate` (`op: 'agent'`) | the tool name and input, the child run id once spawned, and the optional `description` the script gave, which the UI shows as the row's narration <!-- id:Kpv5y7uf --> |
| `result` | that call finishes | `status` (`succeeded` or `failed`), the output, or the error with its code and whether it is retryable <!-- id:ymDHmtTU --> |
| `timer` | `ctx.sleep` parks the run | `wakeAt`, the time the queue will requeue it <!-- id:BP2Fi-oT --> |
| `fired` | the timer elapsed and the run woke | nothing; the matching timer is done <!-- id:bnjVpEZQ --> |
| `wait` | `ctx.waitForEvent` registers a wait | `waitId`, the match the run is waiting for, an optional `timeoutAt` and a human `label` <!-- id:RBdhDmHu --> |
| `event` | the wait resolves | `waitId` and the delivered payload, or no payload when it timed out <!-- id:vKs03D8Z --> |
| `now` | the script reads the clock | the value, so replay sees the same time <!-- id:Omdeq-DP --> |
| `log` | the script calls `ctx.log` | a level and message, with optional data <!-- id:RMwtBzan --> |
| `step` | `ctx.step` starts or ends a plan step | `stepId`, the label, `phase` (`start` or `end`) and whether it succeeded <!-- id:Q8f-ESXc --> |
| `plan` | the script edits its checklist | the whole plan snapshot <!-- id:kXWm2rC5 --> |

The entry types are `WorkflowJournalEntry` in `agents/src/workflow-host.ts`. Narration (the `description` on a call) is display data and is not part of the replay key. <!-- id:uyx1PtbG -->

# Limits <!-- id:jGYB8TEa -->

A journal has a budget. When a run outgrows it the host refuses the append with a `journal-cap` error, which is why a long-lived loop should finish into a fresh run with [continueAsNew](./continue-as-new.md) rather than grow without bound. Clients that watch a run over a [WebSocket subscription](./websocket-subscriptions.md) to `runs/<rootRunId>` receive the whole tree's journal on subscribe, then every new entry as an `append` event; the UI keeps the last 500 entries of each run in memory. <!-- id:M55Nrz1W -->

# Reading it <!-- id:rw5P6MM5 -->

- `GetRunJournal {runId, afterSeq?}` in the [signed API](./signed-api.md) returns a run's entries in order. <!-- id:yAPi0BzU -->
- Subscribing to `runs/<rootRunId>` replays the journal of every run in the [run tree](./runs.md) and then streams new entries. <!-- id:PjoWgS37 -->
- On a run page, **Activity** lists the entries and **Tool calls** shows the call/result pairs; a failed run's error names the `callSeq` of the call it came from, so the error chip can open that call. <!-- id:F1udfU0y -->

# See also <!-- id:rHTm9gpi -->

- [Script and ctx](./script.md) <!-- id:Po3RN5IJ -->
- [continueAsNew](./continue-as-new.md) <!-- id:jwZOmfWJ -->
- [Runs](./runs.md) <!-- id:F3z7WZUR -->
- [Park and wait](./park.md) <!-- id:YWUkk7VG -->
- [Persistence](./persistence.md) <!-- id:npo2M1ss -->
- [Security: script safety](./security.md) <!-- id:NIoT76BG -->
