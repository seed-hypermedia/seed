---
name: Multi-Server Architecture
summary: A three-phase plan for growing the agents service past one host by separating sandboxed execution from the control plane and then sharding accounts across servers.
---
This plan grows the [agents service](../../apps/agents.md) past one box in three phases. Each phase can stop and hold. It is written against the 2026-08-29 production baseline: one 4-vCPU host running `agents-stable`/`-staging`/`-dev`, Caddy, SearXNG, and Crawl4AI, saturated by a single heavy dev agent. The finished perf-squeeze plan, now in git history, measured this. <!-- id:m4ehHETW -->

# Why this shape <!-- id:FRElSwuo -->

**All durable state is per-account.** It is SQLite rows and a state directory, both keyed by [account](../../protocol/identity.md). Nothing global needs a shared database, so scaling means sharding by account plus stateless helpers. There is no distributed-consensus problem. The expensive, bursty work (sandbox microVMs, headless Chromium) also separates cleanly from the latency-sensitive work: the [signed API](../signed-api.md), [WebSocket streaming](../websocket-subscriptions.md), and [trigger](../triggers.md) polling. <!-- id:IKriSujh -->

# Phase 1: one box, contained (now) <!-- id:bHqEtYoI -->

Set Compose CPU limits per container. Move Crawl4AI to its own small node when memory gets tight. The architecture does not change. This holds while total sandbox demand fits in about 2 to 3 dedicated vCPUs. <!-- id:O1tNljt4 -->

# Phase 2: split execution from the control plane <!-- id:33fg7I7P -->

Add an **exec host**: a cheap dedicated-vCPU KVM machine running a thin daemon. The daemon exposes the existing `CodeExecutor` contract (`execute(request) → result` plus availability) over HTTP, with a bearer token on the internal network. `SEED_AGENTS_EXEC_BACKEND=remote` plus a URL selects it. The microsandbox embedding, the watchdog, and the planned long-lived VM pool all sit behind the same interface, so agents code does not change. See the code execution backend in [operations](../operations.md). <!-- id:oELdtzWi -->
  - The control plane is small and steady again: API, WS streaming, polling, SQLite. <!-- id:9nA_G4oM -->
  - Exec capacity grows by adding exec hosts. The control plane round-robins agents across them, with sticky assignment per agent so the long-lived VM pool stays warm. <!-- id:EroFAB75 -->
  - The agent's memory workspace must reach the exec host. Sync directory snapshots on demand (rsync-style, content-addressed) and skip a network filesystem. Executions are bursty and local, and the workspace is already the durable copy. <!-- id:vxBGS0pw -->

This phase lets ion "ramp up" without touching anyone's chat latency. One exec host is about one more ion running flat out. <!-- id:lsA2tem1 -->

# Phase 3: shard the control plane by account <!-- id:CPMiVq2m -->

When one control plane saturates (thousands of accounts, or heavy WS fan-out), run N agents servers. Each owns a subset of accounts with its own SQLite and data dir. A routing layer (a Caddy `map` on account id, or a 20-line router service) sends signed envelopes and WS subscriptions to the owning shard. To move an account, copy its rows and state dir, then flip the route. There is no shared state and no cross-shard traffic. [Triggers](../trigger.md) and [runs](../runs.md) are already scoped to accounts. <!-- id:uCO2S7E7 -->

# Scaling and cost model (Hetzner-style pricing, 2026) <!-- id:e0FqsDYx -->

<!-- id:3MVn8pcJ -->
| Role <!-- col:D0EzZ9tP --> | Machine <!-- col:L4W55Mrd --> | \~€/mo <!-- col:L-aa3DNp --> | Capacity <!-- col:oV5D-fxZ --> <!-- id:nTfUEYpO --> |
| --- | --- | --- | --- |
| Control plane | 4 shared vCPU / 8 GB (CPX31) | \~16 | thousands of accounts; light, steady CPU <!-- id:LH9PP6Qd --> |
| Exec host | 4 dedi vCPU / 16 GB (CCX23) | \~25 | 3 to 4 concurrent heavy sandboxes (1 vCPU each) <!-- id:v-jMqhAs --> |
| Crawl node | 2 vCPU / 8 GB | \~8 | SearXNG + Crawl4AI <!-- id:A7JbJxmh --> |

Rules of thumb: <!-- id:dWG-C4EC -->
  - **Cost scales with concurrent sandbox vCPUs.** The number of accounts barely matters. Budget roughly **€6 to €8 per month per always-on concurrent sandbox vCPU**. An idle agent costs pennies (rows in SQLite). A compiling agent costs a vCPU. <!-- id:G4--KbUy -->
  - Provider tokens cost far more than infrastructure in every phase. One ion-class agent at about 220 requests per hour spends more on tokens per day than an exec host costs per month. So infra should never be the reason to throttle an agent that the model budget wants running. See [model providers](../model-providers.md). <!-- id:mTzM7d15 -->
  - Phase 2 with one exec host costs about **€50/mo total** and supports today's load with an ion running continuously. Each further ion-equivalent adds about €25/mo. Phase 3 adds about €16/mo per control-plane shard, needed only at large account counts. <!-- id:SFjCjQgV -->

# What we avoid on purpose <!-- id:n_qcQ7Sa -->

- Shared or networked SQLite, or a move to Postgres "for scale". Per-account sharding makes it unnecessary far beyond current plans. <!-- id:1XCYUuPs -->
- Kubernetes. Three roles with Compose and Terraform stay easy to read. Revisit only if exec hosts are autoscaled. <!-- id:o_ODywj8 -->
- Scheduling sandboxes on the control plane "because there is spare CPU". That spare CPU is the latency budget for everyone's triggers and streams. Phase 2 exists to protect it. <!-- id:e1zoSp0W -->

# See also <!-- id:5uqFckDJ -->

- [Operations](../operations.md) <!-- id:kAdDjxwb -->
- [Persistence](../persistence.md) <!-- id:hKJNerz5 -->
- [Worker-isolated execution](./worker-isolated-execution.md) <!-- id:s7OkSwKu -->
- [Speed](./speed.md) <!-- id:Qw9kMnkl -->
- [Environments](../environments.md) <!-- id:lIg6OqGp -->
- [Agents service](../../apps/agents.md) <!-- id:WfDKMo1L -->
- [Roadmap](../roadmap.md) <!-- id:uhprhD12 -->
