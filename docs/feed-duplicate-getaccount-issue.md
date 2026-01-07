# Feed Page Duplicate Resource Requests Issue

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

Analyzing `activity-service.ts`, here are ALL the gRPC calls that can be duplicated:

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

### Current Code Structure

```typescript
// api-activity.ts:59-74
export const ListEvents: HMRequestImplementation<HMListEventsRequest> = {
  async getData(grpcClient: GRPCClient, input) {
    const response = await listEventsImpl(grpcClient, input)

    // Each event resolved independently - NO deduplication
    const resolvedEvents = await Promise.allSettled(
      response.events.map((event) =>
        resolveEvent(grpcClient, event, input.currentAccount),
      ),
    )
    // ...
  },
}
```

Each loader function (e.g., `loadCommentEvent`) makes its own calls:
```typescript
// activity-service.ts:207-286 (loadCommentEvent)
const comment = await grpcClient.comments.getComment({id: event.newBlob.cid})
const author = await resolveAccount(grpcClient, comment.author, currentAccount)
const replyingComment = comment.replyParent
  ? await grpcClient.comments.getComment({id: comment.replyParent})
  : null
const replyParentAuthor = replyingComment?.author
  ? await resolveAccount(grpcClient, replyingComment.author, currentAccount)
  : null
const targetDoc = await grpcClient.documents.getDocument({...})
const replyCountResponse = await grpcClient.comments.getCommentReplyCount({...})
```

## Race Condition Analysis

The original Option A proposal stored **Promises** in the cache:

```typescript
const accountCache = new Map<string, Promise<HMContactItem>>()

const getOrResolveAccount = (accountId: string) => {
  if (!accountCache.has(accountId)) {
    accountCache.set(
      accountId,
      resolveAccount(grpcClient, accountId, input.currentAccount)
    )
  }
  return accountCache.get(accountId)!
}
```

**This handles race conditions correctly.** When two events reference the same account concurrently:

