# @shm/shared

Status: current.

`@shm/shared` owns TypeScript behavior shared by desktop, web, notify, editor, and UI packages. Put code here when it
represents product/domain logic used across app surfaces, not app-specific shell behavior.

## Ownership map

| Area                        | Files                                                                                                                                                                                                                                                                | Notes                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| API adapters                | [`src/api-*.ts`](./src)                                                                                                                                                                                                                                              | Typed wrappers and transformations around daemon/web API responses.          |
| Universal client            | [`src/universal-client.ts`](./src/universal-client.ts), [`src/create-web-universal-client.ts`](./src/create-web-universal-client.ts), [`src/grpc-client.ts`](./src/grpc-client.ts)                                                                                   | Cross-runtime client abstractions consumed by web/desktop/shared models.     |
| Routes and navigation types | [`src/routes.ts`](./src/routes.ts), [`src/routing.tsx`](./src/routing.tsx), [`src/validated-route-link.tsx`](./src/validated-route-link.tsx)                                                                                                                         | Shared route shapes, parsing, validated links.                               |
| Document machine            | [`src/models/document-machine.ts`](./src/models/document-machine.ts), [`src/models/use-document-machine.ts`](./src/models/use-document-machine.ts), [`src/models/document-machine-inspect.ts`](./src/models/document-machine-inspect.ts)                             | Shared document lifecycle state machine and React bindings.                  |
| Query ownership             | [`src/models/query-client.ts`](./src/models/query-client.ts), [`src/models/query-keys.ts`](./src/models/query-keys.ts), [`src/request-cache.ts`](./src/request-cache.ts)                                                                                             | Query key conventions, cache helpers, SSR/client request caching.            |
| Document/content helpers    | [`src/document-utils.ts`](./src/document-utils.ts), [`src/document-to-text.ts`](./src/document-to-text.ts), [`src/html-to-blocks.ts`](./src/html-to-blocks.ts), [`src/utils/document-changes.ts`](./src/utils/document-changes.ts), [`src/blobs.ts`](./src/blobs.ts) | Transformations shared by editor, web, desktop, and tests.                   |
| Comments                    | [`src/comments-service-provider.tsx`](./src/comments-service-provider.tsx), [`src/models/comments.ts`](./src/models/comments.ts), [`src/optimistic-comment.ts`](./src/optimistic-comment.ts)                                                                         | Shared comment fetching, optimistic state, navigation behavior.              |
| Notifications               | [`src/models/notification-*.ts`](./src/models)                                                                                                                                                                                                                       | Notification payloads, event classification, titles, read-state merge logic. |
| Discovery/search            | [`src/discovery.ts`](./src/discovery.ts), [`src/models/search.ts`](./src/models/search.ts), [`src/api-search.ts`](./src/api-search.ts)                                                                                                                               | Shared discovery helpers and search models.                                  |

## Guidelines

- Keep app shell concerns out of this package. Electron main process code belongs in `frontend/apps/desktop`; Remix
  server-only behavior belongs in `frontend/apps/web` or `frontend/apps/notify`.
- Prefer tests for domain logic in `src/__tests__` or colocated `*.test.ts` files.
- Do not duplicate normalization deep inside models; system-boundary code should pass canonical values into shared
  internals.

## Commands

```bash
pnpm --filter @shm/shared test
pnpm --filter @shm/shared typecheck
pnpm --filter @shm/shared build:types
pnpm --filter @shm/shared format:write
```
