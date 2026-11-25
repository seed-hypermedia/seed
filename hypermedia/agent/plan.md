---
name: Plan
summary: The plan verb keeps the checklist of steps that a person sees for a thread, shown as a card and not as entries in the log.
---
**plan** is the verb an [agent](../agent.md) uses to keep a checklist of its work. Each item on the list is a [step](./step.md). A person sees the checklist as a card on the run, with each step ticked off as it finishes. Plan calls do not appear in the [log](./log.md). <!-- id:yDb_6JvA -->

For example, an agent asked to write a report might publish three steps: "Read the sources", "Write the draft", "Publish".

This page is the reference for the verb: the shape of a plan, how the model is reminded of it, and how the runtime settles a step. What happens when a turn ends with steps unfinished is on [obligations](./obligations.md).

# The checklist <!-- id:zu6_3lwq -->

A plan is `{title?, steps: [{id, label, status}]}`, where status is `pending`, `running`, `done`, `failed` or `skipped`. <!-- id:rWxol_cq -->

- Each call replaces the whole plan.
- The plan is stored on the [session](./session.md), in `sessions.plan_cbor`. It writes **no transcript event**, because the checklist is a card and not part of the conversation.
- The server records which run owns the plan.
- When every step is settled, the server copies the plan onto the run. So the finished plan stays in the history, even after a later turn replaces the session's plan.

A [child](./child.md) started while a step is running belongs to that step (see [attachment](./attachment.md)). One step can own a whole group of children that run at the same time (see [batch step](./batch-step.md)). A script edits its checklist with `ctx.plan` and `ctx.step` (see [script](./script.md)).

# What the model sees

Because a plan call writes nothing to the transcript, a model that resumes after its children finish cannot see the list it published. So `planStateBlock()` (`api-service.ts`) rebuilds a `<plan_state>` tag from the session on **every turn** and sends it with the turn's input. <!-- id:6gIaYQei -->

- The tag is never stored. The transcript keeps one copy of the truth. The log records what happened, never what the runtime reminded the model about.
- Step ids and labels are text the model wrote. They are escaped (`escapeActionFraming()`) before they go back inside the tag, so a label cannot pretend to be part of the tag.

# Runtime settlement

When every run attached to a running step comes back `succeeded`, the runtime marks the step `done` with `resolvedBy: 'runtime'` (`#settlePlanStepFromChildren()`, `api-service.ts`). <!-- id:mCLG-mEC -->

- Only success settles a step. What a failed child means is for the model to decide, and the [obligations](./obligations.md) loop makes it decide.
- The model cannot set `resolvedBy` itself. The runtime keeps its own mark on a step for as long as the step stays done, and drops it if the model reopens the step or writes it off.

# See also <!-- id:i7_Fe0A- -->

- [Step](./step.md) <!-- id:IJEZtLIB -->
- [Attachment](./attachment.md) <!-- id:kknnBLnN -->
- [Batch step](./batch-step.md) <!-- id:VvR8GAnf -->
- [Log](./log.md) <!-- id:oAv0oY8Y -->
- [Obligations](./obligations.md)
- [Tools](./tools.md) <!-- id:RGlvUK1s -->
- [In the app: the run card](./in-the-app.md) <!-- id:oWJC26lu -->
