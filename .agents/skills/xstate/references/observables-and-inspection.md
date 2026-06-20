# Observables And Inspection

Use this reference when the task involves any of these:

- `fromObservable(...)` or RxJS-backed actors
- inspection/debugging of actor systems
- browser inspector wiring in app code

## Observable actors

Prefer `fromObservable(...)` when the actor naturally wraps a stream of values from an observable source.

Use it when:

- the source is already an observable
- values arrive over time
- the actor should subscribe/unsubscribe with actor lifecycle

Prefer `fromCallback(...)` instead when the source is a callback/listener API rather than an observable.

Local anchor:

- typed `fromObservable(...)` example: [/Users/davidkpiano/Code/xstate/packages/core/CHANGELOG.md](/Users/davidkpiano/Code/xstate/packages/core/CHANGELOG.md:645)

Minimal shape:

```ts
import { createActor, fromObservable } from 'xstate';
import { interval } from 'rxjs';

type Output = number;
type Input = { period?: number };

const tickerLogic = fromObservable<Output, Input>(({ input }) => {
  return interval(input.period ?? 1000);
});

const actor = createActor(tickerLogic, {
  input: { period: 500 }
});
```

## Inspection API

When debugging actor systems programmatically, use `actor.system.inspect(...)`.

This is useful when:

- you need structured transition/event/snapshot visibility
- you want to log or capture inspection events in tests or tooling
- you want lower-level visibility than ordinary subscriptions

It accepts either a function or an observer and returns a subscription.

Local anchor:

- `actor.system.inspect(...)` usage and unsubscribe behavior: [/Users/davidkpiano/Code/xstate/packages/core/test/inspect.test.ts](/Users/davidkpiano/Code/xstate/packages/core/test/inspect.test.ts:367)

Minimal shape:

```ts
import { createActor, createMachine } from 'xstate';

const actor = createActor(createMachine({}));

const sub = actor.system.inspect((inspectionEvent) => {
  console.log(inspectionEvent.type);
});

actor.start();

sub.unsubscribe();
```

## Browser inspector

When the user wants visual debugging in an app, prefer `@statelyai/inspect` with `createBrowserInspector(...)`.

Local anchor:

- React template wiring: [/Users/davidkpiano/Code/xstate/templates/react-ts/src/App.tsx](/Users/davidkpiano/Code/xstate/templates/react-ts/src/App.tsx:1)

Minimal shape:

```tsx
import { useMachine } from '@xstate/react';
import { createBrowserInspector } from '@statelyai/inspect';
import { feedbackMachine } from './feedbackMachine';

const { inspect } = createBrowserInspector({
  autoStart: false
});

export function Feedback() {
  const [snapshot, send] = useMachine(feedbackMachine, {
    inspect
  });

  return (
    <button onClick={() => send({ type: 'restart' })}>
      {snapshot.matches('closed') ? 'Restart' : 'Send'}
    </button>
  );
}
```

## Rule of thumb

- `fromPromise(...)`: one request, one result
- `fromCallback(...)`: callback/listener protocol, many events
- `fromObservable(...)`: real observable stream
- `actor.system.inspect(...)`: programmatic visibility
- `createBrowserInspector(...)`: visual/debug UI visibility
