---
name: Trigger Continuations
summary: The dated record of the headless tool and script continuations that let a trigger firing run code with no model involved, shipped 2026-08-30 and now documented on the triggers reference.
---
Shipped 2026-08-30. A trigger's **continuation** is what a firing does. Before this change every firing either started a thread (a model read the prompt plus the event) or woke a parked run. Two more kinds run **without a model**: `tool`, one journaled tool call, and `script`, a workflow module run headlessly, both as a `workflow` run linked from the firing, with an optional `onFailure: 'thread'` escalation into the ordinary trigger thread when the run fails. <!-- id:XD4Qi5MN -->

The full behaviour, the `$event` input template, the write-time checks, the firing statuses (`running`, `succeeded`, `escalated`), and the desktop forms are documented on the [triggers](./triggers.md) reference, which is the page to read. <!-- id:2qL6qb69 -->

What changed in the code at the time: `TriggerContinuation` gained the `tool` and `script` members and `TriggerFailurePolicy`; `trigger_firings` gained a `run_id` column; every fire site calls one entry point that enqueues the headless run with a deterministic id (`firing-<id>`, so a duplicate firing is a no-op) and no session; a failed run with `onFailure: 'thread'` starts a recovery session titled `<trigger> — automation failed: <summary>` with the failure attached inside `<trigger_context>`; and the model-facing contract at `read ~/triggers/` and the `~/tools/write/triggers` guide gained the author-a-tool-then-wire-a-webhook example. <!-- id:kS3wzUEz -->

Limits that still hold: headless runs have `maxAttempts: 1`, so there is no automatic retry; the write-time tool check consults the registry and the agent's tool documents but not `definition.tools` narrowing, so an excluded tool fails at run time with the workflow's usual "not available" error recorded on the firing; `ctx.delegate` from a trigger script creates a top-level session; and `execute` is callable from a trigger script only where the server offers code execution. <!-- id:W1lYXbqZ -->

Tests: the headless cases in `trigger-events.test.ts`, the webhook `$event.payload` path in `main.test.ts`, the validation and explanation cases in `verbs.test.ts`, and the `run_id` column assertions in `sqlite.test.ts`. <!-- id:ldFwNcSx -->
