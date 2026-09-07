# Run concurrency: what limits it, what was measured, what to do

Written 2026-09-07 after a production session (`e2a0984d-b162-47f4-b9d8-ee4b89869fdf`, a child run spawned by an
interactive HT26 import session) took **27 minutes to start**: run created 20:02:20Z, model first called 20:29:21Z, and
the first model turn itself took 2.4 s. Nothing in the UI said why. This doc records the cause, the measurements, and
the plan.

## What actually happened

- `agents-stable` runs with `SEED_AGENTS_MAX_CONCURRENT_MODEL_RUNS: "2"` in `/opt/agentic/docker-compose.yml` (set
  2026-09-02 as a mitigation while the event loop was starving; the code default is 8). The compose file is the
  authority — it is not in git.
- The `runs` table is the queue. `RunQueue.#claimNext` picked the next `queued` row **strictly FIFO across all
  accounts** (interactive queue first). Both slots were held continuously by another account's tree (an hourly heartbeat
  workflow → coordinator → three scouts, plus an audio-research delegation tree); the container log shows every
  `agent run finished` followed within ~100 ms by the next `agent run starting`, and never more than 2 agent runs in
  flight since boot.
- The child run was `background` (all delegated children are), so it sat behind everything created before it — even
  though its parent was a person's interactive session.

The August/September event-loop fixes (#1024 memory rollup + sqlite pragmas + index, #1032 native Ed25519 verify + WS
batching, #1033 workflow-VM worker POC) are all in the prod build (`69eaa775`, 2026-09-04). The cap was never raised
back after they landed.

## Measurements (prod, 2026-09-07 20:48Z, 2 agent runs + 1 workflow active)

| Signal                                        | Value                                        |
| --------------------------------------------- | -------------------------------------------- |
| container CPU (`docker stats`)                | 114–135 % (mostly microsandbox VM processes) |
| bun **main thread** CPU (`top -H`)            | ~36 %                                        |
| `/api/health` in-container, 40 samples @250ms | p50 1 ms · p90 7 ms · max 18 ms              |
| `run.dispatch_delay` (`/api/perf`)            | p50 54 s · p95 65 min · max 2.5 h            |
| `provider.turn` gpt-5.6-terra / -sol          | p50 6.3 s / 10 s · p95 27 s / 41 s           |
| `prep.system_prompt`                          | p50 4 ms · p95 1.2 s · max 3.5 s             |
| `prep.replay` (session → provider messages)   | p50 3 ms · p95 24 ms (once per run)          |

Read: **the event loop is healthy at 2 runs** — the cap is now throttling throughput, not protecting the loop. The
`run.dispatch_delay` p95/max are inflated: the metric measures from `created_at` even for a parked parent that was
requeued hours later (its wait should be measured from the requeue). Fix that before reading it as queue pressure.

Sandbox CPU is bounded separately by `SEED_AGENTS_EXEC_MAX_VMS` (default 3), so raising the model-run cap does not raise
sandbox CPU.

## What a "model run" costs the main thread

A run is mostly waiting on a streaming HTTP response. What it does on the loop, per turn: prompt prep (system prompt,
tool sync, pi session), CBOR-encoding and writing every event to SQLite, batching stream deltas into WebSocket
broadcasts, tool orchestration (the sandbox itself is out of process), usage updates, and the client refetches those
events trigger. Roughly, at today's ~36 % for 2 runs + workflow + ~50 subscribed clients, expect the single loop to
saturate somewhere around **6–8 concurrent runs** with the current code. That is the ceiling a single event loop gives
on this box regardless of the cap; the box itself (4 vCPU, 7.7 GB) leaves ~2 cores for sandboxes on top.

## Changes made on 2026-09-07

1. **Fair-share dispatch** (`runs.ts` `#claimNext`): order by how many slots of that kind the account already holds,
   then interactive before background, then oldest. One tenant's fan-out can no longer hold every slot while another
   tenant's single run waits out the whole tree. A single account sees the same order as before.
2. **UI says "Waiting to run"** while a run is queued (session status bar + assistant sidebar), with the wait timer,
   instead of "Working…" with a ticking clock. The run card shows `queued 27m` after the fact. Step timing is clamped to
   the run's real start so the queue wait no longer reads as "Thought for 27 minutes".
3. **Model timing in every info dialog**: turn index, model turn (provider request → response complete), first token,
   from the `meta.turn` stamp the runtime already writes. Status-update rows get the same ⓘ button and show the model
   turn time inline.

## Plan

1. **Raise the cap to 8** (the code default) on `agents-stable` now, and restart with `--inspect=127.0.0.1:9230` so the
   loop can be profiled under real load without another restart (JSC `ScriptProfiler`, symbolized via `dist/main.js.map`
   — see the meltdown notes; `perf` cannot symbolize bun's JIT).
2. **Measure at 6–8 runs**: main-thread CPU, in-container `/api/health` latency, `prep.*` percentiles. If the loop pins,
   the profile names the per-run cost to cut first (`prep.system_prompt` p95 1.2 s is the obvious suspect).
3. **Structural fix — worker-isolated agent runs** (phases 3–5 of
   [worker-isolated-execution.md](worker-isolated-execution.md)): the main thread keeps API, WebSocket, RunQueue and
   SQLite writes; each run executes in a worker over an effect bridge. Concurrency then scales with cores, and a hot run
   cannot stall anyone's chat. Phase 1 (workflow VM in a worker) is merged but off in prod
   (`SEED_AGENTS_WORKFLOW_WORKER` unset); turning it on is a free first step.
4. **More cores** for the control plane, or split sandboxes onto an exec host
   ([multi-server-architecture.md](multi-server-architecture.md) phase 2): with workers, the cap becomes "cores minus
   sandboxes"; on a 4-vCPU box that is still only 2–3 workers.
5. **Queue semantics**: children of an interactive root should inherit interactive priority; `run.dispatch_delay` should
   measure from the requeue; consider a per-account share cap so a scheduled agent can never take more than, say, half
   the slots.
