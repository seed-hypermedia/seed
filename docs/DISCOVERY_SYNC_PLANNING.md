# Discovery & Sync Issues: Research & Planning Document

## Executive Summary

Three distinct issues identified in the app-sync discovery system:

1. **Frontend Stacking Issue #1**: Resubscribe within 300ms grace period creates duplicate discovery loops
2. **Frontend Stacking Issue #2**: In-progress discoveries continue after unsubscribe, then schedule new loops
3. **Backend Deletion Check**: Commit `df4474a` blocks discovery for deleted docs, preventing undeletion propagation

---

## Issue #1: Resubscribe Within 300ms Grace Period

### Location
`frontend/apps/desktop/src/app-sync.ts:540-571`

### Root Cause
When unsubscribing, `subscriptionCounts` is deleted immediately but cleanup is delayed 300ms. If user resubscribes within that window:

```typescript
// Unsubscribe path:
state.subscriptionCounts.delete(key)  // Immediate
setTimeout(() => {
  if (!state.subscriptionCounts.has(key)) {  // Check after 300ms
    subState?.unsubscribe()
  }
}, 300)

// Resubscribe path (within 300ms):
const currentCount = state.subscriptionCounts.get(key) || 0  // Returns 0!
if (currentCount === 0) {
  state.subscriptions.set(key, createSubscription(sub))  // OVERWRITES without cleanup
}
```

### Problem
- Old subscription's timer never cleared (reference lost on overwrite)
- Old timer fires, calls `discoveryLoop()`, schedules more timers
- Each quick unsub/resub cycle adds another parallel discovery loop

### Fix
```typescript
if (currentCount === 0) {
  const existing = state.subscriptions.get(key)
  if (existing) existing.unsubscribe()  // Clean up before overwrite
  state.subscriptions.set(key, createSubscription(sub))
}
```

---

## Issue #2: In-Progress Discoveries Continue After Unsubscribe

### Location
`frontend/apps/desktop/src/app-sync.ts:498-519, 527-535`

### Root Cause
`unsubscribe()` clears pending timer but cannot cancel in-flight `runDiscovery()` promise:

```typescript
function discoveryLoop() {
  runDiscovery(sub)  // Promise starts
    .then(() => {
      discoveryTimer = setTimeout(discoveryLoop, ...)  // Runs even after unsubscribe
    })
}

function unsubscribe() {
  if (discoveryTimer) clearTimeout(discoveryTimer)  // Only clears pending timer
  // In-progress promise continues!
}
```

### Problem
- Backend discovery can take up to 10 minutes (`DefaultDiscoveryTimeout`)
- User navigates away during discovery, unsubscribe called
- Promise continues, eventually completes, schedules new timer
- User navigates back, new subscription created
- Now 2+ discovery loops for same resource

### Fix
```typescript
let cancelled = false

function discoveryLoop() {
  if (cancelled) return

  runDiscovery(sub)
    .then(() => {
      if (cancelled) return  // Check before scheduling
      discoveryTimer = setTimeout(discoveryLoop, DISCOVERY_POLL_INTERVAL_MS)
    })
    .catch((error) => {
      if (cancelled) return
      // ... error handling
      discoveryTimer = setTimeout(discoveryLoop, DISCOVERY_POLL_INTERVAL_MS)
    })
}

function unsubscribe() {
  cancelled = true
  if (discoveryTimer) clearTimeout(discoveryTimer)
}
```

---

## Issue #3: Backend Deletion Check Prevents Undeletion Discovery

### Location
`backend/api/entities/v1alpha/entities.go:110-122` (commit `df4474a`)

### The Check
```go
var isDeleted bool
if err := api.db.WithSave(ctx, func(conn *sqlite.Conn) error {
    return sqlitex.ExecTransient(conn, qCheckResourceDeleted(), func(stmt *sqlite.Stmt) error {
        isDeleted = stmt.ColumnInt(0) == 1
        return nil
    }, string(iri))
}); err != nil {
    return nil, err
}
if isDeleted {
    return nil, status.Errorf(codes.FailedPrecondition, "document '%s' is marked as deleted", iri)
}
```

### How Deletion/Undeletion Works
```
Deletion state = computed from: last_tombstone_ref_time > last_alive_ref_time

DELETE:  Create Tombstone Ref (empty heads) → updates last_tombstone_ref_time
UNDELETE: Create Alive Ref (with heads) → updates last_alive_ref_time

Winner determined by timestamp comparison.
```

### The Problem

| Local State | Network State | Result |
|-------------|---------------|--------|
| Deleted | Deleted | OK - no discovery needed |
| Deleted | **Alive** | **BLOCKED** - throws error, never learns about undeletion |
| Alive | Alive | OK - normal sync |
| Alive | Deleted | OK - receives tombstone, updates timestamp |

When a document is deleted locally but undeleted on the network:
1. Local node tries to discover
2. Check sees `is_deleted = true`, throws `FailedPrecondition`
3. Discovery never starts, no peers contacted
4. Local node never receives the new alive Ref
5. **User stuck in deleted state forever**

