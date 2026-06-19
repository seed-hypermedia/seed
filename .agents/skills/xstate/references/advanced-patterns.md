# Advanced XState v5 Patterns

Use this reference when the task involves any of these:

- typed actions beyond plain `assign(...)`
- deciding between `fromPromise(...)` and `fromCallback(...)`
- machine-emitted events
- persistence and hydration
- reducing over-modeled parent machines

## Typed actions beyond `assign(...)`

LLMs often act like `assign(...)` is the only useful action. It is not.

For typed reusable action logic, prefer setup-scoped helpers from a `const machineSetup = setup(...)` object when they make the behavior clearer:

- `machineSetup.createAction(...)` for typed custom actions
- `machineSetup.enqueueActions(...)` when one transition should enqueue several actions conditionally
- `machineSetup.emit(...)` when the machine should emit an event to the surrounding system
- `machineSetup.assign(...)`, `machineSetup.raise(...)`, `machineSetup.sendTo(...)`, etc. when you want type-bound built-ins

Minimal pattern:

```ts
import { setup } from 'xstate';

const machineSetup = setup({
  types: {} as {
    context: { count: number };
    events: { type: 'count.incremented'; value: number } | { type: 'count.flushed' };
    emitted: { type: 'count.changed'; count: number };
  }
});

const increment = machineSetup.assign({
  count: ({ context, event }) =>
    event.type === 'count.incremented' ? context.count + event.value : context.count
});

const raiseFlush = machineSetup.raise({ type: 'count.flushed' });

const emitChanged = machineSetup.emit(({ context }) => ({
  type: 'count.changed',
  count: context.count
}));

const flushIfNeeded = machineSetup.enqueueActions(({ context, enqueue }) => {
  if (context.count > 10) {
    enqueue(raiseFlush);
  }
});
```

Local anchors:

- setup-scoped typed helpers: [/Users/davidkpiano/Code/xstate/packages/core/CHANGELOG.md](/Users/davidkpiano/Code/xstate/packages/core/CHANGELOG.md:254)
- `enqueueActions(...)` in a real machine: [/Users/davidkpiano/Code/xstate/examples/tiles/src/tilesMachine.ts](/Users/davidkpiano/Code/xstate/examples/tiles/src/tilesMachine.ts:1)

## Prefer event payloads over context relay

If state A only stores data so state B can use it immediately, ask whether that data should just travel on an event.

Prefer:

- event carries the payload the next transition or actor needs
- child actor input comes from the triggering event when that is the natural source

Be careful about:

- storing temporary request payloads in context solely so `onDone` or a later state can read them
- adding context fields that duplicate transient protocol data
- storing raw transport artifacts like `latestChunk`, callback payloads, or response wrappers when the machine only needs a derived durable value such as `progress`

Context should hold durable state, not every hop in the protocol.

## Choosing the right actor kind

Do not default to `fromPromise(...)`.

Prefer `fromPromise(...)` when:

- one request produces one result or one failure
- the actor does not need to push multiple events over time
- the machine genuinely wants `onDone` / `onError`

Prefer `fromCallback(...)` when:

- the actor wraps subscriptions, timers, DOM listeners, sockets, or external callbacks
- the actor needs to send multiple events back over time
- forcing everything into `onDone` / `onError` makes the machine awkward

When writing callback-actor examples:

- declare the external callback API shape if it is not already defined in the snippet
- type the callback payload instead of leaving `msg`, `chunk`, or `err` as implicit `any`
- prefer sending domain events like `upload.progress` or `timer.ticked` back to the parent
- keep only durable results in context; avoid storing raw callback payloads unless the machine truly needs them later

Local anchors:

- callback actor with recurring events: [/Users/davidkpiano/Code/xstate/examples/workflow-check-inbox/main.ts](/Users/davidkpiano/Code/xstate/examples/workflow-check-inbox/main.ts:1)
- callback actor for ticking input: [/Users/davidkpiano/Code/xstate/examples/stopwatch/src/stopwatchMachine.ts](/Users/davidkpiano/Code/xstate/examples/stopwatch/src/stopwatchMachine.ts:1)

Minimal upload-style callback pattern:

