---
name: Script / ctx
summary: A script is a child that is code and not a model, and everything it does goes through the ctx object, which records each effect in the journal.
---
A **script** is a [child](./child.md) that is code, not a model. It is a small JavaScript module. It reaches the outside world only through one object, `ctx`. For example, `await ctx.call('read', {address: 'hm://…'})` reads a [document](../protocol/documents.md), and `await ctx.delegate({brief: '…'})` starts a model child. <!-- id:FyyJwpqk -->

Scripts are deterministic: no `Date`, no `Math.random`, no `fetch`. The time comes from `ctx.now()`, which is recorded so a replay sees the same value. Every effect goes into the [journal](./journal.md), the saved record of what the script did.

Use a script when the steps are known before the work starts: a loop over a list, many children at once, a wait of hours or days. A script has no transcript. What a person sees of it is its journal.

# The module and the ctx API

A script is passed to [delegate](./delegate.md) as `script`. It is one module that stands alone: `export default async function (input, ctx) {…}`. It runs in a QuickJS-WASM engine inside the server process (`apps/src/workflow-host.ts`). <!-- id:pnR_U13Y -->

Everything outside the module goes through `ctx`:

| `ctx` member | what it does |
| --- | --- |
| `ctx.call(tool, input, {description})` | runs [`read`](./read.md), [`write`](./write.md), one of the [agent](../agent.md)'s [callable tools](./callables.md), or a [tool resource](./call.md) by its [hm:// URL](../protocol/urls.md) |
| `ctx.delegate` (also `ctx.agent`) | starts a child. If the child is canceled or fails, the promise rejects with an error whose code is `canceled` or `agent-failed` |
| `ctx.parallel`, `ctx.parallelSettled` | run several effects at the same time |
| `ctx.sleep` | waits. A sleep of 60 seconds or more [parks](./park.md) the run; a shorter one keeps the engine running |
| `ctx.minutes`, `ctx.hours` | helpers that give a time in milliseconds |
| `ctx.waitForEvent(match, {timeoutMs, label})` | waits for an event. It resolves `null` when the time runs out |
| `ctx.continueAsNew` | ends this run and starts a fresh one (see [continueAsNew](./continue-as-new.md)). It never resolves |
| `ctx.step`, `ctx.plan` | edit the script's [plan](./plan.md) |
| `ctx.now` | the time, recorded in the journal |
| `ctx.log`, `ctx.progress` | write a message or a progress note |
| `ctx.input`, `ctx.runId` | the input value and the id of this run |

`TextEncoder` and `TextDecoder` are also there.

Two rules:

- A script is always awaited. A detached script child is refused.
- Every effect goes into the journal. So when a run resumes after a crash or a timer, it replays from the top, and finished work never runs again.

# How a script survives a restart

A script can park on a timer, an event, or its children. It holds nothing while it waits. On resume the runtime runs the source again from the top and answers each effect from the journal.

A loop that would grow past the journal's limit ends into a fresh run with [continueAsNew](./continue-as-new.md). A script can also have a time budget; see [delegation budgets](./delegation-budgets.md#the-wall-clock-budget-of-a-script).

# See also <!-- id:7VeMo9KX -->

- [Child](./child.md) <!-- id:QJ6FjG-M -->
- [Delegate](./delegate.md) <!-- id:NhYOcamO -->
- [Journal](./journal.md) <!-- id:lzxpzwlS -->
- [continueAsNew](./continue-as-new.md) <!-- id:YeIdOyyv -->
- [Park and wait](./park.md) <!-- id:UIFLluVS -->
- [Callable tools](./callables.md)
- [Tools](./tools.md) <!-- id:S7wYLlwI -->
- [Security: script safety](./security.md) <!-- id:4Gr-aF-2 -->
