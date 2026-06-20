# XState v4 to v5 Quick Reference

Use this file when you encounter older XState code and need a fast translation path without turning the task into a full migration project.

Default to the **smallest safe translation**. Preserve local structure unless the user asked for broader normalization.

## Core renames

- `cond` -> `guard`
- `schema` -> `types`
- `services` -> `actors`
- `interpret(machine)` -> `createActor(machine)`

## Prefer v5 argument style

Prefer destructured arguments:

```ts
guard: ({ context, event }) => context.count > 0
```

instead of older positional signatures:

```ts
cond: (context, event) => context.count > 0
```

## Prefer `setup(...)`

For new code or explicit normalization, prefer:

```ts
const machine = setup({
  actions: {
    save: () => {
      // ...
    }
  },
  guards: {
    isValid: ({ context }) => context.ready
  },
  actors: {
    loadUser: fromPromise(async () => {
      // ...
    })
  }
}).createMachine({
  // ...
});
```

This gives a single place for named `actions`, `guards`, `actors`, and `delays`.

For small migration tasks, you do not need to introduce `setup(...)` if a more local v5 translation is clearer and safer.

## Transition object shapes

Prefer explicit transition objects:

```ts
on: {
  submit: {
    target: 'saving',
    actions: [{ type: 'trackSubmit' }]
  }
}
```

If you are only fixing a local issue in an older file, preserve nearby style unless the user asked for migration.

## Invocation

v4 code often uses older service patterns. In v5, prefer named actors:

```ts
invoke: {
  src: 'loadUser'
}
```

with implementations defined in `setup({ actors: ... })`.

## Actor creation

Prefer:

```ts
const actor = createActor(machine);
actor.start();
```

instead of:

```ts
const service = interpret(machine).start();
```

## Typing

Prefer `types` over `schema`:

```ts
types: {} as {
  context: { count: number };
  events: { type: 'increment' } | { type: 'reset' };
}
```

## Guard and action objects

Prefer object forms when the behavior is named or parameterized:

```ts
guard: { type: 'hasPermission', params: { role: 'admin' } }
actions: [{ type: 'track', params: { eventName: 'form.submitted' } }]
```

## Preserve scope

Do not force a full v4 -> v5 rewrite when the user asked for a small bug fix or local migration. Translate only the touched area unless:

- the current code is broken due to mixed concepts
- the user explicitly asked for migration
- a local refactor is the simplest safe fix
