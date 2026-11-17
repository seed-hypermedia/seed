---
name: Plan
summary: The plan verb keeps a thread's visible checklist, which shows as a card and not as a log entry.
---
**plan** keeps the thread's visible checklist of [steps](./step.md). Plan calls do not appear in the [log](./log.md). The checklist shows as the run card. <!-- id:yDb_6JvA -->

This page is the reference for the verb: the shape of a plan, how the model is reminded of it, and how the runtime settles a step. What happens when a turn ends with steps unfinished is on [obligations](./obligations.md).

# The checklist <!-- id:zu6_3lwq -->

Maintains the thread's visible checklist: `{title?, steps: [{id, label, status: pending | running | done | failed | skipped}]}`. Each call replaces the whole plan. The plan is stored on `sessions.plan_cbor` and writes **no transcript event**, because the checklist is a card and not part of the conversation. The server stamps the owning run id. When every [step](./step.md) settles, it copies that snapshot onto the run, so the completed plan stays in transcript history even after a later turn replaces the session's mutable plan. <!-- id:rWxol_cq -->

A [child](./child.md) spawned while a step is running belongs to that step (see [attachment](./attachment.md)), and one step can own a whole parallel batch (see [batch step](./batch-step.md)). A script edits its checklist with `ctx.plan` and `ctx.step` (see [script](./script.md)).

# What the model sees

The runtime handles one consequence of this directly. A model resuming after its children finished cannot see the list it published. So `planStateBlock()` (`api-service.ts`) rebuilds a `<plan_state>` block from session state on **every turn** and sends it behind the turn's input with every request of that turn. It is never stored. The transcript keeps exactly one copy of the truth, and the log records what happened, never what the runtime reminded the model about. Step ids and labels are model-authored text handed back inside a frame whose syntax the model knows, so both go through `escapeActionFraming()`. <!-- id:6gIaYQei -->

# Runtime settlement

When every run attached to a running step comes back `succeeded`, `#settlePlanStepFromChildren()` (`api-service.ts`) marks the step `done` with `resolvedBy: 'runtime'`. Only success settles a step. What a failed child means is a judgment the model makes, and the continuation loop exists to make it ask. Model input can never forge `resolvedBy`. `normalizeRunPlan` reads only what the model may say, and `#carryResolvedBy()` (`api-service.ts`) carries the runtime's mark across later writes while the step stays done. It drops the mark if the step is reopened or written off. <!-- id:mCLG-mEC -->

# See also <!-- id:i7_Fe0A- -->

- [Step](./step.md) <!-- id:IJEZtLIB -->
- [Attachment](./attachment.md) <!-- id:kknnBLnN -->
- [Batch step](./batch-step.md) <!-- id:VvR8GAnf -->
- [Log](./log.md) <!-- id:oAv0oY8Y -->
- [Obligations](./obligations.md)
- [Tools](./tools.md) <!-- id:RGlvUK1s -->
- [In the app: the run card](./in-the-app.md) <!-- id:oWJC26lu -->
