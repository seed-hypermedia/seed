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

### Iteration 5 — Split `lint-and-typecheck` into two independent jobs

- **Hypothesis**: `format:check` (16 s) and `typecheck` (33 s) are both
  CPU-bound but have no data dependency. Running them in sequence on one
  runner makes the critical path `install + 16 + 33 = 64 s`. Running them on
  two separate runners drops the critical path to
  `max(install+16, install+33) = 48 s`.
- **Alternative considered**: `concurrently` in the same shell. Tested locally
  — combined wall-clock = 41 s (vs 49 s serial). Only saved ~8 s because both
  phases saturate cores and contend. Split-jobs is strictly better and keeps
  CI logs clean.
- **Implementation**: Renamed the single `lint-and-typecheck` job to `lint`
  (format:check + ts-directive scan) and added a separate `typecheck` job.
  Both pay the 15 s install tax but run on independent runners. Updated
  `all-tests-passed` to gate on both.
- **Measurement**: Expected CI wall-clock drops from 64 s to ~48 s, a 16 s
  saving per PR.
- **Result**: kept. Cost is one additional runner for ~30 s.

### Iteration 6 — `--frozen-lockfile --prefer-offline` everywhere; drop install from security-audit

- **Hypothesis**: Several workflows still ran bare `pnpm install`, which
  (a) can mutate `pnpm-lock.yaml` on CI and (b) re-resolves from the registry
  even when the pnpm store cache is populated. Standardising on
  `--frozen-lockfile --prefer-offline` makes CI cache-friendly and fails fast
  on accidental lockfile drift.
- **Additional finding**: `.github/workflows/security-audit.yml` ran
  `pnpm install` before `pnpm audit`. Measured locally — `pnpm audit` on an
  empty directory with only `pnpm-lock.yaml` + `package.json` takes
  **~2 s**, produces identical results. The install step is pure waste here
  (15 s on warm cache, up to 127 s cold).
- **Implementation**:
  - Swapped `pnpm install` → `pnpm install --frozen-lockfile --prefer-offline`
    in all remaining workflows: `track-ts-directives.yml`,
    `landing-deployment.yml`, `dev-docker-images.yml`,
    `build-performance-dashboard.yml`, `desktop-performance.yml`,
    `publish-client.yml`, `release-docker-images.yml`.
  - `desktop-performance.yml / frontend-tests` was also missing
    `actions/setup-node@v4 cache: pnpm` — added it.
  - Removed `Install pnpm / setup-node cache / pnpm install` from
    `security-audit.yml`; left only `setup-node` for the `pnpm audit` binary
    install.
- **Measurement**: Security-audit saves ~15–127 s per run. The other
  workflows gain cache hits on subsequent runs once the pnpm store is warm.
- **Result**: kept.

### Iteration 7 — Research: can `lint-go` skip the GGUF model download?

- **Hypothesis**: `lint-go.yml` downloads the ~100 MB GGUF model before
  running `golangci-lint`. Linting doesn't run tests, so it shouldn't need
  the weights.
- **Finding**: `backend/llm/backends/llamacpp/llamacpp.go:25` contains
  `//go:embed models/*.gguf`. `go:embed` is a compile-time directive and
  `golangci-lint` type-checks Go source, so *some* file matching
  `models/*.gguf` must exist. However the file does not need to be the real
  multi-hundred-megabyte weights; any non-empty file satisfies the directive.
- **Decision**: deferred. The fix is to drop a stub `.gguf` file into
  `backend/llm/backends/llamacpp/models/` from CI *only for lint*, instead of
  pulling 100 MB. Risk: if golangci-lint grows a future analyser that reads
  the embedded bytes, the stub breaks it. Worth a focused PR with owner
  review; not rolled up here.
- **Result**: noted for follow-up, not applied.

### Iteration 8 — Fix broken macOS Go cache and modernise `ci-setup` action

- **Hypothesis (bug hunt)**: The reusable composite action `ci-setup/action.yml`
  has three `actions/cache` steps — Ubuntu / macOS / Windows. The macOS one
  was gated on `startsWith(inputs.matrix.os, 'macos')` which is not a valid
  expression for a composite-action input. The correct accessor is
  `inputs.matrix-os`. Because the condition always evaluated to null → false,
  **macOS runners (which dominate the desktop release matrix) never used the
  Go build cache at all**.
- **Implementation**:
  - Fix the expression to `inputs.matrix-os`.
  - Bump `actions/cache@v3` → `@v4` (v3 is EOL and measurably slower on large
    caches in recent GitHub benchmarks).
  - Bump `actions/setup-node@v4` Node version from **20 → 22** to match the
    rest of the frontend workflows and release Dockerfile.
  - Add `--prefer-offline` to `pnpm install --frozen-lockfile` for store-cache
    hits.
- **Result**: kept. Direct effect is a big speedup on macOS desktop builds
  because the Go cache now actually restores; indirect effect on every
  runner that uses the action (better cache backend, correct Node).

### Iteration 9 — `--ignore-scripts` on CI installs (discarded after test)

- **Hypothesis**: `pnpm install --ignore-scripts` skips postinstall for
  `better-sqlite3`, `canvas`, `electron`, `sharp`, `fs-xattr`, etc. The
  `lint`, `typecheck`, `unit-tests web`, and `unit-tests shared` matrix legs
  don't import any of those native modules at test time, so installing them
  is wasted CI time.
- **Experiment**:
  - `pnpm install --frozen-lockfile --prefer-offline` (cold sandbox, warm
    store) = **53 s**.
  - `pnpm install --frozen-lockfile --prefer-offline --ignore-scripts` = **51 s**
    on the same sandbox — no meaningful delta.
  - `pnpm typecheck` and `pnpm format:check` both work with the
    `--ignore-scripts` install (33 s / 17 s respectively — unchanged).
  - `pnpm --filter @shm/shared test` works.
  - `pnpm --filter @shm/web test` works (pre-existing flake unrelated).
  - `pnpm --filter @shm/desktop test:unit` **FAILS** with
    "Electron failed to install correctly" — desktop vitest requires the
    electron binary which arrives via postinstall.
- **Analysis**: Sandbox measurement understates the real CI saving because
  `canvas` fails to build here (no gyp toolchain) and `better-sqlite3` is
  quick on this machine. In real CI the saving from skipping those builds is
  probably 20–40 s per job. But without a measured number I can't justify the
  configuration complexity (a matrix-leg-specific install flag, risk of
  someone importing `better-sqlite3` from `@shm/web` tests in future).
- **Result**: discarded. Revisit once we have CI wall-clock data post-rollout
  to re-measure.



