Treat `./AGENTS.md` as the canonical instruction file for this repository.
Read `./AGENTS.md` in full and follow it exactly as if it were this provider-specific file.
Apply any subtree `AGENTS.md` files using the loading rules defined in `./AGENTS.md`.
Critical git rule: never modify the `.git` directory directly, and never run git commands that write state unless explicitly asked.

The sections below supplement (do not override) `AGENTS.md` and its subtree files. When they conflict, the more specific subtree rule wins.

## Working agreements

- **Clarify before coding.** Do not write code or edit files until you are ≥90% sure of the goal, constraints, inputs/outputs, and success criteria. List assumptions and wait for confirmation when the request is vague. (Note: `frontend/AGENTS.md` raises the bar to 95% for that subtree — honor it.)
- **Challenge assumptions.** Push back when a request looks wrong, suboptimal, or inconsistent with the existing codebase. Silent compliance is not useful; say so before implementing.
- **Check for SOTA and best practices.** Verify the proposed approach against current idioms for the affected stack. Go idioms ≠ TypeScript idioms ≠ Bun/Remix idioms — surface a better pattern with a brief tradeoff when one exists, and let the user choose.
- **Plan before implementing.** For anything beyond a one-line fix, produce a written plan (files to touch, workspaces affected, approach, risks) and wait for approval before editing. Call out explicitly when the change crosses workspace or language boundaries (e.g., Go ↔ TS, pnpm ↔ Bun).
- **New features require tests.** Any new feature, endpoint, function, component, or behavior ships with tests covering the happy path and obvious edge cases, using the framework already established in the affected workspace. If testing is genuinely impractical, say so explicitly and explain why before skipping.
- **Bug fixes require regression tests.** Write a failing test first, confirm it reproduces the bug, then implement the fix. If the affected code has no test harness, set one up or flag it as a blocker before patching.
- **Quality checks are mandatory.** After any change, run the relevant lint, typecheck/vet, and test commands for every workspace touched, and report the results. Do not declare work done if any check fails. If a check doesn't exist for a given workspace, say so instead of skipping silently.
- **Respect workspace boundaries.** Do not import across workspaces in ways that violate the repo's existing dependency graph. The `vault/**` Bun workspace in particular must not directly import repo-root files — use `file:` dependencies. If a change seems to require a boundary crossing, stop and ask.

## Repo layout

- `backend/**` — Go 1.25.4 module (root `go.mod`, module name `seed`). Core daemon, APIs, storage, P2P.
- `backend/storage/**` — Go; `schema.sql` is source of truth, migrations in `storage_migrations.go`. See `backend/storage/AGENTS.md`.
- `frontend/apps/*` — pnpm workspaces (TypeScript). Notable apps: `web` (Remix), `desktop` (Electron + Vite), `cli`, `notify`, `emails`, `explore`, `landing`, `perf-web`, `performance`, `performance-dashboard`.
- `frontend/packages/*` — pnpm workspaces (TypeScript): `shared` (`@shm/shared`), `ui`, `editor`, `client`.
- `frontend/scripts` — pnpm workspace.
- `docs` — pnpm workspace (`@shm/docs`).
- `tests` — pnpm workspace; integration tests (Vitest + Playwright).
- `vault/**` — Bun workspace (`@seed-hypermedia/vault`), separate from pnpm. Uses `file:` deps into `frontend/packages/*`. See `vault/AGENTS.md`.
- `proto/**` — Protobuf definitions, generated via `./dev gen //proto/...`. See `proto/AGENTS.md`.
- `ops/**` — Bun-based deploy tooling; requires the pinned Bun version in `ops/package.json` `engines.bun`. `ops/dist/deploy.js` must be rebuilt with that exact version or CI fails.
- `scripts/`, `dev`, `build/`, `monitoring/`, `patches/` — root tooling. `./dev` is a Python entrypoint for common dev tasks (codegen, backend run, etc.).
- `backend/util/llama-go/llama.cpp` — vendored third-party. Do not touch unless explicitly asked.

## Conventions and commands

### Package managers (do not substitute alternatives)

