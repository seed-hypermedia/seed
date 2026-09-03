---
name: Worker-isolated run execution
summary: "The agents server runs everything on one JavaScript event loop: the HTTP API, the WebSocket broadcast fan-out, the background poll loops, and the execution…"
---
# The problem <!-- id:W48hvbe4 -->

The agents server runs everything on one JavaScript event loop: the HTTP API, the WebSocket broadcast fan-out, the background poll loops, **and** the execution of every agent run and workflow. Because that loop is a single thread, any CPU-bound stretch of run execution blocks the API and WebSocket for its whole duration. <!-- id:NHUP7Imx -->

Production profiling (bun's JSC sampler, symbolized through the build's source map) showed that under real load the loop is **CPU-saturated** — \~95% userspace JS, one core pinned — with `/api/health` (a handler that does nothing but reply) stalling **6–23 seconds** while 2 agent runs + 1 workflow are active. The costs are spread across the run path: CBOR encode/decode of session events, `#piMessages` re-decoding the whole session each turn, per-session serialization, and the QuickJS workflow VM. <!-- id:Xi65ElOc -->

Earlier PRs removed large _fixed_ costs — a missing index (ListSessions 80× cheaper), native Ed25519 verify (idle CPU \~8× lower), and batched WebSocket broadcasts. Those made the server fast **at rest**. But they cannot fix saturation under concurrent runs: you cannot yield your way out of a pegged core on a single thread. The only structural fix is **real parallelism** — move run execution off the request-serving loop. <!-- id:29Rkn7zI -->

# Why this is a project, not a patch <!-- id:E821wmU8 -->

`#executeAgentRun` + `#runPiAgent` are \~1,150 lines and reference **40+ distinct `Service` members** — `#db`, `#emit`, `#runQueue`, session/plan management, sub-session spawning, trigger firing, title generation, and more — inside a 14,700-line `Service` class. Moving agent-run execution to another thread means either relocating most of that class or building a message proxy for those 40+ methods, and coordinating SQLite writes and the microsandbox native addon across threads. That is a staged migration, not a single change. <!-- id:qtHAdMs1 -->

Two facts make it tractable: <!-- id:Yov9EWIY -->
  1. **Code execution is already out-of-process.** `execute` runs in microsandbox microVMs (separate `msb` processes); the JS loop only orchestrates them with async I/O. So the thing to isolate is the _JS orchestration and CBOR/serialization_, not the sandboxes. <!-- id:Rdf1mMrg -->
  2. **The runtime already has a narrow effect boundary in one place — workflows.** The QuickJS workflow VM is a pure, synchronous compute realm whose only host interaction is a small, serializable `WorkflowAdapters` contract. That is the ideal first candidate. <!-- id:8Ot-rbwN -->

# Target architecture <!-- id:RaqfFyji -->

``` <!-- id:grMyUci_ -->
                    ┌────────────────────────── main thread ──────────────────────────┐
   HTTP / WS ─────► │  API handlers · WebSocket broadcast · RunQueue · SQLite writes    │
                    │                         ▲            │                            │
                    │                effect results   effect requests                   │
                    └─────────────────────────┼────────────┼────────────────────────────┘
                                              │            ▼
                    ┌──────────────── run worker(s) ────────┼────────────────────────────┐
                    │  CPU-bound execution: pi agent loop / QuickJS VM, CBOR, serialize   │
                    │  no DB writes, no WS — every side effect crosses back as a message  │
                    └────────────────────────────────────────────────────────────────────┘
```

<!-- id:aWLgRB42 -->
- **Main thread** keeps ownership of everything shared and I/O-ish: the RunQueue and its leases, all SQLite writes, WebSocket broadcast, trigger firing. It stays responsive because it does no CPU-bound run work. <!-- id:i86dSnl9 -->
- **Run workers** do the CPU-bound execution and hold _no_ shared state. Every side effect (append an event, spawn a child, execute a tool, update a plan) is a message to main, which performs it and replies. This is the same "compute in the worker, effects on the owner" shape the workflow engine already uses internally. <!-- id:J-alO_Gs -->

## Effect bridge <!-- id:12Wp_lFL -->

The worker never touches the DB or the socket. It sends typed effect requests and awaits typed results: <!-- id:WtU6GV4W -->

``` <!-- id:EF7ibAHs -->
worker → main   { id, op: 'callTool',  args }         main → worker  { id, ok, result }
worker → main   { id, op: 'spawnAgent', args }         main → worker  { id, ok, result }
worker → main   { id, op: 'appendEvent', args }        main → worker  { id, ok }
...
```

