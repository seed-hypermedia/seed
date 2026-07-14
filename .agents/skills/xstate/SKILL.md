---
name: xstate
description: Design, implement, review, or migrate XState v5 state machines and actor systems in TypeScript. Use when a task mentions XState, actors, state machines, statecharts, guards, transitions, Stately, or non-trivial workflow logic in code that already uses XState.
---

# XState v5

Use local package versions, nearby machines, and official v5 documentation as the source of truth. Do not mix v4 and v5 APIs.

## Choose the abstraction

Use `@xstate/store` for simple event-driven state without meaningful finite modes, orchestration, invoked processes, actor communication, guarded or delayed transitions, parallel states, or history.

Use XState when finite modes affect behavior, async work needs retries or cancellation, processes interact, or business transition rules should be explicit. Say plainly when a machine would be unnecessary.

## Existing code

1. Inspect package versions, imports, nearby machines, actors, and framework adapters.
2. Decide whether the task is new code, a local edit, or migration.
3. Preserve local structure for edits and make the smallest safe v5 translation for migrations.
4. Avoid broad stylistic normalization unless requested or required for correctness.

## Model before coding

For unclear requirements, briefly identify states, domain events, durable context, guards, actors, and UI tags. Keep modes in states rather than duplicating them as context booleans. Prefer event payloads to temporary relay context and derived values to duplicated state.

Choose actor logic deliberately:

- `fromPromise(...)` for one request and one result.
- `fromCallback(...)` for subscriptions, timers, callbacks, or recurring events.
- Child actors when they clarify ownership, lifecycle, or concurrency—not merely to split files.

For new code, prefer `setup({...}).createMachine({...})`, named implementations, typed events, and `assertEvent(...)` where narrowing is needed. Avoid `as any`. Use `snapshot.matches(...)`, tags, `snapshot.can(...)`, and selectors instead of parallel UI booleans.

For canonical code shapes, read [references/examples.md](references/examples.md). Load specialized references only when relevant:

- [references/advanced-patterns.md](references/advanced-patterns.md) for typed actions, callback actors, emitted events, and persistence.
- [references/adapters.md](references/adapters.md) and [references/react.md](references/react.md) for framework integration.
- [references/observables-and-inspection.md](references/observables-and-inspection.md) for observables and inspection.
- [references/v4-to-v5-quick-ref.md](references/v4-to-v5-quick-ref.md) for migrations.

Before finishing, check that imports and exports are real, events are typed objects, invoked actors receive valid input, examples use current hook APIs, and runnable code contains no omitted placeholders.
