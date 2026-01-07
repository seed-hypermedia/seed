# Discovery System

## Overview

The discovery system syncs data from the P2P network for subscribed resources. It runs discovery loops in the main process and provides real-time progress updates to renderer windows.

## Discovery Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Subscription   │────▶│  Discovery      │────▶│  Backend        │
│  Created        │     │  Loop Started   │     │  discoverEntity │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                              ┌───────────────────────────┘
                              ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Queries        │◀────│  Invalidation   │◀────│  Progress       │
│  Refetch        │     │  Triggered      │     │  Updates        │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Discovery State

Each entity has an associated discovery state:

```typescript
type DiscoveryState = {
  isDiscovering: boolean
  startedAt: number
  entityId: string
  progress?: DiscoveryProgress
}

type DiscoveryProgress = {
  blobsDiscovered: number
  blobsDownloaded: number
  blobsFailed: number
}
```

## State Streams

Discovery uses `StateStream` for reactive updates:

### Per-Entity Streams

```typescript
const discoveryStreams: Map<string, {
  write: (state: DiscoveryState | null) => void
  stream: StateStream<DiscoveryState | null>
}>
```

Each entity ID has its own stream. Renderers subscribe via tRPC.

### Aggregated Stream

```typescript
const aggregatedDiscoveryStream: StateStream<AggregatedDiscoveryState>

type AggregatedDiscoveryState = {
  activeCount: number      // Number of active discoveries
  blobsDiscovered: number  // Total blobs discovered
  blobsDownloaded: number  // Total blobs downloaded
  blobsFailed: number      // Total failures
}
```

Used for global progress indicators.

## Discovery Loop

Each subscription runs its own discovery loop:

```typescript
function discoveryLoop() {
  if (isCovered) {
    // Skip if parent recursive subscription covers this
    discoveryTimer = setTimeout(discoveryLoop, DISCOVERY_POLL_INTERVAL_MS)
    return
  }

  runDiscovery(sub)
    .then(() => {
      discoveryStream.write(null) // Clear discovering state
      updateAggregatedDiscoveryState()
    })
    .catch(() => {
      // Keep discovering state on failure
    })
    .finally(() => {
      discoveryTimer = setTimeout(discoveryLoop, DISCOVERY_POLL_INTERVAL_MS)
    })
}
```

### Initial Debounce

New subscriptions wait before starting discovery:

```typescript
discoveryTimer = setTimeout(
  discoveryLoop,
  DISCOVERY_DEBOUNCE_MS + Math.random() * 100
)
```

The random jitter prevents thundering herd when many subscriptions are created at once.

## Recursive Subscriptions

### Coverage Detection

Non-recursive subscriptions can be "covered" by a parent recursive subscription:

```typescript
function isEntityCoveredByRecursive(id: UnpackedHypermediaId): boolean {
  if (!id.path?.length) return false

  const basePath = `hm://${id.uid}`
  for (let i = 0; i <= id.path.length; i++) {
    const parentPath = i === 0
      ? `${basePath}/*`
      : `${basePath}/${id.path.slice(0, i).join('/')}/*`
    if (state.recursiveSubscriptions.has(parentPath)) {
      return true
    }
  }
  return false
}
```

Example:
- Recursive subscription: `hm://abc123/*`
- Child subscription: `hm://abc123/docs/readme`
- The child is "covered" and skips its own discovery

### Directory Invalidation

Recursive discovery invalidates directory queries at all levels:

```typescript
if (recursive) {
  appInvalidateQueries([queryKeys.DOC_LIST_DIRECTORY, id.id])
  getParentPaths(id.path).forEach((parentPath) => {
    const parentId = hmId(id.uid, {path: parentPath})
    appInvalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
  })
  const rootId = hmId(id.uid)
  appInvalidateQueries([queryKeys.DOC_LIST_DIRECTORY, rootId.id])
}
```

## Backend Integration

Discovery calls the backend gRPC service:

```typescript
const discoverResp = await grpcClient.entities.discoverEntity({
  account: uid,
  path: hmIdPathToEntityQueryPath(path),
  version: version || undefined,
  recursive,
})
```

### Retry Logic

Discovery uses `tryUntilSuccess` for resilience:

```typescript
return await tryUntilSuccess(
  async () => {
    const discoverResp = await grpcClient.entities.discoverEntity(...)
    if (checkDiscoverySuccess(discoverResp)) {
      return {version: discoverResp.version}
    }
    return null
  },
  {
    maxRetryMs: DISCOVERY_POLL_INTERVAL_MS,
    retryDelayMs: 2_000,
    immediateCatch: (e) => {
      const error = getErrorMessage(e)
      return error instanceof HMRedirectError
    },
  },
)
```

- Retries for up to 3 seconds
- 2 second delay between retries
- Immediately catches redirect errors (no retry)

## Renderer Integration

### Subscribing to Discovery State

```typescript
// In entities.ts (renderer)
const discoveryStateSub = client.sync.discoveryState.subscribe(sub.id.id, {
  onData: (state) => {
    discoveryStreamEntry.write(state)
  },
})
```

### Using Discovery State

```typescript
// In components
const discoveryStream = getDiscoveryStream(entityId)
const state = discoveryStream.get()

if (state?.isDiscovering) {
  // Show loading indicator
  const progress = state.progress
  // progress.blobsDiscovered, progress.blobsDownloaded, etc.
}
```

## Subscription Lifecycle

### Creation

1. Renderer calls `addSubscribedEntity()`
2. tRPC subscription created to main process
3. Main process creates subscription state
4. Discovery loop scheduled with debounce
5. Discovery state subscription created

### Reference Counting

Multiple components can subscribe to the same entity:

```typescript
const currentCount = state.subscriptionCounts.get(key) || 0
if (currentCount === 0) {
  // Create new subscription
  state.subscriptions.set(key, createSubscription(sub))
  ensureActivityPolling() // Start polling if not already
}
state.subscriptionCounts.set(key, currentCount + 1)
```

### Cleanup

When last reference is removed:

```typescript
if (count <= 1) {
  state.subscriptionCounts.delete(key)
  setTimeout(() => {
    if (!state.subscriptionCounts.has(key)) {
      const subState = state.subscriptions.get(key)
      subState?.unsubscribe()
      state.subscriptions.delete(key)

      if (state.subscriptions.size === 0) {
        stopActivityPolling()
      }
    }
  }, 300)
}
```

The 300ms delay allows for quick re-subscriptions (e.g., during navigation).
