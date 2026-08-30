# Performance Squeeze Plan

Goal: let heavy autonomous agents (ion-class dev agents) **ramp up** on the current hardware by removing the bottlenecks
a production investigation (2026-08-29) actually measured, in order of impact. The companion doc
[multi-server-architecture.md](multi-server-architecture.md) covers what to do when squeezing is no longer enough.

## What production showed

One 4-vCPU host runs all three agents containers plus Caddy, SearXNG, and Crawl4AI. A single dev agent (openai-codex,
~10 concurrent sub-sessions) produced:

- **Sustained 104–145% CPU** on `agents-stable` for 33 hours: ~190 sandbox executions/hour, each a fresh 1-vCPU microVM
  running greps, edits, test runs, and TypeScript compiles against a repo checkout in `/workspace`.
- **Timeouts not enforced**: a `timeout_secs: 60` compile ran 153s; successive VMs lived 3–5 minutes at ~110% CPU.
  (Fixed: host-side watchdog in `code-exec.ts`.)
- **~91 GB network egress in 33h** (bursts of 1.6 MB/s): session context re-sent to the provider on each of ~220
  requests/hour across fat dev sessions.
- **~440k log lines/hour**, ~90% per-delta WS lines and no-op poll lines. (Fixed: leveled logging, hot paths at
  `debug`.)
- **Knock-on starvation**: activity poll cycles blowing their 60s budget (`poll tick failed … timed out`), so mention
  triggers for every other account were delayed or skipped — the "server is slow" everyone feels.

## Workstreams

### 1. Execution timeouts — DONE

Host-side watchdog (`EXEC_TIMEOUT_GRACE_MS`) races every execution; a guest that outlives its SDK timeout is killed ~5s
past the deadline and the model gets the collected output plus a clear note. Teardown is bounded (stop gets 5s, then
hard kill) so a wedged VM can never hang a tool call.

### 2. Log volume — DONE

`SEED_AGENTS_LOG_LEVEL` (default `info`); per-partial WS lines and no-op poll lines moved to `debug`. Expected: ~440k
lines/hour → a few thousand.

**Follow-up (planned): per-agent log files.** Route run/session diagnostics to `data/agents/<agentId>/logs/<date>.log`
(size-capped, rotated), keeping the process stdout for service-level lines only. This makes one noisy agent greppable in
isolation and keeps `docker logs` readable. Cheap to add in the leveled logger now that all hot sites route through it.

### 3. Session-scoped long-lived sandboxes — the big CPU lever (PLANNED)

Today every `execute` boots a **fresh ephemeral microVM**: no warm page cache, no installed packages, no incremental
compiler state. For a dev agent this is the dominant waste — every `bun tsgo --noEmit` is a cold compile of the whole
repo (150s+), where a warm incremental check is seconds. The fix is to reuse the VM:

- **Pool keyed by `(accountId, agentId)`** — never shared across accounts. An `execute` call checks the pool; hit → run
  in the live VM, miss → boot one and park it after.
- **Idle TTL** (~10 min) and **pool caps**: max N live VMs host-wide (start: 3 on the current box), max 1 per agent, LRU
  eviction. Evicting is always safe: `/workspace` is a bind mount, so durable state survives; only guest RAM (installed
  system packages, running daemons) is lost, which is today's behavior on every call.
- **Per-call watchdog unchanged**: the workstream-1 deadline applies per execution; a timed-out command is killed inside
  the VM (or the VM recycled if the guest is wedged) without discarding the warm pool entry unless the VM itself is
  unhealthy.
- **Semantics change, documented in the tool prompt**: processes and installed packages MAY survive between calls on a
  best-effort basis (the `pip install --target /workspace/pylibs` advice stays, since eviction can happen any time).
  Background processes are the new risk: a lingering `bun test --watch` pins the VM's vCPU. Mitigation: kill the process
  group after each call by default; an explicit `keep_running` opt-in can come later if agents need servers.
- **CPU fairness**: VMs stay at 1 vCPU. The host-wide live-VM cap is what bounds total sandbox CPU; make it configurable
  (`SEED_AGENTS_EXEC_MAX_VMS`) so a bigger exec host can raise it.

Expected effect: ion-style loops (edit → typecheck → test) go from ~1 cold vCPU-minute per step to seconds, which is
simultaneously **faster ramp-up for the agent and less load on the host**.

### 4. Network egress / provider traffic (PLANNED)

The 91 GB is request bodies: every model turn re-uploads the whole session. Levers, best first:

1. **Server-side conversation state** — the openai-codex provider speaks the Responses API, which supports
   `store: true` + `previous_response_id`: send only the new turn, the provider keeps the context. This collapses
   per-turn upload from O(session) to O(delta) — the single biggest egress and serialization win. Needs Pi SDK support
   verification per provider; fall back where unsupported.
2. **Context compaction** — dev sessions accumulate 64 KB tool results that stop mattering after a few turns. Summarize
   or elide tool results older than N turns (keep the model-visible note that they were elided). Cuts upload bytes AND
   the JSON serialization burning the event loop during streaming.
3. **Sub-session hygiene** — the runtime already offers delegation with fresh contexts; tool prompts should keep nudging
   long-running work into children instead of one ever-growing transcript.

Note: egress bandwidth itself is nearly free on the VPS; the real costs are event-loop serialization time, TLS CPU, and
provider latency per turn. That is why compaction matters even if bytes were free.

### 5. Host containment quick wins (ops, SeedInfra)

- `cpus: 2.5` on `agents-stable` (and `1` on staging/dev) in the compose template in `seed_infra/agentic/main.tf`, so
  one tenant cannot starve trigger polling for every account. Watchtower, SearXNG, and Crawl4AI already idle near zero;
  Crawl4AI's Chromium is the first thing to move off-host if memory gets tight (it holds ~0.5 GB resident).
- A modest host upgrade (4 → 8 vCPU) roughly doubles the safe live-VM cap in workstream 3; worth taking, but the
  cold-compile fix dwarfs it.

## Sequencing

1. ~~Watchdog~~, ~~log levels~~ (this branch) → deploy, confirm poll-cycle overruns stop.
2. Compose CPU limits (SeedInfra PR) — 30 minutes of work, immediate protection.
3. Long-lived sandbox pool — the ramp-up enabler; design above, ~2–3 days including tests.
4. Egress: verify `previous_response_id` support in the Pi SDK path, then compaction.
5. Per-agent log files.
6. Re-measure (same probes: `docker stats`, per-thread top, poll-cycle logs, `/proc/net/dev` deltas) and decide whether
   the [multi-server transition](multi-server-architecture.md) is needed yet.
