# SSR Loading Architecture

## Overview

The web app uses React Query for data fetching on both server and client. The
server prefetches data into a QueryClient, dehydrates it, and sends it to the
client. The client hydrates the cache and renders instantly without refetching.

## Core Principle

**The server prefetches exactly what the client will query.**

Components use React Query hooks (`useResource`, `useDirectory`, `useResources`,
`useAccount`). The server's job is to prefetch those same queries so the client
renders instantly from cache.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                           SERVER (SSR)                               │
│                                                                      │
│  1. Request arrives: GET /hm/z6Mk.../path                           │
│                                                                      │
│  2. Resolve the resource (document, comment, or redirect)            │
│     └─ Uses resolveResource() which follows redirects               │
│                                                                      │
│  3. Create a fresh QueryClient for this request                      │
│                                                                      │
│  4. Prefetch in waves (parallel within each wave):                   │
│                                                                      │
│     Wave 1: Core navigation data                                     │
│     ├── queryResource(docId)           # main document              │
│     ├── queryResource(homeId)          # site home for nav          │
│     ├── queryDirectory(homeId)         # nav menu items             │
│     ├── queryDirectory(docId)          # child pages                │
│     └── queryInteractionSummary(docId) # comment/citation counts    │
│                                                                      │
│     Wave 2: Content dependencies (extracted from document)           │
│     ├── queryAccount(authorUid) × N    # author metadata            │
│     ├── queryResource(embedRef) × N    # embedded document content  │
│     └── queryDirectory(queryTarget) × N # query block results       │
│                                                                      │
│  5. Build minimal response payload:                                  │
│     - document (already have from resolution)                        │
│     - breadcrumbs (built from directory cache)                       │
│     - accountsMetadata (built from account cache)                    │
│     - dehydratedState (the QueryClient cache)                        │
│                                                                      │
│  6. Render React app with HydrationBoundary                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT (Hydration)                          │
│                                                                      │
│  <HydrationBoundary state={dehydratedState}>                        │
│    <DocumentPage document={document} ... />                          │
│  </HydrationBoundary>                                                │
│                                                                      │
│  Components call hooks:                                              │
│  ├── useResource(docId)       → instant from cache                  │
│  ├── useDirectory(homeId)     → instant from cache                  │
│  ├── useAccount(authorUid)    → instant from cache                  │
│  └── BlockContentQuery                                               │
│       ├── useDirectory(queryTargetId) → instant from cache          │
│       └── useResources(resultIds)     → instant from cache          │
│                                                                      │
│  If any query is missing from cache, React Query fetches it          │
│  automatically (graceful degradation)                                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Query Definitions

Queries are defined in `@shm/shared/models/queries.ts`. Each returns a
`{queryKey, queryFn}` object compatible with both `useQuery()` and
`prefetchQuery()`.

| Query                         | Purpose                        | Used By               |
| ----------------------------- | ------------------------------ | --------------------- |
| `queryResource(id)`           | Fetch document/comment/contact | `useResource()` hook  |
| `queryDirectory(id, mode)`    | List child documents           | `useDirectory()` hook |
| `queryAccount(uid)`           | Fetch account metadata         | `useAccount()` hook   |
| `queryInteractionSummary(id)` | Comment/citation counts        | Interaction badges    |
| `queryComments(id)`           | Comments on a document         | Comment sections      |
| `queryCitations(id)`          | Citations to a document        | Citation panels       |

## Deduplication

React Query automatically deduplicates queries by `queryKey`. If the same query
is prefetched twice (e.g., an embed references the home document), only one
fetch occurs.

```typescript
// These result in ONE fetch, not two:
await prefetchQuery(queryResource(client, homeId));
await prefetchQuery(queryResource(client, homeId)); // returns cached
```

## Wave Strategy

Prefetches are grouped into waves based on data dependencies:

**Wave 1** - No dependencies, fetch in parallel:

- Main document resource
- Home document resource
- Home directory (for navigation)
- Document directory (for child pages)
- Interaction summary

**Wave 2** - Depends on document content, fetch in parallel:

- Authors (from `document.authors`)
- Embedded documents (from `extractRefs(document.content)`)
- Query block directories (from `extractQueryBlocks(document.content)`)

## What Components Render From

| Component        | Data Source                        | Query                                |
| ---------------- | ---------------------------------- | ------------------------------------ |
| Navigation menu  | Home directory listing             | `queryDirectory(homeId, 'Children')` |
| Breadcrumbs      | Directory + document metadata      | Built from `queryDirectory` cache    |
| Document content | Main document                      | `queryResource(docId)`               |
| Query blocks     | Directory listing for query target | `queryDirectory(queryTargetId)`      |
| Embed blocks     | Referenced document                | `queryResource(embedId)`             |
| Author badges    | Account metadata                   | `queryAccount(authorUid)`            |

## Query Block Rendering

Query blocks (lists of child documents) render from directory metadata, not full
documents:

```typescript
// BlockContentQuery in blocks-content.tsx
const directoryItems = useDirectory(queryIncludeId, { mode });
// directoryItems contains HMDocumentInfo with:
// - id, path, version
// - metadata (name, icon, description)
// - authors, createTime, updateTime

// Renders cards from metadata - no need to fetch full documents
```

For query blocks, we prefetch the directory listing. The client renders cards
from `HMDocumentInfo` metadata. Full document content is only fetched if a user
clicks through.

## Embedded Document Rendering

Embeds that show document content need the full document:

```typescript
// extractRefs() finds all Embed blocks in content
const refs = extractRefs(document.content);

// Prefetch each referenced document
refs.forEach((ref) => prefetchQuery(queryResource(client, ref.refId)));
```

## Error Handling

- Use `Promise.allSettled()` for prefetches - one failure shouldn't break the
  page
- Missing data is handled gracefully - client will fetch on demand
- Log errors for debugging but don't throw

## Performance Characteristics

| Scenario                            | gRPC Calls | Latency |
| ----------------------------------- | ---------- | ------- |
| Simple document (no embeds/queries) | ~5         | <50ms   |
| Document with 3 query blocks        | ~8         | <80ms   |
| Document with 10 embeds             | ~15        | <100ms  |
| Complex page (embeds + queries)     | ~20        | <150ms  |

All calls are local (same machine), so latency is dominated by database queries,
not network.

## Files

| File                                             | Purpose              |
| ------------------------------------------------ | -------------------- |
| `frontend/apps/web/app/loaders.ts`               | SSR data loading     |
| `frontend/apps/web/app/queries.server.ts`        | QueryClient creation |
| `frontend/packages/shared/src/models/queries.ts` | Query definitions    |
| `frontend/packages/shared/src/models/entity.ts`  | React Query hooks    |
| `frontend/packages/ui/src/blocks-content.tsx`    | Content rendering    |
