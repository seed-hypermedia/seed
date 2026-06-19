# React Integration

Use this reference after the machine design is settled and you need React-specific wiring detail beyond `references/adapters.md`.

For the shared-actor pattern with `createActorContext(...)`, see `references/examples.md`. For inspector wiring (`createBrowserInspector(...)`), see `references/observables-and-inspection.md`.

## Hook surface

| Hook | Use when |
|------|----------|
| `useMachine(machine, options?)` | The component **owns** a local actor; lifecycle is tied to the component. |
| `useActor(actorRef)` | You already have an actor ref (from a parent, prop, or context) and want `[snapshot, send]`. |
| `useActorRef(machine, options?)` | You need to send events but do not want the component to re-render on snapshot changes. |
| `useSelector(actorRef, selector)` | You have a shared actor ref and want to re-render only when a specific slice changes. |

Prefer `useActorRef` + `useSelector` over `useActor` when the actor is shared or when broad rerenders matter. `useActor` is best reserved for small child components that legitimately need `[snapshot, send]` against a passed-in ref.

## Passing initial context via `input`

When the machine uses `input` to seed context, pass it through `useMachine`:

```tsx
import { useMachine } from '@xstate/react';
import { assign, setup } from 'xstate';

const counterMachine = setup({
  types: {} as {
    context: { count: number };
    input: { initialCount: number };
    events: { type: 'count.incremented' };
  }
}).createMachine({
  context: ({ input }) => ({ count: input.initialCount }),
  on: {
    'count.incremented': {
      actions: assign({ count: ({ context }) => context.count + 1 })
    }
  }
});

export function Counter({ initialCount }: { initialCount: number }) {
  const [snapshot, send] = useMachine(counterMachine, {
    input: { initialCount }
  });

  return (
    <button onClick={() => send({ type: 'count.incremented' })}>
      {snapshot.context.count}
    </button>
  );
}
```

Prefer `input` over reading props inside `assign(...)`. Context is seeded once from `input`; later prop changes should be modeled as events.

## Matching nested states

`snapshot.matches(...)` accepts both dot-string and object forms for hierarchical states. Both are valid; pick whichever reads more clearly locally.

```tsx
if (snapshot.matches('processing.validating')) { /* ... */ }
if (snapshot.matches({ processing: 'confirming' })) { /* ... */ }
```

For parallel states, use the object form for the specific region you care about, and prefer tags when several regions should answer a single UI question like "is anything loading?".

## Snapshot-driven UI

Prefer driving JSX directly from the snapshot and actor, not from duplicated local state:

```tsx
function AuthFlow() {
  const [snapshot, send] = useMachine(authMachine);

  if (snapshot.hasTag('loading')) return <LoadingSpinner />;
  if (snapshot.matches('authenticated')) return <Dashboard user={snapshot.context.user} />;
  if (snapshot.matches('error')) {
    return (
      <ErrorDisplay
        message={snapshot.context.error}
        onRetry={() => send({ type: 'auth.retried' })}
      />
    );
  }

  return (
    <LoginForm
      canSubmit={snapshot.can({ type: 'auth.login', email: '', password: '' })}
      onSubmit={(email, password) => send({ type: 'auth.login', email, password })}
    />
  );
}
```

Reach for `snapshot.can(...)` for enablement checks on buttons and inputs, not extra booleans in context.

## Custom hook pattern

When a component tree repeatedly pulls the same slices from a machine, a thin wrapper hook can keep the call sites small without duplicating machine truth. Keep the wrapper close to derived values and event helpers; do not let it accumulate component state.

```tsx
import { useMachine } from '@xstate/react';
import { authMachine } from './authMachine';

export function useAuth() {
  const [snapshot, send, actorRef] = useMachine(authMachine);

  return {
    isAuthenticated: snapshot.matches('signedIn'),
    isLoading: snapshot.hasTag('loading'),
    user: snapshot.context.user,
    error: snapshot.context.error,
    login: (email: string, password: string) =>
      send({ type: 'auth.login', email, password }),
    logout: () => send({ type: 'auth.logout' }),
    actorRef,
    snapshot
  };
}
```

Prefer this pattern only for locally owned actors. For shared actors, build the same ergonomics with `createActorContext(...)` plus `useSelector(...)` so that reads are selective.

## Ownership heuristic

- **Component-local actor**: `useMachine(...)`.
- **Shared actor across a subtree**: `createActorContext(...)` + `useSelector(...)` (see `references/examples.md`).
- **Actor handed down as a prop or ref**: `useActor(actorRef)` for small leaves, or `useSelector(actorRef, ...)` when rerender pressure matters.
- **Send-only component**: `useActorRef(...)` so the component does not subscribe.
