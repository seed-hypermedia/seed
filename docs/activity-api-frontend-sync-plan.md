# Activity API for Frontend Data Synchronization

## Research Summary

### Current Problem

The current entity subscription system in `frontend/apps/desktop/src/models/entities.ts` has a critical issue:

1. **Discovery API doesn't report what changed**: The `discoverDocument()` call returns only the discovered version but doesn't indicate which child documents changed
2. **Aggressive invalidation causes loops**: The commented-out code was calling `invalidateDirectoryQueries()` which invalidates ALL directory queries for the entity and its parents, causing React Query to refetch everything
3. **Blind children query**: The `fetchQuery()` for children was calling `discoveryResultWithLatestVersion()` for every child, regardless of whether it actually changed

```typescript
// Current problematic flow:
updateEntitySubscription()
  → discoverDocument()  // Only returns version, not what changed
  → invalidateDirectoryQueries()  // Invalidates everything
  → fetchQuery(Children)  // Fetches all children
  → discoveryResultWithLatestVersion() for each  // Compares every child
```

### Activity API Research

The Activity API provides a rich event stream that can tell us exactly what changed.

#### Event Types Available

From `proto/activity/v1alpha/activity.proto`:

| Type | Description |
|------|-------------|
| `Ref` | Document changes (creates, updates) |
| `Comment` | New comments |
| `Capability` | Access control grants |
| `Contact` | Contact creation |
| `Profile` | Profile updates |
| `doc/Embed` | Embeds in documents |
| `doc/Link` | Links in documents |
| `comment/Embed` | Embeds in comments |

#### Event Data Structure

```protobuf
message Event {
  oneof data {
    NewBlobEvent new_blob = 1;
    Mention new_mention = 5;
  }
  string account = 2;
  Timestamp event_time = 3;   // Event's own timestamp
  Timestamp observe_time = 4; // When we received it locally
}

message NewBlobEvent {
  string cid = 1;        // Blob CID
  string blob_type = 2;  // Ref, Comment, etc.
  string author = 3;     // Account that created it
  string resource = 4;   // Resource ID (hm://uid/path?v=version)
  string extra_attrs = 5;
  int64 blob_id = 6;
  bool is_pinned = 7;
}
```

#### Pagination Mechanism

The backend uses **structural timestamp (ms)** for cursor-based pagination:

```go
// Backend pagination flow
cursorTS := structuralTimestamp (milliseconds)
pageToken := apiutil.EncodePageToken(minTS-1, nil)
// Next request uses: WHERE ts <= :cursor
```

The `next_page_token` encodes `minTS - 1` from the returned page, allowing efficient forward pagination through the event stream.

### Email Notifier Pattern (Reference Implementation)

The email notifier in `frontend/apps/notify/app/email-notifier.ts` demonstrates the correct pattern:

#### Event ID Generation
```typescript
function getEventId(event: PlainMessage<Event>) {
  if (event.data.case === 'newBlob') {
    return `blob-${event.data.value.cid}`
  }
  if (event.data.case === 'newMention') {
    return `mention-${sourceBlob.cid}-${mentionType}-${target}`
  }
}
```

#### Cursor-Based Processing
```typescript
async function loadEventsAfterEventId(lastProcessedEventId: string) {
  const eventsAfterEventId = []
  let currentPageToken: string | undefined

  while (true) {
    const {events, nextPageToken} = await grpcClient.activityFeed.listEvents({
      pageToken: currentPageToken,
      pageSize: 2,
    })

    for (const event of events) {
      const eventId = getEventId(event)
      if (eventId === lastProcessedEventId) {
        return eventsAfterEventId  // Stop when we hit the cursor
      }
      eventsAfterEventId.push(event)
    }

    if (!nextPageToken) break
    currentPageToken = nextPageToken
  }
  return eventsAfterEventId
}
```

#### Polling Pattern
```typescript
// 15-second polling for immediate notifications
setInterval(handleEmailNotifications, 15_000)
```

---

## Implementation Plan

### Phase 1: Activity Feed Poller Service

Create a centralized activity poller that monitors the activity feed and dispatches targeted invalidations. The poller runs independently of discovery - it watches for ALL changes flowing into the node regardless of source.

#### New File: `frontend/packages/shared/src/models/activity-poller.ts`

