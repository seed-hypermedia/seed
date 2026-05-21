# Desktop app

Status: current.

`@shm/desktop` is the Electron app for local reading, editing, publishing, syncing, and account management. It starts a
local daemon unless configured otherwise, then exposes app-specific services to renderer windows through preload, IPC,
and tRPC.

## Architecture

| Area               | Files                                                                                                                                                                                                  | Notes                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Main process entry | [`src/main.ts`](./src/main.ts)                                                                                                                                                                         | Boots Electron, daemon, stores, windows, menus, notification sync, and app services.   |
| Daemon lifecycle   | [`src/daemon.ts`](./src/daemon.ts), [`src/daemon-path.ts`](./src/daemon-path.ts), [`src/grpc-client.ts`](./src/grpc-client.ts)                                                                         | Builds/locates/runs `seed-daemon` and creates gRPC clients for renderer-facing models. |
| Preload            | [`src/preload.ts`](./src/preload.ts), related `preload-*.ts` files                                                                                                                                     | Safe bridge from isolated renderers to Electron APIs.                                  |
| Renderer entry     | [`src/renderer.ts`](./src/renderer.ts), [`src/root.tsx`](./src/root.tsx)                                                                                                                               | React app root and renderer initialization.                                            |
| App services       | [`src/app-*.ts`](./src)                                                                                                                                                                                | Main-process services and stores. Prefer extending an existing `app-*.ts` by domain.   |
| IPC/tRPC           | [`src/app-ipc.tsx`](./src/app-ipc.tsx), [`src/app-trpc.ts`](./src/app-trpc.ts), [`src/trpc.ts`](./src/trpc.ts)                                                                                         | Renderer-to-main typed bridge. Keep payloads serializable.                             |
| Models             | [`src/models`](./src/models)                                                                                                                                                                           | Renderer hooks and data models around gRPC/tRPC/shared package APIs.                   |
| Pages              | [`src/pages`](./src/pages)                                                                                                                                                                             | Top-level route/page components.                                                       |
| Components         | [`src/components`](./src/components)                                                                                                                                                                   | Desktop-specific UI pieces; shared UI should live in `@shm/ui` when reusable.          |
| Navigation         | [`src/models/navigation.ts`](./src/models/navigation.ts), [`src/utils/navigation-container.tsx`](./src/utils/navigation-container.tsx), [`src/assistant-navigation.ts`](./src/assistant-navigation.ts) | Route state, navigation helpers, assistant-aware navigation.                           |

## Conventions

- `app-*.ts` files are main-process service boundaries for stores, background jobs, IPC/tRPC routers, and OS
  integration.
- `models/*.ts` files are renderer-facing hooks/models; keep direct Electron/main process usage out of React components
  unless bridged.
- Desktop draft state lives in [`src/app-drafts.ts`](./src/app-drafts.ts); web drafts use a different IndexedDB path.
- Notification architecture has a dedicated map in
  [`src/NOTIFICATIONS_DESKTOP_ARCHITECTURE.md`](./src/NOTIFICATIONS_DESKTOP_ARCHITECTURE.md).
- Prefer shared code in `frontend/packages/shared`, `frontend/packages/ui`, or `frontend/packages/editor` only when web
  and desktop genuinely share behavior.

## Commands

From the repo root:

```bash
./dev run-desktop
./dev run-desktop-mainnet
./dev build-desktop
pnpm desktop:test:unit
pnpm desktop:test
pnpm --filter @shm/desktop typecheck
pnpm --filter @shm/desktop format:write
```
