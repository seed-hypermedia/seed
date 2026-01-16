# XState v5 React Integration

> **XState v5 ONLY** - Do not use v4 patterns. Requires TypeScript 5.0+.

## Installation

```bash
npm install xstate @xstate/react
# or
yarn add xstate @xstate/react
```

## useMachine - Basic Usage

Use `useMachine` when the machine lifecycle is tied to the component.

```typescript
import { useMachine } from '@xstate/react';
import { toggleMachine } from './toggle.machine';

function Toggle() {
  const [snapshot, send] = useMachine(toggleMachine);

  return (
    <button onClick={() => send({ type: 'TOGGLE' })}>
      {snapshot.matches('active') ? 'ON' : 'OFF'}
    </button>
  );
}
```

## useMachine with Input (Initial Context)

```typescript
import { useMachine } from '@xstate/react';

const counterMachine = setup({
  types: {
    context: {} as { count: number },
    input: {} as { initialCount: number },
  },
}).createMachine({
  context: ({ input }) => ({ count: input.initialCount }),
  // ...
});

function Counter({ initialCount }: { initialCount: number }) {
  const [snapshot, send] = useMachine(counterMachine, {
    input: { initialCount },
  });

  return <div>{snapshot.context.count}</div>;
}
```

## useActor - For Existing Actor References

Use `useActor` when you have an actor reference from a parent or context.

```typescript
import { useActor } from '@xstate/react';

function ChildComponent({ actorRef }: { actorRef: ActorRefFrom<typeof childMachine> }) {
  const [snapshot, send] = useActor(actorRef);

  return (
    <div>
      State: {snapshot.value}
      <button onClick={() => send({ type: 'DO_SOMETHING' })}>Act</button>
    </div>
  );
}
```

## useActorRef - Get Actor Without Subscribing

Use when you only need to send events, not read state.

```typescript
import { useActorRef } from '@xstate/react';

function Form() {
  const actorRef = useActorRef(formMachine);

  const handleSubmit = () => {
    actorRef.send({ type: 'SUBMIT' });
  };

  // Pass actorRef to children that need to send events
  return <SubmitButton actorRef={actorRef} onClick={handleSubmit} />;
}
```

## useSelector - Optimized State Selection

Use for performance when you only need part of the state.

```typescript
import { useSelector } from '@xstate/react';

function UserName({ actorRef }: { actorRef: ActorRefFrom<typeof userMachine> }) {
  // Only re-renders when user.name changes
  const userName = useSelector(actorRef, (snapshot) => snapshot.context.user?.name);

  return <span>{userName}</span>;
}

// Multiple selectors
function UserDetails({ actorRef }) {
  const name = useSelector(actorRef, (s) => s.context.user?.name);
  const email = useSelector(actorRef, (s) => s.context.user?.email);
  const isLoading = useSelector(actorRef, (s) => s.matches('loading'));

  if (isLoading) return <Spinner />;
  return <div>{name} - {email}</div>;
}
```

## Providing Actor via Context

```typescript
import { createActorContext } from '@xstate/react';
import { appMachine } from './app.machine';

// Create context
const AppMachineContext = createActorContext(appMachine);

// Provider at app root
function App() {
  return (
    <AppMachineContext.Provider>
      <Dashboard />
    </AppMachineContext.Provider>
  );
}

// Consume in children
function Dashboard() {
  const state = AppMachineContext.useSelector((s) => s.value);
  const actorRef = AppMachineContext.useActorRef();

  return (
    <div>
      Current state: {state}
      <button onClick={() => actorRef.send({ type: 'LOGOUT' })}>Logout</button>
    </div>
  );
}
```

## Conditional Rendering Based on State

```typescript
function AuthFlow() {
  const [snapshot, send] = useMachine(authMachine);

  // Using matches()
  if (snapshot.matches('loading')) {
    return <LoadingSpinner />;
  }

  if (snapshot.matches('authenticated')) {
    return <Dashboard user={snapshot.context.user} />;
  }

  if (snapshot.matches('error')) {
    return (
      <ErrorDisplay
        message={snapshot.context.error}
        onRetry={() => send({ type: 'RETRY' })}
      />
    );
  }

  // Default: unauthenticated
  return <LoginForm onSubmit={(data) => send({ type: 'LOGIN', ...data })} />;
}
```

## Handling Nested States

```typescript
function PaymentStatus() {
  const [snapshot] = useMachine(paymentMachine);

  // Check nested state
  if (snapshot.matches('processing.validating')) {
    return <div>Validating payment...</div>;
  }

  if (snapshot.matches('processing.charging')) {
    return <div>Charging card...</div>;
  }

  if (snapshot.matches({ processing: 'confirming' })) {
    return <div>Confirming transaction...</div>;
  }

  return <div>Current: {JSON.stringify(snapshot.value)}</div>;
}
```

## Component Organization Pattern

```
src/
  features/
    auth/
      auth.machine.ts      # Machine definition
      auth.types.ts        # Shared types
      AuthProvider.tsx     # Context provider
      LoginForm.tsx        # UI component
      useAuth.ts           # Custom hook wrapping machine
```

### Custom Hook Pattern

```typescript
// useAuth.ts
import { useMachine } from '@xstate/react';
import { authMachine } from './auth.machine';

export function useAuth() {
  const [snapshot, send, actorRef] = useMachine(authMachine);

  return {
    // Derived state
    isAuthenticated: snapshot.matches('authenticated'),
    isLoading: snapshot.matches('loading'),
    user: snapshot.context.user,
    error: snapshot.context.error,

    // Actions
    login: (email: string, password: string) =>
      send({ type: 'LOGIN', email, password }),
    logout: () => send({ type: 'LOGOUT' }),
    retry: () => send({ type: 'RETRY' }),

    // Raw access if needed
    actorRef,
    snapshot,
  };
}

// Usage
function Header() {
  const { isAuthenticated, user, logout } = useAuth();

  if (!isAuthenticated) return null;

  return (
    <header>
      <span>Welcome, {user.name}</span>
      <button onClick={logout}>Logout</button>
    </header>
  );
}
```

## Event Handlers with Type Safety

```typescript
function Form() {
  const [snapshot, send] = useMachine(formMachine);

  // Type-safe event handlers
  const handleChange = (field: string, value: string) => {
    send({ type: 'CHANGE', field, value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send({ type: 'SUBMIT' });
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={snapshot.context.fields.email}
        onChange={(e) => handleChange('email', e.target.value)}
        disabled={!snapshot.can({ type: 'CHANGE', field: 'email', value: '' })}
      />
      <button type="submit" disabled={!snapshot.can({ type: 'SUBMIT' })}>
        Submit
      </button>
    </form>
  );
}
```

## Inspecting Machine State (Dev Tools)

```typescript
import { useMachine } from '@xstate/react';
import { createBrowserInspector } from '@statelyai/inspect';

const inspector = createBrowserInspector();

function App() {
  const [snapshot, send] = useMachine(appMachine, {
    inspect: inspector.inspect,
  });

  // State visible in Stately Inspector
}
```