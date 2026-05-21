# Architecture overview

Status: current.

Seed is a decentralized knowledge collaboration system with desktop and web clients, a local Go daemon, signed
content-addressed blobs, SQLite indexes, P2P sync/discovery, a remote identity Vault, and notification services.

```text
Desktop UI / Web UI / Vault UI / Notify UI
                |
                v
        gRPC, gRPC-web, HTTP APIs
                |
                v
             Daemon
        /       |        \
      Blob   Storage    P2P / HMNet
    formats  SQLite     Sync / Discovery
       |        |              |
       +--------+--------------+
                |
             Indexes
```

## Runtime components

| Component       | Runtime                | Responsibility                                                                                               | Start here                                                                                     |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Desktop app     | Electron + React       | Local app shell, renderer UI, daemon lifecycle, IPC/tRPC bridge, desktop-only draft and settings stores.     | [`frontend/apps/desktop/README.md`](../../frontend/apps/desktop/README.md)                     |
| Web app         | Remix + React          | Public/read site, SSR loaders, web editing/drafts, daemon HTTP integration, gateway/custom-domain behavior.  | [`frontend/apps/web/README.md`](../../frontend/apps/web/README.md)                             |
| Notify app      | Remix + server runtime | Notification inbox/config/read-state API, email verification, notification email delivery.                   | [`frontend/apps/notify`](../../frontend/apps/notify)                                           |
| Vault           | Bun + React SPA        | Zero-knowledge identity vault, auth methods, encrypted vault data, delegation consent.                       | [`vault/README.md`](../../vault/README.md)                                                     |
| Daemon          | Go                     | gRPC/HTTP API server, blob index, SQLite store, P2P node, sync service, key access, LLM embeddings.          | [`backend/README.md`](../../backend/README.md)                                                 |
| P2P / HMNet     | Go/libp2p              | Peer connectivity, Bitswap/file transfer, sync protocol, discovery status, debug network pages.              | [`backend/hmnet`](../../backend/hmnet), [`backend/hmnet/syncing`](../../backend/hmnet/syncing) |
| Storage / index | Go + SQLite            | Durable local database, schema/migrations, blob storage, structural indexes and search-ish aggregate tables. | [`backend/storage`](../../backend/storage), [`backend/blob`](../../backend/blob)               |

## API surfaces

| Surface                               | Used by                                              | Defined in                                                 | Implemented in                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Documents/Comments/AccessControl gRPC | Desktop, web server, shared TS adapters              | [`proto/documents/v3alpha`](../../proto/documents/v3alpha) | [`backend/api/documents/v3alpha`](../../backend/api/documents/v3alpha)                                                                                                         |
| Entities and discovery gRPC           | Desktop discovery/subscription flows, web API routes | [`proto/entities/v1alpha`](../../proto/entities/v1alpha)   | [`backend/api/entities/v1alpha`](../../backend/api/entities/v1alpha)                                                                                                           |
| Activity/subscriptions gRPC           | Desktop subscriptions and activity feed              | [`proto/activity/v1alpha`](../../proto/activity/v1alpha)   | [`backend/api/activity/v1alpha`](../../backend/api/activity/v1alpha)                                                                                                           |
| Daemon admin/key/vault gRPC           | Desktop settings/onboarding, local dev tooling       | [`proto/daemon/v1alpha`](../../proto/daemon/v1alpha)       | [`backend/api/daemon/v1alpha`](../../backend/api/daemon/v1alpha)                                                                                                               |
| Daemon HTTP/file/debug                | Web app, desktop/web local clients, debug pages      | Go handlers                                                | [`backend/daemon/http.go`](../../backend/daemon/http.go), [`backend/hmnet/http_debug*.go`](../../backend/hmnet)                                                                |
| Web Remix routes                      | Browsers and gateway integrations                    | Remix route files                                          | [`frontend/apps/web/app/routes`](../../frontend/apps/web/app/routes)                                                                                                           |
| Notify Remix routes                   | Desktop/web notification clients and email links     | Remix route files                                          | [`frontend/apps/notify/app/routes`](../../frontend/apps/notify/app/routes)                                                                                                     |
| Desktop IPC/tRPC                      | Electron renderers                                   | TypeScript routers/bridges                                 | [`frontend/apps/desktop/src/app-trpc.ts`](../../frontend/apps/desktop/src/app-trpc.ts), [`frontend/apps/desktop/src/app-ipc.tsx`](../../frontend/apps/desktop/src/app-ipc.tsx) |