- JS/TS workspaces → **pnpm** (`pnpm@10.32.0`, lockfile `pnpm-lock.yaml`). Never propose `npm` or `yarn`.
- `vault/**` → **Bun** (`bun.lock`). Never use `pnpm`/`npm`/`vite` here.
- `ops/**` → Bun, pinned via `ops/package.json` `engines.bun`; invoke as `bunx --bun bun@<version> ...`.
- `backend/**` → Go modules. Use `go mod` commands for dependency changes; don't hand-edit `go.mod`/`go.sum`.

### Canonical commands

Prefer root-level orchestration when it exists.

**Root (pnpm, runs across JS/TS workspaces):**
- Typecheck: `pnpm typecheck` (builds `@shm/shared` types first, then runs `typecheck` in every workspace).
- Tests (default aggregate): `pnpm test` → web + `@shm/shared` + desktop unit.
- Format: `pnpm format:check` / `pnpm format:write`.
- Security: `pnpm audit` (or `pnpm security:check`).
- Watch: `pnpm watch`.

**Per-app / per-package (pnpm):**
- `pnpm --filter <name> <script>` — e.g. `pnpm --filter @shm/web test`, `pnpm --filter @shm/desktop test:unit`.
- Web (`@shm/web`): `dev`, `build`, `test` (Vitest), `typecheck` (`tsc --noEmit`).
- Desktop (`@shm/desktop`): `dev` (electron-forge), `test:unit` (Vitest), `e2e` (Playwright via `pnpm test`), `typecheck`.
- Shared (`@shm/shared`): `test` (Vitest), `build:types`, `typecheck`.
- Integration tests: `pnpm test:integration` (runs from `tests/`).

**Backend (Go, from repo root):**
- Tests: `go test ./backend/...` (run the full set — Go caches efficiently; `-race` where appropriate).
- Lint: `golangci-lint run --new-from-merge-base origin/main ./backend/...`.
- Compile-only check: `go install ./backend/...`.
- SQL queries use `dqb.Str` with explicit query variants; tests use `github.com/stretchr/testify/require`.

**Vault (Bun, from `vault/`):**
- Typecheck + format: `bun check`.
- Tests: `bun test`.
- Dev: `bun --hot src/main.ts` (see `package.json`).

**Proto / codegen:**
- Proto regen: `./dev gen //proto/...` (never run `buf`/`protoc` directly).
- Backend codegen (after schema/migration changes): `./dev gen //backend/...`.

### Test frameworks and file locations

- **Go (`backend/**`)** — standard `testing` + `github.com/stretchr/testify/require`. Tests colocated as `*_test.go`.
- **Frontend pnpm workspaces** — **Vitest** (root devDep `^3.0.9`; some packages pin older versions). Tests colocated as `*.test.ts(x)` or under package-local `test/`/`tests/` dirs following each package's existing pattern.
- **Desktop E2E** — **Playwright** (`playwright.config.ts` in `frontend/apps/desktop`). Run via `pnpm --filter @shm/desktop e2e`.
- **Integration suite** — Vitest + Playwright under top-level `tests/` (`hydration.browser.integration.test.ts`, `ssr.integration.test.ts`, `integration/`).
- **Vault** — `bun test` (Bun's built-in runner). Colocate `*.test.ts` next to sources.

### Repo-specific quirks

- `pnpm typecheck` depends on `@shm/shared` types being built first — the root script handles this; don't bypass it.
- Do not run `pnpm install` or similar inside `vault/**` — it's a separate Bun workspace.
- `ops/dist/deploy.js` must be rebuilt with the exact Bun version from `ops/package.json` `engines.bun` or CI fails the staleness check.
- Before finishing frontend work, per `frontend/AGENTS.md`: `pnpm typecheck`, `pnpm test`, `pnpm audit`, `pnpm format:write`.
- Before finishing backend work, per `backend/AGENTS.md`: `go test ./backend/...` and `golangci-lint run --new-from-merge-base origin/main ./backend/...`.
- Before finishing Vault work, per `vault/AGENTS.md`: `bun check` and `bun test` from `vault/`.
- Tailwind: prefer built-in utilities, avoid arbitrary pixel values, use parent `gap` over child margins (see `AGENTS.md`).
- Write doc comments on every exported symbol (per `AGENTS.md`).
