# Feed Page Duplicate Resource Requests Issue

## Status: ✅ IMPLEMENTED

The fix has been implemented and typecheck passes. See Implementation Notes below.

---

## Problem Statement

When scrolling the feed page, duplicate gRPC requests are made for the same resources. This affects not just accounts, but also documents and comments.

Example from logs (same account ID repeated):
```
↗️ to GetAccount GetAccountRequest {id: 'z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou'}
↗️ to GetAccount GetAccountRequest {id: 'z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou'}
↗️ to GetAccount GetAccountRequest {id: 'z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou'}
...
```

## Root Cause Analysis

The issue is in **server-side event resolution** (`api-activity.ts` and `activity-service.ts`). When `ListEvents` is called, each event is resolved independently via `Promise.allSettled()`, with no deduplication of resource fetches.

### All Duplicate Request Types

| Resource Type | gRPC Call | Where Used |
|--------------|-----------|------------|
| **Account** | `getAccount()` | All event types (author), comment events (reply parent author), capability events (delegates), contact events (subject) |
| **Account Contacts** | `listContacts()` | Called inside `resolveAccount()` for every account resolution |
| **Document** | `getDocument()` | Comment events (target doc), capability events (target), ref events, citation events (source + target docs) |
| **Comment** | `getComment()` | Comment events (main + reply parent), citation events (for comment citations) |
| **Reply Count** | `getCommentReplyCount()` | Comment events, citation events |

### Specific Duplication Scenarios

**Scenario 1: Same author across events**
- 10 doc-update events from same author → 10 `getAccount()` calls
- Each also triggers `listContacts()` → 10 more calls

**Scenario 2: Reply threads**
- 5 comments replying to same parent → 5 `getComment()` calls for parent
- Plus 5 `getAccount()` calls for parent author

**Scenario 3: Citations to same document**
- 3 citations to same target doc → 3 `getDocument()` calls

**Scenario 4: Comments on same document**
- 8 comments on same doc → 8 `getDocument()` calls for target

## Solution: Request-Scoped Resource Cache

The fix uses a **request-scoped cache** that stores Promises (not resolved values) to deduplicate gRPC calls. When two events reference the same resource concurrently, they share the same in-flight Promise, ensuring only one gRPC call is made.

### Race Condition Handling

The Promise-based cache handles race conditions correctly:

1. Event A calls `cache.getAccount("xyz")`
2. Cache miss → stores `Promise<resolve("xyz")>` in map
3. Event B calls `cache.getAccount("xyz")` (before A's promise resolves)
4. Cache hit → returns same Promise
5. Both events await the same Promise
6. Only ONE gRPC call is made

---

## Implementation Notes

### Files Modified

1. **NEW: `frontend/packages/shared/src/request-cache.ts`**
   - `RequestCache` type with methods for each resource type
   - `createRequestCache(grpcClient)` factory function
   - `resolveAccountWithCache()` - cache-aware account resolver (replaces direct `resolveAccount` calls)

2. **`frontend/packages/shared/src/api-activity.ts`**
   - Creates `RequestCache` at start of `ListEvents.getData()`
   - Passes cache to `resolveEvent()` and all loader functions

3. **`frontend/packages/shared/src/models/activity-service.ts`**
   - All `load*` functions now accept `cache: RequestCache` parameter
   - All gRPC calls replaced with cache methods:
     - `grpcClient.comments.getComment()` → `cache.getComment()`
     - `grpcClient.documents.getDocument()` → `cache.getDocument()`
     - `resolveAccount()` → `cache.getAccount()`
     - `grpcClient.comments.getCommentReplyCount()` → `cache.getCommentReplyCount()`

4. **`frontend/packages/shared/src/account-utils.ts`** - NOT MODIFIED
   - Account resolution logic moved into `request-cache.ts` as `resolveAccountWithCache()`
   - Original `resolveAccount()` still exists for other uses outside ListEvents

### Cache Key Strategy

| Resource | Cache Key | Rationale |
|----------|-----------|-----------|
| Account | `${uid}:${currentAccount}` | Contact name may differ based on currentAccount's contacts |
| Document | `${account}:${path}:${version}` | Same doc at different versions are different resources |
| Comment | `${id}` | Comment ID is unique |
| Reply Count | `${id}` | Reply count is per-comment |
| Contacts | `${accountUid}` | One contacts list per account |

### Expected Impact

For a typical feed page with 20 events:

**Before:**
- 20+ GetAccount calls (authors)
- 20+ ListContacts calls
- 10+ GetDocument calls (targets)
- 5+ GetComment calls (reply parents)
- 20+ GetCommentReplyCount calls

**After:**
- ~3-5 GetAccount calls (unique authors)
- 1 ListContacts call (per currentAccount)
- ~2-3 GetDocument calls (unique targets)
- ~2 GetComment calls (unique reply parents)
- ~15 GetCommentReplyCount calls (unique comments - these are less likely to be duplicated)

### Edge Cases Handled

1. **Error propagation**: If a cached promise rejects, all awaiters get the error. This is correct - if account X fails to load, all events needing X should fail.

2. **Alias resolution**: The cache handles recursive alias resolution by calling `cache.getAccount()` for the alias target.

3. **Partial failures**: `Promise.allSettled` in `api-activity.ts` handles individual event failures gracefully.

### Testing Checklist

- [ ] Verify feed page loads correctly
- [ ] Verify scroll/pagination works
- [ ] Check console for duplicate GetAccount requests (should be eliminated)
- [ ] Check console for duplicate GetDocument requests (should be reduced)
- [ ] Verify error cases still work (invalid accounts, etc.)
