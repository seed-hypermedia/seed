---
name: Worker-Isolated Run Execution
summary: "A plan to move agent run execution off the agents server's single event loop into worker threads, so heavy runs stop stalling the API and live updates."
---
# The problem <!-- id:W48hvbe4 -->

The [agents server](../../apps/agents.md) runs everything on one JavaScript event loop: the HTTP API, the WebSocket broadcast fan-out, the background poll loops, **and** the execution of every agent [run](../runs.md) and workflow. That loop is a single thread, so any CPU-bound stretch of run execution blocks the API and [WebSocket](../websocket-subscriptions.md) for its whole duration. <!-- id:NHUP7Imx -->

Production profiling (bun's JSC sampler, symbolized through the build's source map) showed that under real load the loop is **CPU-saturated**: about 95% userspace JS, with one core pinned. `/api/health`, a handler that only replies, stalled for **6 to 23 seconds** while 2 agent runs and 1 workflow were active. The costs are spread across the run path: CBOR encode and decode of session events, `#piMessages` re-decoding the whole session each turn, per-session serialization, and the QuickJS workflow VM. <!-- id:Xi65ElOc -->

Earlier PRs removed large _fixed_ costs: a missing index (ListSessions 80× cheaper), native Ed25519 verify (idle CPU about 8× lower), and batched WebSocket broadcasts. Those made the server fast **at rest**. They cannot fix saturation under concurrent runs, because yielding does not help when a single thread pins its core. The structural fix is **real parallelism**: move run execution off the request-serving loop. <!-- id:29Rkn7zI -->

# Why this takes a staged project <!-- id:E821wmU8 -->

`#executeAgentRun` and `#runPiAgent` are about 1,150 lines. They reference **40+ distinct `Service` members** (`#db`, `#emit`, `#runQueue`, session and plan management, sub-session spawning, trigger firing, title generation, and more) inside a 14,700-line `Service` class. Moving agent-run execution to another thread means either moving most of that class or building a message proxy for those 40+ methods. It also means coordinating SQLite writes and the microsandbox native addon across threads. That needs a staged migration. <!-- id:qtHAdMs1 -->

Two facts make it doable: <!-- id:Yov9EWIY -->
  1. **Code execution already runs out of process.** `execute` runs in microsandbox microVMs (separate `msb` processes), and the JS loop only orchestrates them with async I/O. So the work to isolate is the _JS orchestration and CBOR/serialization_. The sandboxes stay where they are. <!-- id:Rdf1mMrg -->
  2. **Workflows already have a narrow effect boundary.** The QuickJS workflow VM is a pure, synchronous compute context. Its only host interaction is a small, serializable `WorkflowAdapters` contract. That makes it the best first candidate. See [script](../script.md). <!-- id:8Ot-rbwN -->

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
- **Main thread** keeps everything shared and I/O-bound: the RunQueue and its leases, all SQLite writes, WebSocket broadcast, and [trigger](../triggers.md) firing. It stays responsive because it does no CPU-bound run work. <!-- id:i86dSnl9 -->
- **Run workers** do the CPU-bound execution and hold _no_ shared state. Every side effect (append an event, spawn a [child](../child.md), execute a tool, update a [plan](../plan.md)) is a message to main, which performs it and replies. The workflow engine already uses this shape internally: compute in the worker, effects on the owner. <!-- id:J-alO_Gs -->

## Effect bridge <!-- id:12Wp_lFL -->

The worker never touches the DB or the socket. It sends typed effect requests and awaits typed results: <!-- id:WtU6GV4W -->

``` <!-- id:EF7ibAHs -->
worker → main   { id, op: 'callTool',  args }         main → worker  { id, ok, result }
worker → main   { id, op: 'spawnAgent', args }         main → worker  { id, ok, result }
worker → main   { id, op: 'appendEvent', args }        main → worker  { id, ok }
...
```

Ordering is FIFO per run. Effects that must be durable before the run counts as advanced (event appends, [journal](../journal.md) entries) are acked. The worker flushes all pending acks before it reports a terminal outcome. <!-- id:f7sTGSkQ -->

## Cancellation <!-- id:5pxjK0Ks -->

