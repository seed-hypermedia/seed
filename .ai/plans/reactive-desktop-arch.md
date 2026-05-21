# Reactive Desktop Architecture — Plan

Inspired by *Riffle: Reactive Relational State for Local-First Applications* (Litt et al., UIST '23, DOI 10.1145/3586183.3606801).

## Context

Seed desktop today is **polling-based with manual TanStack Query invalidation** over Connect-RPC to a local Go daemon. The daemon already owns the source-of-truth SQLite database on the same machine; IPC is the boundary, not the network. P2P sync results in the daemon, but the renderer only learns about new data on the next poll tick or manual `invalidateQueries()`.

Observed pain points motivating this work:

1. **Flicker / loading states on navigation.** Switching documents shows skeletons even when data is already cached locally, because each panel waits on its own query lifecycle.
2. **P2P sync feels frozen.** Discovery and inbound blobs land in the daemon but the UI takes seconds (or a focus event) to reflect them.
3. **State sprawl.** Server cache (TanStack), UI state (React + electron-store), document editor state (XState) live in separate reactive systems with ad-hoc bridges. Bugs leak across them.

Riffle solves analogous problems via (a) reactive relational queries, (b) synchronous transactional updates, (c) unifying UI + domain state in one reactive substrate. We adopt the **reactive layer ideas only** — daemon SQLite stays the source of truth; we do **not** ship a client-side DB. Web app (`@shm/web`) out of scope.

## Goal

Replace polling + manual invalidation with **push-driven, dependency-tracked reactive queries** that batch into transactional UI ticks, plus a single reactive store for UI state that participates in the same tick.

## Strategy: vertical slices, not horizontal layers

Build the smallest end-to-end loop (event source → bus → reactive graph → one UI surface) for **one** feature first. Each subsequent slice adds one more fetcher + topic + UI surface. The transport, engine, and UI-state store evolve **inside** the same vertical pipeline, swapped behind a stable renderer-facing API.

Benefits over horizontal phasing:

- Ship visible win after slice 1 (~days, not weeks).
- API gets stress-tested on real component before broad migration.
- Can be killed cheaply if approach fails — small blast radius.
- Each slice is independently mergeable; no big-bang flag.

## Target design (end state)

```
┌────────────────────────────── Go daemon ──────────────────────────────┐
│  SQLite (truth) → commit hooks → internal pubsub                      │
│  Events.Watch streaming RPC                                           │
│  • emits typed events: blob.inserted, doc.changed, sub.updated…      │
│  • topic-tagged (ENTITY:<id>, DIRECTORY:<acct>:<path>, ACCOUNT:<id>) │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ Connect-RPC server-streaming
                               ▼
┌──────────────────────── Electron main process ────────────────────────┐
│  EventBridge — owns the single daemon stream, fans out to renderers   │
│  TopicPoller (slice-1 fallback) — polls daemon, diffs, emits events   │
│  Both push to renderers over electron-trpc subscription              │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ tRPC observable
                               ▼
┌──────────────────────────── Renderer ─────────────────────────────────┐
│  @shm/reactive                                                         │
│   • graph.ts: Node={key,topics,fetcher,equals?}, dirty, tick scheduler│
│   • event-bus.ts: pipes events → markDirty(topic)                     │
│   • react.tsx: useReactiveQuery(node), useReactiveState(schema)       │
│  UIStateStore (later slice) — extends StateStream, same tick          │
└────────────────────────────────────────────────────────────────────────┘
```

Stable API contract from day 1: `useReactiveQuery(node)` and `useReactiveState(schema, scope)`. Everything below can change without touching components.

Key design choices:

- **Engine deferred.** No client SQLite. Slice 1 = "refetch whole result on dirty". Later: swap for IVM (cr-sqlite, materialize-wasm) behind same node API.
- **Transport swap, not rewrite.** Slice 1 uses electron-trpc subscription backed by main-process polling. Later slice swaps event source for `Events.Watch` Connect streaming RPC; renderer untouched.
- **Topic-level reactivity, not row-level.** Mirrors Riffle's "on-demand layer" (paper §A). Manually declare topics per node; later derive from query shape.
- **Transactional tick.** All dirty nodes triggered by one event resolve before React notification. Mirrors Riffle §3.2 (synchronous transactional updates).
- **UI state migration is its own slice.** Don't conflate with server-state reactivity.

## Slice plan

Each slice = **one fetcher + one topic + one UI surface**. Stop or pivot after any slice if no win.

### Slice 1 — Live sidebar directory listing (FIRST)

**Why this slice:** smallest end-to-end. One RPC (`Documents.ListDocuments` / `ListDirectory`). Visible P2P win — synced sibling docs appear without focus. No editor/CRDT involvement.

Components:

1. `frontend/packages/reactive/` (NEW pkg `@shm/reactive`)
   - `src/graph.ts` (~120 LOC): `defineNode({key, topics, fetcher, equals?})`, internal `Map<key, Node>`, `markDirty(topic)`, microtask-batched `tick()` that re-runs dirty fetchers in topological order and notifies via per-node `StateStream`.
   - `src/react.tsx`: `useReactiveQuery(node)` via `useSyncExternalStore` reusing `frontend/packages/shared/src/utils/stream.ts`.
   - `src/event-bus.ts`: `dispatch(event)`, `onEvent(topic, fn)`.
   - `src/index.ts` exports.

2. Main process — `frontend/apps/desktop/src/main/topic-poller.ts` (NEW)
   - Registers topic `DIRECTORY:<account>:<path>`.
   - When ≥1 renderer subscribes, polls `grpcClient.documents.listDocuments` every ~1s, hashes ID list, emits event on change.
   - Stops when 0 subscribers.

3. Main process — extend `frontend/apps/desktop/src/app-api.ts`
   - Add `events` router with `watch(topics: string[])` returning tRPC `Observable<Event>` (electron-trpc subscriptions).

4. Renderer wiring — `frontend/apps/desktop/src/app-context.tsx`
   - At boot, open one `trpc.events.watch.subscribe({topics: ['*']})`.
   - Pipe `next` into `reactive.dispatch(event)`.

5. Migrate one component — sidebar directory list (currently uses TanStack `useQuery`)
   - Replace with `useReactiveQuery(directoryNode({account, path}))`.
   - Node declares `topics: ['DIRECTORY:'+account+':'+path]`, fetcher = existing Connect call.

**Verification (slice 1):**
- Open desktop, log in. From a second daemon (or `./dev` script), create new doc under same account/path.
- Sidebar should grow within ~1s without click/focus. Compare to baseline polling (10s + focus refetch).
- Confirm: no console spam, poller stops when sidebar unmounts.
- `pnpm --filter @shm/desktop test:unit`, `pnpm typecheck`.

**What's intentionally NOT in slice 1:**
- New proto file. None.
- Daemon commit hooks / pubsub. None.
- IVM engine. None.
- UI state migration. None.
- Streaming Connect RPC. None.
- Schema mirror, GraphQL, materialized views. None.

### Slice 1.5 — Live sync/discovery progress (visible-on-single-machine, NEXT)

**Why this slice now:** slice 1 plumbing works but isn't user-visible because (a) testing requires a second daemon to trigger external mutations and (b) existing `queryInvalidation` IPC already broadcasts local UI mutations across windows. Discovery progress is the cleanest single-machine, single-daemon demo because the daemon ticks the counters during a sync, independent of UI mutations.

Single-machine demo: paste an unfamiliar `hm://...` URL → footer subscription row shows `blobsDownloaded/blobsDiscovered` counter ticking visibly during sync. Currently the counters update every ~2s (existing `discoverDocument` `retryDelayMs`); with reactive-driven adaptive cadence they tick at ~250ms while the relevant UI is mounted.

Status: existing infra already has a push channel (`client.sync.activeDiscoveries.subscribe` in `frontend/apps/desktop/src/models/entities.ts`) and a per-entity `getDiscoveryStream` consumed by `frontend/apps/desktop/src/components/footer.tsx`. The win is **adaptive cadence**, not new plumbing.

Components:

1. `frontend/apps/desktop/src/app-sync.ts`
   - Lower `discoverDocument` `retryDelayMs` from `2_000` to `250` (or thread it through a dynamic getter). Keep `maxRetryMs` (`DISCOVERY_POLL_INTERVAL_MS = 14_000`) so we don't loop forever.
   - Drive cadence adaptively: fast (`250ms`) while `DISCOVERY:<entity>` topic has subscribers, slow (`2_000ms`) otherwise.

2. `frontend/apps/desktop/src/app-events.ts`
   - Track per-topic subscriber counts (so app-sync can ask "is anyone watching DISCOVERY:<id>?").
   - Emit `DISCOVERY:<entity-id>` topic events on each progress write so the reactive bus participates in the loop (groundwork for future migrations).

3. Renderer
   - Doc-view page (`frontend/apps/desktop/src/pages/desktop-resource.tsx`) opts into fast cadence by subscribing to `DISCOVERY:<id>` topic on mount (no rerender consumer needed — the existing `getDiscoveryStream` already drives the footer UI).
   - Optional dev-only overlay (`<ReactiveEventOverlay />`) — flashes when any topic event fires. Makes the bus observable while debugging, gated by `IS_PROD_DESKTOP === false`.

**Verification (slice 1.5):**
- Open desktop. Paste any not-yet-synced `hm://...` URL into the address bar.
- Watch the footer subscription row counter increment several times per second instead of once every ~2s.
- Close the doc view → cadence drops back to baseline (verify by removing & re-adding subscribers in devtools).
- `pnpm typecheck`, `pnpm --filter @shm/reactive test`.

**What's intentionally NOT in slice 1.5:**
- No new proto. No daemon change.
- No replacement of `client.sync.activeDiscoveries` push channel — still the source of truth for renderer streams.
- No global polling rate change for users who never open a doc — only adaptive when a renderer asks.

### Slice 2 — Account profile header

Topic `ACCOUNT:<id>`. Fetcher = `Documents.GetAccount`. Same poller pattern. Replaces one more `useQuery`. Validates topic taxonomy at 2 surfaces.

### Slice 3 — Open document body (deferred — already mostly covered)

Topic `ENTITY:<id>`. Fetcher = `Documents.GetDocument`. Remote change arrives → doc rerenders without manual reload.

**Note (post-slice-1.5):** existing `queryInvalidation` IPC + electron-trpc subscriptions in `frontend/apps/desktop/src/root.tsx` already broadcasts `invalidateQueries([queryKeys.ENTITY, id])` across windows on any local publish (`frontend/apps/desktop/src/models/documents.ts:467`). Multi-window live mirror works today via that path. The reactive win here is for **non-UI-originated** changes (P2P sync of an open doc) — same testability constraint as slice 1. Defer until we have either (a) a second daemon for testing or (b) the streaming RPC (slice 5) which lets the daemon push directly.

### Slice 4 — Comments thread

Topic `COMMENTS:<entity>`. Fetcher = `Comments.ListComments`. Validates "many small topics under one parent entity" pattern + invalidation fan-out.

### Slice 5 — Swap event source to real streaming RPC

Only main-process change. Add `proto/events/v1alpha/events.proto` with `Events.Watch(filter) returns stream Event`. Implement Go handler reading from internal pubsub fed by SQLite commit hooks (or by tailing `structural_blobs.insert_time`). Replace `TopicPoller` with stream consumer. Renderer untouched.

### Slice 6 — UI state into reactive store (transactional consistency)

Move sidebar selection + breadcrumb + nav stack from React state + electron-store into `UIStateStore` (new). Same tick batches server updates and UI writes. Mirrors Riffle §3.2 — eliminates half-rendered nav (sidebar selected B, main pane still A).

### Slice 7+ — Cleanup + optional IVM

- Delete `refetchInterval`s once parity holds.
- (Optional) Swap "refetch on dirty" for cr-sqlite / materialize-wasm with incremental views. Requires schema mirror — separate design doc.

## Reuse (do not re-invent)

- `frontend/packages/shared/src/utils/stream.ts` — `StateStream`/`EventStream` already used (`appWindowEvents`, `darkMode`). Build on this; no RxJS / signals lib.
- `frontend/packages/shared/src/use-stream.ts` — existing `useSyncExternalStore` binding.
- `frontend/packages/shared/src/models/query-client.ts` — TanStack stays for non-migrated surfaces during rollout.
- `frontend/apps/desktop/src/trpc.ts` — existing electron-trpc setup; add subscription router only.
- Existing `Subscriptions` RPC stays — orthogonal (sync intent), not push.

## Files (slice 1 only)

NEW:
- `frontend/packages/reactive/package.json`
- `frontend/packages/reactive/src/{graph,react,event-bus,index}.ts`
- `frontend/apps/desktop/src/main/topic-poller.ts`

EDIT:
- `frontend/apps/desktop/src/app-api.ts` — add `events.watch` subscription.
- `frontend/apps/desktop/src/app-context.tsx` — wire bus on boot.
- One sidebar component file (TBD when scanning components) — swap hook.

## Boundaries respected

- Daemon untouched in slice 1. First proto/Go change lands in slice 5.
- `vault/` workspace untouched.
- Web app (`@shm/web`) unaffected.
- Per `frontend/AGENTS.md` 95% threshold met via 4 clarifying answers.

## Open questions / risks (mostly deferred until they bite)

- **Backpressure** (relevant slice 5+). Daemon may emit thousands of events during sync burst. Coalesce per-topic with debounce in main process before fanning to renderers.
- **Reconnect / replay** (slice 5+). On daemon restart, renderer must resync. Either cursor on stream (mirroring `P2P.ListBlobs`) or full-refetch-on-reconnect.
- **UI-thread cost** (slice 6+). Riffle §6.4 warns synchronous graph can block paint. Mitigation: keep heavy transforms in component memoization, not in graph fetchers.
- **Persisted UI state queryability** (slice 6+). electron-store blobs aren't queryable. Acceptable for v1.

## Verification per slice

Common gates after every slice:
- `pnpm typecheck`
- `pnpm --filter @shm/reactive test` (once tests exist, slice 1 prototype skips)
- `pnpm --filter @shm/desktop test:unit`
- Manual: golden path + monitor devtools (no console spam, single tRPC subscription open).

Slice-specific:
- Slice 1: P2P-added sidebar doc appears <1.5s, no manual focus. Baseline = current 10s polling.
- Slice 3: remote change of open doc reflects in body <1s.
- Slice 5: swap to streaming verified by `grpcurl` plus desktop e2e equivalence with slice-1 polling baseline.
- Slice 6: Playwright frame trace confirms sidebar selection + main pane swap in same paint.

## How to test slice 1 specifically

1. `pnpm install` (new workspace pkg).
2. `pnpm --filter @shm/desktop dev`.
3. Open two daemons (local + second device or local + `./dev` synthetic peer). Log into same account.
4. On the second daemon, create a new doc in the active directory.
5. Watch the sidebar in the first desktop instance update without clicking or refocusing.
6. Compare: revert the sidebar component to the old `useQuery` hook and repeat — confirm the old behavior takes ≥10s or requires window focus.
7. Devtools network panel: one open tRPC subscription, no rapid HTTP polling for the migrated query.
