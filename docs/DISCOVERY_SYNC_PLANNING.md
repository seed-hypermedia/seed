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

---

## Remaining Issues (Post-Implementation)

After implementing the initial fix, several issues remain:

### Issue 5: "Searching Peers" Stuck Forever for Deleted Docs

**Symptom:** Footer shows "Searching peers..." spinner indefinitely when viewing deleted docs.

**Root cause:** For deleted docs, discovery returns empty `version`. This causes:
1. `checkDiscoverySuccess(discoverResp)` returns `false` (no version)
2. `tryUntilSuccess` returns `null`, keeps retrying until timeout
3. `discoverDocument` throws "Timed out" error
4. `discoveryLoop` catches error, schedules retry in 3 seconds
5. Infinite loop of timeout → retry → timeout

**Flow:**
```
discoverEntity() → empty version → tryUntilSuccess times out →
catch in discoveryLoop → retry in 3s → repeat forever
```

### Issue 6: Refresh Required to See Deleted State

**Symptom:** After deleting a doc, user must refresh to see tombstone UI.

**Root cause:** Query invalidation only happens when `newVersion && newVersion !== lastKnownVersion`:
```typescript
const shouldInvalidate = newVersion && newVersion !== lastKnownVersion
```

For deleted docs, `newVersion` is empty/null, so `shouldInvalidate = false` and queries are never invalidated.

### Issue 7: Discovery Panel Doesn't Show Deletion Status

**Symptom:** Discovery hover panel shows spinner for deleted docs instead of "Deleted" indicator.

**Root cause:** `DiscoveryState` type has no field for tombstone status:
```typescript
type DiscoveryState = {
  isDiscovering: boolean
  startedAt: number
  entityId: string
  recursive?: boolean
  progress?: DiscoveryProgress
  // Missing: isTombstone?: boolean
}
```

### Issue 8: Footer Should Distinguish Deleted from Searching

**Symptom:** Footer shows "Searching peers..." for deleted docs, should show something like "Some resources deleted".

---

## Solution: Add `is_deleted` to DiscoverEntityResponse

The cleanest fix requires backend to tell frontend when a synced doc is deleted.

### Proto Change

**File:** `proto/entities/v1alpha/entities.proto`

```protobuf
message DiscoverEntityResponse {
  string version = 1;
  DiscoveryTaskState state = 2;
  reserved 3;
  google.protobuf.Timestamp last_result_time = 4;
  string last_error = 5;
  google.protobuf.Timestamp result_expire_time = 6;
  DiscoveryProgress progress = 7;
  bool is_deleted = 8;  // NEW: true if resource is deleted after sync
}
```

### Backend Change

**File:** `backend/api/entities/v1alpha/entities.go`

```go
// After TouchHotTask, check deletion status
info := api.disc.TouchHotTask(iri, v, in.Recursive)

// Check if resource is deleted AFTER sync (not before)
var isDeleted bool
if err := api.db.WithSave(ctx, func(conn *sqlite.Conn) error {
    return sqlitex.ExecTransient(conn, qCheckResourceDeleted(), func(stmt *sqlite.Stmt) error {
        isDeleted = stmt.ColumnInt(0) == 1
        return nil
    }, string(iri))
}); err != nil {
    // Ignore error, just don't set isDeleted
}

resp := &entities.DiscoverEntityResponse{
    Version:   info.Result.String(),
    State:     stateToProto(info.State),
    Progress:  progressToProto(info.Progress),
    IsDeleted: isDeleted,  // NEW
}
```

Note: Need to restore `qCheckResourceDeleted` query that was removed earlier.

### Frontend Changes

**File:** `frontend/packages/shared/src/hm-types.ts`

```typescript
export type DiscoveryState = {
  isDiscovering: boolean
  startedAt: number
  entityId: string
  recursive?: boolean
  progress?: DiscoveryProgress
  isTombstone?: boolean  // NEW
}
```

**File:** `frontend/apps/desktop/src/app-sync.ts`

