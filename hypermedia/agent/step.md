---
name: Step
summary: A plan step is one checklist item with a stable id that persists and a human label that models may rename.
---
A **step** is one checklist item in a [plan](./plan.md), with a stable `id` and a human `label`. Models rename labels freely, and ids persist. <!-- id:fv9UhrFE -->

A step's `status` is `pending`, `running`, `done`, `failed` or `skipped`. `failed` and `skipped` are terminal: they write the step off. The runtime marks a running step `done` itself when every [child](./child.md) attached to it succeeds (see [plan](./plan.md#runtime-settlement)). A step left `pending` or `running` when a turn ends is an [obligation](./obligations.md), unless children are still working on it.

# See also <!-- id:1UuYF0qj -->

- [Plan](./plan.md) <!-- id:55Q1hxAu -->
- [Attachment](./attachment.md) <!-- id:Yc18R2RU -->
- [Batch step](./batch-step.md) <!-- id:8gD1ckyH -->
- [Obligations](./obligations.md)
- [Agents glossary](./glossary.md) <!-- id:ZL0rB32c -->
