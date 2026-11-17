---
name: Journal
summary: A script run's journal is the saved, append-only record of every effect the script performed, so a resumed run replays its code against the record and never repeats finished work.
---
A **journal** is the saved record of everything a [script](./script.md) run did. An effect is anything the script asks the host to do in the world: run a tool, start a [child](./child.md), sleep, or wait for an event. The host writes a **journal entry** before and after each effect. <!-- id:6LiAAWRR -->

The journal is what lets a script stop and start again safely. To resume a run after a park or a restart, the runtime runs the code again from the top. Each time the code asks for an effect, the runtime answers from the journal and does not perform the effect again. Only an effect with no saved result runs for real. So a finished effect never runs twice, and a script can park for days.

The table is `run_journal` in [persistence](../operate/persistence.md). Its key is the run id and `seq`, a number that counts up within one run.

Only script runs have a journal. A model run's record is the [log](./log.md) of its [session](./session.md). A script has no transcript, so the journal is also what a person sees of it. On a [run page](./in-the-app.md), the **Activity** drawer is the journal, one line per entry. The **Tool calls** list is the journal's call entries, each paired with its result. <!-- id:i98ZVBBM -->

# Journal entries <!-- id:NzcNQsdp -->

An entry is one JSON value with a `kind`. Every entry carries `callSeq`, the number of the `ctx` call it belongs to. A call and its result share one `callSeq`. <!-- id:zRFTW3yp -->

Most entries also carry a `key`, made from what the effect was (the tool and its input). On replay the host finds an effect's saved result by this key, not by its position. Position would not work: after `ctx.parallel`, the order in which effects finish depends on real timing, so a live run and its replay see effects in different orders.

<!-- id:FAj7N-pu -->
| `kind` <!-- col:NFVGWcsD --> | Written when <!-- col:po_ZW_bl --> | What it carries <!-- col:JJ1KH6pT --> <!-- id:7VTqNTua --> |
| --- | --- | --- |
| `call` | the script calls `ctx.call` (`op: 'tool'`, see [call](./call.md)) or `ctx.delegate` (`op: 'agent'`) | the tool name and input, the child run id once the child starts, and the optional `description` the script gave, which the UI shows as the row's text <!-- id:Kpv5y7uf --> |
| `result` | that call finishes | its outcome (`succeeded` or `failed`), the output, or the error with its code and whether it can be retried <!-- id:ymDHmtTU --> |
| `timer` | the script calls `ctx.sleep` | `wakeAt`, the time the sleep ends <!-- id:BP2Fi-oT --> |
| `fired` | the timer ran out and the run woke | nothing; the matching timer is done <!-- id:bnjVpEZQ --> |
| `wait` | `ctx.waitForEvent` registers a wait | `waitId`, the match the run is waiting for, an optional `timeoutAt` and a human `label` <!-- id:RBdhDmHu --> |
| `event` | the wait resolves | `waitId` and the delivered payload, or no payload when it timed out <!-- id:vKs03D8Z --> |
| `now` | the script reads the clock | the value, so replay sees the same time <!-- id:Omdeq-DP --> |
| `log` | the script calls `ctx.log` | a level and message, with optional data <!-- id:RMwtBzan --> |
| `step` | `ctx.step` starts or ends a [plan](./plan.md) [step](./step.md) | `stepId`, the label, `phase` (`start` or `end`) and whether it succeeded <!-- id:Q8f-ESXc --> |
| `plan` | the script edits its checklist | the whole plan <!-- id:kXWm2rC5 --> |

The entry types are `WorkflowJournalEntry` in `apps/src/workflow-host.ts`. The `description` on a call is only for display. It is not part of the replay key. <!-- id:uyx1PtbG -->

# Limits <!-- id:jGYB8TEa -->

A journal holds at most 5,000 entries or 8 MiB. Past that the host refuses the next entry with a `journal-cap` error. So a loop that runs for a long time should end into a fresh run with [continueAsNew](./continue-as-new.md) and not grow without limit. <!-- id:M55Nrz1W -->

A client can watch a run over a [WebSocket subscription](../build/websocket-subscriptions.md) to `runs/<rootRunId>`. It receives the journal of the whole tree when it subscribes, then every new entry as an `append` event. The UI keeps the last 500 entries of each run in memory.

# Reading it <!-- id:rw5P6MM5 -->

- `GetRunJournal {runId, afterSeq?}` in the [signed API](../build/signed-api.md) returns a run's entries in order. <!-- id:yAPi0BzU -->
- A subscription to `runs/<rootRunId>` replays the journal of every run in the [run tree](./runs.md) and then streams new entries. <!-- id:PjoWgS37 -->
- On a run page, **Activity** lists the entries and **Tool calls** shows each call with its result. A failed run's error names the `callSeq` of the call it came from, so the error chip can open that call. <!-- id:F1udfU0y -->

# See also <!-- id:rHTm9gpi -->

- [Script and ctx](./script.md) <!-- id:Po3RN5IJ -->
- [continueAsNew](./continue-as-new.md) <!-- id:jwZOmfWJ -->
- [Runs](./runs.md) <!-- id:F3z7WZUR -->
- [Park and wait](./park.md) <!-- id:YWUkk7VG -->
- [Persistence](../operate/persistence.md) <!-- id:npo2M1ss -->
- [Security: script safety](./security.md) <!-- id:NIoT76BG -->
