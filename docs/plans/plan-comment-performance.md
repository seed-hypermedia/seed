# Plan: Web Comment Performance — Instrumentation + Optimization

## Context

The web app (Remix + React Query + TipTap) suffers from multi-second delays on
every interaction: opening the comments panel, clicking reply, submitting
comments, and navigating between pages. The root cause is architectural — panel
state changes trigger full Remix loader round-trips with sequential gRPC calls.

### Existing infrastructure we will build on

| Asset | Location | Status |
|-------|----------|--------|
| Server instrumentation (span tree) | `frontend/apps/web/app/instrumentation.server.ts` | Working, opt-in via `SEED_INSTRUMENTATION=dev` |
| Performance test runner (Playwright) | `frontend/apps/performance/` | Electron-focused, web scenarios are stubs |
| Performance dashboard | `frontend/apps/performance-dashboard/` | Has web tab but only tracks LCP/INP/CLS/TTFB from Lighthouse |
| Compare tool | `frontend/apps/performance/src/compare-performance.ts` | Compares two JSON snapshots, generates HTML diff |
| Performance budgets | `frontend/apps/performance/src/performance-budgets.ts` | Electron-only budgets, no web interaction budgets |

---

## Phase 0 — Baseline Benchmarks (before any code changes)

### 0.1 Add client-side performance marks

Add a lightweight `WebVitalsReporter` module in the web app that uses the
browser Performance API (`performance.mark` / `performance.measure`) to track:

- **Panel open time**: mark when user clicks "Comments" → measure when panel
  content first renders (via a `useEffect` in `WebDiscussionsPanel`)
- **Comment submit time**: mark on submit click → measure when mutation
  `onSuccess` fires
- **Navigation time**: mark on `openRoute` call → measure when the new route's
  `useEffect` fires (or Remix `navigation.state` transitions from `loading` →
  `idle`)
- **Comment editor ready time**: mark when `clientLazy` starts loading →
  measure when `CommentEditor` mounts

File: `frontend/apps/web/app/web-perf-marks.ts`

These marks are zero-cost in production (just `performance.mark` calls) and can
be read by Playwright or any DevTools session.

### 0.2 Add Playwright-based web interaction scenarios

Extend `frontend/apps/performance/src/scenarios.ts` with concrete web scenarios
that use a running web app instance:

- `web-page-load`: Navigate to a document page, measure LCP/FCP/TTI
- `web-open-comments-panel`: Click the comments button, measure time to panel
  content visible
- `web-submit-comment`: Type in the editor, submit, measure time to comment
  appearing in the list
- `web-navigate-between-docs`: Click a link to a different document, measure
  navigation complete time
- `web-reply-to-comment`: Open a comment thread, click reply, measure time to
  editor ready

Each scenario collects `performance.getEntriesByType('measure')` from the page
to read the marks from step 0.1.

### 0.3 Add web performance budgets

Extend `performance-budgets.ts` with web-specific budgets:

| Metric | Budget | Severity |
|--------|--------|----------|
| Panel open time | < 300ms | error |
| Comment submit round-trip | < 1000ms | error |
| Client-side navigation | < 500ms | warning |
| Comment editor ready | < 500ms | warning |
| Page LCP (desktop) | < 2500ms | error |
| Page LCP (mobile) | < 4000ms | warning |
| CLS | < 0.1 | error |
| JS bundle size (main) | < 500KB gzipped | warning |

### 0.4 Capture baseline snapshot

Run the new scenarios against the current codebase and save a baseline JSON
file to `frontend/apps/performance-dashboard/public/results/web/`. This becomes
the "before" for all subsequent comparisons.

---

## Phase 1 — Critical Fixes (P0)

### 1.1 Add `shouldRevalidate` to the splat route

**File**: `frontend/apps/web/app/routes/$.tsx`

Export a `shouldRevalidate` function that returns `false` when only panel-related
search params change (e.g., `?panel=comments`). This prevents the Remix loader
from re-running when the user opens/closes a panel or switches panel type.

```ts
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }) {
  // Same pathname, only search params changed
  if (currentUrl.pathname === nextUrl.pathname) {
    // Check if the meaningful params (v, l) changed
    const currentV = currentUrl.searchParams.get('v')
    const nextV = nextUrl.searchParams.get('v')
    const currentL = currentUrl.searchParams.get('l')
    const nextL = nextUrl.searchParams.get('l')
    if (currentV === nextV && currentL === nextL) {
      return false // Only panel/view params changed
    }
  }
  return defaultShouldRevalidate
}
```

**Expected impact**: Eliminates server round-trip on panel open/close.
Panel open time should drop from ~2-3s to ~50-100ms.

### 1.2 Enable build minification

**File**: `frontend/apps/web/vite.config.mts`

Change `build: {minify: false, sourcemap: true}` to `build: {minify: true, sourcemap: true}`.

**Expected impact**: ~50-60% smaller JS bundles, faster initial load.

### 1.3 Re-run benchmarks, compare

Run the same Playwright scenarios from Phase 0 and use
`compare-performance.ts` to generate a before/after report. Verify:
- Panel open time dropped significantly
- No regressions in other metrics

---

## Phase 2 — Comment Interaction Fixes (P1)

### 2.1 Remove double lazy-loading of comment editor

