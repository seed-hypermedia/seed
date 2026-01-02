# Frontend Developers

## Build, Test, and Development Commands

- `./dev run-desktop` boots the desktop client against the default local stack; add `SEED_P2P_TESTNET_NAME=""` to point at mainnet peers.
- `./dev run-site` serves the read-only web portal; `./dev build-desktop` and `./dev build-site` produce distributable bundles.
- `pnpm test` runs Vitest suites across workspaces; use `pnpm desktop:test` or `pnpm web:test` to focus on desktop or web packages.

## Coding Style & Naming Conventions

- TypeScript uses 2-space indentation, ESNext modules, and strict imports.
- React components and hooks use `PascalCase` and `camelCase`; files that export a component prefer `PascalCase.tsx` to align with existing apps.

## When Editing TypeScript code

- Always run the type check with `pnpm typecheck`.
- Before you are done, make sure formatting is correct with `pnpm format:write`.

## Testing Guidelines

- Unit and integration coverage is expected for new behavior; augment Vitest specs or add Playwright flows via `pnpm desktop:test`.
- Snapshot or fixture updates should include a short note in the PR describing the scenario they capture.
