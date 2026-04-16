---
name: xstate
description: Design, implement, review, and migrate XState v5 state machines and statecharts in TypeScript using modern v5 patterns. Use this whenever the user mentions XState, actors, state machines, statecharts, guards, transitions, workflows, or Stately, or is modeling non-trivial UI/app/process logic in a codebase that uses XState. Prefer a short machine sketch before code when requirements are fuzzy. If the problem is too simple for a state machine, say so and recommend @xstate/store instead.
user-invocable: false
---

# XState v5

Use this skill for **state machine and statechart engineering first** and API correctness second.

This skill is **v5-only**. When examples, blog posts, answers, or local code smell v4-ish, translate them rather than mixing versions. Prefer local repo code and official v5 docs over generic memory.

Your job:

- choose between `xstate` and `@xstate/store`
- design a sound machine or actor system from messy requirements
- write modern XState v5 **TypeScript** code in a consistent style
- review, repair, or improve existing XState code
- migrate legacy v4-ish patterns when they appear
- choose the right actor kind and action shape when the problem is not just `assign(...)` plus `fromPromise(...)`
- connect machines and actors to `@xstate/react`, `@xstate/vue`, `@xstate/svelte`, or `@xstate/solid` when needed

## First pass

In an existing codebase:

1. Inspect local `package.json` files and imports.
2. Read nearby machines, stores, actors, and adapter usage.
3. Distinguish between new code, local edits, and migration work before choosing how opinionated to be.
4. Preserve surrounding style by default.

## Task mode

Choose a mode before writing code:

- **New code**: prefer the modern v5 patterns in this skill.
- **Local edit**: preserve local structure and naming unless the current code is mixed, broken, or cleanup was requested.
- **Migration**: prefer the **smallest safe translation** to v5. Preserve structure and semantics unless broader normalization was requested.

For migration and local edits, do not introduce `setup(...)`, named implementations, object-form guards/actions, tags, or actor decomposition unless they are required for correctness, significantly reduce local complexity, or were explicitly requested.

## Choose the tool

Prefer `@xstate/store` when the domain is simple event-based state management:

- no meaningful finite modes that need coordination, orchestration, or explicit lifecycle modeling
- no invoked async processes
- no actor communication
- no need for state machine or statechart concepts such as guarded transitions, delayed transitions, parallel states, or history

Simple fetching or mutation logic can still fit `@xstate/store` if it does not need machine-level orchestration.

Prefer XState when the domain has one or more of these:

- finite modes that matter to behavior or UI
- async workflows, retries, cancellation, or background processes
- multiple interacting processes or child actors
- explicit guards, delays, tags, or transition rules
- a need to model business process flow, not just update state

If the problem is too simple for a machine, say so plainly and recommend `@xstate/store`.

## Workflow

When requirements are fuzzy:

1. Sketch the machine shape first.
2. Name the important states, events, context, actors, and tags.
3. Call out uncertainty or tradeoffs briefly.
4. Then write the code.

When requirements are already clear, keep the sketch short or implicit and move to code.

Do not over-refactor existing code for conceptual purity. Improve the model where it matters, but preserve working structure when a larger rewrite is not justified.

## Modeling questions

Use these questions before writing or revising code:

- What are the finite states? Put **modes** in states, not in context.
- What belongs in context? Keep only durable data, not derivable booleans or duplicated mode.
- What are the domain events? Prefer meaningful names, often dot-separated, such as `form.submitted` or `order.confirmed`.
- What should be a guard versus a separate branch state?
- What side effects should be invoked actors versus transition actions?
- Can an event carry the needed data instead of stashing temporary relay data in context for a later state?
- Is `fromPromise(...)` actually the right actor, or is this a callback/subscription protocol that should send events back over time?
- Should the machine emit events to the surrounding system instead of forcing consumers to infer everything from context?
- Should a child concern be a spawned/invoked actor instead of more parent complexity?
- Does the parent really need these extra intermediate states, or should a child actor own that internal detail?
- Which states need tags for UI semantics such as `'loading'`, `'error'`, or `'dirty'`?
- Can the UI use `snapshot.matches(...)`, tags, or `snapshot.can(...)` instead of extra booleans?

## Preferred v5 patterns

For **new code**, prefer these patterns unless the local codebase has a strong reason not to:

- TypeScript only.
- Prefer `setup({...}).createMachine({...})`.
- Define named `actions`, `guards`, `actors`, and `delays` in `setup(...)`.
- Prefer transition objects like `{ target: 'next' }` over shorthand when it improves consistency.
- Prefer arrays for `actions`, even for a single action, when that keeps the shape consistent.
- Prefer action and guard objects such as `{ type: 'track' }` or `{ type: 'isValid', params: ... }` when the intent is reusable or named.
- Prefer `tags: []` for UI semantics and cross-cutting state meaning.
- Prefer domain-oriented event names; preserve local naming conventions if they are already established.
- Prefer plain functions for derived values instead of storing derivable data in context.
- Prefer event payloads over temporary context relay when one state only needs to pass data to the next step.
- Prefer passing data into named actions and guards via `params` instead of reaching into `event` directly.
- Do not treat `assign(...)` as the only action pattern. For typed reusable logic beyond simple context updates, consider setup-scoped helpers from a `const machineSetup = setup(...)` object, such as `machineSetup.createAction(...)`, `machineSetup.enqueueActions(...)`, and `machineSetup.emit(...)`, or named action objects when they fit the behavior better.
- When a named `assign(...)` action updates multiple context properties, every property updater shares the same `params` type. Use one coherent params object for all updated fields, or split the work into separate named actions. Do not mix incompatible params shapes inside one assigner.
- When an implementation must inspect `event` and the type is not obvious, prefer `assertEvent(...)` for narrowing.
- Avoid `as any` and other loose casts in examples and final code unless there is no cleaner local option.
- Choose actor logic intentionally: prefer `fromPromise(...)` for one request/one result, and prefer `fromCallback(...)` for subscriptions, timers, external callbacks, and multi-event protocols that send events back over time.
- Consider `emit(...)` when the machine should notify the surrounding system directly.
- Keep parent states coarse when possible. If extra intermediate states mainly model an implementation detail, prefer letting a child actor own that internal behavior.
- If you show multiple files, wire them completely. Include real imports/exports for referenced modules and components, or keep the example smaller.

