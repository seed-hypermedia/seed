# Web Instrumentation Implementation Plan

## Overview

Add server-side request instrumentation to the Remix web app when `ENABLE_WEB_INSTRUMENTATION` is enabled (`SEED_INSTRUMENTATION=dev`). The instrumentation tracks timing of all server operations and prints a summary when the request completes.

## Current Request Flow Analysis

### Entry Point: `frontend/apps/web/app/routes/$.tsx`

The main loader function handles document requests:

```
loader()
  -> parseRequest()         // Parse URL, headers, hostname
  -> useFullRender()        // Check cache policy
  -> getConfig(hostname)    // Get site config
  -> hmId()                 // Build document ID
  -> loadSiteResource()     // Main resource loading
```

### Core Loading Functions: `frontend/apps/web/app/loaders.ts`

`loadSiteResource()` orchestrates:
1. `getConfig()` - Site configuration lookup
2. `getMetadata()` - Origin home metadata
3. `loadResourceWithDiscovery()` - Main document loading
   - `loadResource()`
     - `resolveResource()` - gRPC call to get document
     - `getDocument()` - Another gRPC call
   - `discoverDocument()` - Fallback if not found
4. `loadResourcePayload()` - Builds full response
   - `getDocument()` - Main document
   - `getLatestDocument()` - Check for newer version
   - `getMetadata()` for authors (parallel)
   - `resolveHMDocument()` for embedded docs (parallel)
   - `getDirectory()` for navigation (parallel)
   - Prefetch context population with React Query

### Key gRPC Calls (via `client.server.ts`)

- `grpcClient.documents.getDocument()`
- `grpcClient.documents.getAccount()`
- `grpcClient.comments.getComment()`
- `grpcClient.subscriptions.*`

### Supporting Files

- `request.ts` - Request parsing
- `cache-policy.ts` - Full render decision
- `site-config.server.ts` - Site config loading
- `queries.server.ts` - React Query SSR context

### React SSR Rendering: `entry.server.tsx`

After the loader completes, Remix calls `handleRequest()` which handles SSR:

```
handleRequest()
  -> parseRequest()
  -> getConfig()
  -> handleFullRequest()
     -> handleBotRequest() or handleBrowserRequest()
        -> renderToPipeableStream(<RemixServer />)
           - onShellReady/onAllReady: React rendering complete
           - pipe(body): Stream HTML to response
           - body.on('end'): Full response sent
```

Key timing points:
1. **Shell rendering** - Time from `renderToPipeableStream()` to `onShellReady`
2. **Full rendering** - Time from shell to `body.on('end')` (streaming)

---

## Implementation Plan

### Phase 1: Create Instrumentation Module

Create `frontend/apps/web/app/instrumentation.server.ts`:

```typescript
import {ENABLE_WEB_INSTRUMENTATION} from '@shm/shared/constants'

export type InstrumentationSpan = {
  name: string
  start: number
  end?: number
  children: InstrumentationSpan[]
  parent?: InstrumentationSpan
}

export type InstrumentationContext = {
  enabled: boolean
  root: InstrumentationSpan
  current: InstrumentationSpan
}

// Create context for a request
export function createInstrumentationContext(requestPath: string): InstrumentationContext

// Start a new span (child of current)
export function startSpan(ctx: InstrumentationContext, name: string): void

// End the current span
export function endSpan(ctx: InstrumentationContext): void

// Wrap an async function with instrumentation
export function instrument<T>(
  ctx: InstrumentationContext,
  name: string,
  fn: () => Promise<T>
): Promise<T>

// Print summary of all timings
export function printInstrumentationSummary(ctx: InstrumentationContext): void
```

### Phase 2: Integrate into Loader

Modify `$.tsx` loader:
1. Create instrumentation context at start
2. Pass context through to loading functions
3. Print summary before returning

### Phase 3: Instrument Key Functions

Add instrumentation calls to:
1. `parseRequest()` - Request parsing
2. `getConfig()` - Config lookup
3. `loadSiteResource()` - Main orchestrator
4. `loadResourceWithDiscovery()` - Document loading
5. `loadResourcePayload()` - Payload building
6. `getDocument()` - gRPC document fetch
7. `getMetadata()` - Metadata fetch
8. `resolveResource()` - Resource resolution
9. React Query prefetching

### Phase 4: Handle Client Navigations

Remix calls loaders for:
- Initial page load (SSR)
- Client-side navigation
- Revalidation after actions

All these go through the same loader, so instrumentation covers them automatically.

---

## Design Decisions

### 1. Context Passing vs AsyncLocalStorage

**Option A: Explicit Context Passing**
- Pass `InstrumentationContext` through function calls
- More explicit, no hidden state
- Requires modifying function signatures

