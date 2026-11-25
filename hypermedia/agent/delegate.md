---
name: Delegate
summary: The delegate verb starts a child run, either a model child that gets a brief or a script child that gets code, and waits for its result unless told not to.
---
**delegate** is the verb an [agent](../agent.md) uses to give part of its work to a helper. The helper is a [child](./child.md) run. For example, an agent that must summarize ten documents can start ten children, one per document, and collect their results. <!-- id:heu3gUxG -->

There are two kinds of child and one verb:

- A **model child** is a model with its own conversation. It gets a [brief](./brief.md), which is the task in words.
- A **script child** is code. It gets a `script` (see [script and ctx](./script.md)).

The parent waits for the result. The one exception is `await: false`, which lets the child go on alone.

This page is the reference for the verb. How deep and how wide a tree of children may grow is on [delegation budgets](./delegation-budgets.md).

# Model child <!-- id:9vaS9oaE -->

Pass `brief`: markdown a person can read. It becomes the first message of the child's conversation, **word for word**. The user can review it as everything the child was told. See [brief](./brief.md). <!-- id:n7YXckLv -->
  - `systemPrompt` adds instructions for the child. The agent's own [system prompt](./prompt.md) is still included, unless `includeAgentSystemPrompt` is `false`. `prompt` is the old name for `systemPrompt` and still works. `title` is the short label shown for the child. <!-- id:F_DmeZ4g -->
  - `tools` narrows the child's tools (`narrowDefinitionTools`). The child can have only [callable tools](./callables.md) its parent has. One rule is special: the child keeps the publish [grant](./grants.md) only when its `tools` ask for `write` or `publish`. A child that does not ask to [write](./write.md) can only read. A child never has more than its parent. <!-- id:6Qet4VLC -->
  - `model` runs the child on one of the agent's enabled models. Write it as "provider/model", or as a bare model id when only one enabled model has that id. `resolveDelegateModelRef()` checks it against `enabledModels` and the active model when the child starts. It is then saved as the model override of the child's [session](./session.md). The user's model switch uses the same override, so every screen agrees on which model ran. <!-- id:RspuTIWZ -->
  - `model` and `reasoningLevel` must be given together (`normalizeDelegateModelChoice()`). With neither, the child uses the agent's model and level. A `model` with no `reasoningLevel` is refused, and so is a level with no model. The level is `off` or one of the [reasoning levels](./reasoning-levels.md). <!-- id:Qla1n252 -->
  - An agent with more than one enabled model is told, in its system prompt, to give simple mechanical tasks to cheaper models and hard thinking to the strongest one. <!-- id:dof-ASpS -->

A child always runs as the agent that delegated. An agent cannot delegate to a different agent, and a stray `agentId` is refused with a clear error. The reason is privacy: other people may be able to read an agent's transcript, and it must never show the [account](../protocol/identity.md)'s other agents, their briefs or their results. Agents work together through Seed content, [documents](../protocol/documents.md) and [comments](../protocol/comments.md), where [capabilities](../protocol/permissions.md) control access. <!-- id:EaXmZDVV -->

`output` is a JSON schema for the result. The child must then return a checked [typed result](./typed-result.md) through `return_result`. Without `output`, the result is `{text}`. <!-- id:_j0ELcwy -->

`normalizeSubSessionSpec()` (`api-service.ts`) forgives two common mistakes. It accepts `input` as another name for `brief`. And when a call has `prompt` but no `brief`, it reads `prompt` as the brief. Models write the task into `prompt` often, and fixing the call is better than making the model try again.

# Script child

Pass `script`: a module of code that reaches the world only through a `ctx` object. The `ctx` API and the rules for scripts are on [script and ctx](./script.md).

- `input` is the JSON value the module receives.
- A script is always awaited. `await: false` is refused.
- `model` is refused on a script. Set it on each `ctx.delegate` inside the script.

# Parallel and detached children

Start independent children together. Every `delegate` call in one reply runs at the same time. The turn then [parks](./park.md) until all of them finish, and each call receives its own result. A parked turn costs nothing and survives a restart. <!-- id:2N0kICDu -->

`await: false` detaches the child. It runs with the brief as its first message and returns nothing to the parent. `output` and `tools` are then refused with a clear error, never dropped in silence (`api-service.ts`). `model` still works.

# Limits

Every tree of runs has a budget. A run at the bottom of its budget is a leaf and gets no `delegate` verb at all. Budgets, the thoroughness presets and leaves are on [delegation budgets](./delegation-budgets.md).

# See also <!-- id:lTv7TOX0 -->

- [Child](./child.md) <!-- id:X5dcRFQ2 -->
- [Brief](./brief.md) <!-- id:Ec7n0onM -->
- [Script and ctx](./script.md) <!-- id:B7cl_JmU -->
- [Typed result](./typed-result.md) <!-- id:28t3rxxP -->
- [Park and wait](./park.md) <!-- id:XBmpV4tW -->
- [Delegation budgets](./delegation-budgets.md)
- [Runs](./runs.md)
- [Tools](./tools.md) <!-- id:ZPjXIqBW -->