```typescript
import {GRPCClient} from '../grpc-client'
import {invalidateQueries} from './query-client'
import {queryKeys} from './query-keys'
import {unpackHmId, hmId} from '../utils'
import {getParentPaths} from '../utils/breadcrumbs'

// Polling interval - how often to check for new activity events
const ACTIVITY_POLL_INTERVAL_MS = 3_000

// Debounce window for batching invalidations to avoid UI thrash
const INVALIDATION_DEBOUNCE_MS = 100

// Page size for fetching events
const ACTIVITY_PAGE_SIZE = 30

type PollerState = {
  lastEventId: string | null
  isPolling: boolean
  subscribedResources: Set<string>
  pendingInvalidations: Set<string>  // Resources pending invalidation
  debounceTimer: NodeJS.Timeout | null
}

export function createActivityPoller(grpcClient: GRPCClient) {
  const state: PollerState = {
    lastEventId: null,
    isPolling: false,
    subscribedResources: new Set(),
    pendingInvalidations: new Set(),
    debounceTimer: null,
  }

  let pollTimer: NodeJS.Timeout | null = null

  function getEventId(event: any): string {
    if (event.data?.case === 'newBlob') {
      return `blob-${event.data.value.cid}`
    }
    if (event.data?.case === 'newMention') {
      const {sourceBlob, mentionType, target} = event.data.value
      return `mention-${sourceBlob?.cid}-${mentionType}-${target}`
    }
    return `unknown-${Date.now()}`
  }

  function extractResource(event: any): string | null {
    if (event.data?.case === 'newBlob') {
      const resource = event.data.value.resource
      return resource.split('?')[0]  // Strip version query param
    }
    if (event.data?.case === 'newMention') {
      return event.data.value.target?.split('?')[0]
    }
    return null
  }

  function isResourceSubscribed(resource: string): boolean {
    if (state.subscribedResources.has(resource)) return true

    for (const sub of state.subscribedResources) {
      if (sub.endsWith('/*')) {
        const prefix = sub.slice(0, -2)
        if (resource.startsWith(prefix)) return true
      }
    }
    return false
  }

  function invalidateResource(resource: string) {
    const id = unpackHmId(resource)
    if (!id) return

    invalidateQueries([queryKeys.ENTITY, id.id])
    invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
    invalidateQueries([queryKeys.ACCOUNT, id.uid])
    invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, id.id])

    getParentPaths(id.path).forEach((path) => {
      const parentId = hmId(id.uid, {path})
      invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
    })

    invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, id.id])
  }

  function flushInvalidations() {
    state.debounceTimer = null
    for (const resource of state.pendingInvalidations) {
      invalidateResource(resource)
    }
    state.pendingInvalidations.clear()
  }

  function scheduleInvalidation(resource: string) {
    state.pendingInvalidations.add(resource)

    if (!state.debounceTimer) {
      state.debounceTimer = setTimeout(flushInvalidations, INVALIDATION_DEBOUNCE_MS)
    }
  }

  function processEvents(events: any[]) {
    for (const event of events) {
      const resource = extractResource(event)
      if (resource && isResourceSubscribed(resource)) {
        scheduleInvalidation(resource)
      }
    }
  }

  async function fetchNewEvents() {
    if (!state.lastEventId) {
      const {events} = await grpcClient.activityFeed.listEvents({
        pageSize: 1,
        filterEventType: ['Ref', 'Comment', 'Capability'],
      })
      if (events[0]) {
        state.lastEventId = getEventId(events[0])
      }
      return []
    }

    const eventsToProcess = []
    let currentPageToken: string | undefined

    while (true) {
      const {events, nextPageToken} = await grpcClient.activityFeed.listEvents({
        pageToken: currentPageToken,
        pageSize: ACTIVITY_PAGE_SIZE,
        filterEventType: ['Ref', 'Comment', 'Capability'],
      })

      for (const event of events) {
        const eventId = getEventId(event)
        if (eventId === state.lastEventId) {
          return eventsToProcess
        }
        eventsToProcess.push(event)
      }

      if (!nextPageToken) break
      currentPageToken = nextPageToken
    }

    return eventsToProcess
  }

  async function poll() {
    if (state.isPolling) return
    state.isPolling = true

    try {
      const newEvents = await fetchNewEvents()
      if (newEvents.length > 0) {
        processEvents(newEvents)
        state.lastEventId = getEventId(newEvents[0])
      }
    } catch (error) {
      console.error('Activity poll error:', error)
    } finally {
      state.isPolling = false
    }
  }

  function ensurePolling() {
    if (pollTimer) return
    pollTimer = setInterval(poll, ACTIVITY_POLL_INTERVAL_MS)
    poll()  // Immediate first poll
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
      state.debounceTimer = null
    }
  }

  function subscribeResource(iri: string, recursive: boolean = false) {
    const key = recursive ? `${iri}/*` : iri
    state.subscribedResources.add(key)
    ensurePolling()

    return function unsubscribe() {
      state.subscribedResources.delete(key)
      if (state.subscribedResources.size === 0) {
        stopPolling()
      }
    }
  }

  function getSubscriptionCount() {
    return state.subscribedResources.size
  }

  return {
    subscribeResource,
    getSubscriptionCount,
    // Exposed for testing
    _poll: poll,
    _getState: () => state,
  }
}

// Singleton instance
let pollerInstance: ReturnType<typeof createActivityPoller> | null = null

export function getActivityPoller(grpcClient: GRPCClient) {
  if (!pollerInstance) {
    pollerInstance = createActivityPoller(grpcClient)
  }
  return pollerInstance
}
```

### Phase 2: Integrate with Entity Subscriptions

Modify `entities.ts` to use the activity poller instead of blind invalidation:

```typescript
// In entities.ts

import {getActivityPoller} from '@shm/shared/models/activity-poller'

async function updateEntitySubscription(
  sub: EntitySubscription,
  onProgress?: (progress: DiscoveryProgress) => void,
) {
  const {id, recursive} = sub
  if (!id) return

  // Do discovery (this syncs data from network)
  await discoverDocument(id.uid, id.path, undefined, recursive, onProgress)

  // Subscribe to activity feed for targeted updates
  // The poller will handle invalidation when changes arrive
  const poller = getActivityPoller(grpcClient)
  const iri = `hm://${id.uid}${id.path ? '/' + id.path.join('/') : ''}`
  poller.subscribeResource(iri, recursive)
}

function createEntitySubscription(sub: EntitySubscription) {
  // ... existing setup code ...

  const poller = getActivityPoller(grpcClient)
  const iri = `hm://${id.uid}${id.path ? '/' + id.path.join('/') : ''}`

  // Subscribe to activity poller
  const unsubscribePoller = poller.subscribeResource(iri, recursive)

  // ... rest of subscription logic ...

  return () => {
    // Cleanup
    unsubscribePoller()
    loopTimer && clearTimeout(loopTimer)
    if (recursive) {
      recursiveSubscriptions.delete(key)
    }
  }
}
```

### Phase 3: React Query Integration

Create a hook for components to use activity-driven updates:

```typescript
// frontend/packages/shared/src/hooks/use-activity-updates.ts

import {useEffect} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {getActivityPoller} from '../models/activity-poller'
import {GRPCClient} from '../grpc-client'

export function useActivityUpdates(
  grpcClient: GRPCClient,
  resourceId: string | undefined,
  options: {recursive?: boolean} = {}
) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!resourceId) return

    const poller = getActivityPoller(grpcClient)
    const unsubscribe = poller.subscribeResource(resourceId, options.recursive)

    return unsubscribe
  }, [resourceId, options.recursive])
}
```

---

## Potential Issues & Mitigations

### 1. High-Frequency Updates

**Problem**: Many changes arriving quickly could cause UI thrashing.

**Mitigation**: Batch invalidations within a debounce window (100ms). The implementation uses `pendingInvalidations` Set and `debounceTimer` to collect all affected resources, then flush them together after the debounce period.

### 2. Backend Pagination Edge Cases

**Problem**: Structural timestamp ties could cause skipped events.

**Mitigation**: Backend already handles this by using `minTS - 1` for next cursor. Client handles empty pages gracefully by continuing to next page token.

---

## Query Keys Affected

The following query keys will be targeted for invalidation:

| Query Key | When Invalidated |
|-----------|------------------|
| `ENTITY` | On `Ref` events for the resource |
| `RESOLVED_ENTITY` | On `Ref` events for the resource |
| `ACCOUNT` | On `Profile` events |
| `DOC_LIST_DIRECTORY` | On `Ref` events in directory |
| `DOCUMENT_INTERACTION_SUMMARY` | On any event for resource |
| `COMMENTS` | On `Comment` events |
| `CAPABILITIES` | On `Capability` events |
| `CITATIONS` | On mention events |

---

## Migration Path

1. **Phase 1**: Create `activity-poller.ts` without integrating
2. **Phase 2**: Add poller subscription alongside existing code
3. **Phase 3**: Remove aggressive `invalidateDirectoryQueries()` calls
4. **Phase 4**: Remove polling loop from entity subscriptions (let poller handle updates)

---

## Testing Strategy

**Unit tests** for activity poller functions:
- `getEventId()` correctly generates IDs for blob and mention events
- `extractResource()` strips version params correctly
- `isResourceSubscribed()` matches exact and recursive subscriptions
- `processEvents()` schedules invalidations for subscribed resources only
- `fetchNewEvents()` stops at cursor and paginates correctly
- Debounce timer batches multiple invalidations

---

## Alternative Approaches Considered

### WebSocket/SSE Streaming

The backend currently uses unary RPC only. Adding streaming would require:
- Backend changes to support server-sent events
- Connection management complexity
- Not worth it for 3-second polling use case

### Full Query Invalidation on Discover

Current approach but optimized:
- Still wasteful, causes unnecessary refetches
- Doesn't scale with number of subscriptions

### Hybrid: Activity + Discovery

**Recommended approach** (this plan):
- Discovery for initial sync and deep sync
- Activity polling for incremental updates
- Best of both worlds
