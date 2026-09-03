# Delegation budgets: where #1070 leaves us, and the next project

Written 2026-09-10 alongside PR #1070 (budgeted delegation with thoroughness presets). The first half records what that
PR built and why it is only a first step. The second half is a proposal for the project that follows: **budget pauses
and tree budgets**, which turns a hard cap the model bumps into, into a negotiation with the person paying for the work.

## What #1070 built

- Every root run (a user turn, a trigger firing, a continuation successor, a retry) is created with a `RunBudget`
  (`maxDepth`, `maxChildren`) from the session's thoroughness, else the agent's, else `normal`. Every child copies its
  parent's budget, so one tree answers to one setting.

  | Preset | Max depth | Children per run |
  | ------ | --------- | ---------------- |
  | quick  | 1         | 4                |
  | normal | 3         | 10               |
  | deep   | 5         | 16               |

- **Depth counts model children only.** A script is orchestration, not thinking, so `root → script → worker` is depth 1.
- **Leaves lose the verb.** A run at the budget's depth gets no `delegate` tool and a prompt that says so, so it never
  tries. This removed the failure that motivated the PR (122 refusals across 67 of Ion's sessions in two weeks).
- **Width is still a refusal.** A run may need the verb until its last slot is used, so the eleventh spawn is refused.
  #1070 softens this two ways: every child result carries `delegation.parentChildrenRemaining` (the live count — the
  system prompt is built once per run and goes stale after the first batch), and the refusal says what works from there
  (finish alone now; next time, several items per brief or one script child, whose own children draw on a separate
  budget).