Keep event naming consistent. The `.` in event names is useful and meaningful, including for partial event descriptors and clearer domain grouping. See the official docs on [events and transitions](https://stately.ai/docs/transitions) and [TypeScript narrowing with `assertEvent(...)`](https://stately.ai/docs/typescript).

See `references/examples.md` for canonical code shapes, `references/advanced-patterns.md` when the task involves typed actions beyond `assign(...)`, callback actors, emitted events, or persistence/hydration, and `references/observables-and-inspection.md` for `fromObservable(...)`, inspection, and browser inspector patterns.

## UI integration

Prefer letting the machine drive UI behavior:

- use `snapshot.matches(...)` for finite mode checks
- use tags for semantic checks such as loading, saving, or dirty
- use `snapshot.can(...)` to drive whether an event is currently valid
- avoid parallel piles of manual booleans that restate machine truth

If a component owns a small local actor, `useMachine(...)` is often enough.

If an actor is shared, long-lived, or performance-sensitive:

- create or obtain an actor ref once
- read slices with `useSelector(...)`
- use actor context/provider helpers when the actor is shared across a subtree

See `references/adapters.md` for concise adapter guidance.

## Review and repair guidance

When reviewing or fixing XState code, look for:

- finite mode stored in context instead of states
- giant machines that should be split into child actors
- side effects hidden in random callbacks or mixed into assigners
- v4 and v5 concepts mixed together in the same machine
- state names and event names that describe UI mechanics instead of domain meaning
- extra booleans that should be replaced by `matches(...)`, tags, or selectors
- missed opportunities to use `@xstate/store` when the problem is simple
- named `assign(...)` actions whose property updaters implicitly expect different `params` shapes

Avoid pushing decomposition too far. Actor boundaries are useful when they improve clarity, ownership, or concurrency. Do not split for its own sake.

## Migration

When legacy code is present, translate toward v5 gradually and locally unless the user asked for a broader migration.

Common migration targets include:

- `cond` -> `guard`
- `schema` -> `types`
- `services` -> `actors`
- `interpret(...)` -> `createActor(...)`
- old function signatures -> destructured v5 arguments such as `({ context, event })`

For migration tasks:

- preserve local structure first
- change only what is needed for correctness, compatibility, or clarity
- do not normalize into the full preferred house style unless the user asked for that
- explain any non-local refactor you choose to make
- do not preserve dead or invalid hook option patterns just because they existed nearby
- when migrating React usage, prefer valid current hook surfaces over trying to smuggle old `interpret`-style implementation overrides into `useMachine(...)`

Use `references/v4-to-v5-quick-ref.md` for quick translation patterns.

## Persistence

When persistence or hydration matters:

- persist snapshots, not just context, unless context-only restore is truly sufficient
- prefer `actor.getPersistedSnapshot()` for saving machine state
- prefer hydrating with `createActor(machine, { snapshot })` or adapter/provider snapshot options where available
- do not hand-roll restoration by guessing the state value plus a partial context blob

See `references/advanced-patterns.md` for concrete persistence and hydration patterns.

## Testing

Do not introduce testing guidance unless the user asks about testing or requests tests.

If they do ask, keep it brief:

- test key transitions and guards
- test happy path and failure path actor behavior
- test the UI against machine state rather than duplicating stateful logic
- mention model-based testing utilities when useful

If a link would help, point them to the XState [testing](https://stately.ai/docs/testing) and [graph/path generation](https://stately.ai/docs/graph) docs.

## Optional tools

Stately Studio and inspection tools can help with design, debugging, and communication, but they are optional. Mention them when the user is designing a machine, wants visualization, or needs better debugging visibility.

- [Stately Studio](https://stately.ai/docs/studio) for visual modeling and collaboration
- [Inspection API](https://stately.ai/docs/inspection) for observing actor systems
- [Stately Inspector](https://stately.ai/docs/inspector) for visual inspection in running apps

## Output format

Prefer this output shape:

1. Short machine sketch if requirements are fuzzy.
2. Code.
3. Brief rationale explaining states, events, context, actors, and tags.
4. Migration notes only if relevant.

Prefer fewer complete files over a larger but partially wired example. Do not sketch extra shell files unless they are fully wired.

See `references/examples.md` for more canonical examples that can grow over time.

## Final self-check

Before you answer, do a quick compile-minded pass:

- every JSX component from another file has a real import
- every imported symbol is actually exported by the shown file
- every `send(...)` and `snapshot.can(...)` call uses real event objects
- async work uses `actors`/`fromPromise` and `invoke.input`, not legacy shapes
- if you reference an external helper from the prompt or surrounding system, declare its signature or show enough typed shape for the example to stand on its own
- migration examples do not pass invalid implementation override objects into hooks just to preserve dead local code
- no placeholder shell files, omitted imports, `...`, or pseudocode in code fences that are meant to be runnable

If a complete multi-file answer is getting bulky, remove the shell file and keep the smaller set of files that still demonstrates the pattern correctly.
