# Warm MicroVM Pool for execute_code

Design for keeping a sandbox alive between `execute` calls instead of booting a fresh microVM every time. This expands
workstream 3 of [perf-squeeze-plan.md](perf-squeeze-plan.md) into an implementable shape, informed by the numbers in
[agent-speed-plan.md](agent-speed-plan.md).

## Why

Measured on this branch (`scripts/bench-exec.ts`, M-series macOS): a trivial shell command spends **86% of its span
booting the VM** (185ms boot vs 16ms of work, +70ms teardown). That is the floor; the ceiling is much worse:

- Production (2026-08-29): ~190 boots/hour sustained on a loaded 4-vCPU host, each boot slower than the laptop's.
- The real cost is not the boot itself but **losing all guest warm state**: page cache, installed packages, incremental
  compiler state. A cold `bun tsgo --noEmit` over a repo checkout ran 150s+ in prod where a warm incremental check is
  seconds. For an agent in an edit → typecheck → test loop, every step pays cold price.

Two distinct wins, one mechanism: fast single calls (boot removed) and fast dev loops (warm state preserved).

## Design

### Pool

- **Key: `(accountId, agentId, sessionId, runtime image)`** — two boundaries in one key. Account+agent is the **security
  boundary**: a VM is never shared across agent instances, ever. Session is the **predictability boundary** (Eric,
  2026-09-01): reuse is confined to one conversation, so guest RAM state from an old session (installed packages, temp
  files) can never surface in a new one — a new session always boots a cold, known-clean VM, and only repeat calls
  within the same session get the warm hit. That's where the win lives anyway: the edit→typecheck→test loops that
  motivated the pool are intra-session. Image is part of the key because `ts` runs in a different rootfs than
  python/shell.
- `execute` checks the pool: hit → run in the live VM; miss → boot one, run, then **park it** instead of tearing down.
- **Idle TTL ~10 min**, sliding — also the natural end-of-life for a finished session's VM. **Caps**: 1 VM per session,
  `SEED_AGENTS_EXEC_MAX_VMS` host-wide (start at 3 on the current prod box; scale with vCPUs). LRU eviction on cap
  pressure.
- Eviction is always safe: `/workspace` is a bind mount, so durable state survives; only guest RAM is lost — which is
  today's behavior on **every** call.

### Semantics change (documented in the tool contract)

- Processes and installed packages MAY survive between calls, best-effort. The existing
  `pip install --target /workspace/pylibs` advice stays valid since eviction can happen any time.
- Default: kill the guest process group after each call, so a stray `bun test --watch` cannot pin the vCPU between
  calls. A `keep_running` opt-in for deliberate background servers can come later.
- The per-call watchdog (workstream 1, shipped) is unchanged. A timed-out command is killed inside the VM; the VM is
  recycled (evicted + torn down) only when the guest itself is wedged. Health check before reuse: a 1s `true` exec —
  fail → discard and boot fresh.

### Warm-start ideas beyond the pool

- **Pre-warm on session start**: when an agent session opens (or a run claims), boot its VM concurrently with the first
  provider round-trip. First `execute` then finds it hot. Constraint: the workspace bind mount is fixed at `create()`,
  so pre-warm must already know `(account, agent)` — cheap, since session open does.
- **Boot-time shaving**: measure `exec.boot` variance (first boot after image pull was 403ms vs 181ms steady-state
  locally — rootfs cache effects). Keeping images pre-pulled and the msb runtime resident is cheap insurance.
- **Snapshot/restore** (libkrun capability to investigate): resume a booted-guest snapshot instead of cold boot. Only
  worth pursuing if the pool leaves a gap — the pool's warm hit costs ~0ms boot already; snapshots would only speed the
  cold-miss path.

### Teardown off the critical path

Today teardown (~70ms, up to 5s+5s bounded) happens before the result returns to the model. With a pool, parking is
instant; even on eviction, teardown should be fire-and-forget after the result is handed back. This alone trims every
call's tail regardless of pool hits.

## Accounting

- New metrics: `exec.pool_hit` / `exec.pool_miss` (recorded as 0/1 durations or a counter pair), plus the existing
  `exec.boot` now only paid on misses. Success criterion: p50 `exec.total` for a trivial command drops from ~200ms to
  ~30ms on hits, and prod cold-compile loops drop from vCPU-minutes to seconds.
- `docker stats` on prod should show sandbox CPU falling at the same time — this is the rare fix that is faster for the
  agent AND lighter on the host.

## Risks

- **Cross-call state as a correctness hazard**: a tool run may observe a daemon or temp file from a previous call.
  Mitigated by process-group kill + documented semantics; the model is told state is best-effort.
- **RAM residency**: parked VMs hold guest memory (512 MiB default). The host-wide cap bounds this; idle TTL returns it.
  On memory pressure, evict before swapping.
- **Security review**: reuse must not weaken the account boundary — the pool key and a "never rebind the workspace
  mount" rule are the invariants; add a test that a pool hit for agent B can never return agent A's VM.

## Seam contract (reviewed by ion, 2026-09-01)

Ion's review of the first seam cut set these as **prerequisites for any pooling source** — the first two are now encoded
in the types, the rest are contract obligations a pool implementation must land with tests:

