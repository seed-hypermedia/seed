---
name: Attachment
summary: A child spawned while a plan step is running is attached to that step, so the step row is the way into the child.
---
**attachment**: a [child](./child.md) spawned while a [plan](./plan.md) [step](./step.md) is running belongs to that step, and the step row in the run card is the way into the child. The runtime joins them by **planStepId**, the step's stable id, and falls back to the label for older runs. <!-- id:Otwq7Wqa -->

# See also

- [Step](./step.md)
- [Batch step](./batch-step.md)
- [Child](./child.md)
- [Plan](./plan.md)
- [Desktop UI: the run card](./desktop-ui.md)
- [Agents glossary](./glossary.md)