1. Event A calls `getOrResolveAccount("xyz")`
2. Cache miss → stores `Promise<resolve("xyz")>` in map
3. Event B calls `getOrResolveAccount("xyz")` (before A's promise resolves)
4. Cache hit → returns same Promise
5. Both events await the same Promise
6. Only ONE gRPC call is made

This is the standard "promise memoization" pattern that handles concurrent access correctly.

## Recommended Solution: Request-Scoped Resource Cache

Create a unified cache for all resource types within a single `ListEvents` request:

```typescript
// New file: frontend/packages/shared/src/request-cache.ts

export type RequestCache = {
  getAccount: (uid: string, currentAccount?: string) => Promise<HMContactItem>
  getDocument: (params: {account: string, path?: string, version?: string}) => Promise<Document>
  getComment: (id: string) => Promise<Comment>
  getCommentReplyCount: (id: string) => Promise<number>
  getContacts: (accountUid: string) => Promise<Contact[]>
}

export function createRequestCache(grpcClient: GRPCClient): RequestCache {
  // Store Promises to handle concurrent access
  const accounts = new Map<string, Promise<HMContactItem>>()
  const documents = new Map<string, Promise<Document>>()
  const comments = new Map<string, Promise<Comment>>()
  const replyCounts = new Map<string, Promise<number>>()
  const contacts = new Map<string, Promise<Contact[]>>()

  return {
    getAccount(uid: string, currentAccount?: string) {
      // Key includes currentAccount because contact name may differ
      const key = `${uid}:${currentAccount || ''}`
      if (!accounts.has(key)) {
        accounts.set(key, resolveAccount(grpcClient, uid, currentAccount))
      }
      return accounts.get(key)!
    },

    getDocument(params) {
      const key = `${params.account}:${params.path || ''}:${params.version || ''}`
      if (!documents.has(key)) {
        documents.set(key, grpcClient.documents.getDocument(params))
      }
      return documents.get(key)!
    },

    getComment(id: string) {
      if (!comments.has(id)) {
        comments.set(id, grpcClient.comments.getComment({id}))
      }
      return comments.get(id)!
    },

    getCommentReplyCount(id: string) {
      if (!replyCounts.has(id)) {
        replyCounts.set(id,
          grpcClient.comments.getCommentReplyCount({id})
            .then(r => Number(r.replyCount))
        )
      }
      return replyCounts.get(id)!
    },

    getContacts(accountUid: string) {
      if (!contacts.has(accountUid)) {
        contacts.set(accountUid,
          grpcClient.documents.listContacts({
            filter: {case: 'account', value: accountUid}
          }).then(r => r.contacts)
        )
      }
      return contacts.get(accountUid)!
    }
  }
}
```

### Updated ListEvents Implementation

```typescript
// api-activity.ts
export const ListEvents: HMRequestImplementation<HMListEventsRequest> = {
  async getData(grpcClient: GRPCClient, input) {
    const response = await listEventsImpl(grpcClient, input)

    // Create request-scoped cache
    const cache = createRequestCache(grpcClient)

    const resolvedEvents = await Promise.allSettled(
      response.events.map((event) =>
        resolveEvent(grpcClient, event, input.currentAccount, cache),
      ),
    )
    // ...
  },
}
```

### Updated Event Loaders

Each loader function receives the cache and uses it:

```typescript
export async function loadCommentEvent(
  grpcClient: GRPCClient,
  event: HMActivityEvent,
  currentAccount?: string,
  cache?: RequestCache,  // Optional for backwards compat
): Promise<LoadedCommentEvent | null> {
  // ...
  const comment = cache
    ? await cache.getComment(event.newBlob.cid)
    : await grpcClient.comments.getComment({id: event.newBlob.cid})

  const author = cache
    ? await cache.getAccount(comment.author, currentAccount)
    : await resolveAccount(grpcClient, comment.author, currentAccount)

  // ... etc
}
```

## Alternative: Refactor resolveAccount to Accept Cache

The `resolveAccount` function in `account-utils.ts` also calls `listContacts()`. It should accept a cache parameter:

```typescript
export async function resolveAccount(
  grpcClient: GRPCClient,
  accountId: string,
  currentAccount?: string,
  cache?: RequestCache,
  maxDepth: number = 10,
): Promise<HMContactItem> {
  // Use cache.getContacts() instead of direct call
  const contactsResponse = currentAccount && cache
    ? await cache.getContacts(currentAccount)
    : currentAccount
    ? await grpcClient.documents.listContacts({...})
    : null
  // ...
}
```

## Impact Analysis

For a typical feed page with 20 events:

**Before (worst case):**
- 20+ GetAccount calls (authors)
- 20+ ListContacts calls
- 10+ GetDocument calls (targets)
- 5+ GetComment calls (reply parents)
- 20+ GetCommentReplyCount calls

**After (with cache):**
- ~3-5 GetAccount calls (unique authors)
- 1 ListContacts call
- ~2-3 GetDocument calls (unique targets)
- ~2 GetComment calls (unique reply parents)
- ~15 GetCommentReplyCount calls (unique comments)

## Files to Modify

1. **New file**: `frontend/packages/shared/src/request-cache.ts` - Cache implementation
2. `frontend/packages/shared/src/api-activity.ts` - Create cache, pass to resolvers
3. `frontend/packages/shared/src/models/activity-service.ts` - Update all load* functions
4. `frontend/packages/shared/src/account-utils.ts` - Accept cache in resolveAccount

## Edge Cases

1. **Error handling**: If a cached promise rejects, all awaiters get the error. This is correct behavior - if account X fails to load, all events needing X should fail.

2. **Cache key collisions**: Document cache key must include account + path + version. Two events may reference same doc at different versions.

3. **Partial failures**: `Promise.allSettled` already handles individual event failures gracefully.

## Summary

The fix requires:
1. Creating a request-scoped cache that stores Promises (not resolved values)
2. Passing this cache through the event resolution chain
3. Using the cache for all resource fetches

The Promise-based caching naturally handles race conditions - concurrent requests for the same resource share the same in-flight Promise.
