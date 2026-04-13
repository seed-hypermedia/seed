# Electron Performance Fix — XState Actor Architecture

## Context

Users report progressive slowdown: 90 subscriptions, 86 discovery streams with 5 windows, heap grew 130.2%, RSS 350MB. Root causes: (1) 300ms setTimeout in `removeSubscribedEntity()` leaks subscriptions on window close/navigation, (2) per-resource discovery timers (N resources = N setTimeout chains), (3) 3s activity polling with no background throttling, (4) global lazy subscriptions never cleaned.

We'll replace the implicit mutable state with XState v5 actors (already installed at v5.19.2). This gives: explicit states, deterministic cleanup, built-in observability, and adaptive polling via dynamic delays.

## Actor Hierarchy

```
MAIN PROCESS
─────────────
syncSystemActor (orchestrator — spawns/stops children)
  ├── activityStateActor        — tracks active/idle/backgrounded
  ├── activityPollerActor       — polls activity feed on adaptive interval
  ├── discoveryBatchActor       — single loop processing discovery queue
  ├── invalidationBufferActor   — debounces query invalidations
  └── resourceActor[N]          — one per subscribed resource (spawned on demand)

RENDERER (per window)
─────────────
windowSyncActor                 — ref-counted subscription handles + deterministic cleanup
```

## Statecharts

### `syncSystemActor` — Orchestrator (main process)

```
context:
  subscriptionCounts: Map<key, number>
  resourceActors: Map<key, ActorRef<resourceActor>>
  recursiveKeys: Set<string>

states: idle | active

events:
  SUBSCRIBE { key, id, recursive, windowId }
    → increment count, if was 0: spawn resourceActor, transition idle→active
  UNSUBSCRIBE { key, id, windowId }
    → decrement count, if now 0: stop resourceActor
    → if no subscriptions left: transition active→idle
  CLEANUP_WINDOW { windowId }
    → unsubscribe all entries for that windowId (safety net for crashes)
  RESOURCE_STATUS { key, status, version }
    → forward to invalidationBufferActor
  ACTIVITY_EVENTS { events[] }
    → match against subscribed resources, forward to invalidationBufferActor
  FLUSH { resources[] }
    → call appInvalidateQueries for each resource
```

### `resourceActor` — Per-Resource Discovery (spawned child)

Replaces `discoveryLoop()` setTimeout chain in `app-sync.ts:635-670`.

```
input: { id, recursive, activityState }
context: { lastVersion, progress, retryCount }

states:
  debouncing → after(DEBOUNCE + jitter) → discovering
  discovering
    invoke: runDiscovery(id, recursive)
    → done.ok:
        found      → found
        tombstone  → settled.tombstone
        redirect   → settled.redirect
        notFound   → settled.notFound
    → done.error   → retrying
  found
    entry: sendParent(RESOURCE_STATUS)
    after(DISCOVERY_POLL_INTERVAL * multiplier) → discovering
  settled.tombstone / settled.redirect / settled.notFound
    entry: sendParent(RESOURCE_STATUS)
    after(DELETED_POLL_INTERVAL * multiplier) → discovering
  retrying
    after(2000 * multiplier) → discovering

on: STOP → (final)  // auto-cancels all pending delays
on: ACTIVITY_CHANGE { state } → assign multiplier
```

XState auto-cancels `after` delays when actor is stopped — **no leaked timers possible**.

### `activityPollerActor` — Activity Feed Polling

Replaces `setInterval(pollActivity, 3000)` in `app-sync.ts:357`.

```
context: { lastEventId, multiplier }

states:
  stopped → on START → polling
  polling
    invoke: fetchNewEvents(lastEventId)
    → done.ok → sendParent(ACTIVITY_EVENTS), → waiting
    → done.error → waiting
  waiting
    after(15_000 * multiplier) → polling   // was 3s, now 15s base
    on STOP → stopped

on: ACTIVITY_CHANGE → assign multiplier
```

### `invalidationBufferActor` — Debounced Invalidations

Replaces `scheduleInvalidation` / `debounceTimer` in `app-sync.ts`.

```
context: { pending: Set<string> }

states:
  idle → on INVALIDATE → buffering (add to pending)
  buffering
    on INVALIDATE → stay (add to pending)
    after(100ms) → flush → idle
  flush: entry → sendParent(FLUSH, pending), clear pending
```

### `activityStateActor` — App Focus/Idle Tracking

New module. Drives adaptive polling across all actors.

```
context: { idleTimeoutMs: 60_000 }

states:
  active
    on ALL_WINDOWS_BLURRED → backgrounded
    on SUSPEND → backgrounded
    after(idleTimeoutMs) → idle
    on USER_INPUT → restart idle timer
  backgrounded
    on WINDOW_FOCUSED → active
    on RESUME → active
  idle
    on WINDOW_FOCUSED → active
    on USER_INPUT → active

Multipliers: active=1, idle=3, backgrounded=10
On transition: sendParent(ACTIVITY_CHANGE { state, multiplier })
```

Wired to: `BrowserWindow` focus/blur, `powerMonitor` suspend/resume, `powerMonitor.getSystemIdleTime()`.

### `windowSyncActor` — Renderer Subscription Manager

