---
name: Delegation Budgets
summary: A proposal, not started as of September 2026, to let a person answer budget pauses, give each run tree one shared budget, and count budgets in tokens and money.
---
Written 2026-09-10 alongside PR #1070 (budgeted delegation with thoroughness presets). What that PR built is now reference material on the [tools](../tools.md) page, with a summary below. The rest of this page proposes the next project, **budget pauses and tree budgets**. In it, a hard cap that the model hits becomes a question for the person paying for the work. Status as of 2026-09-16: proposed, not started. <!-- id:ZtY71Q3g -->

# What shipped in #1070 <!-- id:ujIb66Pu -->

Every root [run](../runs.md) gets a depth and fan-out budget from the `quick`, `normal`, or `deep` thoroughness preset, and every [child](../child.md) copies it. A run at the budget's depth loses the [delegate](../delegate.md) verb. Past the fan-out limit a spawn is refused, and each child result carries the parent's live remaining count. The full reference, with the preset table, is under `delegate` on the [tools](../tools.md) page. Leaves removed the failure that motivated the PR: 122 refused delegations across 67 of Ion's sessions in two weeks. <!-- id:veZugn5a -->

# Problems with the current caps <!-- id:rvk6vgyB -->

**The cap is a proxy.** Depth and fan-out stand in for what the person cares about: money, time, and a good answer. A tree should be free to spend its budget as three deep chains or as one wide fan-out. Shape caps should be safety rails, and something else should be the real limit. <!-- id:aG-l6Ukg -->

**Running out is silent.** When the last slot is used mid-task, the model is told to "finish the remaining work yourself." That instruction suits a model with no one to ask. It is the wrong outcome for a person who would have paid for two more helpers. Nothing in the UI says the task was scaled down. <!-- id:Gg1xwU0P -->

**Headless runs have no policy.** A [trigger](../triggers.md) firing at 3 a.m. gets the same refusal and the same "finish alone", and nobody notices. <!-- id:njm47660 -->

**Changing the budget mid-flight takes many writes.** Children copy the budget, so raising it for a running tree means touching every run in it. Today nothing does this, so a session's thoroughness only applies from the next run. <!-- id:DmVsSwRh -->

**Scripts cannot see their budget.** A [script](../script.md) cannot read its budget, so `ctx.parallel` over thirty items throws on the eleventh delegation unless the author guessed the limit. <!-- id:JNcZMx0J -->

**The escape hatch is an accident.** `continue_session` starts a fresh root run with a fresh budget, so a foreground conversation can always get past the cap. That is fine as a per-turn bound. But the cap then bounds a turn and never a whole task, and the person never sees the total spend. See [session continuation](../session-continuation.md). <!-- id:lo5dWBIa -->

# Principles for the harness <!-- id:VKpkV0xy -->

1. **Budgets are about cost.** The real budget is counted in tokens (later, dollars) and wall time, per tree. Depth and fan-out stay as high safety rails against runaway trees. <!-- id:f-ereCIi -->
2. **Every observation shows budget state.** The model never learns a limit from a refusal. Either the affordance is removed (leaves), or the remaining budget is visible in every tool result, the way the context meter is visible. <!-- id:WbzKfA2B -->
3. **Running out goes to a person.** A run that runs out of budget [parks](../park.md). It says what it has done, what remains, and what it would cost to continue. The person decides the budget. <!-- id:kace5Lh6 -->
4. **Presets set intent up front; the pause handles what comes up at runtime.** Quick, Normal, and Deep answer "how much will I spend before I have seen anything." The pause answers "it needed more; do you want to pay for it." Both are needed. Presets without the pause force a guess. A pause without presets interrupts every task. <!-- id:k2k5FhsR -->
5. **Headless runs carry a policy instead of pausing.** The agent definition says what to do when nobody is watching: pause and wait, finish alone, or fail. Chats default to pausing. Triggers default to finishing alone and noting it. <!-- id:HEqjcvg5 -->
6. **The tree owns the budget and children reference it.** One object sits at the root and every descendant reads it, so a grant is one write and a meter is one query. <!-- id:gBy_QFnb -->
7. **The person sees the tree, its spend, and its remaining budget, and can raise or stop it.** The pause shows as a card with three choices: continue with more, finish without helpers, or stop. That card is the whole interaction. <!-- id:qn3LSGTb -->

