# Seed Hypermedia frontend monorepo

Status: current.

The frontend workspace contains Electron, Remix apps, shared product models, editor/UI packages, and the low-level
TypeScript Hypermedia client. Use `pnpm` from the repo root for this subtree.

## App and package map

| Path                                             | Package                   | Purpose                                                                                    |
| ------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------ |
| [`apps/web`](./apps/web/README.md)               | `@shm/web`                | Remix public/site web app, SSR loaders, web editing, daemon HTTP integration.              |
| [`apps/desktop`](./apps/desktop/README.md)       | `@shm/desktop`            | Electron desktop app, daemon lifecycle, main/preload/renderer shell, desktop-only storage. |
| [`apps/notify`](./apps/notify/README.md)         | `@shm/notify`             | Notification service routes, email verification, inbox/config/read state.                  |
| [`packages/shared`](./packages/shared/README.md) | `@shm/shared`             | Shared API adapters, routes, query models, document machine, notification/domain models.   |
| [`packages/client`](./packages/client/README.md) | `@seed-hypermedia/client` | Low-level Hypermedia signing, imports, blob payload helpers, type schemas.                 |
| [`packages/editor`](./packages/editor/README.md) | `@shm/editor`             | TipTap/BlockNote document editor, readonly viewer, comment editor, editor extensions.      |
| [`packages/ui`](./packages/ui)                   | `@shm/ui`                 | Shared React UI components and resource/document surfaces.                                 |

## Development

```bash
pnpm install
pnpm web              # web app dev server only
pnpm web:standalone   # local daemon + web app
pnpm desktop          # Electron app; ./dev run-desktop is usually preferred
pnpm notify:standalone
```

Prefer root `./dev` commands when they exist because they build required generated artifacts and daemon binaries first:

```bash
./dev run-desktop
./dev run-web
./dev build-desktop
./dev build-web
```

## Checks

```bash
pnpm typecheck
pnpm test
pnpm audit
pnpm format:write
```

For targeted work, use package filters, for example `pnpm --filter @shm/web test` or
`pnpm --filter @shm/shared typecheck`.
