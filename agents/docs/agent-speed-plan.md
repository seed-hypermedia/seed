# Agent Speed Plan

Goal: agents should feel **instant** — the reply starts streaming the moment you hit send, tool calls resolve in the
time the work itself takes, and nothing sits in a queue you can't see. This is the perceived-latency companion to
[perf-squeeze-plan.md](perf-squeeze-plan.md), which attacks host throughput; here the unit of success is the
milliseconds a person (or a parent agent) waits.

## The latency a user actually experiences

One interactive turn, end to end:

1. Signed request lands → run enqueued → executor claims it (`run.dispatch_delay`)
2. Turn prep: system prompt resolution, transcript replay build, Pi session assembly (`provider.request_gap`)
3. Provider request sent → first streamed output (`provider.ttft`) — the silence the user stares at
4. Tool batches: each tool's own span (`tool.<name>`), dominated for `execute` by microVM boot (`exec.boot`)
5. More provider round-trips per tool batch, each paying 3 again on a growing context

Every stage is now measured (see Instrumentation), so "it feels slow" decomposes into a number per stage and the fix
lands where the number is worst.

## Instrumentation (DONE, this branch)

- **`src/perf.ts`** — process-wide rolling-window recorder: count, min/max/mean lifetime, p50/p95 over the last 256
  samples per metric. One array write per sample; no config.
- **`GET /api/perf`** (and `/agents/api/perf`) — the aggregate snapshot as JSON, served beside `/api/health`. Metric
  names and millisecond aggregates only — no ids, no accounts, no content. `curl https://<host>/api/perf` against
  staging/prod answers "slow where?" without a log dive.
- **Wired spans**:
  - `provider.request_gap` — turn dispatched → first provider request sent (pre-turn overhead)
  - `provider.ttft` — provider request sent → first streamed event, logged per request as `provider first output`
  - `provider.turn` — provider request sent → assistant turn complete
  - `exec.boot` / `exec.run` / `exec.teardown` / `exec.total` — the execute_code span, decomposed; `bootMs` is now also
    reported on every `CodeExecResult`
  - `run.dispatch_delay` — run dispatchable → executor started
  - `tool.<name>` — every tool call span by tool name
- **Counters** (occurrences, in the same snapshot so they correlate with the spans above):
  `provider.error.<provider>.<model>.<reason>` with reason normalized to {overloaded, rate_limited, timeout, other} —
  ion's ask, so provider overload is distinguishable from local queue/prep time — and `run.retry.<code>` for queue-level
  retries.
- **`scripts/bench-exec.ts`** — standalone sandbox benchmark through the real executor
  (`bun scripts/bench-exec.ts --runs=6 --runtime=shell`), for before/after proof on any host.

## What the first measurements say

Local (M-series macOS, libkrun), 6 trivial shell executions, 2026-09-01:

| span          | p50   | share of total |
| ------------- | ----- | -------------- |
| exec.boot     | 185ms | **86%**        |
| exec.run      | 16ms  | 8%             |
| exec.teardown | 70ms  | (after result) |

With the warm pool (this branch, `--warm-pool`): the first call boots (~400ms including image cache effects), every
repeat call for the same agent runs in **1–3ms total** — the boot share falls from 86% to 0%, and the guest keeps its
warm state between calls.

Boot dominates even on a fast laptop for the cheapest possible command. Production is worse in two compounding ways: the
4-vCPU VPS boots slower under load, and a fresh VM means **no warm state** — the 2026-08-29 investigation measured a
cold repo typecheck at 150s+ where a warm incremental one takes seconds. Prod numbers should be collected from
`/api/perf` once this branch deploys.

Prod-side experience (ion, 2026-09-01, reviewing this plan from the agentic host): cold `execute` dominates dev loops —
preserving warm guest state is higher leverage than shaving milliseconds off trivial commands; provider round-trips
compound with transcript growth (pointing at upload/prefill + re-decode, not model degradation); control-plane
read/write calls are secondary but 1–2s each adds up; and delegation occasionally hits provider overload, which the
percentiles should distinguish from local queue/prep time.

## Workstreams, in order of expected impact

1. **Keep the microVM alive between calls** — [exec-warm-pool.md](exec-warm-pool.md). Removes `exec.boot` from every
   call after the first and, far bigger, preserves guest warm state for dev loops.
2. **Cut provider round-trip cost** — [model-comms-latency.md](model-comms-latency.md). TTFT and per-turn upload: prompt
   caching, server-side conversation state, context compaction, leaner tool contracts.
3. **Shave the dispatch/prep path** — watch `run.dispatch_delay` and `provider.request_gap` in prod. Suspects when
   they're high: the 1s dispatch poll for background runs (interactive runs bypass it via `runInline`), system-prompt
   resolution fetching remote hm:// documents (now cached 5 min — verify the hit rate), and `#piMessages` re-decoding
   large transcripts every turn (the append-time spill follow-up in perf-squeeze §6).
4. **Never look idle** — the UI side: `starting` / `thinking` / `tool` phase events already stream; make sure every
   stage above emits one so waiting always shows motion. Cheap, pure perception, worth auditing after the numbers
   improve.

## How to re-measure

- Any host: `bun scripts/bench-exec.ts --runs=6`
- Running server, real traffic: `curl -s https://<host>/api/perf | jq .metrics`
- Per-request TTFT in logs: grep `provider first output`