**File**: `frontend/apps/web/app/client-lazy.tsx` + `commenting.tsx`

The `clientLazy()` wrapper already handles client-only rendering. Remove the
inner `<ClientOnly>` wrapper from `commenting.tsx` to eliminate one extra render
cycle with null output.

### 2.2 Scope query invalidation after comment post

**File**: `frontend/apps/web/app/commenting.tsx`

Change the 7 broad `invalidateQueries` calls to scope them to the current
document:

```ts
queryClient.invalidateQueries({
  queryKey: [queryKeys.DOCUMENT_COMMENTS, docId],
})
```

This prevents refetching comment data for all documents in the cache.

### 2.3 Add optimistic comment insertion

After the comment mutation succeeds (the API returns the full comment in
`CommentResponsePayload`), immediately insert it into the React Query cache
via `queryClient.setQueryData` before the invalidation refetch completes.
This gives instant visual feedback.

### 2.4 Preload comment editor on hover

Add `onMouseEnter={() => import('./commenting')}` to the Comments panel
toggle button so the editor chunk starts loading before the user clicks.

### 2.5 Re-run benchmarks, compare against Phase 1 baseline

Verify:
- Comment submit round-trip time improved
- Comment editor ready time improved
- No regressions

---

## Phase 3 — Navigation & Architecture (P2)

### 3.1 Move providers to a Remix layout route

Create `frontend/apps/web/app/routes/_app.tsx` as a layout route that renders
`WebSiteProvider` and `CommentsProvider`. Move the splat route to
`_app.$.tsx`. This prevents provider remount on navigation.

### 3.2 Tune React Query defaults

**File**: `frontend/apps/web/app/providers.tsx`

Change `staleTime: Infinity` to `staleTime: 30_000` and `refetchOnMount: true`.
This allows React Query to serve cached data instantly while refetching in the
background, giving users fresh data without blocking renders.

### 3.3 Use Remix `<Link prefetch="intent">` where possible

Audit navigation patterns and replace programmatic `navigate()` calls with
`<Link prefetch="intent">` for document links in navigation, breadcrumbs, and
directory listings. This prefetches route data on hover.

### 3.4 Re-run benchmarks, compare against Phase 2 baseline

Verify:
- Client-side navigation time improved
- No regressions

---

## Phase 4 — Bundle Optimization (P3)

### 4.1 Run bundle analyzer

Uncomment the `analyzer` plugin in `vite.config.mts` and generate a bundle
report. Identify the largest chunks.

### 4.2 Code-split TipTap/ProseMirror

Ensure the TipTap editor and its 13 extensions are only loaded when the user
opens a comment editor, not on initial page load. The `clientLazy` pattern
already partially handles this — verify it's effective by checking the
generated chunks.

### 4.3 Verify server-only imports

Ensure `sharp`, `libp2p`, IPFS, and other server-only deps don't leak into
the client bundle. Use Remix's `serverOnly$()` macro or `.server.ts` file
naming where needed.

### 4.4 Use `defer()` for Wave 3 prefetch data

In `loaders.ts`, use Remix's `defer()` for card-view query block resources
(Wave 3) so the page can render while this data loads in the background.

### 4.5 Final benchmark run + regression check

Run all scenarios, compare against Phase 0 baseline to show cumulative
improvement. Generate final report.

---

## Continuous Measurement Infrastructure

### CI Integration

Add a script `frontend/apps/performance/src/run-web-perf.ts` that:

1. Starts the web app in dev/production mode
2. Runs all web scenarios from Phase 0.2
3. Saves results JSON to the dashboard's `public/results/web/` directory
4. Runs `compare-performance.ts` against the previous baseline
5. Exits with code 1 if any error-severity budget is violated

This script can be called from CI or locally via:
```
pnpm --filter @shm/performance run test:web
```

### Dashboard updates

Extend the performance dashboard's `WebPerformance.tsx` to show the new
interaction metrics (panel open time, comment submit time, navigation time)
alongside the existing Core Web Vitals.

### Developer workflow

Add `SEED_PERF_MARKS=1` env var that enables console logging of all
performance marks/measures in the browser console during development, so
developers can see timing data without opening DevTools Performance tab.

---

## Summary of files to create/modify

### New files
- `frontend/apps/web/app/web-perf-marks.ts` — Client-side performance marks
- `frontend/apps/performance/src/web-scenarios.ts` — Playwright web scenarios
- `frontend/apps/performance/src/run-web-perf.ts` — Web perf test runner

### Modified files
- `frontend/apps/web/app/routes/$.tsx` — Add `shouldRevalidate`
- `frontend/apps/web/vite.config.mts` — Enable minification
- `frontend/apps/web/app/client-lazy.tsx` — Remove double lazy-loading
- `frontend/apps/web/app/commenting.tsx` — Scope invalidation + optimistic updates
- `frontend/apps/web/app/providers.tsx` — Tune React Query defaults
- `frontend/apps/web/app/discussions-panel.tsx` — Add perf marks
- `frontend/packages/ui/src/resource-page-common.tsx` — Add perf marks + preload
- `frontend/apps/performance/src/performance-budgets.ts` — Add web budgets
- `frontend/apps/performance/src/scenarios.ts` — Register web scenarios
- `frontend/apps/performance-dashboard/src/components/WebPerformance.tsx` — New metrics
