# XState v5 Patterns

> **XState v5 ONLY** - Do not use v4 patterns. Requires TypeScript 5.0+.

## Machine Setup with Full Types

```typescript
import { setup, assign, fromPromise } from 'xstate';

interface Context {
  user: User | null;
  error: string | null;
}

type Events =
  | { type: 'FETCH'; userId: string }
  | { type: 'RETRY' }
  | { type: 'RESET' };

const machine = setup({
  types: {
    context: {} as Context,
    events: {} as Events,
  },
  actors: {
    fetchUser: fromPromise(async ({ input }: { input: { userId: string } }) => {
      const response = await fetch(`/api/users/${input.userId}`);
      return response.json();
    }),
  },
  actions: {
    setUser: assign({ user: (_, params: { user: User }) => params.user }),
    setError: assign({ error: (_, params: { error: string }) => params.error }),
    clearError: assign({ error: null }),
  },
  guards: {
    hasUser: ({ context }) => context.user !== null,
  },
}).createMachine({
  id: 'userFetch',
  initial: 'idle',
  context: { user: null, error: null },
  states: {
    idle: {
      on: { FETCH: 'loading' },
    },
    loading: {
      invoke: {
        src: 'fetchUser',
        input: ({ event }) => ({ userId: event.userId }),
        onDone: {
          target: 'success',
          actions: { type: 'setUser', params: ({ event }) => ({ user: event.output }) },
        },
        onError: {
          target: 'error',
          actions: { type: 'setError', params: ({ event }) => ({ error: event.error.message }) },
        },
      },
    },
    success: {
      on: { RESET: 'idle' },
    },
    error: {
      on: { RETRY: 'loading' },
    },
  },
});
```

## Guards

```typescript
const machine = setup({
  types: {
    context: {} as { count: number; max: number },
    events: {} as { type: 'INCREMENT' },
  },
  guards: {
    canIncrement: ({ context }) => context.count < context.max,
    isAtMax: ({ context }) => context.count >= context.max,
  },
}).createMachine({
  // ...
  states: {
    counting: {
      on: {
        INCREMENT: {
          guard: 'canIncrement',
          actions: 'increment',
        },
      },
      always: {
        guard: 'isAtMax',
        target: 'maxReached',
      },
    },
  },
});
```

## Actions with Parameters

```typescript
const machine = setup({
  actions: {
    log: (_, params: { message: string }) => {
      console.log(params.message);
    },
    updateField: assign({
      data: ({ context }, params: { field: string; value: string }) => ({
        ...context.data,
        [params.field]: params.value,
      }),
    }),
  },
}).createMachine({
  // Use with params
  entry: { type: 'log', params: { message: 'Machine started' } },
  on: {
    UPDATE: {
      actions: {
        type: 'updateField',
        params: ({ event }) => ({ field: event.field, value: event.value }),
      },
    },
  },
});
```

## Hierarchical (Nested) States

```typescript
const machine = setup({
  // ...
}).createMachine({
  id: 'payment',
  initial: 'idle',
  states: {
    idle: { on: { START: 'processing' } },
    processing: {
      initial: 'validating',
      states: {
        validating: {
          on: { VALID: 'charging' },
        },
        charging: {
          on: { CHARGED: 'confirming' },
        },
        confirming: {
          on: { CONFIRMED: '#payment.complete' }, // Go to root state
        },
      },
    },
    complete: { type: 'final' },
  },
});
```

## Parallel States

```typescript
const machine = setup({
  // ...
}).createMachine({
  id: 'upload',
  type: 'parallel',
  states: {
    upload: {
      initial: 'idle',
      states: {
        idle: { on: { UPLOAD: 'uploading' } },
        uploading: { on: { COMPLETE: 'done' } },
        done: { type: 'final' },
      },
    },
    validation: {
      initial: 'pending',
      states: {
        pending: { on: { VALIDATE: 'validating' } },
        validating: { on: { VALID: 'valid', INVALID: 'invalid' } },
        valid: { type: 'final' },
        invalid: {},
      },
    },
  },
});
```

## Invoking Promises

```typescript
import { fromPromise } from 'xstate';

const machine = setup({
  actors: {
    fetchData: fromPromise(async ({ input }: { input: { url: string } }) => {
      const res = await fetch(input.url);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    }),
  },
}).createMachine({
  states: {
    loading: {
      invoke: {
        src: 'fetchData',
        input: { url: '/api/data' },
        onDone: { target: 'success', actions: assign({ data: ({ event }) => event.output }) },
        onError: { target: 'error', actions: assign({ error: ({ event }) => event.error }) },
      },
    },
  },
});
```

## Invoking Callbacks (for subscriptions/streams)

```typescript
import { fromCallback } from 'xstate';

const machine = setup({
  actors: {
    listenToSocket: fromCallback(({ sendBack, input }) => {
      const socket = new WebSocket(input.url);
      socket.onmessage = (e) => sendBack({ type: 'MESSAGE', data: JSON.parse(e.data) });
      socket.onerror = () => sendBack({ type: 'ERROR' });
      return () => socket.close(); // Cleanup
    }),
  },
}).createMachine({
  states: {
    connected: {
      invoke: {
        src: 'listenToSocket',
        input: { url: 'wss://example.com' },
      },
      on: {
        MESSAGE: { actions: 'handleMessage' },
        ERROR: 'error',
      },
    },
  },
});
```