Ordering is per-run FIFO. Effects that must be durable before the run is considered advanced (event appends, journal entries) are acked; the worker flushes all pending acks before it reports a terminal outcome. <!-- id:f7sTGSkQ -->

## Cancellation <!-- id:5pxjK0Ks -->

Run cancellation and the QuickJS fuel/interrupt check are **synchronous** and hot, so they cannot be a round-trip. A one-byte `SharedArrayBuffer` per run carries the cancel flag: main sets it, the worker's interrupt handler reads it inline. No message latency, no polling. <!-- id:S3KKxA4V -->

## SQLite <!-- id:v6rYOyrI -->

SQLite stays **single-writer on main**. Workers issue no writes directly; their effects become main-thread writes. Read-only queries a worker genuinely needs (rare) can use a separate read-only WAL connection, but the default is "all DB access is an effect." This sidesteps multi-writer coordination entirely. <!-- id:f4kiNccQ -->

## microsandbox <!-- id:kTA7arv9 -->

Unchanged. `execute` remains a `callTool` effect; main drives the microVM exactly as it does today. The addon is never loaded in a worker. <!-- id:PcaAwqx_ -->

# Phased migration <!-- id:aNBStiUU -->

<!-- id:35QWzYhc -->
| Phase <!-- col:FphzIE4G --> | Scope <!-- col:utXek2xr --> | Risk <!-- col:-RU_q9ko --> | Ships behind <!-- col:dSIke_X6 --> <!-- id:B95pBXez --> |
| --- | --- | --- | --- |
| **1 (this PR's POC)** | Workflow QuickJS VM in a worker via proxy-adapters | Low — clean existing boundary, default-off flag, workflows only | `SEED_AGENTS_WORKFLOW_WORKER=1` <!-- id:LxaHEqsf --> |
| 2 | Harden phase 1: worker pool/reuse, backpressure, crash recovery, metrics; enable by default | Low–med | flag flips default-on <!-- id:xYwuQy7_ --> |
| 3 | Extract the agent-run _effect surface_ — enumerate the 40+ `Service` touches, group them into a stable effect contract (append event, spawn, resolve child, plan ops, status, title, trigger-complete) | Med — API-shape-preserving refactor, no behavior change | internal <!-- id:RNS4IjKV --> |
| 4 | Run agent runs in workers over that contract, one worker per run, capped by the existing concurrency limits | High — the payoff and the hard part | `SEED_AGENTS_RUN_WORKER=1` <!-- id:UxcoLrcD --> |
| 5 | Worker pool sizing, lifecycle, observability; enable by default; delete the in-process path | Med | default-on <!-- id:lrMMfor3 --> |

Each phase is independently shippable, flag-guarded, and validated in production before the next. No phase changes the wire API — message shapes and durable formats are unchanged throughout, so any client, and a rollback to the in-process path, keep working. <!-- id:qTQznC8z -->

# Phase 1 proof of concept (in this PR) <!-- id:yo_vNO4h -->

The workflow VM is isolated first because `runWorkflowVM(adapters)` is _already_ parameterized by its entire host interaction. The POC runs that exact function, unchanged, inside a worker, supplying a **proxy `WorkflowAdapters`** whose every method posts a message to main and (for the async ones) awaits the reply. Main supplies the **real** adapters it already builds in `#executeWorkflowRun`. The journal stays on main; the worker gets the loaded entries at start and streams appends back. Cancellation uses a `SharedArrayBuffer`. <!-- id:2g5taZgq -->

Guarantees: <!-- id:5NCB0VTw -->
  - **Default off.** Without `SEED_AGENTS_WORKFLOW_WORKER=1`, execution is byte-for-byte the current in-process path. The worker path is opt-in and reversible per-deploy. <!-- id:fXOXtlOI -->
  - **Identical semantics.** Same `runWorkflowVM`, same journal, same determinism/replay, same outcomes. The worker path is a transport, not a rewrite. <!-- id:NTL8355o -->
  - **Measurable win.** With it on, a workflow's QuickJS compute no longer blocks the main loop; `/api/health` stays responsive while a workflow burns CPU in its worker. <!-- id:iQsDinoy -->

This proves the effect-bridge + SharedArrayBuffer-cancel pattern end to end on the safest possible surface, so phases 3–4 (agent runs) build on a demonstrated foundation. <!-- id:oBe4vjFl -->
