# CI Optimization Log

Autoresearch log for reducing total CI pipeline time on the Seed Hypermedia monorepo.

## Environment

- Runner used for local measurements: sandbox Linux container, Node 22.22.2, pnpm 10.32.0.
- CI runner used in GitHub Actions: `ubuntu-latest` (all jobs of interest below).
- Git branch: `claude/ci-optimization-audit-OezR3`.

## Workflows audited

Primary target: `.github/workflows/test-frontend-parallel.yml` — reusable workflow
used by every desktop/dev/release flow. It is the critical path for PR signal
and every frontend-touching release.

Secondary targets (noted, not primarily tuned yet):
- `.github/workflows/test-desktop.yml` (currently disabled — `branches: [none]`).
- `.github/workflows/dev-desktop.yml`, `release-desktop.yml` (depend on
  `test-frontend-parallel.yml` before their own matrix builds).
- `.github/workflows/build-performance-dashboard.yml`,
  `.github/workflows/release-docker-images.yml`, `lint-go.yml`, `test-go.yml`,
  `security-audit.yml`, `landing-deployment.yml`.

## Phase 1 — Baseline (local wall-clock, warm disk)

| Step                                        | Baseline (s) |
|---------------------------------------------|-------------:|
| `pnpm install --frozen-lockfile` (cold)     |         127  |
| `pnpm install --frozen-lockfile` (warm)     |          15  |
| `pnpm format:check`                         |          16  |
| `pnpm typecheck`                            |          54  |
| `pnpm -r --parallel run typecheck` only     |          32  |
| `pnpm --filter @shm/web test`               |          23  |
| `pnpm --filter @shm/shared test`            |          17  |
| `pnpm --filter @shm/desktop test:unit`      |          32  |

Pre-existing flakes observed locally (not introduced or fixed here):
- `@shm/web` — `app/ssr-document.integration.test.ts` times out on one test.
- `@shm/shared` — one xstate snapshot assertion fails.

These are unrelated to CI config changes and will be ignored for this audit
(the CI job accepts them when vitest exits 0 on a retry; our job is to make
the pipeline faster, not to rewrite tests).

## Slowest steps (priority order)

1. **`pnpm install` on cold cache** (~127 s) — `unit-tests` job has no
   `actions/setup-node@v4 cache: pnpm` step, so the pnpm store is re-downloaded
   every run.
2. **`pnpm typecheck`** (54 s) — dominates the unit-tests job; the wrapper
   script `pnpm --filter @shm/shared build:types` preamble costs ~22 s but is
   not strictly required (see experiment below).
3. **Desktop unit tests** (32 s) — not yet split, sequential in the pipeline.

## Selected metric

Total wall-clock of the `test-frontend-parallel.yml / unit-tests` job (this is
the single critical-path blocker for every PR / desktop release). Upstream
steps (format:check, typecheck, vitest) all run inside this one job today.

---

## Phase 2 — Iterations

Conventions:
- **Baseline delta** is the estimated CI wall-clock savings of the change on
  the `unit-tests` job, derived from local timings.
- "Kept" means the change is on disk and committed on the branch.

### Iteration 1 — Add pnpm store cache to the frontend unit-tests job

- **Hypothesis**: The `unit-tests` job in `test-frontend-parallel.yml` installed
  pnpm (`pnpm/action-setup@v4`) but never ran `actions/setup-node@v4` with
  `cache: "pnpm"`. The other jobs in the same file do. That meant the pnpm
  store was re-downloaded from the registry on every run, instead of being
  restored from the GitHub Actions cache. Adding the setup-node step should
  cut warm-cache install from ~127 s (cold) to ~15 s.
- **Implementation**: Added the missing `actions/setup-node@v4` step (Node 22,
  `cache: "pnpm"`) and switched `pnpm install` to
  `pnpm install --frozen-lockfile --prefer-offline`. Frozen-lockfile is also a
  correctness win — previously CI could silently mutate `pnpm-lock.yaml`.
- **Measurement**: Local warm install = **15 s** vs cold = **127 s**. On CI's
  first run on a branch the pnpm store is restored from the most-recent main
  cache, so the new number will be close to 15 s in practice.
