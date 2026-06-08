# TanStack Router + Bun Migration Notes

This directory captures the current state of the `@shm/web` migration away from Remix and toward Bun + Vite + TanStack
Router.

## Reading Order

1. [`01-status.md`](./01-status.md) — what changed, what should already work, and the current architecture.
2. [`02-next-steps.md`](./02-next-steps.md) — concrete follow-up work, organized by priority.
3. [`03-testing.md`](./03-testing.md) — validation commands, what each command proves, and known gaps.
4. [`04-api-and-routing-differences.md`](./04-api-and-routing-differences.md) — Remix vs TanStack/Bun API differences
   encountered so far.
5. [`05-subjective-notes.md`](./05-subjective-notes.md) — tradeoffs, opinions, and design notes that are not purely
   mechanical.
6. [`06-iteration-log.md`](./06-iteration-log.md) — chronological implementation iterations and why they happened.

## Current High-Level Summary

The web app is no longer started through Remix. `pnpm web` at the repo root still works, but now resolves to
`frontend/apps/web` and starts Vite through Bun:

```sh
pnpm web
```

The app now boots through:

- `frontend/apps/web/index.html`
- `frontend/apps/web/app/main.tsx`
- `frontend/apps/web/app/router.tsx`
- `@tanstack/react-router`
- `frontend/apps/web/vite.config.mts`
- Bun-powered package scripts in `frontend/apps/web/package.json`

The main document catch-all route is implemented in TanStack Router and renders `WebResourcePage` through
`WebSiteProvider`. Public API access for document data is routed through a framework-neutral handler path used by both
Vite dev middleware and `server.ts`.

## Important Scope Note

This migration is not fully production-complete yet. The app can boot and the document page is wired through TanStack
Router, but several Remix-era pieces are still present as compatibility/reference code and need deliberate follow-up
work before the web app should be considered fully migrated for deployment.
