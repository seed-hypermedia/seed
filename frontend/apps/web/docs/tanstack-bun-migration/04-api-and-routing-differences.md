# 04 — API and Routing Differences

This document lists concrete API differences encountered during the Remix → TanStack Router + Bun migration.

## Routing Model

### Remix

Remix used file routes under `app/routes` and route modules exported framework APIs:

```ts
export const loader = async ({request, params}) => {}
export const action = async ({request, params}) => {}
export const meta = () => []
export const headers = () => new Headers()
export default function RouteComponent() {}
```

The main document page lived in:

- `app/routes/$.tsx`
- `app/routes/_index.tsx`

The splat path was available as `params['*']`.

### Current TanStack Router Path

The current app uses manual TanStack Router route creation in `app/router.tsx`:

```ts
const rootRoute = createRootRoute(...)
const indexRoute = createRoute(...)
const catchAllRoute = createRoute({ path: '$', ... })
```

The splat path is read from TanStack params:

```ts
const params = useParams({strict: false}) as {_splat?: string}
```

A utility converts this into the old Seed route interpretation shape:

- `app/router-utils.ts`
- `describeDocumentRoute()`

## Loader/Data Differences

### Remix Loader Data

Old route loading used server-side Remix loaders:

```ts
export const loader = async ({params, request}) => {
  return loadDocumentRouteWithAuth({params, request})
}
```

The component read data with:

```ts
const data = unwrap(useLoaderData())
```

This enabled SSR data loading and React Query dehydration in the server-rendered response.

### Current TanStack Router Data Path

The current TanStack route does not yet use a TanStack route loader for document payloads. It renders `WebResourcePage`,
and the existing client-side data path fetches resources through `/api/*`.

Current flow:

1. TanStack route parses URL.
2. Browser fetches `/hm/api/config`.
3. Route builds `docId`.
4. `WebSiteProvider` and `WebResourcePage` render.
5. Existing resource/query hooks fetch via the universal client and `/api/*`.

This is less complete than Remix SSR, but it is a pragmatic intermediate step that makes documents load through TanStack
Router without first rebuilding all SSR behavior.

## Navigation Hook Differences

### Remix

`providers.tsx` used:

```ts
import {useLocation, useNavigate, useNavigation} from '@remix-run/react'
```

- `useNavigate()` accepted strings directly.
- `useNavigation().state === 'loading'` exposed loading state.
- `useLocation()` returned pathname/search.

### TanStack Router

`providers.tsx` now uses:

```ts
import {useLocation, useNavigate, useRouterState} from '@tanstack/react-router'
```

Important call shape difference:

```ts
// Remix
navigate(href, {replace})

// TanStack Router
navigate({to: href, replace})
```

Loading state now uses router status:

```ts
const routerStatus = useRouterState({select: (state) => state.status})
const isNavigating = routerStatus === 'pending'
```

## Server Response Differences

### Remix `json()`

Old `wrapJSON()` imported Remix response helpers:

```ts
import {json, TypedResponse} from '@remix-run/node'
```

### Web `Response`

`wrapJSON()` now returns a standard Web `Response`:

```ts
return new Response(JSON.stringify(serialize(value)), {
  ...resp,
  headers,
})
```

This works in Bun, Vite middleware, and any Web Fetch-compatible server.

## Cookie Differences

### Remix Cookie Helper

Old daemon auth used:

```ts
import {createCookie} from '@remix-run/node'
```

### Local Cookie Helper

`daemon-auth.server.ts` now implements the minimal parse/serialize behavior needed for the daemon auth token cookie.

This avoids dragging Remix into active Bun server code.

Current behavior preserves:

- cookie name switching in production (`__Host-HM-Auth-Token` vs `HM-Auth-Token`)
- `Path=/`
- `HttpOnly`
- `SameSite=Lax`
- `Secure` in production
- explicit `Expires`

## Dev Server Middleware vs Remix Resource Routes

### Remix

Remix automatically exposed route module loaders/actions as HTTP endpoints.

### Current Vite/Bun

The active HTTP API path is explicit:

- `app/http-handlers.server.ts` dispatches API requests.
- `vite.config.mts` installs middleware during dev.
- `server.ts` calls the same dispatcher in production/static serving.

This is more manual, but it makes API ownership clearer and framework-neutral.

## Bun Differences

### Bun Tests

`bun test` uses `bun:test`, not Vitest. A small declaration file exists:

- `app/bun-test.d.ts`

This lets TypeScript understand `bun:test` without globally adding Bun types, which caused unrelated
`Uint8Array<ArrayBufferLike>` type incompatibilities.

### Bun Server

`server.ts` uses:

```ts
Bun.serve({ fetch(request) { ... } })
Bun.file(...)
```

This is intentionally simple and does not yet implement all of the old Remix server behavior.

## TanStack Start vs TanStack Router

The dependency `@tanstack/react-start` is installed, but the current running app is best described as:

- Bun
- Vite
- React
- TanStack Router
- custom Bun server

It is not yet a full TanStack Start SSR application. That was an intentional simplification to get the app booting and
documents loading through TanStack Router first.

A future iteration can decide whether to use TanStack Start for SSR/server integration or keep a custom Bun server.