## Storage and indexing responsibility

- `backend/storage/schema.sql` is the SQLite schema source of truth.
- `backend/storage/storage_migrations.go` owns migration steps when schema changes.
- `backend/blob/*` owns signed blob formats, decoding, validation, indexing hooks, and visibility propagation.
- `backend/blob/index*.go` and related schema tables turn content-addressed blobs into queryable
  document/resource/comment/capability state.

## Sync and discovery responsibility

- `backend/hmnet` owns libp2p node setup, Bitswap/file transport, peer metadata, relays, debug endpoints, and P2P
  service registration.
- `backend/hmnet/syncing` owns authorized blob sync, discovery scheduling, and sync server behavior.
- `proto/entities/v1alpha/entities.proto` defines discovery request/response semantics used by clients.
- Desktop subscriptions and resource discovery streams are coordinated in `frontend/apps/desktop/src/models/entities.ts`
  and `frontend/apps/desktop/src/app-sync.ts`.

## Identity and vault responsibility

- Account/private key generation, import/export, and daemon key listing live behind the daemon API.
- The local daemon key store and local vault storage live under `backend/core/keystore` and `backend/storage/vault`.
- The remote Vault service under `vault/**` handles zero-knowledge auth, encrypted data, and delegation consent.
- Web delegation/session flows live in `frontend/apps/web/app/auth*`,
  `frontend/apps/web/app/routes/hm.api.delegate-device.tsx`, and the Vault app.

## Notifications responsibility

- Shared notification classification, payloads, titles, and read-state merge logic live under
  `frontend/packages/shared/src/models/notification-*`.
- Desktop local notification sync/read/config state lives under `frontend/apps/desktop/src/app-notification*.ts` and
  `frontend/apps/desktop/src/app-notifications.ts`.
- Web notification UI and API integration live in `frontend/apps/web/app/web-notifications.ts`,
  `frontend/apps/web/app/notifications-page-content.tsx`, and `frontend/apps/web/app/routes/hm.notifications.tsx`.
- The notification service API and persistence live under `frontend/apps/notify/app`.

## Sources of truth

| Concern                        | Source of truth                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proto service contracts        | [`proto/**`](../../proto)                                                                                                                               |
| Generated Go API types         | [`backend/genproto/**`](../../backend/genproto)                                                                                                         |
| Generated TS API types         | Generated package outputs referenced by frontend imports; refresh with [`./dev gen`](../../dev).                                                        |
| DB schema                      | [`backend/storage/schema.sql`](../../backend/storage/schema.sql)                                                                                        |
| DB migrations                  | [`backend/storage/storage_migrations.go`](../../backend/storage/storage_migrations.go)                                                                  |
| Blob formats                   | [`backend/blob/blob_*.go`](../../backend/blob)                                                                                                          |
| Blob visibility/indexing       | [`backend/blob/index*.go`](../../backend/blob), [`backend/storage/schema.sql`](../../backend/storage/schema.sql)                                        |
| TS shared models               | [`frontend/packages/shared/src/**`](../../frontend/packages/shared/src)                                                                                 |
| Low-level Hypermedia TS client | [`frontend/packages/client/src/**`](../../frontend/packages/client/src)                                                                                 |
| Desktop shell/runtime          | [`frontend/apps/desktop/src/main.ts`](../../frontend/apps/desktop/src/main.ts), [`frontend/apps/desktop/src/app-*.ts`](../../frontend/apps/desktop/src) |
| Web SSR and routes             | [`frontend/apps/web/app/routes`](../../frontend/apps/web/app/routes), [`frontend/apps/web/app/loaders.ts`](../../frontend/apps/web/app/loaders.ts)      |
| Vault auth/encryption          | [`vault/src`](../../vault/src)                                                                                                                          |
