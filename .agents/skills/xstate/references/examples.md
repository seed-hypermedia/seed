# XState v5 Examples

This file holds expandable canonical examples for the skill. Keep the examples opinionated and small enough to be reusable, but grow this file over time as recurring patterns emerge.

## Machine with `setup(...)`

```ts
import { assign, assertEvent, setup } from 'xstate';

export const feedbackMachine = setup({
  types: {} as {
    context: {
      feedback: string;
    };
    events:
      | { type: 'feedback.good' }
      | { type: 'feedback.bad' }
      | { type: 'feedback.changed'; value: string }
      | { type: 'feedback.submitted' }
      | { type: 'feedback.restarted' };
  },
  guards: {
    hasFeedback: ({ context }) => context.feedback.trim().length > 0
  },
  actions: {
    updateFeedback: assign({
      feedback: (_, params: { value: string }) => params.value
    }),
    clearFeedback: assign({
      feedback: () => ''
    }),
    logSubmission: ({ event }) => {
      assertEvent(event, 'feedback.submitted');
      console.log('submitted feedback');
    })
  }
}).createMachine({
  context: {
    feedback: ''
  },
  initial: 'prompt',
  states: {
    prompt: {
      on: {
        'feedback.good': {
          target: 'thanks'
        },
        'feedback.bad': {
          target: 'form'
        }
      }
    },
    form: {
      tags: ['editable'],
      on: {
        'feedback.changed': {
          actions: [
            {
              type: 'updateFeedback',
              params: ({ event }) => ({ value: event.value })
            }
          ]
        },
        'feedback.submitted': [
          {
            guard: { type: 'hasFeedback' },
            target: 'thanks',
            actions: [{ type: 'logSubmission' }]
          }
        ]
      }
    },
    thanks: {
      tags: ['completed'],
      on: {
        'feedback.restarted': {
          target: 'prompt',
          actions: [{ type: 'clearFeedback' }]
        }
      }
    }
  }
});
```

## Shared actor with React

```tsx
import { createActorContext } from '@xstate/react';
import { feedbackMachine } from './feedbackMachine';

const FeedbackContext = createActorContext(feedbackMachine);

export function FeedbackProvider(props: { children: React.ReactNode }) {
  return <FeedbackContext.Provider>{props.children}</FeedbackContext.Provider>;
}

export function FeedbackForm() {
  const actorRef = FeedbackContext.useActorRef();
  const canSubmit = FeedbackContext.useSelector((snapshot) =>
    snapshot.can({ type: 'feedback.submitted' })
  );
  const isEditable = FeedbackContext.useSelector((snapshot) =>
    snapshot.hasTag('editable')
  );

  if (!isEditable) {
    return null;
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        actorRef.send({ type: 'feedback.submitted' });
      }}
    >
      <textarea
        onChange={(event) => {
          actorRef.send({
            type: 'feedback.changed',
            value: event.target.value
          });
        }}
      />
      <button disabled={!canSubmit}>Submit</button>
    </form>
  );
}
```

## Shared async auth actor with React

When one actor is shared across a subtree, prefer a provider plus `useSelector(...)`.

If a named `assign(...)` action updates multiple properties, use one `params` object that contains every field that action needs.

```ts
// authMachine.ts
import { assign, assertEvent, fromPromise, setup } from 'xstate';

type User = { id: string; email: string; name: string };
type Session = { token: string; expiresAt: number };

export const authMachine = setup({
  types: {} as {
    context: {
      user: User | null;
      session: Session | null;
      error: string | null;
    };
    events:
      | { type: 'auth.login'; email: string; password: string }
      | { type: 'auth.logout' }
      | { type: 'auth.refresh' };
  },
  actors: {
    login: fromPromise(
      async ({ input }: { input: { email: string; password: string } }) => {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        });

        if (!res.ok) {
          throw new Error('Login failed');
        }

        return (await res.json()) as { user: User; session: Session };
      }
    ),
    refreshSession: fromPromise(async () => {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });

      if (!res.ok) {
        throw new Error('Refresh failed');
      }

      return (await res.json()) as { session: Session };
    })
  },
  actions: {
    setAuth: assign({
      user: (_, params: { user: User; session: Session }) => params.user,
      session: (_, params: { user: User; session: Session }) => params.session,
      error: () => null
    }),
    setSession: assign({
      session: (_, params: { session: Session }) => params.session
    }),
    setError: assign({
      error: (_, params: { message: string }) => params.message
    }),
    clearAuth: assign({
      user: () => null,
      session: () => null,
      error: () => null
    })
  }
}).createMachine({
  id: 'auth',
  context: {
    user: null,
    session: null,
    error: null
  },
  initial: 'signedOut',
  states: {
    signedOut: {
      on: {
        'auth.login': { target: 'signingIn' }
      }
    },
    signingIn: {
      tags: ['loading'],
      invoke: {
        src: 'login',
        input: ({ event }) => {
          assertEvent(event, 'auth.login');

          return {
            email: event.email,
            password: event.password
          };
        },
        onDone: {
          target: 'signedIn',
          actions: [
            {
              type: 'setAuth',
              params: ({ event }) => ({
                user: event.output.user,
                session: event.output.session
              })
            }
          ]
        },
        onError: {
          target: 'signedOut',
          actions: [
            {
              type: 'setError',
              params: ({ event }) => ({
                message: event.error instanceof Error ? event.error.message : 'Login failed'
              })
            }
          ]
        }
      }
    },
    signedIn: {
      on: {
        'auth.logout': {
          target: 'signedOut',
          actions: [{ type: 'clearAuth' }]
        },
        'auth.refresh': { target: 'refreshing' }
      }
    },
    refreshing: {
      tags: ['loading'],
      invoke: {
        src: 'refreshSession',
        onDone: {
          target: 'signedIn',
          actions: [
            {
              type: 'setSession',
              params: ({ event }) => ({
                session: event.output.session
              })
            }
          ]
        },
        onError: {
          target: 'signedOut',
          actions: [
            {
              type: 'setError',
              params: ({ event }) => ({
                message: event.error instanceof Error ? event.error.message : 'Refresh failed'
              })
            },
            { type: 'clearAuth' }
          ]
        }
      }
    }
  }
});
```