**Option B: AsyncLocalStorage**
- Node.js built-in for request-scoped state
- No function signature changes
- May have edge cases in Remix environment

**Decision: Option A (Explicit Context)** - More predictable, easier to debug

### 2. Span Hierarchy

Track parent-child relationships for nested operations:
```
loadSiteResource: 245ms
  ├─ getConfig: 2ms
  ├─ getMetadata(home): 45ms
  └─ loadResourceWithDiscovery: 198ms
       ├─ resolveResource: 120ms
       │    └─ gRPC.getDocument: 115ms
       └─ loadResourcePayload: 78ms
            ├─ getLatestDocument: 25ms
            ├─ parallel[authors]: 30ms
            └─ parallel[prefetch]: 20ms
```

### 3. Output Format

Print structured summary to console:
```
[INSTRUMENTATION] GET /docs/getting-started
═══════════════════════════════════════════════════
Total: 412ms

LOADER PHASE                         312ms (75.7%)
├─ parseRequest                        1ms  (0.2%)
├─ getConfig                           2ms  (0.5%)
└─ loadSiteResource                  245ms (59.5%)
   ├─ getMetadata(home)               45ms (10.9%)
   └─ loadResourceWithDiscovery      198ms (48.1%)
      ├─ resolveResource             120ms (29.1%)
      │  └─ grpc.getDocument         115ms (27.9%)
      └─ loadResourcePayload          78ms (18.9%)

REACT SSR PHASE                      100ms (24.3%)
├─ shellRendering                     60ms (14.6%)
└─ streamingToEnd                     40ms  (9.7%)
═══════════════════════════════════════════════════
```

---

## Tasks

- [x] Create `instrumentation.server.ts` module
- [x] Add instrumentation context creation in $.tsx loader
- [x] Instrument `getConfig()`
- [x] Instrument `loadSiteResource()` and nested functions
- [x] Instrument React Query prefetching
- [x] Instrument React SSR rendering in `entry.server.tsx`
  - [x] Track shell rendering time (`renderToPipeableStream` -> `onShellReady`)
  - [x] Track full streaming time (shell -> `body.on('end')`)
- [x] Add summary printing after response completes
- [ ] Test with `SEED_INSTRUMENTATION=dev`

---

## Implementation Summary

### Files Modified

1. **`frontend/packages/shared/src/constants.ts`** - Already had `ENABLE_WEB_INSTRUMENTATION`
2. **`frontend/apps/web/app/instrumentation.server.ts`** - NEW: Core instrumentation module
3. **`frontend/apps/web/app/routes/$.tsx`** - Added context creation & instrumentation
4. **`frontend/apps/web/app/loaders.ts`** - Added instrumentation to loading functions
5. **`frontend/apps/web/app/entry.server.tsx`** - Added React SSR instrumentation

### How It Works

1. **Loader Phase**: Context created in `$.tsx` loader, passed through `loadSiteResource()` and nested functions
2. **SSR Phase**: Context stored by request URL, retrieved in `entry.server.tsx` for SSR timing
3. **Summary**: Printed after HTML streaming completes (`body.on('end')`)

### Key Functions Instrumented

Loader phase:
- `getConfig()` - Site config lookup
- `loadSiteResource()` - Main orchestrator
- `getHomeMetadata()` - Origin home metadata
- `loadResourceWithDiscovery()` - Document loading with fallback
- `resolveResource()` - gRPC resource resolution
- `getLatestDocument()` - Version check
- `getAuthors()` - Author metadata (parallel)
- `getEmbeddedDocs()` - Embedded document loading
- `getHomeAndDirectories()` - Navigation data
- `getBreadcrumbs()` - Path hierarchy
- `prefetchCriticalData()` - React Query SSR prefetch
- `prefetchEmbeddedDocs()` - Embedded doc prefetch
- `prefetchAccounts()` - Account prefetch

SSR phase:
- `reactSSR` - Total SSR time
- `shellRendering` - Time to render shell
- `streamToClient` - Time to stream HTML

---

## Questions / Follow-ups

1. Should we also track memory usage?
2. Should parallel operations show as nested or flat?
3. Do we want to track gRPC call counts (e.g., "5 calls to getDocument")?
4. Should there be a threshold for "slow" operations to highlight?

---

## Notes

- Flag check: `ENABLE_WEB_INSTRUMENTATION` reads `process.env.SEED_INSTRUMENTATION === 'dev'`
- All instrumentation code should be no-op when disabled for zero overhead
- Context passed between loader and SSR via a Map keyed by request URL
- Summary printed after HTML streaming completes, includes both loader and SSR phases
