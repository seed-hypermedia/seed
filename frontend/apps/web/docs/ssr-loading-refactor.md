# SSR Loading Refactor: Implementation Plan

## Current State

`loaders.ts` has ~1100 lines with a confused architecture:

1. **Manual fetching phase** (lines 267-425): Direct gRPC calls via `getDocument()`, `getMetadata()`, `getDirectory()`, accumulating data into arrays
2. **React Query prefetch phase** (lines 426-510): Prefetches the SAME data again via `queryResource()`, `queryDirectory()`, `queryAccount()`
3. **Query block explosion** (lines 347-400): For each query block, fetches ALL result documents individually (100+ calls)

Result: 200+ gRPC calls for a single page, 1173ms load time.

## Target State

Single-phase architecture using React Query prefetching only. ~80 lines for `loadResourcePayload()`.

## Step-by-Step Implementation

### Step 1: Create the new prefetch function

Add a new function alongside the existing one (don't replace yet):

```typescript
// New function - add after line 527
async function prefetchResourceData(
  docId: UnpackedHypermediaId,
  document: HMDocument,
  prefetchCtx: PrefetchContext,
  ctx?: InstrumentationContext,
): Promise<void> {
  const client = serverUniversalClient
  const homeId = hmId(docId.uid, {latest: true})

  // Wave 1: Core navigation data (parallel)
  await Promise.allSettled([
    prefetchCtx.queryClient.prefetchQuery(queryResource(client, docId)),
    prefetchCtx.queryClient.prefetchQuery(queryResource(client, homeId)),
    prefetchCtx.queryClient.prefetchQuery(queryDirectory(client, homeId, 'Children')),
    prefetchCtx.queryClient.prefetchQuery(queryDirectory(client, docId, 'Children')),
    prefetchCtx.queryClient.prefetchQuery(queryInteractionSummary(client, docId)),
  ])

  // Wave 2: Content dependencies (parallel)
  const queryBlocks = extractQueryBlocks(document.content)
  const refs = extractRefs(document.content)

  await Promise.allSettled([
    // Query block directories
    ...queryBlocks.map(block => {
      const include = block.attributes.query.includes[0]
      if (!include) return Promise.resolve()
      const targetId = hmId(include.space, {
        path: entityQueryPathToHmIdPath(include.path),
      })
      return prefetchCtx.queryClient.prefetchQuery(
        queryDirectory(client, targetId, include.mode)
      )
    }),
    // Embedded document content
    ...refs.map(ref =>
      prefetchCtx.queryClient.prefetchQuery(queryResource(client, ref.refId))
    ),
    // Author accounts
    ...document.authors.map(uid =>
      prefetchCtx.queryClient.prefetchQuery(queryAccount(client, uid))
    ),
  ])
}
```

### Step 2: Create helper functions for cache extraction

Add these helper functions:

```typescript
function getHomeDocumentFromCache(
  prefetchCtx: PrefetchContext,
  homeId: UnpackedHypermediaId,
): HMDocument | null {
  const client = serverUniversalClient
  const resource = prefetchCtx.queryClient.getQueryData(
    queryResource(client, homeId).queryKey
  ) as HMResource | null
  return resource?.type === 'document' ? resource.document : null
}

function buildBreadcrumbsFromCache(
  prefetchCtx: PrefetchContext,
  docId: UnpackedHypermediaId,
  document: HMDocument,
): HMMetadataPayload[] {
  const client = serverUniversalClient
  const homeId = hmId(docId.uid, {latest: true})

  // Get all descendants to find parent metadata
  const allDocs = prefetchCtx.queryClient.getQueryData(
    queryDirectory(client, homeId, 'Children').queryKey
  ) as HMDocumentInfo[] | null

  const crumbPaths = getParentPaths(docId.path).slice(0, -1)
  const breadcrumbs = crumbPaths.map(crumbPath => {
    const id = hmId(docId.uid, {path: crumbPath})
    const dirEntry = allDocs?.find(d => d.id.id === id.id)
    return {
      id,
      metadata: dirEntry?.metadata || {},
    }
  })

  // Add current document
  breadcrumbs.push({id: docId, metadata: document.metadata})
  return breadcrumbs
}

function buildAccountsMetadataFromCache(
  prefetchCtx: PrefetchContext,
  authorUids: string[],
): HMAccountsMetadata {
  const client = serverUniversalClient
  return Object.fromEntries(
    authorUids.map(uid => {
      const account = prefetchCtx.queryClient.getQueryData(
        queryAccount(client, uid).queryKey
      ) as HMMetadataPayload | null
      return [uid, account || {id: hmId(uid), metadata: {}}]
    })
  )
}
```

### Step 3: Create the new loadResourcePayload

Replace the existing `loadResourcePayload` function:

```typescript
async function loadResourcePayload(
  docId: UnpackedHypermediaId,
  parsedRequest: ParsedRequest,
  payload: {
    document: HMDocument
    latestDocument?: HMDocument | null
    comment?: HMComment
  },
  ctx?: InstrumentationContext,
): Promise<WebResourcePayload> {
  const {document, latestDocument, comment} = payload
  const prefetchCtx = createPrefetchContext()
  const homeId = hmId(docId.uid, {latest: true})

  // Prefetch all data for React Query hydration
  await prefetchResourceData(docId, document, prefetchCtx, ctx)

  // Extract data from cache for SSR response
  const homeDocument = getHomeDocumentFromCache(prefetchCtx, homeId)
  const breadcrumbs = buildBreadcrumbsFromCache(prefetchCtx, docId, document)
  const accountsMetadata = buildAccountsMetadataFromCache(prefetchCtx, document.authors)

  return {
    document,
    comment,
    accountsMetadata,
    isLatest: !latestDocument || latestDocument.version === document.version,
    id: {...docId, version: document.version},
    breadcrumbs,
    siteHomeIcon: homeDocument?.metadata?.icon || null,
    dehydratedState: dehydratePrefetchContext(prefetchCtx),
    ...getOriginRequestData(parsedRequest),
  }
}
```

### Step 4: Add missing import

Add `entityQueryPathToHmIdPath` to the imports from `@shm/shared`:

```typescript
import {
  // ... existing imports ...
  entityQueryPathToHmIdPath,
} from '@shm/shared'
```

### Step 5: Remove dead code

After verifying the new implementation works, remove:

1. **Lines 71-90**: `getMetadata()` function (replaced by `queryAccount`)
2. **Lines 210-211**: `getDirectory` and `getQueryResults` declarations
3. **Lines 267-425**: The entire manual fetching section in old `loadResourcePayload`
4. **Lines 631-866**: `loadEditorNodes`, `loadDocumentBlock`, `loadDocumentBlockNode`, `loadDocumentContent`, `loadAuthors` functions (unused after refactor)

### Step 6: Update instrumentation

The new implementation should still support instrumentation. Wrap prefetch calls:

```typescript
await instrument(ctx, 'prefetchWave1', () =>
  Promise.allSettled([
    instrument(ctx, `prefetchResource(${packHmId(docId)})`, () =>
      prefetchCtx.queryClient.prefetchQuery(queryResource(client, docId))
    ),
    // ... etc
  ])
)
```

## Testing Strategy

### Unit Tests

1. Test `buildBreadcrumbsFromCache` with various path depths
2. Test `buildAccountsMetadataFromCache` with missing accounts
3. Test `prefetchResourceData` with documents containing query blocks and embeds

### Integration Tests

1. Load a simple document - verify correct data
2. Load a document with query blocks - verify directory prefetched
3. Load a document with embeds - verify embed documents prefetched
4. Load a document with nested embeds - verify graceful handling

### Performance Tests

1. Enable instrumentation: `SEED_INSTRUMENTATION=dev`
2. Load the same page that showed 1173ms/200+ calls
3. Verify: <20 gRPC calls, <200ms total

## Rollback Plan

The new function is additive. If issues arise:

1. Revert `loadResourcePayload` to the old implementation
2. Keep the new helper functions (they're not harmful)
3. Investigate issues in development

## Migration Checklist

- [ ] Add `prefetchResourceData` function
- [ ] Add `getHomeDocumentFromCache` helper
- [ ] Add `buildBreadcrumbsFromCache` helper
- [ ] Add `buildAccountsMetadataFromCache` helper
- [ ] Add `entityQueryPathToHmIdPath` import
- [ ] Replace `loadResourcePayload` implementation
- [ ] Add instrumentation to new code
- [ ] Test simple document load
- [ ] Test document with query blocks
- [ ] Test document with embeds
- [ ] Run performance test with instrumentation
- [ ] Remove dead code
- [ ] Final review and commit

## Files Changed

| File | Changes |
|------|---------|
| `frontend/apps/web/app/loaders.ts` | Major refactor |

No other files need changes - the query definitions and client hooks are already correct.
