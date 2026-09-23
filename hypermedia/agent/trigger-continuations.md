---
name: Trigger Continuations
summary: The dated record of the headless tool and script continuations that let a trigger firing run code with no model, shipped 2026-08-30 and now documented on the triggers reference.
---
Shipped 2026-08-30. A [trigger](./trigger.md)'s **continuation** is what a [firing](./firing.md) does. Before this change, every firing either started a thread (a model read the prompt plus the event) or woke a [parked](./park.md) run. Two new kinds run **without a model**: `tool` makes one journaled tool call, and `script` runs a workflow module headlessly. Both run as a `workflow` run linked from the firing. An optional `onFailure: 'thread'` setting escalates into the ordinary trigger thread when the run fails. <!-- id:XD4Qi5MN -->

The [triggers](./triggers.md) reference documents the full behaviour: the `$event` input template, the write-time checks, the firing statuses (`running`, `succeeded`, `escalated`), and the desktop forms. Read that page for current details. <!-- id:2qL6qb69 -->

What changed in the code at the time: <!-- id:kS3wzUEz -->
  - `TriggerContinuation` gained the `tool` and `script` members and `TriggerFailurePolicy`. <!-- id:xxOC2BqQ -->
  - `trigger_firings` gained a `run_id` column. <!-- id:LU7FUkYl -->
  - Every fire site calls one entry point. It enqueues the headless run with no session and a deterministic id (`firing-<id>`), so a duplicate firing does nothing. <!-- id:5W_h03NG -->
  - A failed run with `onFailure: 'thread'` starts a recovery session titled `<trigger> — automation failed: <summary>`, with the failure attached inside `<trigger_context>`. <!-- id:fBP9Sk0A -->
  - The model-facing [contract](./contract.md) at `read ~/triggers/` and the `~/tools/write/triggers` guide gained the example of authoring a tool and then wiring a webhook to it. <!-- id:IDKahYby -->

Limits that still hold: <!-- id:W1lYXbqZ -->
  - Headless runs have `maxAttempts: 1`, so there is no automatic retry. <!-- id:nOByTf36 -->
  - The write-time tool check consults the registry and the agent's [tool documents](./tool-document.md), but not `definition.tools` narrowing. An excluded tool fails at run time, and the workflow's usual "not available" error is recorded on the firing. <!-- id:_KrDJgL2 -->
  - `ctx.delegate` from a trigger [script](./script.md) creates a top-level session. <!-- id:WH-gbJ2z -->
  - A trigger script can call `execute` only where the server offers code execution. <!-- id:qLIVl-xn -->

Tests: the headless cases in `trigger-events.test.ts`, the webhook `$event.payload` path in `main.test.ts`, the validation and explanation cases in `verbs.test.ts`, and the `run_id` column assertions in `sqlite.test.ts`. <!-- id:ldFwNcSx -->

# See also <!-- id:u_3B0EZD -->

- [Triggers](./triggers.md), the full reference. <!-- id:nITUUfsA -->
- [trigger](./trigger.md) and [firing](./firing.md), the term pages. <!-- id:IXkMimpz -->
- [script and ctx](./script.md) and [journal](./journal.md), for how a headless script runs. <!-- id:KjCB1iyu -->
- [tool document](./tool-document.md), for the tools a `tool` continuation calls. <!-- id:9fyj5PIM -->
- [Roadmap](./roadmap.md), for trigger documents. <!-- id:q_GgHHEX -->
