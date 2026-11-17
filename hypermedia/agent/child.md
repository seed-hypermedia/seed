---
name: Child
summary: A child is a run spawned by the delegate verb, either a model child with its own session or a script child in the QuickJS engine.
---
A **child** is a [run](./runs.md) spawned by [delegate](./delegate.md). A model child gets its own session (thread) and starts from a [brief](./brief.md). A [script](./script.md) child runs in the QuickJS engine. <!-- id:QGIGEjGR -->

A child always runs as the agent that delegated, with grants that can only be narrower than its parent's. A model child returns `{text}`, or a [typed result](./typed-result.md) when the parent declared an `output` schema. While its children work, the parent [parks](./park.md). How many children a run may start, and how deep the tree may go, is the [delegation budget](./delegation-budgets.md). In a [plan](./plan.md), a child belongs to the step that was running when it was spawned (see [attachment](./attachment.md)).

# See also <!-- id:lUkpI4p7 -->

- [Delegate](./delegate.md) <!-- id:Me9y0HOz -->
- [Runs](./runs.md) <!-- id:vCjeAvyV -->
- [Brief](./brief.md) <!-- id:tgbfCH5D -->
- [Script and ctx](./script.md) <!-- id:4iqd8UF0 -->
- [Typed result](./typed-result.md) <!-- id:xAWgQDJk -->
- [Park and wait](./park.md) <!-- id:LE9GJ1ys -->
- [Delegation budgets](./delegation-budgets.md)