Replaces `addSubscribedEntity`/`removeSubscribedEntity` + 300ms setTimeout in `entities.ts:221-277`.

```
context:
  handles: Map<key, { resourceSub, discoveryStateSub }>
  counts: Map<key, number>

states:
  active
    on ADD_ENTITY { key, id, recursive }
      → increment count
      → if was 0: create tRPC subs (sync.subscribe + sync.discoveryState)
    on REMOVE_ENTITY { key, id }
      → decrement count
      → if now 0: unsubscribe IMMEDIATELY (no setTimeout!)

  on WINDOW_CLOSING → cleanup (final)
    entry: iterate all handles, unsubscribe each, clear maps

  cleanup (type: final)
```

**Critical fix**: `REMOVE_ENTITY` at count=0 unsubscribes **synchronously**. The 300ms debounce is unnecessary because React 18 batches `useEffect` cleanup+setup in the same commit. For the rare rapid unmount/remount case, ref counting naturally handles it (count goes 1→0→1, never triggers unsubscribe).

Global subscriptions (`aggregatedState`, `activeDiscoveries`) become part of `windowSyncActor` context — created on actor start, cleaned up when actor reaches final state.

## Files to Create/Modify

| File | Action |
|------|--------|
| `frontend/apps/desktop/src/machines/sync-system.ts` | **NEW** — syncSystemActor, exports createSyncSystem() |
| `frontend/apps/desktop/src/machines/resource-discovery.ts` | **NEW** — resourceActor |
| `frontend/apps/desktop/src/machines/activity-poller.ts` | **NEW** — activityPollerActor |
| `frontend/apps/desktop/src/machines/invalidation-buffer.ts` | **NEW** — invalidationBufferActor |
| `frontend/apps/desktop/src/machines/activity-state.ts` | **NEW** — activityStateActor |
| `frontend/apps/desktop/src/machines/window-sync.ts` | **NEW** — windowSyncActor (renderer) |
| `frontend/apps/desktop/src/app-sync.ts` | Replace internals with syncSystemActor; keep tRPC router as thin adapter |
| `frontend/apps/desktop/src/models/entities.ts` | Replace add/removeSubscribedEntity with windowSyncActor events |
| `frontend/apps/desktop/src/app-windows.ts` | Wire CLEANUP_WINDOW on window close |
| `frontend/apps/desktop/src/main.ts` | Initialize syncSystemActor, wire activityState to BrowserWindow/powerMonitor |
| `frontend/apps/desktop/src/desktop-universal-client.tsx` | Adapt subscribeEntity to send events to windowSyncActor |

## Implementation Phases (Incremental Migration)

### Phase 1: Foundation + Immediate Leak Fix
1. Create `invalidationBufferActor` — extract from app-sync.ts
2. Create `windowSyncActor` — replace entities.ts subscription management, **kill the 300ms setTimeout**
3. Wire `WINDOW_CLOSING` in app-windows.ts
4. Create `activityStateActor` — wire to BrowserWindow focus/blur + powerMonitor

### Phase 2: Polling + Discovery
5. Create `activityPollerActor` — replace setInterval(pollActivity, 3s) with 15s adaptive
6. Create `resourceActor` — replace per-resource discoveryLoop setTimeout chains
7. Create `syncSystemActor` — orchestrate all actors, replace mutable state object
8. Adapt tRPC `syncApi` router to read from actor system

### Phase 3: Notification Actors (optional follow-up)
9. Create `notificationPollerActor` — replace notification setInterval with adaptive
10. Create `notificationSyncActor` — replace read-state sync interval

**Backwards compatibility**: The tRPC API shape and `subscribeEntity`/`useResource`/`useResources` hook signatures stay the same throughout. Internal implementation changes, external interfaces don't.

## Patterns to Follow

Follow the existing `draftMachine` pattern from `frontend/apps/desktop/src/models/draft-machine.ts`:
- Use `setup({ types: { input, context, events } }).createMachine({ ... })` syntax
- Type context and events explicitly
- Use `assign()` for context updates
- Use `fromPromise()` for async service invocations
- Export `StateFrom<typeof machine>` for type inference

## Verification

1. **Typecheck**: `pnpm typecheck` in `frontend/`
2. **Leak regression test**: Open 5 windows → navigate heavily → close 3 → check memory profiler:
   - Subscription count should drop proportionally
   - Discovery stream count should match subscription count
   - Heap should not grow 130%+ over 10 snapshots
3. **Adaptive polling**: Blur all windows → network tab should show gRPC calls drop to ~1/10th → re-focus → speeds back up
4. **Actor inspection**: Use XState inspector (`@xstate/inspect`) during dev to visualize all actors, states, and transitions in real-time
5. **Timer cleanup**: Stop a resourceActor → confirm no lingering setTimeout in timer registry
6. **Window crash safety**: Kill a renderer process → confirm main process CLEANUP_WINDOW fires and subscriptions drop
7. **Existing tests**: Run `pnpm test` — hook interfaces unchanged so tests should pass
8. **Manual smoke test**: Open library, navigate docs, open/close windows, check performance feels responsive on throttled CPU (6x slowdown in DevTools)
