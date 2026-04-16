# Adapter Notes

Use this file for brief framework-specific guidance after the machine design is already clear.

The concepts are the same across adapters:

- create or obtain an actor ref
- read slices of snapshot state with selectors when possible
- send events to the actor
- avoid duplicating machine truth in component-local booleans

## React

- Use `useMachine(machine)` when the component owns a local actor.
- Prefer `createActorContext(...)`, `useActorRef(...)`, and `useSelector(...)` when the actor is shared or when you want finer-grained subscriptions.
- Prefer UI checks like `snapshot.matches(...)`, `snapshot.hasTag(...)`, and `snapshot.can(...)`.

## Vue

- Use `useMachine(machine)` for simple component-local ownership.
- Prefer `useActorRef(...)` and `useSelector(...)` when working with shared actors or more selective subscriptions.
- Keep template conditionals driven by snapshot state or tags.

## Svelte

- Use `useMachine(machine)` for local ownership.
- Prefer actor refs plus `useSelector(...)` when you need shared ownership or selective updates.
- Keep derived UI state close to the machine snapshot rather than duplicating it in separate stores.

## Solid

- Use `useMachine(machine)` for local ownership.
- Prefer `useActorRef(...)` and `useSelector(...)` when an actor is shared or when you want tighter subscription control.
- Keep signals derived from actor snapshot slices instead of rebuilding mode booleans manually.

## Heuristic

Prefer `useMachine(...)` when:

- the actor is local to one component
- ownership is simple
- rendering pressure is low

Prefer actor ref + selector patterns when:

- the actor is shared across a subtree
- multiple components read different slices
- you want clearer ownership boundaries
- you want to avoid broad rerenders