# Proposal: budget pauses and tree budgets <!-- id:FcmW-uuG -->

Scope: one project, three milestones, each shippable. Cost-denominated budgets are milestone 3 because they need the meter from milestone 2 to make sense to a person. <!-- id:OaZkTqk6 -->

## Milestone 1: the pause card <!-- id:UvmptRPZ -->

Reuse what exists. `runs.ts` already has a `budget-pause` wait reason ("only a person resumes it"), a wall-clock budget (`maxWallMs`) that produces it, and `resumeBudgetPause()`, which drops the exhausted dimension and requeues. Extend it from wall time to every dimension. <!-- id:9GIqlgjv -->
  - **Server.** When a spawn would exceed `maxChildren` (from a model run or a script child), and the run's exhaustion policy is `pause`, the run parks with `{reason: 'budget-pause', note, exhausted: 'children' | 'depth' | 'wallMs', pending}` and does not throw. `pending` is the refused spawn request, so resuming replays it. The model's turn is not interrupted: its delegate call resolves later. The parent's `tool_call` stays open, the same as for an awaited child. <!-- id:GkfwBRU1 -->
  - **Resume.** `resumeBudgetPause(runId, grant)` raises the exhausted dimension on the tree's budget (milestone 2), or before that on this run and its descendants, then replays `pending`. A second action, `finishWithoutHelpers`, resolves the pending call with the exhaustion message #1070 already writes, so the model finishes alone. Stop is the existing cancel. <!-- id:b7spH9um -->
  - **Policy.** `AgentDefinition.onBudgetExhausted?: 'pause' | 'finish' | 'fail'`. Runs started from a session default to `pause`. Runs started by a trigger default to `finish`. A `finish` outcome adds a note to the run result, so a person who reads it later sees the task was scaled down. <!-- id:iP20l2NQ -->
  - **UI.** The run card (the progress card in the session, the run page, and the assistant panel) shows a paused run as a card: "Paused after 10 helpers: 12 items remain. Continue with 10 more · Finish without helpers · Stop." The model's own `status` text supplies the "12 items remain" line when it exists. The note is the fallback. See [desktop UI](../desktop-ui.md). <!-- id:Ts5jEhbS -->
  - **Model-facing.** The model has nothing new to learn. The delegate call blocks, as it already does while a child runs. <!-- id:lKUJLUF5 -->

Tests: under `pause`, a spawn past the cap parks and does not throw. Resume with a grant replays it and the child runs. Finish resolves the call with the exhaustion message. A trigger-started run finishes alone and its result carries the note. <!-- id:Er36Q-Ee -->

## Milestone 2: tree budgets and the meter <!-- id:hD8S3g7G -->

<!-- id:toaymq2Z -->
- **Data model.** Add `runs.budget_run_id`: the root of the tree that owns the budget, and the root points at itself. `#delegationLimits(run)` reads the owner's `budget_cbor`. Children stop copying the budget. Migration: backfill `budget_run_id` from the parent chain. Runs with no owner keep today's copy-on-spawn behaviour. See [persistence](../persistence.md). <!-- id:9tUE_zlR -->
- **Consumption.** `RunUsage.children` already rolls finished children up into the parent. Roll it up to the owner too, with one more `UPDATE` when a run finalizes, so the tree's spend is one row read. Count children the same way: `budget_used_cbor` on the owner with `{children, deepest, tokens, wallMs}`. <!-- id:JfD45lOS -->
- **Live budget in every observation.** Replace `parentChildrenRemaining` with a `budget` block on every child result and on `~/self`: `{remaining: {children, depth, tokens?}, used: {...}, limits: {...}}`. The system prompt keeps its once-per-run summary. The results carry the live numbers. <!-- id:CbTvysLz -->
- **Scripts.** `ctx.budget()` returns the same block. Past the cap, `ctx.delegate` throws a typed `BudgetExhausted` error the script can catch. Under the `pause` policy it parks the script the same way as a model run. The workflow host already parks on `waitForEvent`, so this is one more wait reason. <!-- id:rhUciuJv -->
- **Mid-flight changes apply.** Changing a session's thoroughness while a tree runs updates the owner's budget, so the next spawn sees it. "Continue with 10 more" becomes one write. <!-- id:7whDMMKE -->
- **Meter.** Next to the context meter, a budget meter for the session's current tree shows children used of allowed, tokens so far, and time so far. A click opens the run tree. The pause card shows the same numbers. <!-- id:RNsuTWVr -->

