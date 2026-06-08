# 02 — Next Steps

This is the recommended follow-up plan after the current Bun + Vite + TanStack Router migration checkpoint.

## Priority 0 — Confirm Real Document Loading Locally

Before deeper cleanup, verify the real behavior with a daemon running:

1. Start backend/daemon as usual for web development.
2. Start web from repo root:

   ```sh
   pnpm web
   ```

3. Open:

   - `http://localhost:3000/`
   - a known document path
   - a gateway path like `/hm/<uid>/<path>`

4. Confirm in browser devtools:
   - `/hm/api/config` succeeds.
   - `/api/GetResource` or equivalent resource API requests succeed.
   - The document content renders in `WebResourcePage`.

If this fails, debug the `/api/*` middleware path first, then the `WebSiteProvider`/React Query path.

## Priority 1 — Server/API Parity

The minimum API surface is wired, but old Remix had many public route modules. These need either migration or
intentional deletion.

### Keep and Port for Real

- `/api/*`
- `/hm/api/config`
- `/hm/api/auth`
- `/hm/api/resource/*`
- `/hm/api/file/*`
- `/hm/api/image/*`
- `/hm/api/version`

### Evaluate and Port/Stubs

- admin
- discover
- delegate-device
- document-update
- register
- site-image
- content-image

### Recommended Direction

Build a small route table in `app/http-handlers.server.ts` that delegates to framework-neutral handlers. Avoid
continuing to depend on Remix file route naming for active server behavior.

Proposed shape:

```ts
const routes = [
  {method: 'GET', pattern: /^\/hm\/api\/config$/, handler: handleConfig},
  {method: 'POST', pattern: /^\/hm\/api\/auth$/, handler: handleAuth},
  {method: 'GET', pattern: /^\/api\//, handler: handleApiGet},
  {method: 'POST', pattern: /^\/api\//, handler: handleApiPost},
]
```

Then move logic out of `app/routes/*.tsx` into explicitly named server handler modules.

## Priority 2 — Restore SSR and Metadata Deliberately

The current app is client-rendered via Vite SPA mode. Old Remix had meaningful SSR behavior:

- document HTML streaming
- React Query dehydration
- metadata from documents/comments
- bot-specific stream behavior
- instrumentation during SSR

Recommended sequence:

1. Do not immediately restore all custom streaming behavior.
2. First create a Bun server endpoint that returns document loader payloads via `loadDocumentRoute`.
3. Use TanStack Router loaders to fetch that payload client-side.
4. Once client loader behavior is stable, decide between:
   - TanStack Start SSR, or
   - a custom Bun SSR server using React `renderToReadableStream`.

The most valuable old SSR artifact is `ssrContentHTML`, because it improves first paint and SEO. Reintroduce that before
reintroducing bot-specific streaming.

## Priority 3 — Route Cleanup

After real document loading is confirmed:

- Remove or quarantine stale Remix route files from `app/routes`.
- Replace `app/root.tsx`, `app/entry.client.tsx`, and `app/entry.server.tsx` with TanStack/Bun equivalents or delete
  them.
- Move the new TanStack route modules to clearer file names if desired.
- Remove old Remix tests or convert them.

A safe intermediate step is to move stale Remix modules into a `legacy-remix/` directory, but only if imports/tests are
updated and typecheck still passes.

## Priority 4 — Navigation API Wrappers

`providers.tsx` now uses TanStack Router hooks directly. More components still import Remix hooks.

Recommended improvement: introduce a tiny app-level router adapter module, e.g.:

- `app/router-adapter.ts`

It should export:

- `useAppNavigate()`
- `useAppLocation()`
- `useAppSearchParams()`
- `AppLink`

Then component code can depend on app concepts rather than framework packages. This will make future router changes less
invasive.

## Priority 5 — Sentry and Error Boundaries

Current Sentry integration is still Remix-oriented in legacy files.

Next steps:

1. Replace `@sentry/remix` with generic Sentry browser/server integrations.
2. Add TanStack route error components.
3. Preserve error reporting tags from the old root boundary where useful.
4. Confirm source map upload paths use `dist/**/*.map` or the final Bun server output paths.

## Priority 6 — Deployment and Docker

The package scripts now run Bun, but deployment files still need review.

Update:

- `frontend/apps/web/Dockerfile`
- root scripts if any assume `build/server/index.js`
- CI workflows that expect Remix build output
- deployment scripts that expect `build/client` or `build/server`

New production shape is currently:

```sh
pnpm --filter @shm/web build
cd frontend/apps/web
bun server.ts
```

That serves from `frontend/apps/web/dist`.

## Priority 7 — Remove Remix Dependencies

Do this only after stale files are either migrated or removed:

- `@remix-run/node`
- `@remix-run/react`
- `@remix-run/serve`
- `@remix-run/dev`
- maybe `@sentry/remix`
- maybe `remix-utils`

For now, removing them will likely break typecheck because legacy files still import Remix.

## Suggested Next Work Chunk

The best next coding session is:

1. Add `/hm/api/resource/*`, `/hm/api/file/*`, and `/hm/api/image/*` to `app/http-handlers.server.ts`.
2. Add a small integration test around `handleWebApiRequest()` with mocked route handlers.
3. Run `pnpm web` with a real daemon and verify a known document page loads.
4. Start deleting/moving stale Remix route modules only after the real page works.
