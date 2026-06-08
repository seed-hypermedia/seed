# 05 — Subjective Notes and Tradeoffs

This file is intentionally less mechanical. It captures judgments, preferences, and tradeoffs from the migration so far.

## Prefer Framework-Neutral Core Logic

The best early move was extracting Seed URL parsing out of Remix route modules.

Why it matters:

- Seed's URL model is domain-specific and more important than the router framework.
- Framework routes should adapt to Seed route semantics, not define them.
- Tests for `document-route-path.ts` are valuable regardless of whether the app uses Remix, TanStack Router, or another
  router later.

This pattern should continue for server handlers and metadata conversion.

## Do Not Rush Full SSR Parity

The old Remix SSR code was not generic boilerplate. It had a lot of production-specific behavior.

Trying to port all of it in one pass would likely create subtle bugs. The better path is:

1. Get client-rendered documents loading through TanStack Router.
2. Make API/server routing explicit and reliable.
3. Reintroduce SSR document HTML.
4. Reintroduce metadata/head behavior.
5. Reintroduce custom streaming/instrumentation only where clearly needed.

This is slower but safer.

## TanStack Router Is a Better Fit for the Seed URL Model

The app's URL semantics are not simply a list of routes. The catch-all route parses:

- gateway document paths
- site document paths
- inspect paths
- IPFS inspect paths
- comment suffixes
- activity suffixes
- profile tab suffixes
- version/latest query params

A single TanStack catch-all route with explicit Seed parsing feels more honest than file-route conventions pretending to
own this model.

## Bun Is Working, but Keep Native Dependencies in Mind

Bun is now working for:

- typecheck command execution
- Bun unit tests
- Vite build execution
- serving static output through `Bun.serve()`

But the real risk is not static serving. The real risks are:

- `sharp`
- `better-sqlite3`
- `@connectrpc/connect-node`
- Sentry profiling
- filesystem/image cache behavior
- AsyncLocalStorage under real load

Do not declare the Bun runtime fully production-proven until image/file routes and daemon/API routes are exercised.

## Keep `pnpm` as Package Manager for Now

Even though the app runtime uses Bun, the repo still uses `pnpm` for the main workspace. This split is okay:

- `pnpm` installs and filters workspace packages.
- Bun runs scripts and serves the web app.

Switching the whole workspace package manager would be much higher risk and is not necessary for this migration.

## The Current Bundle Is Too Big, but That Is Acceptable Temporarily

The current TanStack document route imports `WebResourcePage` directly. That pulls in substantial UI/editor
dependencies.

This is acceptable for migration proof-of-life, but should be improved later with:

- lazy loading `WebResourcePage`
- lazy loading editor-heavy features
- route-level code splitting
- preserving the old intent to avoid eager editor bundle loading

Do not optimize bundle size before the route/API/server behavior is correct.

## Avoid Keeping Active Logic in `app/routes/*.tsx`

The current code still imports a few legacy route handlers from `app/routes/*.tsx` through
`app/http-handlers.server.ts`.

That is useful temporarily, but confusing long term. Once behavior is stable, active server code should move to
explicitly named modules like:

- `app/api/handle-api.server.ts`
- `app/api/handle-config.server.ts`
- `app/api/handle-auth.server.ts`
- `app/api/handle-image.server.ts`

Then `app/routes` can either become TanStack route files or disappear entirely.

## Add Router Adapter Hooks Before More Component Ports

Several components still import Remix hooks. Rather than replacing every component with direct TanStack imports, create
app-level hooks:

- `useAppNavigate`
- `useAppLocation`
- `useAppSearchParams`
- `AppLink`

This reduces framework coupling and makes tests easier to update.

## The Migration Is Better Treated as Iterative Replacement, Not Cleanup

It is tempting to delete all Remix code immediately. That may create a cleaner tree, but it also removes useful
behavioral reference points.

Better sequence:

1. Make TanStack/Bun path work.
2. Add tests for the new path.
3. Port or intentionally drop each old route/feature.
4. Delete Remix files only when their replacement is tested or the feature is explicitly removed.

## Be Careful with "Start" Terminology

The user requested TanStack Start/TanStack Router. The current code is firmly on TanStack Router and Bun, but not yet
deeply using TanStack Start SSR primitives.

This distinction should stay explicit in docs and status reports. It avoids overclaiming and makes the next SSR decision
clearer.
