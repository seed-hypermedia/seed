# Repository Guidelines

## Project Structure & Module Organization
- `backend/` hosts Go services (daemon, APIs, P2P); Bazel/Please targets exist, but day-to-day builds rely on `go` tooling and the `./dev` wrapper. Use `backend/AGENTS.md` file for further backend-related guidance.
- `frontend/apps/` contains Remix- and Electron-based apps; shared React utilities live under `frontend/packages/`.
- `docs/` stores developer playbooks and design notes; `proto/` holds the canonical protocol buffers; scripts and automation live in `scripts/`.
- Tests follow source: Go `_test.go` files sit beside implementations, while web specs live in `__tests__` or `*.test.ts[x]` folders within each workspace.

## Build, Test, and Development Commands
- `./dev run-desktop` boots the desktop client against the default local stack; add `SEED_P2P_TESTNET_NAME=""` to point at mainnet peers.
- `./dev run-site` serves the read-only web portal; `./dev build-desktop` and `./dev build-site` produce distributable bundles.
- `yarn test` runs Vitest suites across workspaces; use `yarn desktop:test` or `yarn web:test` to focus on desktop or web packages.
- `go test ./...` exercises the backend; pair with `golangci-lint run ./...` before pushing to catch regressions.

## Coding Style & Naming Conventions
- TypeScript uses 2-space indentation, ESNext modules, and strict imports; run `yarn format:write` (Prettier + Tailwind plugin) to normalize spacing.
- React components and hooks use `PascalCase` and `camelCase`; files that export a component prefer `PascalCase.tsx` to align with existing apps.
- Go code must remain `gofmt`-clean; package directories stay lowercase with underscores only when necessary, and exported symbols use Go’s `CamelCase`.

## Testing Guidelines
- Unit and integration coverage is expected for new behavior; augment Vitest specs or add Playwright flows via `yarn desktop:test`.
- Backend changes need parallel `_test.go` cases plus assertions for error paths; seed test fixtures live under `backend/testutil`.
- Snapshot or fixture updates should include a short note in the PR describing the scenario they capture.

## Commit & Pull Request Guidelines
- Follow the prevailing short, imperative style (`fix(frontend/web): adjust toast layout`); group fixups locally with `git commit --fixup` and squash before merge.
- Reference issue IDs or Notion tasks in the body when relevant, and note user-facing impacts.
- PRs should describe the change, list manual verification (`./dev run-desktop`, `go test ./...`, etc.), and include UI screenshots for visual tweaks.

## Environment Setup Notes
- macOS/Linux contributors rely on Nix + Direnv; run `direnv allow` after cloning to sync toolchains.
- The `docs/docs/dev-setup.md` guide stays authoritative—update it whenever tooling or bootstrapping steps change.
