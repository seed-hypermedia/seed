---
name: "Multi-Server Architecture"
summary: "How the agents service grows past one box, in three phases that can each stop and hold. Written against the 2026-08-29 production baseline: one 4-vCPU host…"
---
How the agents service grows past one box, in three phases that can each stop and hold. Written against the 2026-08-29
production baseline: one 4-vCPU host running `agents-stable`/`-staging`/`-dev`, Caddy, SearXNG, and Crawl4AI, saturated
by a single heavy dev agent (see [perf-squeeze-plan.md](./agent-perf-squeeze-plan.md)).

## Why this shape

The service has a lucky property: **all durable state is per-account** (SQLite rows and a state directory, both keyed by
account). Nothing global needs a shared database, so scaling is sharding-by-account plus stateless helpers — never a
distributed-consensus problem. The expensive, bursty work (sandbox microVMs, headless Chromium) is also cleanly
separable from the latency-sensitive work (signed API, WebSocket streaming, trigger polling).

## Phase 1 — one box, contained (now)

Compose CPU limits per container; Crawl4AI moved to its own small node the day memory gets tight. No architecture
change. Holds as long as total sandbox demand fits ~2–3 dedicated vCPUs.

## Phase 2 — split execution from the control plane

Add an **exec host**: a cheap dedicated-vCPU KVM machine running a thin daemon that exposes the existing `CodeExecutor`
contract (`execute(request) → result` plus availability) over HTTP with a bearer token on the internal network.
`SEED_AGENTS_EXEC_BACKEND=remote` + a URL selects it; the microsandbox embedding, watchdog, and (planned) long-lived VM
pool all live behind the same interface, so agents code does not change.

- The control plane goes back to being small and steady: API, WS streaming, polling, SQLite.
- Exec capacity scales by adding exec hosts; the control plane round-robins agents across them with sticky assignment
  per agent (so the long-lived VM pool stays warm).
- The agent's memory workspace must reach the exec host: sync directory snapshots on demand (rsync-style,
  content-addressed) rather than a network filesystem — executions are bursty and localized, and the workspace is
  already the durable copy.

This is the phase that lets ion "ramp up" without touching anyone's chat latency. One exec host ≈ one more ion running
flat out.

## Phase 3 — shard the control plane by account

When one control plane saturates (thousands of accounts / heavy WS fan-out): run N agents servers, each owning a subset
of accounts with its own SQLite + data dir. A routing layer (Caddy `map` on account id, or a 20-line router service)
sends signed envelopes and WS subscriptions to the owning shard. Moving an account = copy its rows + state dir, flip the
route. No shared state, no cross-shard traffic; triggers and runs already scope to accounts.

## Scaling & cost model (Hetzner-style pricing, 2026)

| Role          | Machine                      | ~€/mo | Capacity                                     |
| ------------- | ---------------------------- | ----- | -------------------------------------------- |
| Control plane | 4 shared vCPU / 8 GB (CPX31) | ~16   | thousands of accounts; light, steady CPU     |
| Exec host     | 4 dedi vCPU / 16 GB (CCX23)  | ~25   | 3–4 concurrent heavy sandboxes (1 vCPU each) |
| Crawl node    | 2 vCPU / 8 GB                | ~8    | SearXNG + Crawl4AI                           |

Rules of thumb:

- **Cost scales with concurrent sandbox vCPUs, not with accounts** — roughly **€6–8/month per always-on concurrent
  sandbox vCPU**. An idle agent costs pennies (rows in SQLite); a compiling agent costs a vCPU.
- Provider tokens dwarf infrastructure at every phase: one ion-class agent at ~220 requests/hour spends more on tokens
  per day than an exec host costs per month. Infra should therefore never be the reason to throttle an agent that model
  budget wants running.
- Phase 2 with one exec host ≈ **€50/mo total** and supports today's load with an ion running continuously; each further
  ion-equivalent adds ~€25/mo. Phase 3 adds ~€16/mo per control-plane shard, needed only at large account counts.

## What we deliberately avoid

- Shared/networked SQLite, or a migration to Postgres "for scale" — per-account sharding makes it unnecessary until far
  beyond current horizons.
- Kubernetes — three roles × compose × Terraform stays legible; revisit only if exec hosts are autoscaled.
- Scheduling sandboxes on the control plane "because there is spare CPU" — that spare CPU is the latency budget for
  everyone's triggers and streams; Phase 2 exists to protect it.
