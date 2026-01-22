# Sync Service Architecture

## Overview

The Sync Service is the central coordination point for data synchronization in
the Seed desktop app. It runs in the Electron main process (Node.js) and handles
two primary responsibilities:

1. **Discovery**: Syncing data from the P2P network for subscribed resources
2. **Activity Polling**: Watching the activity feed for changes and invalidating
   React Query caches

## Why Main Process?

The sync service runs in the Electron main process rather than renderer
processes because:

1. **Single polling loop**: Multiple windows would each poll independently,
   causing duplicate API calls and redundant invalidations
2. **Shared state**: Subscription counts and cursors are shared across all
   windows
3. **Broadcast invalidations**: The existing `appInvalidateQueries`
   infrastructure broadcasts to all windows

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Electron Main Process                        │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                      app-sync.ts                             │ │
│  │  ┌─────────────────┐  ┌─────────────────┐                   │ │
│  │  │  Activity       │  │  Discovery      │                   │ │
│  │  │  Poller         │  │  Manager        │                   │ │
│  │  │  (3s interval)  │  │  (per resource) │                   │ │
│  │  └────────┬────────┘  └────────┬────────┘                   │ │
│  │           │                    │                             │ │
│  │           ▼                    ▼                             │ │
│  │  ┌─────────────────────────────────────────┐                │ │
│  │  │         appInvalidateQueries()          │                │ │
│  │  │    (broadcasts to all windows)          │                │ │
│  │  └─────────────────────────────────────────┘                │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              │ tRPC subscriptions                 │
│                              ▼                                    │
└─────────────────────────────────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Window 1       │  │  Window 2       │  │  Window N       │
│  (Renderer)     │  │  (Renderer)     │  │  (Renderer)     │
│                 │  │                 │  │                 │
│  entities.ts    │  │  entities.ts    │  │  entities.ts    │
│  - subscribes   │  │  - subscribes   │  │  - subscribes   │
│    via tRPC     │  │    via tRPC     │  │    via tRPC     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## Key Components

### 1. Sync State (`SyncState`)

Central state object holding:

- `lastEventId`: Cursor for activity feed pagination
- `isPolling`: Prevents concurrent poll operations
- `pendingInvalidations`: Set of resources to invalidate (debounced)
- `subscriptions`: Map of active resource subscriptions
- `subscriptionCounts`: Reference counting for subscriptions
- `recursiveSubscriptions`: Set of recursive subscription keys
- `discoveryStreams`: Map of discovery state streams per entity
- `lastKnownVersions`: Map of entity ID to last discovered version (for
  deduplication)

### 2. Activity Polling

Polls the backend activity feed every 3 seconds for new events. When events are
detected for subscribed resources, schedules query invalidations.

### 3. Discovery Manager

Runs discovery loops for each subscribed resource. Discovery syncs data from the
P2P network and invalidates queries when complete.

### 4. tRPC API (`syncApi`)

Exposes the sync service to renderer processes:

- `subscribe`: Register a resource subscription
- `discoveryState`: Subscribe to discovery state changes
- `getAggregatedState`: Get aggregated discovery stats
- `aggregatedState`: Subscribe to aggregated state changes

## Data Flow

### Subscription Flow

1. Renderer calls `addSubscribedEntity()` in `entities.ts`
2. `entities.ts` calls `client.sync.subscribe.subscribe()` via tRPC
3. Main process `app-sync.ts` creates subscription and starts discovery loop
4. Activity polling starts (if not already running)

### Invalidation Flow

1. Activity poller fetches new events from backend
2. Events are filtered to only subscribed resources
3. Resources are added to `pendingInvalidations` set
4. After 100ms debounce, `appInvalidateQueries()` is called for each
5. All renderer windows receive invalidation and refetch data

### Discovery Flow

1. Discovery loop calls `grpcClient.entities.discoverEntity()`
2. Progress updates are written to discovery state stream
3. Renderer subscribes to discovery state via tRPC
4. On completion, version is compared against `lastKnownVersions`
5. **Only if version changed**: relevant queries are invalidated
6. Loop repeats after 3 second interval

### Version Tracking Optimization

The sync service tracks the last known version for each subscribed entity in
`state.lastKnownVersions`. This prevents unnecessary query invalidations when
discovery completes but no new data has arrived:

```typescript
// Only invalidate if version actually changed
const newVersion = result?.version
const lastKnownVersion = state.lastKnownVersions.get(id.id)

if (newVersion && newVersion !== lastKnownVersion) {
  state.lastKnownVersions.set(id.id, newVersion)
  appInvalidateQueries([queryKeys.ENTITY, id.id])
  // ... other invalidations
}
```

This optimization significantly reduces unnecessary refetches when the app is
idle.

## File Locations

| File                                            | Purpose                               |
| ----------------------------------------------- | ------------------------------------- |
| `frontend/apps/desktop/src/app-sync.ts`         | Main process sync service             |
| `frontend/apps/desktop/src/models/entities.ts`  | Renderer-side subscription management |
| `frontend/apps/desktop/src/app-invalidation.ts` | Cross-window invalidation utilities   |
| `frontend/apps/desktop/src/app-api.ts`          | tRPC router including syncApi         |

## Configuration

| Constant                     | Value            | Purpose                                    |
| ---------------------------- | ---------------- | ------------------------------------------ |
| `DISCOVERY_POLL_INTERVAL_MS` | 3000             | Discovery loop interval                    |
| `ACTIVITY_POLL_INTERVAL_MS`  | 3000             | Activity feed poll interval                |
| `INVALIDATION_DEBOUNCE_MS`   | 100              | Debounce window for batching invalidations |
| `ACTIVITY_PAGE_SIZE`         | 30               | Events per activity feed request           |
| `DISCOVERY_DEBOUNCE_MS`      | (from constants) | Initial discovery delay                    |
