---
name: Script / ctx
summary: A script child is a deterministic JavaScript module whose every effect goes through the journaled ctx object.
---
A **script** is a [child](./child.md) that is code, not a model. It reaches the outside only through `ctx`: `ctx.call(tool, input, {description})`, `ctx.delegate`, `ctx.parallel`, `ctx.step`, `ctx.plan`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.continueAsNew`. Scripts are deterministic, with no clock and no randomness, and every effect goes into the [journal](./journal.md). <!-- id:FyyJwpqk -->

Use a script when the control flow is known in advance: a loop over a list, a fan-out, a wait of hours or days. The script has no transcript. What a person sees of it is its journal.

# The module and the ctx API

A script is passed to [delegate](./delegate.md) as `script`, a self-contained module `export default async function (input, ctx) {…}` run in an in-process QuickJS-WASM realm (`apps/src/workflow-host.ts`). Everything external crosses through `ctx`: `ctx.call(tool, input, {description})`, `ctx.delegate` (alias `ctx.agent`), `ctx.parallel` and `ctx.parallelSettled`, `ctx.sleep` (a sleep of 60 seconds or more parks the run; shorter ones hold the VM), `ctx.minutes` and `ctx.hours`, `ctx.waitForEvent(match, {timeoutMs, label})` (resolves `null` on timeout), `ctx.continueAsNew` (never resolves), `ctx.step`, `ctx.plan`, `ctx.now`, `ctx.log`, `ctx.progress`, `ctx.input`, `ctx.runId`, plus `TextEncoder` and `TextDecoder`. A child that is canceled or fails rejects `ctx.delegate` with an error whose code is `canceled` or `agent-failed`. Scripts hold the read and write verbs plus the agent's callable set (`api-service.ts`), and tool resources by hm:// URL. Every effect goes into the [journal](./journal.md), so resume after a crash or a timer wake replays from the top and completed work never re-executes. Detached script children are rejected outright. Scripts are always awaited. <!-- id:pnR_U13Y -->

# How a script survives a restart

A script can [park](./park.md) on a timer, an event, or its children, and hold nothing while it waits. On resume the runtime runs the source again from the top and answers each effect from the [journal](./journal.md). A loop that would outgrow the journal ends into a fresh run with [continueAsNew](./continue-as-new.md). A script can also carry a wall-clock budget; see [delegation budgets](./delegation-budgets.md#choosing-thoroughness).

# See also <!-- id:7VeMo9KX -->

- [Child](./child.md) <!-- id:QJ6FjG-M -->
- [Delegate](./delegate.md) <!-- id:NhYOcamO -->
- [Journal](./journal.md) <!-- id:lzxpzwlS -->
- [continueAsNew](./continue-as-new.md) <!-- id:YeIdOyyv -->
- [Park and wait](./park.md) <!-- id:UIFLluVS -->
- [Callable tools](./callables.md)
- [Tools](./tools.md) <!-- id:S7wYLlwI -->
- [Security: script safety](./security.md) <!-- id:4Gr-aF-2 -->
