# Feed Author Loading Issue Analysis

## Problem Statement

Authors in the feed are showing up as account IDs instead of displaying their resolved metadata (names, icons). The desktop app relies on having entities synced locally to display author metadata, but feed events reference authors that may not be locally available.

## Current Architecture

### How Comments Panel Solves This

The comments panel ([comments.tsx](frontend/packages/ui/src/comments.tsx)) uses `useHackyAuthorsSubscriptions` - a workaround that:

1. Collects all author IDs from comment data
2. Passes them to `useResources()` with `subscribed: true`
3. This triggers desktop subscription/sync for those accounts
4. Once synced, the account metadata becomes available locally

```tsx
// comments.tsx:134-151
const allAuthorIds = useMemo(() => {
  const authors = new Set<string>()
  // ... collect author IDs from comments
  return Array.from(authors)
}, [parentThread?.thread, commentGroupReplies.data])

useHackyAuthorsSubscriptions(allAuthorIds)
```

### How Feed Events Are Loaded

Feed events go through `api-activity.ts` which calls `resolveAccount()` for each author:

```
ListEvents → resolveEvent() → loadCommentEvent/loadRefEvent/etc → resolveAccount()
```

The `resolveAccount()` function ([account-utils.ts](frontend/packages/shared/src/account-utils.ts)):
- Fetches account document via gRPC
- Falls back to abbreviated UID if account not found
- Returns `HMContactItem` with `id` and `metadata`

### The Disconnect

**On Web**: Events are fully resolved server-side before sending to frontend. Works correctly.

**On Desktop**:
- Events are resolved via the same shared code
- BUT the desktop gRPC client connects to the local daemon
- Local daemon may not have synced the referenced accounts
- Result: `resolveAccount()` fails, returns abbreviated UID as fallback name

## Why `useHackyAuthorsSubscriptions` Works

The "hack" works because:
1. It calls `useResources(ids, {subscribed: true})`
2. `useResources` calls `client.subscribeEntity({id})` for each ID
3. On desktop, this triggers entity discovery/subscription
4. The local daemon starts syncing those accounts
5. Once synced, the entity becomes available locally
6. React Query cache is updated, UI re-renders with metadata

## Solutions Analysis

### Option 1: Apply `useHackyAuthorsSubscriptions` to Feed (Quick Fix)

**Implementation**:
- Collect author IDs from feed events
- Call `useHackyAuthorsSubscriptions(authorIds)` in Feed component

**Pros**:
- Minimal code change
- Consistent with comments panel approach
- Works immediately

**Cons**:
- Initial render shows abbreviated IDs until sync completes
- Increases subscription count (may impact performance)
- Perpetuates "hacky" pattern

### Option 2: Backend-Driven Auto-Subscribe (Original Intent)

**Concept**: Go service automatically subscribes to referenced entities based on frontend queries.

**How it would work**:
1. When frontend queries `ListEvents`, backend observes referenced account IDs
2. Backend triggers discovery/sync for those accounts
3. Subsequent queries return resolved metadata

**Current Status**: Not implemented for ListEvents

**Pros**:
- No frontend code changes
- Backend has full visibility into what's needed
- Works for all clients automatically

**Cons**:
- Complex to implement correctly
- Race condition: first request still returns unresolved data
- Backend doesn't know what user is actively viewing
- May over-subscribe (subscriptions have costs)

### Option 3: Frontend-Driven Discovery API (Recommended)

**Concept**: Frontend explicitly tells backend what it's viewing, backend subscribes.

**How it would work**:
1. Frontend collects entity IDs it's displaying
2. Calls discovery API: `discoverEntities(ids[])`
3. Backend initiates sync for those entities
4. Frontend polls/subscribes for updates

**Implementation sketch**:
```tsx
// In Feed component
const visibleAuthorIds = useMemo(() => {
  return allEvents.flatMap(e => extractAuthorIds(e))
}, [allEvents])

// Tell backend we need these entities
useDiscoverEntities(visibleAuthorIds)
```

**Pros**:
- Frontend knows exactly what user sees
- Can be visibility-aware (only subscribe to visible items)
- Cleaner separation of concerns
- Works with virtualized lists (only subscribe to visible rows)

**Cons**:
- Requires new API endpoint
- Still has initial render flash

### Option 4: Hybrid Preloading

**Concept**: Combine backend resolution with frontend subscription.

**How it would work**:
1. `ListEvents` continues to resolve metadata server-side (current behavior)
2. Frontend also subscribes to keep entities fresh for future requests
3. Cache warmed from initial response, subscriptions prevent staleness

**Pros**:
- First render has correct data (if backend can resolve)
- Keeps data fresh
- Graceful degradation

**Cons**:
- More complexity
- Desktop backend still may not have entities initially

## Recommendation

### Short Term (Immediate Fix)
Apply Option 1: Add `useHackyAuthorsSubscriptions` to Feed. This unblocks users now.

### Medium Term (Clean Architecture)
Implement Option 3 with a proper discovery hook:

```tsx
// New shared hook
export function useDiscoverEntities(ids: UnpackedHypermediaId[]) {
  const client = useUniversalClient()

  useEffect(() => {
    if (!ids.length || !client.discoverEntities) return

    // Batch discovery request
    client.discoverEntities(ids)
  }, [ids, client])
}

// In Feed
const authorIds = useMemo(() =>
  allEvents.flatMap(extractAuthorIds), [allEvents])

useDiscoverEntities(authorIds)
```

This would:
1. Replace the "hacky" subscription pattern
2. Work for both desktop and web
3. Be visibility-aware (extend later)
4. Support batching and deduplication

### Long Term (Backend Intelligence)
Extend the Go service to:
1. Track which entities are frequently accessed together
2. Proactively sync "related" entities
3. Prioritize based on access patterns

## Implementation Notes for Quick Fix

To apply `useHackyAuthorsSubscriptions` to feed:

1. Pass hook through `CommentsProvider` (already done for feed page)
2. In `Feed` component, collect author IDs:
```tsx
const authorIds = useMemo(() => {
  return allEvents.flatMap(e => {
    const ids: string[] = []
    if (e.author?.id?.uid) ids.push(e.author.id.uid)
    if (e.type === 'comment' && e.replyParentAuthor?.id?.uid) {
      ids.push(e.replyParentAuthor.id.uid)
    }
    if (e.type === 'capability' && e.delegates) {
      e.delegates.forEach(d => d.id?.uid && ids.push(d.id.uid))
    }
    if (e.type === 'contact' && e.contact?.subject?.id?.uid) {
      ids.push(e.contact.subject.id.uid)
    }
    return ids
  })
}, [allEvents])
```
3. Call `useHackyAuthorsSubscriptions(authorIds)` from context

## Questions to Consider

1. Should we throttle/debounce subscription calls for performance?
2. Should subscriptions be scoped to current view (unsubscribe on navigate)?
3. Is there a maximum subscription limit we should respect?
4. Should we prioritize visible vs scrolled-past entities?
