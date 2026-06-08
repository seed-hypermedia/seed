# 06 — Iteration Log

This is a chronological account of the migration work so far.

## Iteration 1 — Research and Plan

Initial research mapped the Remix app structure:

- `app/root.tsx` owned root document and env injection.
- `app/entry.server.tsx` owned custom SSR and pre-request handling.
- `app/routes/$.tsx` owned the main catch-all document route.
- `app/loaders.ts` owned core document loading and React Query dehydration.
- `app/routes/api.$.tsx` and `hm.api.*` files owned public API/resource routes.

Key conclusion: the main document route was the right first target because it encodes the Seed URL model.

## Iteration 2 — Extract Route Semantics

Added:

- `app/document-route-path.ts`
- `app/document-route-path.test.ts`

Extracted logic for:

- view suffix parsing (`:comments`, `:activity`, profile tabs)
- inspect prefix parsing
- inspect-IPFS parsing
- document loader dependency/revalidation semantics

Why: this made the most important part of `routes/$.tsx` reusable outside Remix.

## Iteration 3 — Extract Document Loader Body

Added:

- `app/document-route-loader.server.ts`

Moved the old main route loader body into a framework-neutral-ish server module, while leaving `routes/$.tsx` as a Remix
adapter.

Why: preserve the old loader behavior for future TanStack loader/SSR integration without keeping all logic in a Remix
route module.

## Iteration 4 — Make SuperJSON Responses Framework-Neutral

Changed:

- `app/wrapping.server.ts`

Added:

- `app/wrapping.server.test.ts`

Replaced Remix `json()`/`TypedResponse` with a standard Web `Response`.

Why: Bun, Vite middleware, TanStack loaders, and custom servers all speak Web Fetch APIs. This reduced unnecessary Remix
coupling.

## Iteration 5 — Switch Scripts and Build Stack to Bun/Vite/TanStack Router

Changed:

- `package.json`
- `vite.config.mts`
- `pnpm-lock.yaml`

Added dependencies:

- `@tanstack/react-router`
- `@tanstack/react-start`
- `@vitejs/plugin-react`
- Vite 7

Updated scripts to use Bun:

- `bunx --bun vite dev`
- `bunx --bun vite build`
- `bunx --bun tsc --noEmit`
- `bun test`
- `bun server.ts`

Why: the user explicitly allowed breaking Remix and asked to continue until the app was firmly on Bun and TanStack
Router.

## Iteration 6 — Add TanStack Router App Entry

Added:

- `index.html`
- `app/main.tsx`
- `app/router.tsx`
- `app/router-utils.ts`

Created a TanStack Router tree with:

- root route
- index route
- catch-all route

The first version rendered a diagnostic shell showing route interpretation.

Why: establish a working non-Remix boot path before wiring the full document UI.

## Iteration 7 — Add Bun Server

Added:

- `server.ts`

The server:

- responds to `/healthz`
- serves `dist` files
- falls back to `index.html` for client-side routes

Why: Vite preview is not a production Bun runtime. A small `Bun.serve()` server makes the runtime explicit.

## Iteration 8 — Add Bun Tests

Added:

- `app/router.bun.test.ts`
- `app/bun-test.d.ts`

The test imports `router-utils`, not the full React route tree, to keep Bun tests focused and fast.

Why: `bun test` should validate something real about the migration without depending on heavy UI modules.

## Iteration 9 — Replace Remix Navigation in Providers

Changed:

- `app/providers.tsx`

Replaced:

- Remix `useNavigate`
- Remix `useLocation`
- Remix `useNavigation`

with TanStack Router equivalents:

- `useNavigate`
- `useLocation`
- `useRouterState`

Also updated navigate call shape from `navigate(href, {replace})` to `navigate({to: href, replace})`.

Why: `WebSiteProvider` is needed by `WebResourcePage`, so it had to work under TanStack Router.

## Iteration 10 — Add API Dispatch for Vite and Bun

Added:

- `app/http-handlers.server.ts`

Changed:

- `vite.config.mts`
- `server.ts`

The dispatcher currently handles:

- `/api/*`
- `/hm/api/config`
- `/hm/api/auth`

Vite dev middleware and Bun server both call the same dispatcher.

Why: once Remix was no longer serving route modules, the app needed an explicit way to serve public API calls.

## Iteration 11 — Replace Remix Cookie Helper

Changed:

- `app/daemon-auth.server.ts`

Removed active dependency on Remix `createCookie` by implementing a minimal local parse/serialize helper.

Why: `/hm/api/auth` and daemon auth context need to work under Bun without Remix server helpers.

## Iteration 12 — Wire `WebResourcePage` into TanStack Route

Changed:

- `app/router.tsx`

The catch-all route now:

- fetches `/hm/api/config`
- computes the document id
- creates `WebSiteProvider`
- renders `WebResourcePage`

Why: this is the main milestone for actually loading documents through TanStack Router.

## Iteration 13 — Fix Build Issues from Workspace Aliases

Vite build failed on editor imports like `@/editor.css` because those imports came from `@shm/editor` but resolved
against the web app alias.

Fixed with targeted aliases:

- `@/editor.css` → editor package CSS
- `@/blocknote` → editor package blocknote directory

Why: broad `@` aliasing is convenient in app code but can conflict with package-internal aliases when source packages
are bundled directly.

## Iteration 14 — Validation Pass

Successful commands:

```sh
pnpm --filter @shm/web typecheck
pnpm --filter @shm/web test
pnpm --filter @shm/web build
```

Also smoke-tested:

```sh
pnpm web
curl http://localhost:3000/
```

and after build:

```sh
PORT=4174 bun server.ts
curl http://localhost:4174/healthz
```

## Current Endpoint

The app is now on the Bun/Vite/TanStack Router boot path and the main document route renders `WebResourcePage`. The next
iteration should prove and harden real document loading against a running daemon, then migrate the remaining API routes
and SSR behavior.
