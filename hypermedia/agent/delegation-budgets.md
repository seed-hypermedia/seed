---
name: Delegation Budgets
summary: A delegation budget sets how deep a tree of delegated runs may go and how many children each run may start, chosen as a thoroughness preset.
---
A **delegation budget** limits how much an [agent](../agent.md) can [delegate](./delegate.md). An agent's [run](./runs.md) can start [children](./child.md), and they can start children too, so the runs form a tree. The budget sets two limits on that tree: how deep it can go, and how many children one run can start. A person picks the budget as a **thoroughness** preset: quick, normal or deep.

This page covers the presets, what a run at the limit looks like, what the model is told about its budget, and the wall-clock budget of a script.

# Depth and fan-out

Every tree of runs has two limits: how deep it can go, and how many children one run can start. The limits are fixed when the root run starts, and every child copies them. <!-- id:OzDe9cN0 -->

| preset | depth (`maxDepth`) | children per run (`maxChildren`) |
| --- | --- | --- |
| quick | 1 | 4 |
| normal (the default) | 3 | 10 |
| deep | 5 | 16 |

The presets are `THOROUGHNESS_PRESETS` in `apps/protocol/src/delegation.ts`.

- A root run is a user's turn, a [trigger](../trigger.md) firing, a continuation successor, or a retry. Each is created with `budget.maxDepth` and `budget.maxChildren`.
- The values come from the `thoroughness` override on the [session](./session.md). Without one, they come from the [agent definition](./space.md).
- Every child copies its parent's budget. So a whole tree follows one setting, even if the user changes it while the tree runs.
- Depth counts model children only. A script child does not count (`#delegationDepth`). So root, script, worker, sub-worker is depth 2, and the tree the user sees matches what the limit counts.
- The `depth` on a run row is a different number. It counts every ancestor, scripts included.

# Leaves

A run at the budget's depth is a **leaf**. It gets **no delegate [verb](./tools.md) at all** and no way to start a child (`#delegationStatus`, `canDelegate`). Its [system prompt](./prompt.md) says so ("You are a leaf worker…"). It is never given a verb that refuses every call and wastes a turn. <!-- id:44rasYwX -->

# What the model is told

The model always knows its budget: <!-- id:Ok1umdMw -->

- The prompt of every turn that is not a leaf's states its depth, how many children a run may start, and whether its children could delegate further.
- Once a run has started a child, a `<delegation_budget>` tag comes with each turn's input and says how many children are left.
- A parent whose children will be leaves is told to give them [briefs](./brief.md) that stand alone (`delegationPrompt()`).
- The `tool_result` of a finished child carries `delegation: {depth, maxDepth, childCouldDelegate, parentChildrenRemaining, parentMaxChildren}`. The parent's count there is the live one.
- The system prompt carries no running count. So it stays the same when a run parks and resumes.
- `~/self` shows the agent's preset and limits.

When a run uses its last child, `childrenExhaustedMessage()` tells it to finish alone. It also says how to pack a long list next time: several items per brief, or one script child, whose children use their own budget. <!-- id:ENgm3Xcs -->

# Choosing thoroughness

A person picks the preset in two places: the agent's Settings tab, and the model badge on a session. The badge also works on a draft chat in the assistant panel; the choice is sent with `CreateSession`. A new agent starts on Normal, and the Create Agent dialog does not ask. A change on a session applies from its next root run, because a running tree keeps the budget it copied. <!-- id:gd7-bOM2 -->

# The wall-clock budget of a script

The run type has room for a time budget, `maxWallMs`. When a run has one and the time is used up, the workflow executor [parks](./park.md) the run with the `budget-pause` wait reason. The run waits until a person resumes it: the **Resume** button on the run page sends a `resume` signal through `SignalRun`.

No run pauses this way in practice. The server never gives a run a `maxWallMs`, and no action lets a caller set one.

# See also

- [Delegate](./delegate.md)
- [Child](./child.md)
- [Runs](./runs.md)
- [Park and wait](./park.md)
- [Typed result](./typed-result.md)
- [Security](./security.md)