- **Thoroughness is chosen where the model is chosen**: agent Settings, the Create Agent dialog, and the session model
  badge (including the assistant panel's draft chat, whose choices ride `CreateSession`).

## Why this is not the end state

**The cap is a proxy.** Depth and fan-out are stand-ins for what the person actually cares about: money, time, and
whether the answer is good. A tree that spends its budget as three deep chains or as one wide fan-out should be free to
choose; shape caps should be safety rails, not the operative signal.

**Exhaustion degrades silently.** When the last slot is used mid-task, the model is told to "finish the remaining work
yourself." That is the right instruction for a model with no one to ask, and the wrong outcome for a person who would
gladly have paid for two more helpers. Nothing in the UI says the task was scaled down.

**Headless runs have no policy.** A trigger firing at 3 a.m. gets the same refusal and the same "finish alone", with
nobody to notice.

**Changing the budget mid-flight is many writes.** Children copy the budget, so raising it for a running tree means
touching every run in it. Today nothing does, which is why a session's thoroughness only applies from the next run.

**Scripts are blind.** A script cannot read its budget, so `ctx.parallel` over thirty items throws on the eleventh
delegation unless the author guessed the limit.

**The escape hatch is accidental.** `continue_session` starts a fresh root run with a fresh budget, so a foreground
conversation can always out-run the cap. That is fine as a per-turn bound, but it means the cap bounds a turn, not a
task, and the person never sees the cumulative spend.

## Principles for the harness

1. **Budgets are about cost.** The operative budget is denominated in tokens (later: dollars) and wall time, per tree.
   Depth and fan-out stay as high safety rails against runaway trees.
2. **Budget state is part of every observation.** The model never learns a limit from a refusal. Either the affordance
   is removed (leaves) or the remaining budget is visible in every tool result, the way the context meter is visible.
3. **Exhaustion escalates to a person; it does not degrade quietly.** A run that runs out of budget parks and says what
   it has done, what remains, and what it would cost to continue. The person is the budget authority.
4. **Presets are a-priori intent; the pause is runtime negotiation.** Quick/Normal/Deep answer "how much am I willing to
   spend before I have seen anything." The pause answers "it turned out to need more; do you want to pay for it." Both
   are needed: presets without the pause force a guess; a pause without presets interrupts every task.
5. **Headless runs carry a policy, not a pause.** The agent definition says what to do with nobody watching: pause and
   wait, finish alone, or fail. Chats default to pausing; triggers default to finishing alone and noting it.
6. **The tree owns the budget; children reference it.** One object at the root, read by every descendant, so a grant is
   one write and a meter is one query.
7. **The person sees the tree, its spend, and its remaining budget, and can raise or stop it.** The pause renders as a
   card with three choices — continue with more, finish without helpers, stop — and that card is the whole interaction.

## Proposal: budget pauses and tree budgets

Scope: one project, three milestones, each shippable. Cost-denominated budgets are milestone 3 because they need the
meter from milestone 2 to be legible.

### Milestone 1 — the pause card

Reuse what exists. `runs.ts` already has a `budget-pause` wait reason ("only a person resumes it"), a wall-clock budget
(`maxWallMs`) that produces it, and `resumeBudgetPause()` which drops the exhausted dimension and requeues. Generalize
it from wall time to every dimension.

- **Server.** When a spawn would exceed `maxChildren` (or a script child would), and the run's exhaustion policy is
  `pause`, the run parks with `{reason: 'budget-pause', note, exhausted: 'children' | 'depth' | 'wallMs', pending}`
  instead of throwing. `pending` is the spawn request that was refused, so resuming replays it: the model's turn is not
  interrupted, its delegate call simply resolves later. The parent's `tool_call` stays open exactly as it does for an
  awaited child.
- **Resume.** `resumeBudgetPause(runId, grant)` raises the exhausted dimension on the tree's budget (milestone 2) or,
  before that, on this run and its descendants, then replays `pending`. A second action, `finishWithoutHelpers`,
  resolves the pending call with the exhaustion message #1070 already writes, so the model finishes alone. Stop is the
  existing cancel.
- **Policy.** `AgentDefinition.onBudgetExhausted?: 'pause' | 'finish' | 'fail'`; runs started from a session default to
  `pause`, runs started by a trigger default to `finish`. A `finish` outcome appends a note to the run result so the
  person reading it later sees the task was scaled down.
- **UI.** The run card (progress card in the session, run page, assistant panel) renders a paused run as a card: "Paused
  after 10 helpers: 12 items remain. Continue with 10 more · Finish without helpers · Stop." The model's own `status`
  text supplies the "12 items remain" line when it exists; the note is the fallback.
- **Model-facing.** Nothing new to learn: the delegate call blocks, as it already does while a child runs.

Tests: a spawn past the cap parks instead of throwing under `pause`; resume with a grant replays it and the child runs;
finish resolves the call with the exhaustion message; a trigger-started run finishes alone and its result carries the
note.

### Milestone 2 — tree budgets and the meter

- **Data model.** Add `runs.budget_run_id` (the root of the tree that owns the budget; the root points at itself).
  `#delegationLimits(run)` reads the owner's `budget_cbor`. Children stop copying the budget. Migration: backfill
  `budget_run_id` from the parent chain; runs with no owner keep today's copy-on-spawn behaviour.
- **Consumption.** `RunUsage.children` already rolls finished children up into the parent; roll it up to the owner too
  (one more `UPDATE` when a run finalizes) so the tree's spend is one row read. Count children the same way:
  `budget_used_cbor` on the owner with `{children, deepest, tokens, wallMs}`.
- **Live budget in every observation.** Replace `parentChildrenRemaining` with a `budget` block on every child result
  and on `~/self`: `{remaining: {children, depth, tokens?}, used: {...}, limits: {...}}`. The system prompt keeps its
  once-per-run summary; the results carry the live numbers.
- **Scripts.** `ctx.budget()` returns the same block; `ctx.delegate` past the cap throws a typed `BudgetExhausted` error
  the script can catch, or — under the `pause` policy — parks the script exactly like a model run (the workflow host
  already parks on `waitForEvent`; this is one more wait reason).
- **Mid-flight changes apply.** Changing a session's thoroughness while a tree runs updates the owner's budget, so the
  next spawn sees it. "Continue with 10 more" becomes one write.
- **Meter.** Beside the context meter: a budget meter for the session's current tree — children used of allowed, tokens
  so far, time so far. Click opens the run tree. The same numbers render on the pause card.

Tests: a grant on the owner is seen by a grandchild's next spawn; usage rolls up across three levels; a script reads its
budget and chunks; a mid-flight thoroughness change applies to the next spawn.

### Milestone 3 — cost-denominated budgets

- Add `maxTokens` to `RunBudget` and to the presets, chosen so that a `normal` tree today rarely hits it. The presets
  become budget templates: `{maxDepth, maxChildren, maxTokens, maxWallMs}`.
- The pause fires on tokens like any other dimension; the card says "spent 1.2M tokens of 1M".
- Later, dollars: per-provider pricing is already partly known (`model-capabilities`); a `maxUsd` dimension is the same
  mechanism with a price table.
- Shape caps stay, raised to safety-rail values (`deep` might become depth 6, 32 children) once tokens are the operative
  bound.

### Performance and cost notes

- Every child is a full context: the agent's system prompt, memory, the space index, then the brief. Fan-out is the
  expensive part of a tree, and the meter should make that visible in tokens rather than counts.
- Prod runs 8 model runs at a time (`run-concurrency.md`). A fan-out of 16 finishes no faster than 8; the prompt should
  say the effective parallelism so the model prefers fewer, larger children and scripts for mechanical work.
- The extra queries in #1070 (a recursive CTE for depth, a count for children) run once per turn and per spawn on cached
  statements; milestone 2 replaces the count with a read of the owner row.

### Non-goals

- Queueing spawns past the cap as a concurrency limit. The cap bounds cost per turn; a throttle bounds nothing.
- Per-account or per-server budgets. Those are the resource manager's job (see the Supe project); this is per tree.
- Changing how `continue_session` budgets successors. A successor is a new tree by design; the meter should show the
  chain's cumulative spend, but the budget resets.

### Open questions

- Should "Continue with more" grant a fixed increment (one more preset's worth) or ask for a number? Start fixed.
- Where does the pause card live for a background tree with no session open — the agent's activity feed?
- Should a paused run time out (auto-finish after a day) so an abandoned pause does not hold a tool call open forever?
  Probably yes, with the note explaining it.
