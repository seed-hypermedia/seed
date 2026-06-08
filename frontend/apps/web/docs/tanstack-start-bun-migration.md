# TanStack Router + Bun Migration

The detailed migration notes have moved into a dedicated directory:

- [`tanstack-bun-migration/README.md`](./tanstack-bun-migration/README.md)
- [`tanstack-bun-migration/01-status.md`](./tanstack-bun-migration/01-status.md)
- [`tanstack-bun-migration/02-next-steps.md`](./tanstack-bun-migration/02-next-steps.md)
- [`tanstack-bun-migration/03-testing.md`](./tanstack-bun-migration/03-testing.md)
- [`tanstack-bun-migration/04-api-and-routing-differences.md`](./tanstack-bun-migration/04-api-and-routing-differences.md)
- [`tanstack-bun-migration/05-subjective-notes.md`](./tanstack-bun-migration/05-subjective-notes.md)
- [`tanstack-bun-migration/06-iteration-log.md`](./tanstack-bun-migration/06-iteration-log.md)

## Current Snapshot

`@shm/web` now starts through Bun + Vite + TanStack Router rather than Remix. From the repo root:

```sh
pnpm web
```

The TanStack catch-all route is wired to render `WebResourcePage`, with API dispatch handled by Vite dev middleware and
the Bun production server.

See the linked notes for the complete status, testing plan, remaining work, and migration tradeoffs.
