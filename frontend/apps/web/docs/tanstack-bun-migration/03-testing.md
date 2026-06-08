# 03 — Testing and Validation

## Current Primary Commands

Run these from the repo root.

### Typecheck

```sh
pnpm --filter @shm/web typecheck
```

This runs TypeScript through Bun:

```sh
bunx --bun tsc --noEmit
```

What it proves:

- The new TanStack Router entry compiles.
- The Bun server compiles.
- Legacy Remix files still typecheck for now.
- Vite config/server middleware types are acceptable.

What it does not prove:

- Runtime route behavior.
- Real daemon/API behavior.
- Browser rendering correctness.

### Bun Unit Tests

```sh
pnpm --filter @shm/web test
```

This currently runs:

```sh
bun test app/*.bun.test.ts app/**/*.bun.test.ts
```

Current Bun tests cover:

- `describeDocumentRoute()` for gateway document paths.
- `describeDocumentRoute()` for inspect-IPFS paths.

These tests intentionally import `app/router-utils.ts`, not the full React route tree. This keeps Bun tests fast and
avoids pulling in the entire UI dependency graph.

### Build

```sh
pnpm --filter @shm/web build
```

This runs:

```sh
NODE_ENV=development bunx --bun vite build
```

What it proves:

- Vite 7 can bundle the app.
- The React/TanStack Router entry is valid.
- Workspace aliases are sufficient for a production bundle.
- The editor CSS alias workaround is working.

Known warning:

- Large bundle warnings are expected right now because the first TanStack route imports `WebResourcePage`, which pulls
  in a lot of UI/editor-related code. This should be optimized later with route/component-level lazy imports.

### Bun Server Smoke Test

After build:

```sh
cd frontend/apps/web
PORT=4174 bun server.ts
curl -fsS http://localhost:4174/healthz
```

Expected output:

```txt
ok
```

What it proves:

- Bun can load `server.ts`.
- Basic `Bun.serve()` works.
- Built `dist` can be served by the new server.

What it does not prove:

- API route correctness.
- Document loading.
- Browser hydration.

### Root Dev Server Smoke Test

From repo root:

```sh
pnpm web
```

Then open or request:

```sh
curl -fsS http://localhost:3000/
```

Expected result:

- HTML from Vite dev server.
- Browser should load the TanStack Router app.

## Legacy Vitest Tests

The old Vitest suite is still available:

```sh
pnpm --filter @shm/web test:vitest
```

It is no longer the primary web test command because:

- the app runtime has moved to Bun;
- some tests mock Remix-specific hooks;
- full Vitest-through-Bun had worker compatibility issues;
- several old tests are validating Remix route modules rather than the new TanStack runtime.

Do not delete the old tests casually. They are still valuable as behavioral references and should be converted when the
corresponding feature is migrated.

## Manual Document Loading Test

This is the most important current validation because automated tests do not yet prove real document rendering.

1. Start the backend daemon with the usual local web settings.
2. Run:

   ```sh
   pnpm web
   ```

3. Open:

   ```txt
   http://localhost:3000/
   ```

4. Watch browser network requests:

   - `/hm/api/config`
   - `/api/GetResource` or related resource requests
   - image/file API requests if document content contains media

5. Confirm:

   - config loads;
   - document id is correct;
   - `WebResourcePage` renders content;
   - route navigation within Seed still updates URL and content.

## Recommended Tests to Add Next

### API Dispatcher Tests

Add Bun tests for `app/http-handlers.server.ts` with mocked handler modules or test-only dependency injection.

Cases:

- `/hm/api/config` dispatches to config handler.
- `/hm/api/auth` dispatches to auth handler.
- `GET /api/GetResource?...` dispatches to API loader.
- `POST /api/...` dispatches to API action.
- unknown paths return `null`.

### Router Rendering Smoke Test

Add a browser-oriented test once the test harness is stable:

- render `AppRouter` with a fake location;
- mock `/hm/api/config`;
- mock resource client calls;
- assert `WebResourcePage` receives expected `docId`.

### Real Document E2E Test

Longer term, add Playwright or existing integration coverage:

- start backend;
- start `pnpm web`;
- navigate to a known fixture doc;
- assert content is visible.

This is the test that will really prove migration success.

## Known Testing Gaps

- No automated test currently verifies real browser document rendering through `WebResourcePage`.
- No automated test currently verifies `/api/*` calls against a running daemon.
- No automated test currently verifies auth cookie behavior in Bun.
- No automated test currently verifies production static fallback route behavior beyond `/healthz`.
- Legacy Remix route tests have not been converted to TanStack Router.
