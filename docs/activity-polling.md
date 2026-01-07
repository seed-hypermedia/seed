# Activity Polling System

## Overview

The activity polling system watches the backend activity feed for changes and invalidates React Query caches when relevant data updates. This provides real-time reactivity without requiring WebSocket connections.

## How It Works

### Cursor-Based Pagination

The activity feed uses cursor-based pagination. The sync service maintains `lastEventId` to track the most recent event seen.

```
Timeline: ──────────────────────────────────────────────────────▶
          │                    │                    │
          Event A              Event B              Event C
          (old)                                     (newest)
                               ▲
                               │
                          lastEventId
```

On each poll:
1. Fetch events newer than `lastEventId`
2. Process events for subscribed resources
3. Update `lastEventId` to newest event

### Event Types

The poller filters for these event types:
- `Ref`: Document version changes
- `Comment`: New or updated comments
- `Capability`: Permission changes

### Event Processing

```typescript
function processEvents(events: Event[]) {
  for (const event of events) {
    const resource = extractResource(event)
    if (resource && isResourceSubscribed(resource)) {
      scheduleInvalidation(resource)
    }
  }
}
```

Events are only processed if the resource is currently subscribed.

## Subscription Matching

### Exact Subscriptions

A subscription key like `hm://abc123/docs/readme` matches events for that exact resource.

### Recursive Subscriptions

A subscription key like `hm://abc123/docs/*` matches:
- `hm://abc123/docs/readme`
- `hm://abc123/docs/guide`
- `hm://abc123/docs/api/reference`

The matching logic:

```typescript
function isResourceSubscribed(resource: string): boolean {
  const id = unpackHmId(resource)
  if (!id) return false

  const exactKey = id.id
  const recursiveKey = `${id.id}/*`

  // Check exact match
  if (state.subscriptionCounts.has(exactKey)) return true

  // Check recursive match for this exact resource
  if (state.subscriptionCounts.has(recursiveKey)) return true

  // Check if covered by parent recursive subscription
  for (const sub of state.recursiveSubscriptions) {
    const prefix = sub.slice(0, -2) // Remove /*
    if (resource === prefix || resource.startsWith(prefix + '/')) {
      return true
    }
  }

  return false
}
```

## Debouncing

Invalidations are debounced to prevent UI thrash when many events arrive at once.

```
Events: ──E1──E2──E3──────────────────E4──────────▶
              │                        │
              └── 100ms ──┐            └── 100ms ──┐
                          ▼                        ▼
Invalidations:       [E1,E2,E3]                  [E4]
```

The debounce window is 100ms (`INVALIDATION_DEBOUNCE_MS`).

## Polling Lifecycle

### Start Conditions

Activity polling starts when:
1. First subscription is created
2. `ensureActivityPolling()` is called

### Stop Conditions

Activity polling stops when:
1. Last subscription is removed
2. All `subscriptions` map is empty

### Cleanup

```typescript
function stopActivityPolling() {
  if (state.activityPollTimer) {
    clearInterval(state.activityPollTimer)
    state.activityPollTimer = null
  }
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
    state.debounceTimer = null
  }
}
```

## Query Invalidation

When a resource is invalidated, these query keys are affected:

| Query Key | Purpose |
|-----------|---------|
| `ENTITY` | The document/entity data |
| `RESOLVED_ENTITY` | Resolved entity with metadata |
| `ACCOUNT` | Account profile data |
| `DOC_LIST_DIRECTORY` | Directory listing (this entity) |
| `DOC_LIST_DIRECTORY` (parents) | Parent directory listings |
| `DOCUMENT_INTERACTION_SUMMARY` | Interaction counts |

## Error Handling

Poll errors are logged but don't stop the polling loop:

```typescript
async function pollActivity() {
  if (state.isPolling) return
  state.isPolling = true

  try {
    const newEvents = await fetchNewEvents()
    // ... process events
  } catch (error) {
    console.error('Sync poll error:', error)
  } finally {
    state.isPolling = false
  }
}
```

The `isPolling` flag prevents concurrent polls.

## Performance Considerations

1. **Batched invalidations**: Multiple events in 100ms window are batched
2. **Filtered processing**: Only subscribed resources trigger invalidations
3. **Single polling loop**: All windows share one poller in main process
4. **Cursor efficiency**: Only fetches events newer than last seen