Run cancellation and the QuickJS fuel and interrupt check are **synchronous** and hot, so they cannot wait for a round trip. A one-byte `SharedArrayBuffer` per run carries the cancel flag. Main sets it, and the worker's interrupt handler reads it inline. There is no message latency and no polling. <!-- id:S3KKxA4V -->

## SQLite <!-- id:v6rYOyrI -->

SQLite stays **single-writer on main**. Workers write nothing directly. Their effects become main-thread writes. A worker that needs a read-only query (rare) can use a separate read-only WAL connection, but by default all DB access is an effect. This avoids multi-writer coordination. See [persistence](../persistence.md). <!-- id:f4kiNccQ -->

## microsandbox <!-- id:kTA7arv9 -->

Unchanged. `execute` stays a `callTool` effect, and main drives the microVM as it does today. The addon never loads in a worker. <!-- id:PcaAwqx_ -->

# Phased migration <!-- id:aNBStiUU -->

<!-- id:35QWzYhc -->
| Phase <!-- col:FphzIE4G --> | Scope <!-- col:utXek2xr --> | Risk <!-- col:-RU_q9ko --> | Ships behind <!-- col:dSIke_X6 --> <!-- id:B95pBXez --> |
| --- | --- | --- | --- |
| **1 (this PR's POC)** | Workflow QuickJS VM in a worker via proxy-adapters | Low: clean existing boundary, default-off flag, workflows only | `SEED_AGENTS_WORKFLOW_WORKER=1` <!-- id:LxaHEqsf --> |
| 2 | Harden phase 1: worker pool/reuse, backpressure, crash recovery, metrics; enable by default | Low to med | flag flips default-on <!-- id:xYwuQy7_ --> |
| 3 | Extract the agent-run _effect surface_: enumerate the 40+ `Service` touches, group them into a stable effect contract (append event, spawn, resolve child, plan ops, status, title, trigger-complete) | Med: API-shape-preserving refactor, no behavior change | internal <!-- id:RNS4IjKV --> |
| 4 | Run agent runs in workers over that contract, one worker per run, capped by the existing concurrency limits | High: the payoff and the hard part | `SEED_AGENTS_RUN_WORKER=1` <!-- id:UxcoLrcD --> |
| 5 | Worker pool sizing, lifecycle, observability; enable by default; delete the in-process path | Med | default-on <!-- id:lrMMfor3 --> |

Each phase ships on its own behind a flag and is validated in production before the next. No phase changes the wire API. Message shapes and durable formats stay the same throughout, so every client keeps working, and so does a rollback to the in-process path. <!-- id:qTQznC8z -->

# Phase 1 proof of concept (in this PR) <!-- id:yo_vNO4h -->

The workflow VM goes first because `runWorkflowVM(adapters)` _already_ takes its entire host interaction as a parameter. The POC runs that exact function, unchanged, inside a worker. It supplies a **proxy `WorkflowAdapters`** whose every method posts a message to main and, for the async ones, awaits the reply. Main supplies the **real** adapters it already builds in `#executeWorkflowRun`. The journal stays on main. The worker gets the loaded entries at start and streams appends back. Cancellation uses a `SharedArrayBuffer`. <!-- id:2g5taZgq -->

Guarantees: <!-- id:5NCB0VTw -->
  - **Default off.** Without `SEED_AGENTS_WORKFLOW_WORKER=1`, execution is byte-for-byte the current in-process path. The worker path is opt-in and reversible per deploy. <!-- id:fXOXtlOI -->
  - **Identical semantics.** Same `runWorkflowVM`, same journal, same determinism and replay, same outcomes. The worker path only changes the transport. <!-- id:NTL8355o -->
  - **Measurable win.** With the flag on, a workflow's QuickJS compute no longer blocks the main loop. `/api/health` stays responsive while a workflow burns CPU in its worker. <!-- id:iQsDinoy -->

This proves the effect bridge and `SharedArrayBuffer` cancel pattern end to end on the safest surface, so phases 3 and 4 (agent runs) build on a tested base. <!-- id:oBe4vjFl -->

# See also

- [Multi-server architecture](./multi-server-architecture.md)
- [Speed](./speed.md)
- [Operations](../operations.md)
- [Runs](../runs.md)
- [Script / ctx](../script.md)
- [Persistence](../persistence.md)
- [Agents service](../../apps/agents.md)