Tests: a grant on the owner is seen by a grandchild's next spawn. Usage rolls up across three levels. A script reads its budget and chunks its work. A mid-flight thoroughness change applies to the next spawn. <!-- id:9Cge9T7s -->

## Milestone 3: cost-denominated budgets <!-- id:DK0dEU-8 -->

- Add `maxTokens` to `RunBudget` and to the presets, set so that a `normal` tree today rarely hits it. The presets become budget templates: `{maxDepth, maxChildren, maxTokens, maxWallMs}`. <!-- id:QDdTlZT9 -->
- The pause fires on tokens like any other dimension. The card says "spent 1.2M tokens of 1M". <!-- id:wqni9YNb -->
- Later, dollars. Per-provider pricing is already partly known (`model-capabilities`). A `maxUsd` dimension is the same mechanism with a price table. See [model providers](../model-providers.md). <!-- id:q7or2222 -->
- Shape caps stay, raised to safety-rail values (`deep` might become depth 6, 32 children) once tokens are the real bound. <!-- id:uUxZPJF- -->

## Performance and cost notes <!-- id:FIqus6FP -->

- Every child is a full context: the agent's system prompt, memory, the [Space index](../space-index.md), then the [brief](../brief.md). Fan-out is the expensive part of a tree, and the meter should show that in tokens instead of counts. <!-- id:cUntqoU_ -->
- The run queue caps model runs at 8 at a time by default (see [operations](../operations.md)). A fan-out of 16 finishes no faster than 8. The prompt should state the effective parallelism, so the model prefers fewer, larger children, and scripts for mechanical work. <!-- id:3DRsAQzP -->
- The extra queries in #1070 (a recursive CTE for depth, a count for children) run once per turn and per spawn on cached statements. Milestone 2 replaces the count with a read of the owner row. <!-- id:zYg12jUa -->

## Non-goals <!-- id:ASTP667Y -->

- Queueing spawns past the cap as a concurrency limit. The cap bounds cost per turn. A throttle bounds nothing. <!-- id:I7iSaXo9 -->
- Per-account or per-server budgets. Those belong to the resource manager (see the Supe project). This proposal is per tree. <!-- id:UIzHxbOX -->
- Changing how `continue_session` budgets successors. A successor is a new tree by design. The meter should show the chain's total spend, but the budget resets. <!-- id:6Sm3O3f9 -->

## Open questions <!-- id:Q0By_lCn -->

- Should "Continue with more" grant a fixed increment (one more preset's worth) or ask for a number? Start fixed. <!-- id:IKUE8Rpx -->
- Where does the pause card live for a background tree with no session open? The agent's activity feed is one option. <!-- id:v0LjAF2T -->
- Should a paused run time out (auto-finish after a day) so an abandoned pause does not hold a tool call open forever? Probably yes, with the note explaining it. <!-- id:gGyU1nld -->

# See also

- [Tools](../tools.md)
- [Delegate](../delegate.md)
- [Runs](../runs.md)
- [Park / Wait](../park.md)
- [Wake source](../wake-source.md)
- [Session continuation](../session-continuation.md)
- [Roadmap](../roadmap.md)