```tsx
// AuthContext.tsx
import { createActorContext } from '@xstate/react';
import { authMachine } from './authMachine';

export const AuthContext = createActorContext(authMachine);

export function AuthProvider(props: { children: React.ReactNode }) {
  return <AuthContext.Provider>{props.children}</AuthContext.Provider>;
}
```

```tsx
// Navbar.tsx
import { AuthContext } from './AuthContext';

export function Navbar() {
  const actorRef = AuthContext.useActorRef();
  const userName = AuthContext.useSelector((snapshot) => snapshot.context.user?.name ?? null);
  const isSignedIn = AuthContext.useSelector((snapshot) => snapshot.matches('signedIn'));

  return (
    <nav>
      {isSignedIn ? (
        <>
          <span>{userName}</span>
          <button onClick={() => actorRef.send({ type: 'auth.logout' })}>Logout</button>
        </>
      ) : (
        <span>Signed out</span>
      )}
    </nav>
  );
}
```

```tsx
// SettingsPage.tsx
import { AuthContext } from './AuthContext';

export function SettingsPage() {
  const actorRef = AuthContext.useActorRef();
  const user = AuthContext.useSelector((snapshot) => snapshot.context.user);
  const isLoading = AuthContext.useSelector((snapshot) => snapshot.hasTag('loading'));

  if (!user) {
    return <p>Please sign in.</p>;
  }

  return (
    <section>
      <p>{user.email}</p>
      <button
        disabled={isLoading}
        onClick={() => actorRef.send({ type: 'auth.refresh' })}
      >
        {isLoading ? 'Refreshing…' : 'Refresh session'}
      </button>
    </section>
  );
}
```

```tsx
// BillingPage.tsx
import { AuthContext } from './AuthContext';

export function BillingPage() {
  const session = AuthContext.useSelector((snapshot) => snapshot.context.session);
  const isSignedIn = AuthContext.useSelector((snapshot) => snapshot.matches('signedIn'));

  if (!isSignedIn || !session) {
    return <p>Billing is unavailable while signed out.</p>;
  }

  return (
    <section>
      <p>Session expires at: {new Date(session.expiresAt).toLocaleString()}</p>
    </section>
  );
}
```

```tsx
// App.tsx
import { AuthProvider } from './AuthContext';
import { BillingPage } from './BillingPage';
import { Navbar } from './Navbar';
import { SettingsPage } from './SettingsPage';

export function App() {
  return (
    <AuthProvider>
      <Navbar />
      <SettingsPage />
      <BillingPage />
    </AuthProvider>
  );
}
```

## Prefer `@xstate/store` for simple domains

Use a store when the domain is just event-based state updates without meaningful modes or actors.

```ts
import { createStore } from '@xstate/store';

export const preferencesStore = createStore({
  context: {
    theme: 'light' as 'light' | 'dark',
    compactMode: false
  },
  on: {
    'preferences.themeChanged': (
      context,
      event: { value: 'light' | 'dark' }
    ) => ({
      ...context,
      theme: event.value
    }),
    'preferences.compactModeToggled': (context) => ({
      ...context,
      compactMode: !context.compactMode
    })
  }
});
```

## Migration notes example

### Before

```ts
const machine = createMachine({
  schema: {
    context: {} as { count: number },
    events: {} as { type: 'inc' } | { type: 'dec' }
  },
  on: {
    inc: {
      cond: (context) => context.count < 10,
      actions: assign({
        count: (context) => context.count + 1
      })
    }
  }
});
```

### After

```ts
const machine = setup({
  types: {} as {
    context: { count: number };
    events: { type: 'inc' } | { type: 'dec' };
  },
  guards: {
    canIncrement: ({ context }) => context.count < 10
  },
  actions: {
    increment: assign({
      count: ({ context }) => context.count + 1
    })
  }
}).createMachine({
  context: {
    count: 0
  },
  on: {
    inc: [
      {
        guard: { type: 'canIncrement' },
        actions: [{ type: 'increment' }]
      }
    ]
  }
});
```
