# `@shm/reactive` — what it is, why it exists, and how it works

> A small reactive layer between our Go daemon and the Electron renderer. Think TanStack Query, but events come **to** you instead of you polling **for** them.

This post walks through the design of the new `@shm/reactive` package (`frontend/packages/reactive/`) and how it connects daemon-side state changes to React components without polling. It's aimed at teammates who already know our desktop stack (Connect-RPC + TanStack + electron-trpc) but haven't read the [Riffle paper](https://doi.org/10.1145/3586183.3606801) that inspired it.

## The problem

Today, every renderer hook that fetches daemon data follows the same loop:

1. `useQuery` calls a Connect-RPC method.
2. TanStack caches the result with `staleTime: Infinity`.
3. Some other code path eventually calls `queryClient.invalidateQueries(key)`.
4. The hook refetches.

That works fine when **the renderer itself** caused the change (publish → invalidate). It works poorly when the change happens elsewhere:

- A P2P peer pushes a new version of a doc to our daemon.
- Background discovery downloads new blobs.
- The user runs `seed document create` in a terminal.

Today the renderer only learns about those by polling on an interval (10s `useDaemonInfo`, 2s on active tasks, 14s discovery), waiting for a focus event, or hoping a mutation in the renderer happened to invalidate the right key. The result is the UI feels frozen for seconds when interesting things happen outside it.

We want the daemon to **push**, the renderer to **react**, and components to stay declarative.

## Where the idea comes from

Riffle (Litt et al., UIST '23) ships an entire reactive client-side relational DB. We borrowed only the *reactive layer* — not the DB. Our daemon already owns a local SQLite; the boundary between daemon and renderer is IPC, not the network. So we don't need to replicate the DB into the renderer. We just need a way to tell the renderer "this thing changed, refetch the bits that care."

Three Riffle concepts mapped onto our setup:

| Riffle concept | Our adaptation |
|---|---|
| Reactive relational queries (DAG of SQL) | Reactive **fetcher nodes** keyed by topic |
| Synchronous transactional updates | Microtask-batched tick — one paint per event burst |
| UI state in the DB | (Deferred to a future slice) |

## Architecture in one picture

```
┌────────────────────────── Go daemon (Connect-RPC) ─────────────────────────┐
│  SQLite is source of truth. Listens on :56001 (http) and :56002 (grpc).    │
│  (Future: streams change events directly. Today: queried by polling.)      │
└───────────────────────────────────┬────────────────────────────────────────┘
                                    │ Connect-RPC unary calls
                                    ▼
┌──────────────────────── Electron main process ─────────────────────────────┐
│  TopicPoller (frontend/apps/desktop/src/app-events.ts)                     │
│  • Registers fetchers per topic (e.g. LIBRARY).                            │
│  • Polls the daemon every 1.5s, hashes result, emits event on diff.        │
│  Anywhere in main can call broadcastReactiveEvent({topic, hint}).          │
│  Exposed as electron-trpc subscription:  events.watch  →  Observable<E>    │
└───────────────────────────────────┬────────────────────────────────────────┘
                                    │ tRPC subscription (one per renderer)
                                    ▼
┌──────────────────────────── Renderer ──────────────────────────────────────┐
│  @shm/reactive                                                              │
│   ├─ event-bus.ts:   pub/sub keyed by topic, supports wildcard '*'.        │
│   ├─ graph.ts:       Node = {key, topics, fetcher, equals?}.               │
│   │                  Subscribes to its topics. On event → mark dirty,      │
│   │                  schedule microtask tick. Tick refetches all dirty     │
│   │                  nodes and notifies React via StateStream.             │
│   └─ react.tsx:      useReactiveQuery(node) via useSyncExternalStore.      │
│                                                                             │
│  root.tsx wires it once at boot:                                            │
│    client.events.watch.subscribe(undefined, {                              │
│      onData: (e) => dispatch(e),                                           │
│    })                                                                       │
└────────────────────────────────────────────────────────────────────────────┘
```

The renderer side is ~250 lines of TS. The main-process side is ~90 lines.

## The three building blocks

### 1. `event-bus.ts` — topic pub/sub

```ts
export type ReactiveEvent = { topic: string; hint?: unknown }

const listenersByTopic = new Map<string, Set<Listener>>()
const wildcardListeners = new Set<Listener>()

export function dispatch(event: ReactiveEvent): void {
  listenersByTopic.get(event.topic)?.forEach((l) => l(event))
  wildcardListeners.forEach((l) => l(event))
}

export function onEvent(topic: string, listener: Listener): () => void {
  // ... refcounted add/remove
}
```

That's basically it. Topics are strings — we standardise them in `Topics`:

```ts
export const Topics = {
  LIBRARY: 'LIBRARY',
  directory: (account: string, path: string) => `DIRECTORY:${account}:${path}`,
  entity: (id: string) => `ENTITY:${id}`,
  account: (id: string) => `ACCOUNT:${id}`,
  comments: (entityId: string) => `COMMENTS:${entityId}`,
} as const
```

A topic is a coarse-grained dependency declaration. "I care about anything in the LIBRARY," or "I care about this specific entity." Wildcards (`*`) are useful for the dev overlay (more on that below) and for blanket invalidations.

### 2. `graph.ts` — fetcher nodes with dirty tracking

A `Node` glues together "what to fetch," "what to refetch on," and "how to compare results."

```ts
export type NodeDef<T> = {
  key: string             // stable identity in the registry
  topics: readonly string[]
  fetcher: () => Promise<T>
  equals?: (a: T, b: T) => boolean   // optional early-cutoff
}
```

You don't call the fetcher yourself. Instead you `acquireNode(def)` and get back a `StateStream<NodeState<T>>` plus a `release` function. Internally the graph:

1. Keeps a global registry keyed by `key`. Two `acquireNode` calls with the same key **share** the underlying node — one fetch serves many consumers.
2. Refcounts subscribers per node. First subscriber → subscribe the fetcher to all of its `topics`. Last subscriber → unsubscribe (memory hygiene).
3. When an event for one of the node's topics arrives → mark the node dirty and `queueMicrotask(runTick)`.
4. The tick reads the dirty set, re-runs each fetcher in parallel, and writes the result back through the node's `StateStream`.
5. If `equals` is provided and returns true against the previous value, the tick restores the **previous state object** (same reference) — no notification fires downstream, so React doesn't re-render.

The microtask scheduling is the key piece. If a daemon event burst arrives — say five blobs in one bitswap round-trip — the bus dispatches five events, the graph marks five dirty bits, and we run **one** tick instead of five. That's our budget version of Riffle's "synchronous transactional updates": no half-rendered UI between events.

```ts
function scheduleTick(): void {
  if (tickScheduled) return
  tickScheduled = true
  queueMicrotask(runTick)
}

async function runTick(): Promise<void> {
  tickScheduled = false
  const batch = Array.from(dirtyQueue)
  dirtyQueue.clear()
  await Promise.all(batch.map((rec) => refreshNode(rec)))
}
```

### 3. `react.tsx` — the hook

```ts
export function useReactiveQuery<T>(def: NodeDef<T>): NodeState<T> {
  // memoizes acquire on def.key, unsubscribes on unmount,
  // bridges StateStream to React via useSyncExternalStore.
}
```

Components don't see any of the bus or graph machinery. They look identical to a `useQuery`:

```tsx
const state = useReactiveQuery({
  key: `directory:${account}:${path}`,
  topics: [Topics.directory(account, path)],
  fetcher: () => grpcClient.documents.listDirectory({account, path}),
})
if (state.status === 'loading') return <Spinner />
if (state.status === 'error') return <Error err={state.error} />
return <List docs={state.value} />
```

## How an event travels end-to-end

Take the simplest topic we have wired today, `LIBRARY`, and trace what happens when something changes the user's document list.

1. **Trigger.** Someone — anyone — adds a doc. Could be a publish from this window, or `seed document create` from a terminal hitting the same daemon, or a future P2P blob sync.
2. **Main-process poller notices.** Every 1.5s the `TopicPoller` calls `grpcClient.documents.listDocuments({pageSize: 100_000})`, hashes the id/version list, and compares against its last-known fingerprint.
3. **Diff → broadcast.** Fingerprint changed → `broadcast({topic: 'LIBRARY'})`. Each renderer subscriber (`events.watch` observable) receives the event.
4. **Renderer dispatches into the bus.** `root.tsx`'s `client.events.watch.subscribe` callback calls `dispatch(event)`.
5. **Bus → graph.** Any node that declared `LIBRARY` in its `topics` array is marked dirty. Tick is scheduled.
6. **Tick.** Microtask runs. The dirty node's fetcher re-executes (or, for components that haven't migrated yet, we just call `queryClient.invalidateQueries([queryKeys.LIBRARY])` — see below).
7. **React notified.** `useSyncExternalStore` returns the new state; the component re-renders.

Steps 4-6 happen in the same JS task. Steps 1-3 happen in the main process; steps 4-7 in the renderer.

### Why the polling step is *temporary*

Today step 2 (main-process polling) is the source of events. The plan calls for replacing it with a Connect-RPC server-streaming method on the daemon — `Events.Watch` — that fires events from SQLite commit hooks. **When that happens, nothing in the renderer changes.** The `events.watch` tRPC subscription continues to forward events into the same bus. That's the whole point of stable APIs at each layer — we can swap transports without rewiring components.

## Bridging the old world: TanStack co-existence

We didn't rip out TanStack Query. New components can use `useReactiveQuery` directly. Existing components keep `useQuery` and we route reactive events to TanStack invalidations.

Concrete example, from `frontend/apps/desktop/src/models/library.ts`:

```ts
export function useSubscribedDocuments() {
  const allDocuments = useQuery({
    queryKey: [queryKeys.LIBRARY],
    queryFn: async () => { /* unchanged */ },
  })

  // ★ New: subscribe to LIBRARY topic → invalidate the TanStack key.
  useEffect(() => {
    return onEvent(Topics.LIBRARY, () => {
      queryClient.invalidateQueries({queryKey: [queryKeys.LIBRARY]})
    })
  }, [])

  return allDocuments
}
```

The component code didn't change. The hook didn't change shape. We just added a one-line bridge that lets the reactive bus poke TanStack from outside the renderer's normal mutation flow. This is the migration path: incremental.

## A second example — discovery progress (slice 1.5)

This one is wired but not consumed by a reactive node yet — the existing `getDiscoveryStream` push channel still drives the footer UI. We use the bus as a visibility tool today.

In `app-sync.ts`, the per-document discovery progress callback now also broadcasts:

```ts
discoveryStream.write({ /* ...progress... */ })

broadcastReactiveEvent({
  topic: `DISCOVERY:${id.id}`,
  hint: progress,
})
```

We also lowered `discoverDocument`'s `retryDelayMs` from 2000 ms to 250 ms. End result: when you paste an unfamiliar `hm://` URL into the address bar, the footer's `blobsDownloaded/blobsDiscovered` counter ticks visibly several times per second instead of every couple of seconds, **and** the dev overlay flashes a `DISCOVERY:hm://...` pill on each tick — proof that the bus is delivering events live.

## The dev-only overlay

`frontend/apps/desktop/src/components/reactive-event-overlay.tsx` is a tiny floating widget that subscribes to the wildcard topic and renders the last six events with a 4-second TTL:

```tsx
useEffect(() => onEvent('*', (event) => {
  setEvents((prev) => [event, ...prev].slice(0, MAX_VISIBLE))
}), [])
```

It only mounts when `!IS_PROD_DESKTOP`. When you're debugging, it tells you whether the bus is actually firing. If you have a hunch a UI is stale because no event reached it, the overlay tells you immediately.

## What this *isn't*

A few things to set expectations:

- **Not an IVM engine.** We re-fetch whole results on dirty. The Riffle paper uses SKDB to materialize incrementally. For us, that's a swappable future engine behind the same node API.
- **Not a client-side database.** All data still lives in the daemon's SQLite. The renderer just gets faster notifications.
- **Not a TanStack replacement.** Today it's a complementary push channel. Migration is incremental.
- **Not transactional across IPC.** Within a single tick we batch, but if events arrive from main in separate IPC ticks, they'll produce separate renders. Riffle's true synchronous semantics require everything in one process; we're in two. Close enough for now.

## How to read the code (suggested order)

1. `frontend/packages/reactive/src/event-bus.ts` — 50 LOC. Read first.
2. `frontend/packages/reactive/src/graph.ts` — 130 LOC. Read after event-bus.
3. `frontend/packages/reactive/src/react.tsx` — 35 LOC. Trivial after the graph.
4. `frontend/packages/reactive/src/index.ts` — public surface + the `Topics` taxonomy.
5. `frontend/packages/reactive/src/event-bus.test.ts` & `graph.test.ts` — 12 tests that document expected semantics.
6. `frontend/apps/desktop/src/app-events.ts` — main-process poller + tRPC subscription.
7. `frontend/apps/desktop/src/root.tsx` — the boot wiring (`client.events.watch.subscribe`).
8. `frontend/apps/desktop/src/models/library.ts` — example bridge into TanStack.

## What we plan to migrate next

See `.ai/plans/reactive-desktop-arch.md` for the slice roadmap. Short version:

- Slice 2: account profile header (`ACCOUNT:<id>` topic).
- Slice 3 (deferred — covered today by `queryInvalidation` IPC): doc body across windows.
- Slice 4: comments thread.
- Slice 5: replace the main-process poller with a daemon-side `Events.Watch` streaming RPC. Renderer untouched.
- Slice 6: move UI state (selection, scroll, navigation stack) into the same reactive store so server state and UI state tick together — eliminates the half-rendered flicker on navigation.

## TL;DR

- We added a tiny pub/sub bus, a fetcher-node graph, and a React hook in `@shm/reactive`.
- The main process pushes typed events to the renderer over an electron-trpc subscription.
- Renderer-side, events mark nodes dirty; a microtask tick refetches them in batch; React notifies in one render.
- Existing TanStack-based hooks can opt in by adding a one-line `onEvent` listener that calls `invalidateQueries`.
- The dev overlay makes the whole thing observable while debugging.

The whole point: the daemon already knows when things change. We just gave it a way to tell the UI without making the UI ask repeatedly.