```typescript
// In discoverDocument, return is_deleted status
return await tryUntilSuccess(
  async () => {
    const discoverResp = await grpcClient.entities.discoverEntity(discoverRequest)
    // ...
    // Consider deleted docs as "success" - we synced the tombstone
    if (discoverResp.isDeleted) {
      return {version: '', isDeleted: true}
    }
    if (checkDiscoverySuccess(discoverResp))
      return {version: discoverResp.version, isDeleted: false}
    return null
  },
  // ...
)

// In runDiscovery, handle deletion
const result = await discoverDocument(...)

if (result?.isDeleted) {
  // Deleted doc - mark as tombstone, use slower polling
  discoveryStream.write({
    isDiscovering: false,
    isTombstone: true,
    entityId: id.id,
    startedAt: Date.now(),
  })
  // Invalidate queries so UI shows tombstone
  appInvalidateQueries([queryKeys.ENTITY, id.id])
  appInvalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
  return result
}

// In discoveryLoop, use slower polling for deleted docs
runDiscovery(sub)
  .then((result) => {
    if (cancelled) return
    discoveryStream.write(null)
    updateAggregatedDiscoveryState()

    // Slower polling for deleted docs (check for undeletion)
    const interval = result?.isDeleted
      ? DELETED_POLL_INTERVAL_MS  // 60 seconds
      : DISCOVERY_POLL_INTERVAL_MS  // 3 seconds
    discoveryTimer = setTimeout(discoveryLoop, interval)
  })
```

**File:** `frontend/apps/desktop/src/components/footer.tsx`

```typescript
function DiscoveryItem({discovery}: {discovery: DiscoveryState}) {
  // ...
  return (
    <div className="flex items-center gap-2 text-xs">
      {discovery.isTombstone ? (
        <span className="text-muted-foreground">Deleted</span>
      ) : (
        <Spinner size="small" className="size-3 shrink-0" />
      )}
      {/* ... rest */}
    </div>
  )
}

function DiscoveryIndicator() {
  const discovery = useStream(getAggregatedDiscoveryStream())
  const activeDiscoveries = useStream(getActiveDiscoveriesStream())

  // Count tombstoned vs actively discovering
  const tombstonedCount = activeDiscoveries?.filter(d => d.isTombstone).length ?? 0
  const searchingCount = (discovery?.activeCount ?? 0) - tombstonedCount

  if (searchingCount === 0 && tombstonedCount === 0) return null

  // Show different message based on what's happening
  if (searchingCount === 0 && tombstonedCount > 0) {
    return (
      <div className="text-muted-foreground text-xs px-2">
        {tombstonedCount} deleted resource{tombstonedCount > 1 ? 's' : ''}
      </div>
    )
  }

  // ... existing searching/downloading UI
}
```

### Update AggregatedDiscoveryState

```typescript
export type AggregatedDiscoveryState = {
  activeCount: number
  tombstoneCount: number  // NEW
  blobsDiscovered: number
  blobsDownloaded: number
  blobsFailed: number
}
```

---

## Implementation Order

### Phase 1: Proto + Backend (enables frontend fix)
1. Add `is_deleted` field to proto
2. Regenerate proto files
3. Add `qCheckResourceDeleted` query back to entities.go
4. Set `IsDeleted` in response after discovery

### Phase 2: Frontend Discovery Logic
1. Update `discoverDocument` to return `isDeleted`
2. Update `runDiscovery` to handle deleted state
3. Update `discoveryLoop` to use slower polling for deleted docs
4. Invalidate queries when deletion state is detected

### Phase 3: Frontend UI
1. Add `isTombstone` to `DiscoveryState` type
2. Add `tombstoneCount` to `AggregatedDiscoveryState`
3. Update footer to show deletion status appropriately
4. Update discovery panel to show "Deleted" instead of spinner

---

## Constants

```typescript
const DISCOVERY_POLL_INTERVAL_MS = 3_000      // Normal polling
const DELETED_POLL_INTERVAL_MS = 60_000       // Slower polling for deleted docs
```