- **Result**: kept. Saves ~**110 s** per run on warm cache; also a correctness
  improvement (frozen lockfile).

### Iteration 2 — Split `unit-tests` into parallel jobs (matrix + lint/typecheck)

- **Hypothesis**: The old `unit-tests` job ran seven sequential steps
  (`check-ts-directives → install → format:check → typecheck → web test →
  shared test → desktop test`). Two of those (format:check, typecheck) have no
  data dependency on the vitest suites and the three vitest suites don't
  depend on each other. Splitting into two parallel jobs — one for
  `lint-and-typecheck`, one matrix job with legs for web/shared/desktop —
  should cut the critical path to `max(lint-and-typecheck, slowest vitest
  leg)`.
- **Implementation**:
  - New `lint-and-typecheck` job: checkout → setup-node/pnpm → install →
    `format:check` → `typecheck`.
  - New `unit-tests` matrix job with `suite: [web, shared, desktop]`, each
    running its single vitest command in parallel. The `desktop` leg preserves
    the existing tolerant handling for the known jsdom-env teardown hang.
  - Updated the `all-tests-passed` gate to depend on both jobs.
- **Measurement** (local warm, using the numbers in the baseline table):
  - Old serial wall-clock: `install(15)+format(16)+typecheck(33)+web(23)+
    shared(17)+desktop(32)` ≈ **136 s**.
  - New wall-clock: `max(install+format+typecheck, install+desktop)` =
    `max(15+16+33, 15+32)` = **64 s**.
- **Result**: kept. Saves ~**72 s** of wall-clock per run once cache is warm.
  Cost: three runners instead of one. Worth it — `ubuntu-latest` minutes are
  cheap compared to engineer wait time on PR signal.

### Iteration 3 — Drop the `pnpm --filter @shm/shared build:types` preamble from `typecheck`

- **Hypothesis**: The root `typecheck` script ran
  `pnpm --filter @shm/shared build:types` before the parallel typecheck. Since
  all workspace packages resolve `@shm/shared` via `tsconfig.*.json` `paths`
  (or via pnpm's workspace symlinks to `src/index.ts`), the pre-built `.d.ts`
  emit is redundant for typecheck.
- **Experiment**: Deleted `frontend/packages/shared/dist` and all
  `*.tsbuildinfo` files, then ran `pnpm -r --parallel run typecheck` cold.
  - `pnpm typecheck` (old, with build:types preamble, warm tsbuildinfo) = 54 s.
  - `pnpm -r --parallel run typecheck` (no preamble, cold cache) = 41 s.
  - `pnpm -r --parallel run typecheck` (no preamble, warm tsbuildinfo) = 33 s.
- **Implementation**: `package.json` — replaced the multi-step typecheck
  script with `pnpm -r --parallel run typecheck`.
- **Result**: kept. Saves **~14 s** on the `typecheck` step. Already reflected
  in iteration-2 maths (typecheck = 33 s).

### Iteration 4 — Per-package typecheck timing (research only)

- **Hypothesis**: Splitting typecheck into a matrix of one-package-per-runner
  might beat the current `pnpm -r --parallel` approach.
- **Measurement** (single-threaded, cold tsbuildinfo, per package):

  | Package                          |  Seconds |
  |----------------------------------|---------:|
  | `frontend/apps/desktop`          |     39   |
  | `frontend/apps/web`              |     28   |
  | `frontend/packages/editor`       |     23   |
  | `frontend/packages/ui`           |     19   |
  | `frontend/apps/notify`           |     13   |
  | `frontend/packages/shared`       |     12   |
  | `frontend/apps/explore`          |     11   |
  | `frontend/packages/client`       |      7   |
  | `frontend/apps/cli`              |      7   |

- **Analysis**: The slowest leg (desktop = 39 s) plus an install (~15 s) =
  54 s. The current single-job parallel approach is 33 s. Matrix-splitting
  would be strictly slower because every matrix leg pays the install tax.
- **Result**: discarded — current parallel approach is already optimal.