## Spawning Child Actors

```typescript
import { setup, assign, sendTo } from 'xstate';

const childMachine = setup({
  // ...
}).createMachine({
  id: 'child',
  // ...
});

const parentMachine = setup({
  types: {
    context: {} as { children: ActorRefFrom<typeof childMachine>[] },
  },
  actors: { child: childMachine },
}).createMachine({
  context: { children: [] },
  on: {
    SPAWN_CHILD: {
      actions: assign({
        children: ({ context, spawn }) => [
          ...context.children,
          spawn('child', { id: `child-${Date.now()}` }),
        ],
      }),
    },
    SEND_TO_CHILD: {
      actions: sendTo(
        ({ context }) => context.children[0],
        { type: 'SOME_EVENT' }
      ),
    },
  },
});
```

## Entry/Exit Actions

```typescript
const machine = setup({
  actions: {
    onEnterLoading: () => console.log('Started loading'),
    onExitLoading: () => console.log('Finished loading'),
  },
}).createMachine({
  states: {
    loading: {
      entry: 'onEnterLoading',
      exit: 'onExitLoading',
      // ...
    },
  },
});
```

## Delayed Transitions

```typescript
const machine = setup({
  delays: {
    timeout: 5000,
    retryDelay: ({ context }) => context.retryCount * 1000,
  },
}).createMachine({
  states: {
    pending: {
      after: {
        timeout: 'timedOut',
      },
    },
    error: {
      after: {
        retryDelay: 'retrying',
      },
    },
  },
});
```

## Observable Actors (RxJS Integration)

```typescript
import { fromObservable } from 'xstate';
import { interval, map } from 'rxjs';

const machine = setup({
  actors: {
    ticker: fromObservable(({ input }: { input: { interval: number } }) =>
      interval(input.interval).pipe(map((n) => ({ type: 'TICK', count: n })))
    ),
  },
}).createMachine({
  states: {
    running: {
      invoke: {
        src: 'ticker',
        input: { interval: 1000 },
      },
      on: {
        TICK: { actions: 'handleTick' },
      },
    },
  },
});
```

## Transition Actors (Reducer-like)

```typescript
import { fromTransition } from 'xstate';

const counterLogic = fromTransition(
  (state, event) => {
    switch (event.type) {
      case 'INCREMENT':
        return { ...state, count: state.count + 1 };
      case 'DECREMENT':
        return { ...state, count: state.count - 1 };
      default:
        return state;
    }
  },
  { count: 0 } // Initial state
);

// Use standalone
const actor = createActor(counterLogic);
actor.start();
actor.send({ type: 'INCREMENT' });
```

## Promise with AbortSignal (Cancellation)

```typescript
import { fromPromise } from 'xstate';

const machine = setup({
  actors: {
    fetchWithCancel: fromPromise(async ({ input, signal }) => {
      const res = await fetch(input.url, { signal });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    }),
  },
}).createMachine({
  states: {
    loading: {
      invoke: {
        src: 'fetchWithCancel',
        input: { url: '/api/data' },
        onDone: 'success',
        onError: 'error',
      },
      on: {
        CANCEL: 'idle', // Exiting state aborts the promise
      },
    },
  },
});
```

## Callback Actor with `receive()` (Bidirectional)

```typescript
import { fromCallback } from 'xstate';

const machine = setup({
  actors: {
    webSocket: fromCallback(({ sendBack, receive, input }) => {
      const socket = new WebSocket(input.url);

      socket.onmessage = (e) => {
        sendBack({ type: 'MESSAGE', data: JSON.parse(e.data) });
      };

      // Receive events FROM the parent machine
      receive((event) => {
        if (event.type === 'SEND_MESSAGE') {
          socket.send(JSON.stringify(event.payload));
        }
      });

      return () => socket.close();
    }),
  },
}).createMachine({
  states: {
    connected: {
      invoke: { src: 'webSocket', input: { url: 'wss://api.example.com' } },
      on: {
        MESSAGE: { actions: 'handleMessage' },
        SEND: {
          actions: sendTo('webSocket', ({ event }) => ({
            type: 'SEND_MESSAGE',
            payload: event.payload,
          })),
        },
      },
    },
  },
});
```

## System ID and Actor Communication

```typescript
import { createActor } from 'xstate';

// Assign a systemId for cross-actor communication
const actor = createActor(machine, { systemId: 'main' });

// Access system from within machine
const childMachine = setup({
  // ...
}).createMachine({
  entry: ({ system }) => {
    const mainActor = system.get('main');
    mainActor?.send({ type: 'CHILD_READY' });
  },
});
```

## Cleanup Pattern

```typescript
const machine = setup({
  actors: {
    subscription: fromCallback(({ sendBack }) => {
      const id = setInterval(() => sendBack({ type: 'TICK' }), 1000);

      // ALWAYS return cleanup function
      return () => {
        clearInterval(id);
        console.log('Cleaned up');
      };
    }),
  },
}).createMachine({
  states: {
    active: {
      invoke: { src: 'subscription' },
      on: { STOP: 'idle' }, // Cleanup runs automatically
    },
    idle: {},
  },
});