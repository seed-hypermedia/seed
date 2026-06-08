# 01 — Current Status

## What Changed So Far

### Runtime and Build

`frontend/apps/web/package.json` now uses Bun for the primary web app commands:

- `dev`: `bunx --bun vite dev`
- `build`: `NODE_ENV=development bunx --bun vite build`
- `start`: `bun server.ts`
- `start:prod`: `bun server.ts`
- `typecheck`: `bunx --bun tsc --noEmit`
- `test`: `bun test app/*.bun.test.ts app/**/*.bun.test.ts`

From the repo root, the existing command still works:

```sh
pnpm web
```

That command enters `frontend/apps/web` and runs the package `dev` script, so it now starts the Bun/Vite/TanStack Router
app instead of Remix.

### Vite

`frontend/apps/web/vite.config.mts` no longer installs the Remix Vite plugin. It now uses Vite 7 with:

- `@vitejs/plugin-react`
- `@tailwindcss/vite`
- `vite-tsconfig-paths`
- `vite-plugin-commonjs`
- the existing workspace aliases for `@shm/shared`, `@shm/editor`, `@shm/ui`, and `@seed-hypermedia/client`
- a small dev-server middleware that handles `/api/*` and `/hm/api/*`

The Vite config also has targeted aliases for editor CSS imports that historically relied on Remix/workspace behavior:

- `@/editor.css`
- `@/blocknote`

### TanStack Router Entry

New app entry files:

- `index.html`
- `app/main.tsx`
- `app/router.tsx`
- `app/router-utils.ts`

`app/router.tsx` creates a TanStack Router tree with:

- a root route
- an index route
- a catch-all route (`$`)

The catch-all route is currently the main web document route.

### Main Document Page

The TanStack Router catch-all route now:

1. Parses the current splat path with `describeDocumentRoute()`.
2. Loads site config from `/hm/api/config`.
3. Builds the document id with `hmId()`.
4. Creates a `WebSiteProvider` with an initial Seed navigation route.
5. Renders `WebResourcePage`.

This means document loading now happens through the existing client/query path rather than Remix route loader data.

### API Handling

A new framework-neutral API dispatcher exists at:

- `app/http-handlers.server.ts`

It handles the routes required for the TanStack app to load documents and authenticate daemon requests:

- `/api/*`
- `/hm/api/config`
- `/hm/api/auth`

It is used by:

- the Vite dev middleware in `vite.config.mts`
- the Bun production/static server in `server.ts`

### Bun Static Server

`server.ts` uses `Bun.serve()` to:

- respond to `/healthz`
- handle framework-neutral API routes
- serve `dist` assets
- fall back to `dist/index.html` for client-side TanStack Router paths

### Framework-Neutral Extraction

These files were added/extracted to reduce Remix coupling:

- `app/document-route-path.ts`
- `app/document-route-path.test.ts`
- `app/document-route-loader.server.ts`
- `app/wrapping.server.ts`
- `app/wrapping.server.test.ts`

`document-route-loader.server.ts` preserves much of the old Remix route loader body for future server-side integration,
even though the current TanStack page loads via client-side API calls.

## What Should Already Work

With backend daemon/config available, these should work or at least be wired to the right route/data path:

- Starting with `pnpm web` from repo root.
- Opening the web app at `http://localhost:3000`.
- Loading the site root document path.
- Loading normal site document paths like `/some/path`.
- Loading gateway-style document paths like `/hm/<uid>/some/path`.
- Parsing document view suffixes like `:comments`, `:activity`, and profile tab suffixes.
- Browser-side document data requests through `/api/*`.
- Browser-side daemon auth/config requests through `/hm/api/config` and `/hm/api/auth`.
- Production-ish static serving after `pnpm --filter @shm/web build` via `bun server.ts`.

## What Is Still Not Complete

The app is not yet fully equivalent to the old Remix app. Missing/incomplete areas include:

- SSR document HTML and React Query dehydration.
- Remix `entry.server.tsx` pre-handler parity:
  - OPTIONS metadata responses
  - `/ipfs/*` proxying
  - security headers
  - frame/CSP policies
  - trailing slash redirects
  - well-known/favicons behavior
- Full public API route migration beyond the minimum currently routed endpoints.
- Sentry migration away from `@sentry/remix`.
- Root metadata/head behavior parity.
- Notification/connect/device-link/download pages as TanStack routes.
- Replacing or deleting stale Remix route files.
- Updating Dockerfile/deployment to use the Bun server.
- Reestablishing robust integration/e2e test coverage for real document loading.

## Important Current Caveat

There are still many files importing Remix. The running app no longer uses Remix for its main boot path, but the
repository has not yet been cleaned of Remix-era route modules, entry files, tests, and Sentry integration.
