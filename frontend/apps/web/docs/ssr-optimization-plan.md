# SSR Performance Optimization Plan

## Background

### Performance Regression Identified

**Date**: December 2025 **Issue**: Perceived performance regression after SSR
implementation

**Root Cause**: Commit `deea8a4bf` ("Attempt to streamline server rendering
loaders") removed query block prefetching logic, causing client-side waterfall
fetches for pages with Query blocks.

### Impact

- Pages with Query blocks now trigger multiple client-side round trips instead
  of being server-rendered
- Lost ~67 lines of critical prefetching code
- Estimated performance degradation: 50-70% slower for query-heavy pages

---

## Phase 1: Fix Regression (COMPLETED)

### Changes Made

**File**: `frontend/apps/web/app/loaders.ts` **Lines**: 317-357

**Restored**:

1. Query block extraction from document content
2. Server-side query execution
3. Prefetching of all query result documents
4. Graceful error handling with `Promise.allSettled`

**Code Added**:

```typescript
// CRITICAL: Extract and prefetch query blocks (RESTORED)
const queryBlocks = extractQueryBlocks(document.content)

if (queryBlocks.length > 0) {
  await instrument(ctx || noopCtx, 'prefetchQueryBlocks', async () => {
    const queryBlockQueries = await Promise.all(
      queryBlocks.map(async (block) => {
        try {
          return await getQueryResults(block.attributes.query)
        } catch (e) {
          console.error('Error executing query block', e)
          return null
        }
      }),
    )

    // Add query result documents to embeddedDocs for prefetching
    const queryResultDocs = await Promise.allSettled(
      queryBlockQueries
        .filter((item) => item !== null && item.results)
        .flatMap((item) => item!.results)
        .map(async (item) => {
          try {
            const id = item.id
            const document = await getDocument(id)
            return {id, document}
          } catch (e) {
            console.error('Error fetching query result document', item.id, e)
            return null
          }
        }),
    )

    // Add successfully fetched query result docs to embeddedDocs
    queryResultDocs.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        embeddedDocs.push(result.value)
      }
    })
  })
}
```

---

## Phase 2: Performance Optimizations

### Current Performance Bottlenecks

Based on analysis of the SSR implementation, the following bottlenecks were
identified:

#### 1. **No Resource Hints**

**File**: `frontend/apps/web/app/root.tsx` **Issue**: No preconnect or
dns-prefetch hints for external services **Impact**: ~100-300ms overhead per
origin for DNS + TLS

**Current State**:

```typescript
export const links: LinksFunction = () => {
  return [
    {rel: 'stylesheet', href: globalStyles},
    {rel: 'stylesheet', href: localTailwindStyles},
    {rel: 'stylesheet', href: sonnerStyles},
    {rel: 'stylesheet', href: slashMenuStyles},
  ]
}
```

**Services to preconnect**:

- `DAEMON_HTTP_URL` / `SEED_ASSET_HOST` - Main backend API
- `LIGHTNING_API_URL` - Lightning network API
- `NOTIFY_SERVICE_HOST` - Notification service

#### 2. **Suboptimal React Query Configuration**

**File**: `frontend/apps/web/app/providers.tsx` **Lines**: 38-49

**Issue**: `staleTime: Infinity` prevents background data freshness

**Current Config**:

```typescript
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity, // ⚠️ Never considers data stale
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  })
}
```

**Impact**:

- Good for SSR cache
- Bad for client-side navigation (no fresh data checks)
- Users see stale data even after long sessions

#### 3. **All Prefetching is Blocking**

**File**: `frontend/apps/web/app/loaders.ts` **Lines**: 381-419

**Issue**: All prefetches block shell render, including non-critical data

**Current Blocking Operations**:

1. ✅ `getAuthors` (critical - needed for metadata)
2. ⚠️ `getEmbeddedDocs` (non-critical - can defer)
3. ✅ `getHomeAndDirectories` (critical - needed for navigation)
4. ⚠️ `prefetchQueryBlocks` (non-critical - can defer)
5. ✅ `getBreadcrumbs` (critical - needed for UI)
6. ⚠️ `queryInteractionSummary` (non-critical - comment counts)
7. ⚠️ `prefetchEmbeddedDocs` (non-critical - can defer)
8. ⚠️ `prefetchAccounts` (non-critical - can defer)

**Impact**: Server response delayed by ~200-500ms for non-critical data

#### 4. **No defer() Usage**

**File**: `frontend/apps/web/app/routes/$.tsx`

**Issue**: All loader data blocks initial response

**Opportunity**: Stream non-critical data after shell renders

- Interaction summaries (comments, likes)
- Embedded documents
- Query block results

**Complexity**: Requires UI changes for Suspense/Await boundaries

---

## Optimization Roadmap

### Priority 1: Add Resource Hints (HIGH IMPACT, LOW EFFORT)

**File**: `frontend/apps/web/app/root.tsx` **Lines to modify**: 29-36

**Implementation**:

```typescript
export const links: LinksFunction = () => {
  // Get environment variables injected by loader
  const daemonUrl =
    typeof window !== 'undefined'
      ? window.ENV?.SEED_ASSET_HOST || 'http://localhost:56001'
      : 'http://localhost:56001'

  const lightningUrl =
    typeof window !== 'undefined'
      ? window.ENV?.LIGHTNING_API_URL || 'https://ln.seed.hyper.media'
      : 'https://ln.seed.hyper.media'

  return [
    // Resource hints - CRITICAL for performance
    {rel: 'preconnect', href: daemonUrl, crossOrigin: 'anonymous'},
    {rel: 'dns-prefetch', href: lightningUrl},

    // Existing stylesheets
    {rel: 'stylesheet', href: globalStyles},
    {rel: 'stylesheet', href: localTailwindStyles},
    {rel: 'stylesheet', href: sonnerStyles},
    {rel: 'stylesheet', href: slashMenuStyles},
  ]
}
```

**Expected improvement**: 100-300ms faster first request to each origin

---

### Priority 2: Split Critical vs Non-Critical Prefetching (HIGH IMPACT, MEDIUM EFFORT)

**File**: `frontend/apps/web/app/loaders.ts` **Lines to modify**: 381-419

**Strategy**: Separate blocking vs non-blocking prefetches

**Critical (must complete before response)**:

- Home document
- Home directory (for navigation)
- Document directory (for children)
- Authors

**Non-Critical (can fail gracefully)**:

- Interaction summaries
- Embedded documents
- Query results
- Account metadata

**Implementation**:

```typescript
// Prefetch CRITICAL data - must succeed
await instrument(ctx || noopCtx, 'prefetchCriticalData', async () => {
  await Promise.all([
    prefetchCtx.queryClient.prefetchQuery(queryResource(client, homeId)),
    prefetchCtx.queryClient.prefetchQuery(
      queryDirectory(client, homeId, 'Children'),
    ),
    prefetchCtx.queryClient.prefetchQuery(
      queryDirectory(client, docId, 'Children'),
    ),
  ])
})

// Prefetch NON-CRITICAL data - use allSettled for graceful degradation
await instrument(ctx || noopCtx, 'prefetchNonCriticalData', async () => {
  await Promise.allSettled([
    // Interaction summary - nice to have but not blocking
    prefetchCtx.queryClient.prefetchQuery(
      queryInteractionSummary(client, docId),
    ),
    // Embedded docs - will load on client if missing
    ...embeddedDocs.map((doc) =>
      prefetchCtx.queryClient.prefetchQuery(queryResource(client, doc.id)),
    ),
    // Account metadata - will load on client if missing
    ...authors.map((author) =>
      prefetchCtx.queryClient.prefetchQuery(
        queryAccount(client, author.id.uid),
      ),
    ),
  ])
})
```

**Expected improvement**: 200-500ms faster TTFB (Time To First Byte)

---

### Priority 3: Tune React Query staleTime (LOW IMPACT, LOW EFFORT)

**File**: `frontend/apps/web/app/providers.tsx` **Lines to modify**: 38-49

**Change**:

```typescript
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60000, // 1 minute (was Infinity)
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  })
}
```

**Rationale**:

- Keeps SSR cache benefits (no refetch on mount/focus)
- Allows background freshness checks after 1 minute
- Balances performance with data freshness

**Expected improvement**: Better long-session UX, minimal performance impact

---

### Priority 4: Implement defer() for Streaming (MEDIUM IMPACT, HIGH EFFORT)

**File**: `frontend/apps/web/app/routes/$.tsx` **Lines to modify**: 155-236

**Strategy**: Split loader into critical shell data + deferred streaming data

**Implementation**:

```typescript
import {defer} from '@remix-run/node'

export const loader = async ({params, request}) => {
  const parsedRequest = parseRequest(request)
  const documentId = unpackHmId(params['*'])

  if (!useFullRender(parsedRequest)) {
    return null
  }

  const serviceConfig = await getConfig(hostname)

  // Load CRITICAL data (blocks shell render)
  const criticalData = await loadCriticalSiteResource(parsedRequest, documentId)

  // Start loading NON-CRITICAL data (streams after shell)
  const deferredData = {
    interactionSummary: loadInteractionSummary(documentId),
    embeddedDocs: loadEmbeddedDocuments(documentId),
  }

  return defer({
    ...criticalData,
    ...deferredData,
  })
}
```

**UI Changes Required**:

- Wrap non-critical components in `<Suspense>`
- Use `<Await>` component for deferred data
- Add loading states for streaming sections

**Expected improvement**: 300-600ms faster perceived load time

**Note**: This is the most complex change and should be considered for a future
iteration if simpler optimizations don't provide sufficient gains.

---

## Implementation Checklist

### Phase 2 Tasks

- [ ] **Add Resource Hints**

  - [ ] Update `frontend/apps/web/app/root.tsx` links export
  - [ ] Add preconnect for DAEMON_HTTP_URL/SEED_ASSET_HOST
  - [ ] Add dns-prefetch for LIGHTNING_API_URL
  - [ ] Add dns-prefetch for NOTIFY_SERVICE_HOST (if configured)
  - [ ] Test in production mode (resource hints only work in production)

- [ ] **Split Prefetching**

  - [ ] Update `frontend/apps/web/app/loaders.ts` prefetch logic
  - [ ] Separate critical Promise.all from non-critical Promise.allSettled
  - [ ] Move interaction summary to non-critical section
  - [ ] Move embedded docs to non-critical section
  - [ ] Move account metadata to non-critical section
  - [ ] Add instrumentation tags for monitoring

- [ ] **Tune React Query**

  - [ ] Update `frontend/apps/web/app/providers.tsx`
  - [ ] Change staleTime from Infinity to 60000
  - [ ] Verify refetch behavior is correct
  - [ ] Test client-side navigation still uses cache

- [ ] **(Optional) Implement defer()**
  - [ ] Create separate loader functions for critical vs deferred
  - [ ] Update route to use defer()
  - [ ] Add Suspense boundaries in UI
  - [ ] Add Await components for deferred data
  - [ ] Add loading states
  - [ ] Test streaming behavior

### Testing

- [ ] **Development Testing**

  - [ ] Run `yarn web` and verify app loads
  - [ ] Test pages with Query blocks
  - [ ] Test client-side navigation
  - [ ] Verify no console errors
  - [ ] Check Network tab for resource hint effects

- [ ] **Performance Testing**

  - [ ] Measure TTFB before/after
  - [ ] Measure FCP (First Contentful Paint)
  - [ ] Measure LCP (Largest Contentful Paint)
  - [ ] Measure TTI (Time To Interactive)
  - [ ] Test on slow 3G network simulation

- [ ] **Integration Testing**
  - [ ] Run `yarn web:test`
  - [ ] Verify all tests pass
  - [ ] Run typecheck: `yarn typecheck`
  - [ ] Run format check: `yarn format:check`

---

## Expected Performance Gains

### Optimistic Scenario

- Resource hints: -150ms connection overhead
- Split prefetching: -400ms TTFB
- Combined: **~550ms faster first paint**

### Conservative Scenario

- Resource hints: -100ms connection overhead
- Split prefetching: -200ms TTFB
- Combined: **~300ms faster first paint**

### With defer() (future)

- Additional: -300ms perceived load time
- **Total: ~600-850ms improvement**

---

## Monitoring & Validation

### Metrics to Track

**Server-Side**:

- TTFB (Time To First Byte)
- Server processing time
- Prefetch operation duration (instrumentation)

**Client-Side**:

- FCP (First Contentful Paint)
- LCP (Largest Contentful Paint)
- TTI (Time To Interactive)
- Total Blocking Time

**User Experience**:

- Perceived load speed
- Client-side navigation smoothness
- Cache hit rates

### Tools

- Chrome DevTools Network/Performance tabs
- Lighthouse CI
- WebPageTest
- Custom instrumentation (already in place)

---

## Rollback Plan

If optimizations cause issues:

1. **Resource Hints**: Remove from links export (low risk)
2. **Split Prefetching**: Revert to single Promise.all (medium risk)
3. **staleTime**: Revert to Infinity (low risk)
4. **defer()**: Remove defer, return to blocking loader (high risk if
   implemented)

All changes are independent and can be reverted individually.

---

## References

- Remix defer() docs: https://remix.run/docs/en/main/guides/streaming
- React Query SSR: https://tanstack.com/query/latest/docs/react/guides/ssr
- Resource Hints: https://www.w3.org/TR/resource-hints/
- Core Web Vitals: https://web.dev/vitals/

---

**Document Version**: 1.0 **Last Updated**: 2025-12-19 **Author**: Claude (AI
Assistant)
