# Web app

Status: current.

`@shm/web` is the Remix app that renders public Hypermedia sites, gateway routes, registration/device-link flows, web
notifications, and browser-based document editing.

## Run locally

The easiest local setup runs a daemon and web app together:

```bash
pnpm web:standalone
```

To run only the web app against an already-running daemon:

```bash
pnpm web
```

`pnpm web` sets the default dev daemon ports used by the root script. If you run your own daemon, use those ports or run
the Remix binary directly with custom environment variables:

```bash
./dev run-backend -- -data-dir="$PWD/.dev-data/web" -p2p.port=58000 -http.port=58001 -grpc.port=58002
pnpm web
```

For custom daemon ports, bypass the root `pnpm web` script so its default port assignments do not override your
environment:

```bash
cd frontend/apps/web
SEED_BASE_URL="http://localhost:3099" PORT=3099 DAEMON_HTTP_URL="http://localhost:53001" DAEMON_FILE_URL="http://localhost:53001/ipfs" pnpm exec remix vite:dev
```

## Remix structure

| Area                 | Files                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root/entries         | [`app/root.tsx`](./app/root.tsx), [`app/entry.server.tsx`](./app/entry.server.tsx), [`app/entry.client.tsx`](./app/entry.client.tsx)                                                                               |
| Catch-all site route | [`app/routes/$.tsx`](./app/routes/$.tsx)                                                                                                                                                                           |
| API routes           | [`app/routes/hm.api.*.tsx`](./app/routes)                                                                                                                                                                          |
| Resource rendering   | [`app/web-resource-page.tsx`](./app/web-resource-page.tsx), [`app/web-feed-page.tsx`](./app/web-feed-page.tsx)                                                                                                     |
| SSR loading          | [`app/loaders.ts`](./app/loaders.ts), [`app/queries.server.ts`](./app/queries.server.ts), [`app/client.server.ts`](./app/client.server.ts)                                                                         |
| Universal clients    | [`app/universal-client.tsx`](./app/universal-client.tsx), [`app/server-universal-client.ts`](./app/server-universal-client.ts)                                                                                     |
| Web editing          | [`app/document-edit`](./app/document-edit), [`app/draft-media-db.ts`](./app/draft-media-db.ts)                                                                                                                     |
| Auth/vault           | [`app/auth.tsx`](./app/auth.tsx), [`app/auth-session.ts`](./app/auth-session.ts), [`app/routes/hm.api.delegate-device.tsx`](./app/routes/hm.api.delegate-device.tsx), [`app/vault-links.ts`](./app/vault-links.ts) |
| Notifications        | [`app/web-notifications.ts`](./app/web-notifications.ts), [`app/notifications-page-content.tsx`](./app/notifications-page-content.tsx), [`app/routes/hm.notifications.tsx`](./app/routes/hm.notifications.tsx)     |

See [`docs/ssr-loading-architecture.md`](./docs/ssr-loading-architecture.md) for SSR loader details.

## Daemon connection

The web server talks to a Seed daemon for document/resource data, blob files, discovery, and API operations. Important
environment variables include:

| Variable                | Purpose                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `DAEMON_HTTP_URL`       | Base URL for daemon HTTP APIs when not using only port-based defaults.                  |
| `DAEMON_HTTP_PORT`      | Local daemon HTTP port used by the package `dev`/`start` scripts.                       |
| `DAEMON_FILE_URL`       | URL prefix for daemon-served file/blob content, usually `http://localhost:<port>/ipfs`. |
| `SEED_BASE_URL`         | Public base URL for canonical links and auth/delegation flows.                          |
| `PORT`                  | Remix server port.                                                                      |
| `SEED_IDENTITY_ENABLED` | Enables identity/delegation flows in standalone web runs.                               |
| `SEED_SIGNING_ENABLED`  | Enables signing behavior where supported.                                               |

## Tests and checks

```bash
pnpm --filter @shm/web test
pnpm --filter @shm/web typecheck
pnpm --filter @shm/web format:write
pnpm web:prod
```

For production deployment, use the root deployment scripts and Docker workflow documented from the root
[`README.md`](../../../README.md).
