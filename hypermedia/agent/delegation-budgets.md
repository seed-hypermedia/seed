---
name: Delegation Budgets
summary: A delegation budget sets how deep a tree of delegated runs may go and how many children each run may start, chosen as a thoroughness preset.
---
A delegation budget bounds the tree of [runs](./runs.md) that [delegate](./delegate.md) can grow: how deep it may go and how many [children](./child.md) one run may start. A person picks it as a **thoroughness** preset. This page covers the presets, what a run at the limit looks like, what the model is told about its budget, and the wall-clock budget of a script.

# Depth and fan-out

Depth and fan-out are a per-tree budget, set per run. Every root run (a user's turn, a trigger firing, a continuation successor, a retry) is created with `budget.maxDepth` and `budget.maxChildren`. The values come from the session's `thoroughness` override, or else from the agent definition. Every child copies its parent's budget, so a whole tree follows one setting even if the user changes it mid-run. The presets (`THOROUGHNESS_PRESETS` in `apps/protocol/src/delegation.ts`) are quick (depth 1, 4 children per run), normal (3, 10), and deep (5, 16). `normal` is the default. Depth counts model children only. A script child does not count (`#delegationDepth`), so root, script, worker, sub-worker is depth 2, and the tree the user sees matches what the limit counts. (The `depth` on a run row counts every ancestor, scripts included; the budget's depth is this model-only count.) <!-- id:OzDe9cN0 -->

# Leaves

A run at the budget's depth is a leaf. It gets **no delegate verb at all** and no spawn handlers (`#delegationStatus`, `canDelegate`), and its system prompt says so ("You are a leaf worker…"). It never gets a verb whose every call is refused and costs a turn. <!-- id:44rasYwX -->

# What the model is told

Every non-leaf turn's prompt states its depth, how many children a run may start, and whether its children could delegate further. Once a run has started a child, a `<delegation_budget>` block with each turn's input says how many are left. A parent whose children will be leaves is told to give them self-contained briefs (`delegationPrompt()`). A resolved child's `tool_result` also carries `delegation: {depth, maxDepth, childCouldDelegate, parentChildrenRemaining, parentMaxChildren}`. The parent's count there is the live one; the system prompt itself carries no running count, so it stays the same across a park and resume. `~/self` shows the agent's preset and limits. <!-- id:Ok1umdMw -->

When a run uses its last slot, `childrenExhaustedMessage()` tells it to finish alone now, and how to pack the next long list: several items per brief, or one script child whose children draw on their own budget. <!-- id:ENgm3Xcs -->

# Choosing thoroughness

A person picks the preset where they pick the model: the agent's Settings tab and the model badge on a session. A new agent starts on Normal; the Create Agent dialog does not ask. That includes the assistant panel's draft chat, whose choice goes with `CreateSession`. A session's change applies from its next root run, because running trees keep the budget they copied. A script run also knows a wall-clock budget, `maxWallMs`: the workflow executor parks the run with the `budget-pause` wait reason until a person resumes it (the run page's **Resume** button sends a `resume` signal through `SignalRun`). Model runs are never budget-paused. Nothing in the app environment sets `maxWallMs` when it creates a run. <!-- id:gd7-bOM2 -->

# See also

- [Delegate](./delegate.md)
- [Child](./child.md)
- [Runs](./runs.md)
- [Park and wait](./park.md)
- [Typed result](./typed-result.md)
- [Security](./security.md)