1. **Typed principal identity — DONE.** `ExecPrincipal {accountId, agentId}` travels explicitly through
   `CodeExecRequest` → `SandboxSpec`; the pool keys on `(principal, image)` and never infers identity from a filesystem
   path. An isolation test (two principals can never share a VM) ships with the pool.
2. **Injectable source — DONE.** `createCodeExecutor(config, loadSdk, createSource)` takes a `SandboxSourceFactory`;
   seam tests prove normal exit → healthy release, watchdog/vanished stream → unhealthy release, reuse → `bootMs` 0, and
   release-exactly-once.
3. **No double-leasing.** A sandbox is on loan to at most one lease; concurrent acquires for the same key queue or get
   distinct VMs. Needs an explicit concurrency test before the pool ships.
4. **Reset before park.** The promised cross-call cleanup (kill the guest process group, clear guest temp state) is part
   of `release` semantics, with a background-process isolation test (start a daemon in call 1, prove call 2 cannot see
   it).
5. **Lifetime decoupled from call timeout.** `maxDuration(timeoutSecs + 30)` is a boot-per-call artifact; a pooled VM's
   lifetime is pool policy (idle TTL, caps), never derived from any single call's timeout.
6. **Fast release, drained teardown.** `release` may return immediately (parking); actual disposal drains asynchronously
   and `SandboxSource.drain()` / `CodeExecutor.drain()` settle it, keeping shutdown and tests deterministic. This also
   takes today's ~70ms teardown off the critical path.

## Sequencing

1. ~~Extract a `SandboxLease` seam in `code-exec.ts` (acquire/release instead of create/teardown) with the current
   create-per-call behavior behind it; land tests.~~ DONE, including the typed-principal and injectable-source hardening
   above.
2. ~~Add the pool behind `SEED_AGENTS_EXEC_WARM_POOL=1` with hit/miss metrics, satisfying contract items 3–6 with tests;
   bench before/after with `scripts/bench-exec.ts`.~~ DONE — `createWarmPoolSource` in `code-exec.ts`, selected by
   config (`SEED_AGENTS_EXEC_WARM_POOL=1`, cap via `SEED_AGENTS_EXEC_MAX_VMS`), contract tests in
   `src/exec-pool.test.ts` (`bun test src/exec-pool.test.ts`). Measured against real microVMs
   (`bun scripts/bench-exec.ts --runs=6 --warm-pool`): warm hits run **1–3ms total vs ~200ms cold** — boot share drops
   from 86% to 0% on repeat calls.

   Real-guest findings baked into the implementation:

   - The broadcast kill is not portable: the guest's dash builtin rejects both `kill -9 -1` and `kill -9 -- -1`
     ("Illegal number"), silently killing nothing. The reset is an explicit `/proc` sweep sparing pid 1, the sweeping
     shell, and its ancestor chain.
   - A single sweep has a fork race (ion's second-pass blocker): a process forking after the glob expanded escapes that
     pass. The reset therefore repeats (bounded at 5 passes), each pass re-expanding `/proc`, and reports clean only
     when a full pass proves every snapshot entry spared, zombie, or kernel thread. The pass is **fail-closed** (ion's
     staging-pass blocker): an unreadable, vanished, or unparseable entry marks the pass dirty and gets a kill attempt
     anyway — a vanished parent may have forked before exiting, so its disappearance is grounds for another pass, never
     for trust — and stat parsing flattens newlines first so a hostile comm cannot break it. Zombies are spared only on
     a **two-snapshot proof** (ion's fourth-pass blocker): a Z on first observation may have forked and died between the
     glob and its stat read, so it dirties the pass; it is spared once it was already Z in the prior complete pass (dead
     at that scan, so it cannot have forked since) — persistent corpses cost one extra pass on their first reset, not
     one per pass. A guest still dirtying passes after the budget is disposed instead of parked, and the disposal is
     counted (`exec.pool_reset_failed`, beside `exec.pool_probe_failed`) so it is externally attributable.
   - `scripts/verify-exec-reset.ts` proves the contract against real guests with plant assertions (positive call-1
     success), per-scenario expectations, and **counter attribution**: a plain daemon and a double-forked orphan MUST be
     reused clean via a pool hit with zero reset failures; a moderate respawner must be clean either way; a
     self-perpetuating respawn chain (each generation forks its successor before parking, so every pass stays dirty)
     MUST exhaust the pass budget with exactly one `exec.pool_reset_failed` — disposal positively attributed to the
     reset, not to a failed probe or an unhealthy call. A raw fork bomb turned out to be the wrong storm: it melts the
     guest so hard the plant call itself dies and the disposal mis-attributes to an unhealthy release.
   - Killed daemons linger as zombies (`State: Z`, empty cmdline) because init.krun reaps lazily. A proven zombie runs
     nothing — the reset contract (no prior-call process RUNNING at reuse) holds; corpses are bounded by the VM's
     30-minute lifetime.
   - Exec sessions are direct children of pid 1, so the ancestor chain the sweep must spare is short and stable.

3. ~~Tool-contract wording update for the new semantics (before any staging enable).~~ DONE — the `execute` contract now
   reads "treat the sandbox as ephemeral: consecutive calls MAY reuse a warm sandbox … background processes are always
   terminated between calls", truthful in both modes.
4. Enable on staging, watch `/api/perf` and `docker stats`, then prod.
5. Pre-warm on session start; evaluate snapshot/restore only if numbers still leave a gap.
