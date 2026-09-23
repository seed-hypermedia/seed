---
name: Agent Speed Plan
summary: A plan to make agents feel instant by measuring every stage of a turn and cutting the delays a person actually waits through, from dispatch to the first token.
---
Goal: agents should feel **instant**. The reply starts streaming the moment you hit send. Tool calls take only as long as the work itself. Nothing sits in a queue you can't see. This plan is about perceived latency. It follows the finished perf-squeeze plan (now in git history), which worked on host throughput. Here success is measured in the milliseconds a person, or a parent agent, waits. <!-- id:ne7tmVa3 -->

# The latency a user experiences <!-- id:W0Wj8fiz -->

One interactive turn, end to end: <!-- id:wSwP0VdL -->
  1. The signed request lands, the [run](../runs.md) is enqueued, and an executor claims it (`run.dispatch_delay`). <!-- id:eUafDyAu -->
  2. Turn prep: system prompt resolution, transcript replay build, and Pi session assembly (`provider.request_gap`). <!-- id:9XkH_-bH -->
  3. From sending the provider request to the first streamed output (`provider.ttft`). This is the silence the user stares at. <!-- id:hhxoRppP -->
  4. Tool batches: each tool's own span (`tool.<name>`). For `execute`, microVM boot (`exec.boot`) takes most of the time. <!-- id:8gHZQqn- -->
  5. More provider round trips, one per tool batch, each paying step 3 again on a larger context. <!-- id:luNWD3fr -->

Every stage is now measured (see Instrumentation). So "it feels slow" breaks down into one number per stage, and the fix goes where the number is worst. <!-- id:hLHkOCCW -->

# Instrumentation (done on this branch) <!-- id:MvN6uQx4 -->

- **`src/perf.ts`**: a process-wide rolling-window recorder. It keeps count, lifetime min, max, and mean, and p50 and p95 over the last 256 samples per metric. Each sample is one array write. There is no config. <!-- id:WXEXlN_A -->
- **`GET /api/perf`** (and `/agents/api/perf`): the aggregate snapshot as JSON, served beside `/api/health`. It holds metric names and millisecond aggregates only: no ids, no accounts, no content. `curl https://<host>/api/perf` against staging or prod shows where time goes without digging through logs. <!-- id:h_I86xGv -->
- **Wired spans**: <!-- id:EK9XekOk -->
  - `provider.request_gap`: from turn dispatch to the first provider request sent (pre-turn overhead). <!-- id:aHKgUKtz -->
  - `provider.ttft`: from provider request sent to the first streamed event, logged per request as `provider first output`. <!-- id:HyYtJqVD -->
  - `provider.turn`: from provider request sent to assistant turn complete. <!-- id:gWcjq2tB -->
  - `exec.boot` / `exec.run` / `exec.teardown` / `exec.total`: the execute_code span, split into parts. `bootMs` is now also reported on every `CodeExecResult`._ <!-- id:Yd5pXIcs -->
  - `run.dispatch_delay`: from run dispatchable to executor started. <!-- id:aw_TUCfu -->
  - `tool.<name>`: every tool call span, by tool name. <!-- id:GgBg2IJ8 -->
- **Counters** count occurrences. They sit in the same snapshot so they line up with the spans above. `provider.error.<provider>.<model>.<reason>` normalizes the reason to {overloaded, rate_limited, timeout, other}. Ion asked for this so provider overload can be told apart from local queue and prep time. `run.retry.<code>` counts queue-level retries._ <!-- id:IU0Updlf -->
- **`scripts/bench-exec.ts`**: a standalone sandbox benchmark through the real executor (`bun scripts/bench-exec.ts --runs=6 --runtime=shell`), for before-and-after proof on any host. <!-- id:58eqX-3h -->

# What the first measurements say <!-- id:PzJ2ajOc -->

Local (M-series macOS, libkrun), 6 trivial shell executions, 2026-09-01: <!-- id:X6dUQWrz -->

