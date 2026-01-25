# Discovery & Sync Issues: Planning Document (Final)

## Key Insight

The UI already shows tombstone status from document query, not from discovery. Discovery is just background sync that keeps local DB up-to-date. These are separate concerns that got conflated.

```
Current (conflated):
  Discovery → throws error if deleted → Frontend stops discovery → UI shows tombstone

Correct (separated):
  Document query → returns tombstone → UI shows tombstone immediately
  Discovery → syncs data → updates local DB → (triggers query invalidation if changed)
```

---

## Problems to Fix

### 1. Frontend Stacking Bug

**Root cause:** No cancellation mechanism for in-progress discoveries.

Two manifestations:
- Resubscribe within 300ms: Old loop continues (wasn't cleaned up)
- Unsubscribe during discovery: Promise completes, schedules new timer

**Fix:** Add `cancelled` flag, always cleanup before overwrite.

### 2. 300ms Grace Period Bug

**Root cause:** Broken optimization that doesn't work as intended.

```typescript
// On unsubscribe: deletes count, delays cleanup 300ms
// On resubscribe within 300ms: count=0, creates NEW subscription anyway!
```

The optimization doesn't reuse subscriptions - it just skips cleanup, causing stacking.

**Fix:** Remove 300ms delay entirely. Immediate cleanup is simpler and correct.

### 3. Backend Deletion Check Blocks Undeletion

**Root cause:** `df4474a` added check that throws error before discovery starts.

```go
if isDeleted {
    return nil, status.Errorf(codes.FailedPrecondition, ...)  // Blocks undeletion discovery
}
```

**Fix:** Remove this check. Discovery should sync regardless of local deletion state.

### 4. Frontend `deletedEntities` is Redundant

**Root cause:** Frontend caches the backend error to avoid re-discovery.

But this is unnecessary:
- UI already knows tombstone status from document query
- With backend check removed, the error won't be thrown anyway

**Fix:** Remove `deletedEntities` set entirely.

---

## The Minimal Fix

### Backend Change (1 line removal)

**File:** `backend/api/entities/v1alpha/entities.go`

Remove lines 110-122 (the `is_deleted` check).

That's it. No proto changes. No new fields.

### Frontend Changes

**File:** `frontend/apps/desktop/src/app-sync.ts`

1. Add `cancelled` flag to subscription
2. Remove 300ms delayed cleanup
3. Remove `deletedEntities` set
4. Clean up existing subscription before creating new one

```typescript
function createSubscription(sub: ResourceSubscription): SubscriptionState {
  const {id, recursive} = sub
  let cancelled = false  // NEW
  let discoveryTimer: ReturnType<typeof setTimeout> | null = null

  function discoveryLoop() {
    if (cancelled) return  // NEW - check at start
    if (state.deletedEntities.has(id.id)) { ... }  // REMOVE this check

    runDiscovery(sub)
      .then(() => {
        if (cancelled) return  // NEW - check before scheduling
        discoveryStream.write(null)
        updateAggregatedDiscoveryState()
        discoveryTimer = setTimeout(discoveryLoop, DISCOVERY_POLL_INTERVAL_MS)
      })
      .catch((error) => {
        if (cancelled) return  // NEW - check before scheduling
        // REMOVE: HMResourceTombstoneError handling that adds to deletedEntities
        discoveryTimer = setTimeout(discoveryLoop, DISCOVERY_POLL_INTERVAL_MS)
      })
  }

  function unsubscribe() {
    cancelled = true  // NEW
    if (discoveryTimer) clearTimeout(discoveryTimer)
    // ... rest unchanged
  }

  return {unsubscribe, discoveryTimer, isCovered}
}

export function subscribe(sub: ResourceSubscription): () => void {
  const key = getSubscriptionKey(sub)
  const currentCount = state.subscriptionCounts.get(key) || 0

  if (currentCount === 0) {
    const existing = state.subscriptions.get(key)  // NEW
    if (existing) existing.unsubscribe()           // NEW - cleanup before overwrite
    state.subscriptions.set(key, createSubscription(sub))
    ensureActivityPolling()
  }

  state.subscriptionCounts.set(key, currentCount + 1)

  return function unsubscribe() {
    const count = state.subscriptionCounts.get(key) || 0
    if (count <= 1) {
      state.subscriptionCounts.delete(key)
      // REMOVE: 300ms setTimeout wrapper
      const subState = state.subscriptions.get(key)
      subState?.unsubscribe()
      state.subscriptions.delete(key)
      if (state.subscriptions.size === 0) {
        stopActivityPolling()
      }
    } else {
      state.subscriptionCounts.set(key, count - 1)
    }
  }
}
```

Also remove from SyncState:
```typescript
// REMOVE: deletedEntities: Set<string>
```

---

## Why This Works

### Deleted Document Flow (After Fix)

1. User navigates to deleted doc
2. `useResource` subscribes → triggers discovery in background
3. `useResource` queries document → returns tombstone from local DB → **UI shows tombstone immediately**
4. Discovery runs in background, syncs latest Refs
5. If doc was undeleted on network:
   - Discovery syncs new alive Ref
   - `last_alive_ref_time` updated, `is_deleted` becomes false
   - Query invalidation triggered
   - UI updates to show document

### Not-Found Document Flow

1. User navigates to non-existent doc
2. Discovery runs, times out (no providers)
3. Document query returns "not found"
4. UI shows "not found"
5. Discovery continues polling - if doc is created later, it will be found

### Stacking Prevention

1. User navigates to doc A → subscription created, loop starts
2. User navigates away → `cancelled = true`, timer cleared
3. If discovery in progress: promise completes, checks `cancelled`, exits without scheduling
4. User navigates back → new subscription, single loop

---

## What We're NOT Doing (And Why)

### NOT adding `is_deleted` to DiscoverEntityResponse
- Document query already provides this
- Keeps API simple
- No proto changes needed

### NOT slowing down polling for deleted docs
- Adds complexity
- `lastKnownVersions` already prevents unnecessary invalidations
- Background polling cost is acceptable

### NOT keeping the 300ms grace period
- It's broken and causes bugs
- The "optimization" doesn't actually work
- Simpler to just cleanup immediately

### NOT using `getDocumentInfo` in app-sync
- Discovery and document display are separate concerns
- Keep them decoupled
- Document query already handles tombstone display

---

## Summary

| Change | Lines | Risk |
|--------|-------|------|
| Remove backend `is_deleted` check | ~15 removed | Low - just removes a guard |
| Add `cancelled` flag | ~10 added | Low - standard pattern |
| Remove 300ms delay | ~10 removed | Low - simplification |
| Remove `deletedEntities` | ~15 removed | Low - redundant code |
| Cleanup before overwrite | ~3 added | Low - defensive check |

**Total: Net removal of ~25 lines. Simpler, correct, enables undeletion.**

---

## Testing

1. **Stacking:** Navigate rapidly between docs, verify single loop per doc
2. **Tombstone UX:** View deleted doc, verify immediate tombstone display
3. **Undeletion:** Delete doc, undelete on another node, verify propagation
4. **Not-found:** View non-existent doc, verify appropriate UI
5. **Memory:** Long session with navigation, verify no timer leaks