```ts
import { assign, fromCallback, setup } from 'xstate';

type UploadMessage =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'complete' }
  | { type: 'error'; error: unknown };

declare function startUploadAndListen(
  uploadId: string,
  onMessage: (message: UploadMessage) => void
): () => void;

const machineSetup = setup({
  types: {} as {
    context: {
      uploadId: string | null;
      progress: number;
      error: string | null;
    };
    events:
      | { type: 'upload.started'; uploadId: string }
      | { type: 'upload.progress'; loaded: number; total: number }
      | { type: 'upload.completed' }
      | { type: 'upload.failed'; error: string };
  },
  actors: {
    upload: fromCallback<
      { type: 'upload.progress'; loaded: number; total: number }
      | { type: 'upload.completed' }
      | { type: 'upload.failed'; error: string },
      { uploadId: string }
    >(({ input, sendBack }) => {
      return startUploadAndListen(input.uploadId, (message) => {
        if (message.type === 'progress') {
          sendBack({
            type: 'upload.progress',
            loaded: message.loaded,
            total: message.total
          });
          return;
        }
        if (message.type === 'complete') {
          sendBack({ type: 'upload.completed' });
          return;
        }
        sendBack({ type: 'upload.failed', error: String(message.error) });
      });
    })
  }
});

export const uploadMachine = machineSetup.createMachine({
  context: {
    uploadId: null,
    progress: 0,
    error: null
  },
  initial: 'idle',
  states: {
    idle: {
      on: {
        'upload.started': {
          target: 'uploading',
          actions: assign({ uploadId: ({ event }) => event.uploadId })
        }
      }
    },
    uploading: {
      invoke: {
        src: 'upload',
        input: ({ context }) => ({ uploadId: context.uploadId! })
      },
      on: {
        'upload.progress': {
          actions: assign({
            progress: ({ event }) =>
              Math.round((event.loaded / event.total) * 100)
          })
        },
        'upload.completed': { target: 'done' },
        'upload.failed': {
          target: 'failed',
          actions: assign({ error: ({ event }) => event.error })
        }
      }
    },
    done: {},
    failed: {}
  }
});
```

## Emitted events

Machines can emit events. This is useful when the machine is driving a larger system and should announce something meaningful outward, instead of forcing every consumer to poll context or infer behavior indirectly.

Prefer emitted events when:

- the machine is modeling a process that should notify the outside world
- the notification is part of the domain, not just UI plumbing
- the alternative is stuffing extra bookkeeping into context for others to watch

Use `types.emitted` plus `machineSetup.emit(...)` for typed emitted events.

Local anchor:

- typed emitted events and `machineSetup.emit(...)`: [/Users/davidkpiano/Code/xstate/packages/core/CHANGELOG.md](/Users/davidkpiano/Code/xstate/packages/core/CHANGELOG.md:254)

## Avoid over-modeling the parent machine

LLMs often over-expand the statechart.

Prefer coarse parent states when:

- the parent only cares about a higher-level mode
- an invoked/spawned child can own transient internal detail
- extra parent states mainly represent implementation noise

Do not split aggressively just for conceptual purity. The goal is a sturdier model, not the maximum number of actors and states.

## Persistence and hydration

Prefer snapshot persistence over hand-rolled state reconstruction.

Canonical pattern:

```ts
import { createActor } from 'xstate';
import { authMachine } from './authMachine';

const persisted = loadPersistedSnapshot();

const actor = createActor(authMachine, {
  snapshot: persisted
});

actor.subscribe(() => {
  savePersistedSnapshot(actor.getPersistedSnapshot());
});
```

In UI adapters, prefer provider or hook options that accept a persisted snapshot when available rather than rebuilding state manually.

Be careful about older examples that use `state:` in actor options. For current v5 code, prefer `snapshot:` when hydrating persisted machine state.

For migration or repair tasks, do not keep dead implementation override objects alive by passing them into `useMachine(...)` if the current hook does not accept them. Either move real implementations into `setup(...)`/machine config or remove dead overrides if they are unused.

Local anchors:

- persisted snapshot save/restore flow: [/Users/davidkpiano/Code/xstate/examples/mongodb-persisted-state/main.ts](/Users/davidkpiano/Code/xstate/examples/mongodb-persisted-state/main.ts:14)
- persisted snapshot in an API workflow example: [/Users/davidkpiano/Code/xstate/examples/express-workflow/index.ts](/Users/davidkpiano/Code/xstate/examples/express-workflow/index.ts:27)
- React adapter tests using `snapshot` hydration: [/Users/davidkpiano/Code/xstate/packages/xstate-react/test/createActorContext.test.tsx](/Users/davidkpiano/Code/xstate/packages/xstate-react/test/createActorContext.test.tsx:435)
