---
name: Child
summary: A child is a helper run that an agent starts with the delegate verb, either a model with its own conversation or a script.
---
A **child** is a helper [run](./runs.md) that an [agent](../agent.md) starts with [delegate](./delegate.md). The run that starts it is its parent. There are two kinds. A model child is a model with its own [session](./session.md) (its own conversation), and it starts from a [brief](./brief.md). A [script](./script.md) child is code that runs in the QuickJS engine. <!-- id:QGIGEjGR -->

What is true of every child:

- It runs as the agent that delegated, never as another agent.
- Its [grants](./grants.md) can only be the same as its parent's or narrower.
- A model child returns `{text}`. It returns a [typed result](./typed-result.md) when the parent gave an `output` schema.
- While its children work, the parent [parks](./park.md): it waits and uses nothing.
- The [delegation budget](./delegation-budgets.md) sets how many children a run may start, and how deep the tree may go.
- In a [plan](./plan.md), a child belongs to the step that was running when it started (see [attachment](./attachment.md)).

# See also <!-- id:lUkpI4p7 -->

- [Delegate](./delegate.md) <!-- id:Me9y0HOz -->
- [Runs](./runs.md) <!-- id:vCjeAvyV -->
- [Brief](./brief.md) <!-- id:tgbfCH5D -->
- [Script and ctx](./script.md) <!-- id:4iqd8UF0 -->
- [Typed result](./typed-result.md) <!-- id:xAWgQDJk -->
- [Park and wait](./park.md) <!-- id:LE9GJ1ys -->
- [Delegation budgets](./delegation-budgets.md)