### Why The Check Was Added
To avoid showing "Syncing..." spinner indefinitely for truly deleted documents.

### The Tradeoff

| Approach | Deleted Doc UX | Undeletion Support |
|----------|----------------|-------------------|
| **With check** (current) | Good - immediate tombstone error | Broken - never discovers undeletion |
| **Without check** | Bad - infinite spinner | Works - discovers new alive Refs |

---

## Proposed Solution for Issue #3

### Option A: Remove the check entirely (simple but poor UX)
- Reverts `df4474a`
- Undeletion works
- But deleted docs show infinite "Syncing..." spinner

### Option B: Time-limited discovery for deleted docs (recommended)
Allow discovery for deleted docs but with reduced timeout/retries:

```go
// Check if resource is deleted
isDeleted := checkResourceDeleted(ctx, api.db, iri)

// Adjust discovery behavior based on deletion state
var discoveryTimeout time.Duration
if isDeleted {
    discoveryTimeout = 10 * time.Second  // Quick check for undeletion
} else {
    discoveryTimeout = DefaultDiscoveryTimeout  // Full 10 minutes
}

ctx, cancel := context.WithTimeout(ctx, discoveryTimeout)
defer cancel()
// ... proceed with discovery
```

**Benefits:**
- Deleted docs get quick discovery attempt (10s) - enough to find an undeletion Ref if peers have it
- If still deleted after 10s, return tombstone error
- User sees brief "Syncing..." then appropriate state
- Undeletion propagates within ~10s

### Option C: Periodic background check for deleted docs
- Keep the immediate error for UI responsiveness
- Add background job that periodically re-checks deleted docs for undeletion
- More complex but best UX

### Option D: Discovery with early termination
- Start discovery but return tombstone immediately to UI
- Continue discovery in background
- If undeletion found, update state and notify UI
- Most complex but best of both worlds

---

## Frontend Changes for Deleted Doc Handling

Current behavior in `app-sync.ts:504-514`:
```typescript
.catch((error) => {
  const parsedError = getErrorMessage(error)
  if (parsedError instanceof HMResourceTombstoneError) {
    state.deletedEntities.add(id.id)  // Permanent stop
    return  // No retry
  }
  // Other errors - retry
  discoveryTimer = setTimeout(discoveryLoop, DISCOVERY_POLL_INTERVAL_MS)
})
```

### Problem
Once `deletedEntities.add(id.id)` is called, discovery NEVER retries for that entity (even in new subscriptions checked at line 487).

### Proposed Change
Don't permanently stop discovery for deleted entities. Instead, use longer interval:

```typescript
const DELETED_POLL_INTERVAL_MS = 60_000  // Check every 60s for undeletion

.catch((error) => {
  const parsedError = getErrorMessage(error)
  if (parsedError instanceof HMResourceTombstoneError) {
    // Don't add to deletedEntities - allow periodic re-check
    discoveryStream.write({
      isDiscovering: false,
      isTombstone: true,  // New field for UI
      entityId: id.id,
    })
    // Slower polling for potential undeletion
    discoveryTimer = setTimeout(discoveryLoop, DELETED_POLL_INTERVAL_MS)
    return
  }
  discoveryTimer = setTimeout(discoveryLoop, DISCOVERY_POLL_INTERVAL_MS)
})
```

---

## Recommended Implementation Order

### Phase 1: Fix Frontend Stacking (Low risk, high impact)
1. Fix Issue #1: Clean up existing subscription before overwrite
2. Fix Issue #2: Add cancellation flag to discovery loop

### Phase 2: Fix Deleted Doc Discovery (Medium risk)
1. Backend: Implement Option B (time-limited discovery for deleted docs)
2. Frontend: Remove permanent `deletedEntities` blocking, use slower polling instead
3. Frontend: Add `isTombstone` state to discovery stream for UI

### Phase 3: Improve UX (Optional)
1. Consider Option D for best UX (immediate tombstone + background discovery)
2. Add UI indicator distinguishing "deleted" vs "not found" vs "syncing"

---

## Testing Scenarios

### Stacking Tests
1. Subscribe, unsubscribe, resubscribe within 300ms - verify single loop
2. Subscribe, start long discovery, unsubscribe, resubscribe - verify single loop
3. Rapid navigation between docs - verify no accumulated loops

### Deletion Tests
1. Delete doc locally, verify tombstone shown
2. Delete doc locally, undelete on another node, verify propagation
3. View deleted doc, verify no infinite spinner
4. View never-existed doc, verify appropriate behavior

---

## Files to Modify

### Frontend
- `frontend/apps/desktop/src/app-sync.ts`
  - Fix subscription overwrite cleanup
  - Add cancellation flag
  - Change deleted entity handling

### Backend
- `backend/api/entities/v1alpha/entities.go`
  - Modify or remove the `isDeleted` check
  - Implement time-limited discovery for deleted docs

### Shared Types (if adding isTombstone)
- `frontend/packages/shared/src/hm-types.ts`
  - Add `isTombstone` to `DiscoveryState`