<!-- id:vitO1zPv -->
| span <!-- col:vgJ-bpOg --> | p50 <!-- col:TUl6thJL --> | share of total <!-- col:Px630oE9 --> <!-- id:iC8OZ6Fa --> |
| --- | --- | --- |
| exec.boot | 185ms | **86%** <!-- id:S8fIlwcT --> |
| exec.run | 16ms | 8% <!-- id:ClPYKiqh --> |
| exec.teardown | 70ms | (after result) <!-- id:yHY-UASL --> |

With the warm pool (this branch, `--warm-pool`), the first call boots in about 400ms, including image cache effects. Every repeat call for the same agent runs in **1 to 3ms total**. The boot share falls from 86% to 0%, and the guest keeps its warm state between calls. <!-- id:iqrXUqJe -->

Boot takes most of the time even on a fast laptop, for the cheapest possible command. Production is worse in two ways that add up. The 4-vCPU VPS boots slower under load. A fresh VM also has **no warm state**: the 2026-08-29 investigation measured a cold repo typecheck at 150s+, where a warm incremental one takes seconds. Collect prod numbers from `/api/perf` once this branch deploys. <!-- id:3MAg-QyX -->

Ion reviewed this plan from the agentic host on 2026-09-01 and reported from prod: <!-- id:43ycwJ5X -->
  - Cold `execute` dominates dev loops. Keeping warm guest state matters more than shaving milliseconds off trivial commands. <!-- id:HHl1IpUN -->
  - Provider round trips grow with the transcript. That points at upload, prefill, and re-decode, and not at model degradation. <!-- id:JIzOr6CF -->
  - Control-plane read and write calls matter less, but 1 to 2s each adds up. <!-- id:Rc2JNGM7 -->
  - [Delegation](../delegate.md) sometimes hits provider overload. The percentiles should separate that from local queue and prep time. <!-- id:TxpRw638 -->

# Workstreams, in order of expected impact <!-- id:URIPrRHx -->

1. **Keep the microVM alive between calls.** This shipped as the exec warm pool. As of September 2026 it is still opt-in with `SEED_AGENTS_EXEC_WARM_POOL=1` (see [operations](../operations.md)). It removes `exec.boot` from every call after the first. More importantly, it keeps guest warm state for dev loops. <!-- id:XHzdvgl0 -->
2. **Cut provider round-trip cost.** See [model comms latency](./model-comms-latency.md). It covers TTFT (time to first token) and per-turn upload: prompt caching, server-side conversation state, eliding old tool results, and leaner tool [contracts](../contract.md). <!-- id:ogA71Hyt -->
3. **Shave the dispatch and prep path.** Watch `run.dispatch_delay` and `provider.request_gap` in prod. Suspects when they are high: the 1s dispatch poll for background runs (interactive runs skip it through `runInline`); system-prompt resolution fetching remote [hm://](../../protocol/urls.md) documents (now cached 5 min, so check the hit rate); and `#piMessages` re-decoding large transcripts every turn (the append-time spill follow-up left by the perf-squeeze plan). <!-- id:MySHfUMe -->
4. **Never look idle.** On the UI side, `starting` / `thinking` / `tool` phase events already stream. Make sure every stage above emits one, so waiting always shows motion. This is cheap and only affects perception. Audit it after the numbers improve. <!-- id:NrCII4ob -->

# How to re-measure <!-- id:8633Vh-c -->

- Any host: `bun scripts/bench-exec.ts --runs=6` <!-- id:hqYEQgdv -->
- Running server, real traffic: `curl -s https://<host>/api/perf | jq .metrics` <!-- id:eHVhJ6sV -->
- Per-request TTFT in logs: grep `provider first output` <!-- id:h3-CVHFE -->

# See also <!-- id:Z4fn-ubO -->

- [Model comms latency](./model-comms-latency.md), the provider round-trip plan. <!-- id:QkZT30x2 -->
- [Operations](../operations.md), for the warm pool and server configuration. <!-- id:RSasRXv7 -->
- [Runs](../runs.md), for the dispatch queue. <!-- id:upV0u4x3 -->
- [Model providers](../model-providers.md), for how provider requests are built. <!-- id:wCAh-GAM -->
- [Roadmap](../roadmap.md), where speed and cost of every turn is a top priority. <!-- id:RR97xcbV -->
