---
name: Step
summary: A step is one item on a plan's checklist, with an id that never changes and a label that a model may reword.
---
A **step** is one item on the checklist of a [plan](./plan.md). It has an `id` that never changes and a `label` that people read, such as "Write the draft". A model may reword a label freely. The id stays the same, so the runtime always knows which step is meant. <!-- id:fv9UhrFE -->

A step also has a state, in its `status` field (this is not the [`status` verb](./tools.md#status)). The state is `pending`, `running`, `done`, `failed` or `skipped`.

- `failed` and `skipped` are final. They write the step off.
- The runtime marks a running step `done` itself when every [child](./child.md) attached to it succeeds (see [plan](./plan.md#runtime-settlement)).
- A step left `pending` or `running` when a turn ends is an [obligation](./obligations.md), unless children are still working on it.

# See also <!-- id:1UuYF0qj -->

- [Plan](./plan.md) <!-- id:55Q1hxAu -->
- [Attachment](./attachment.md) <!-- id:Yc18R2RU -->
- [Batch step](./batch-step.md) <!-- id:8gD1ckyH -->
- [Obligations](./obligations.md)
- [Agents glossary](./glossary.md) <!-- id:ZL0rB32c -->
