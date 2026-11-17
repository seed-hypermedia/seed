---
name: Delegate
summary: The delegate verb spawns a child run, a model child given a brief or a script child given source, and waits for it unless told not to.
---
**delegate** spawns a [child](./child.md) run. A **model child** gets a [brief](./brief.md), and a **script child** gets a `script` (see [script and ctx](./script.md)). The parent waits for the result unless the call sets `await: false`, which detaches the child. <!-- id:heu3gUxG -->

This page is the reference for the verb. How deep and how wide a tree may grow is on [delegation budgets](./delegation-budgets.md).

Spawns a [child](./child.md) run. There are two kinds of child and one verb (`api-service.ts`). <!-- id:ApEK039O -->

# Model child <!-- id:9vaS9oaE -->

**Model child.** Pass `brief`: human-readable markdown that becomes the child conversation's first message **verbatim**. The user reviews it as the child's full context. See [brief](./brief.md). <!-- id:n7YXckLv -->
  - `prompt` gives an anonymous worker persona. <!-- id:F_DmeZ4g -->
  - `tools` narrows the child's set (`narrowDefinitionTools`). It is intersected against the parent's full callable set, with one translation: the child keeps `publish` only when its `tools` ask for `write` or `publish`. A child that does not ask to write gets a read-only posture. Every grant can only narrow. <!-- id:6Qet4VLC -->
  - `model` runs the child on one of the agent's enabled models ("provider/model", or a bare model id when unambiguous). `resolveDelegateModelRef()` resolves it at spawn time against `enabledModels` plus the active pair, then stores it as the child session's model override. The user's quick-switch uses the same mechanism, so run resolution and every client surface agree on what ran. <!-- id:RspuTIWZ -->
  - `model` and `reasoningLevel` travel together (`normalizeDelegateModelChoice()`). A `model` without a `reasoningLevel` (`off` or one of the levels) is refused, with no default. A level without a model is refused too. Omitting both inherits the agent's configured model and level. This stops a child from silently running the agent's model with reasoning off: an override stores the level explicitly, and an absent level on an override means off. <!-- id:Qla1n252 -->
  - Agents with more than one enabled model get system-prompt guidance to route cheap mechanical subtasks to cheaper models and hard reasoning to the strongest. <!-- id:dof-ASpS -->

A child always runs as the delegating agent. There is no direct agent-to-agent delegation. A transcript that an agent's collaborators or the public can read must never leak the account's other agents or carry their briefs and results. Cross-agent collaboration happens through Seed content (documents and comments), where the [capability](../protocol/permissions.md) system governs access. A stray `agentId` is refused loudly at both the spec and dispatch layers. <!-- id:EaXmZDVV -->

`output` declares a JSON schema for a validated [typed result](./typed-result.md), delivered through `return_result`. Without it the result is `{text}`. `normalizeSubSessionSpec()` (`api-service.ts`) accepts `input` as an alias for `brief`, and reads a bare `prompt` as the brief instead of bouncing the call. Models write the task into `prompt` often enough that a retry is worse than a rescue. <!-- id:_j0ELcwy -->

# Script child

Pass `script`: a module that runs in an in-process engine and reaches the world only through a `ctx` object. Scripts are always awaited. The `ctx` API and the rules for scripts are on [script and ctx](./script.md).

# Parallel and detached children

Spawn independent children together. Every `delegate` call in one reply runs at the same time. The turn then [parks](./park.md) (cheaply, and restart-proof) until all of them resolve, and each call receives its own result. `await: false` detaches: the child runs with the brief as its first message and returns nothing. `output` and `tools` are then rejected loudly, never silently discarded (`api-service.ts`). `model` is still honored, resolved against the agent's enabled models. <!-- id:2N0kICDu -->

# Limits

A run at the bottom of its budget is a leaf and gets no `delegate` verb at all. Budgets, the thoroughness presets and leaves are on [delegation budgets](./delegation-budgets.md).

# See also <!-- id:lTv7TOX0 -->

- [Child](./child.md) <!-- id:X5dcRFQ2 -->
- [Brief](./brief.md) <!-- id:Ec7n0onM -->
- [Script and ctx](./script.md) <!-- id:B7cl_JmU -->
- [Typed result](./typed-result.md) <!-- id:28t3rxxP -->
- [Park and wait](./park.md) <!-- id:XBmpV4tW -->
- [Delegation budgets](./delegation-budgets.md)
- [Runs](./runs.md)
- [Tools](./tools.md) <!-- id:ZPjXIqBW -->
