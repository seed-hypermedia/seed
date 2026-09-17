---
name: Agents Roadmap
summary: The one live list of what Seed Agents does not do yet and what comes next, reconciled against the code on 2026-09-16, with the finished projects reduced to a line each.
---
This is the only forward-looking page for Seed Agents. It records what is open, in rough priority, as of **2026-09-16**. Anything that shipped is described in the reference pages ([tools](./tools.md), [triggers](./triggers.md), [persistence](./persistence.md), [security](./security.md), and the rest); the design records and build logs that used to sit beside this page are in git history. The larger open designs each have their own page under [plans](./plans/speed.md). <!-- id:OypE7mEz -->

# What exists today <!-- id:fuShc1t7 -->

Complete enough to build on: a standalone Bun service with a signed CBOR HTTP API and signed WebSocket subscriptions; SQLite persistence behind a schema gate; encrypted provider secrets; registry-driven providers (OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Groq, xAI, Ollama, custom) executing through the Pi SDK, with reasoning levels and ChatGPT subscription sign-in; agents, sessions, collaborators, public read and public chat; the runs tree as dispatch queue with leases, boot-sweep recovery, fair-share ordering across accounts, and cancellation over subtrees; the five verbs as the whole model-facing surface; tools as content-addressed documents with touch-expand and promotion; remote MCP servers; model and script children with typed results and journaled replay; budgeted delegation with thoroughness presets; parked runs and every wake source; six trigger sources and four continuations; the symmetric log with the wrench palette; session continuation instead of compaction; per-agent memory, attachments, self-hosted web search and reading, sandboxed execution with an opt-in warm microVM pool; the shared desktop and web UI; the local agents server embedded in the desktop app; delegated signers proven by a published capability blob. <!-- id:hpRRD8nC -->

# Highest priority <!-- id:kVLJTyIl -->

## 1. Trigger documents <!-- id:rvAwOYgb -->

Triggers are the one piece of standing authority an agent holds, and they are still SQLite rows behind CRUD actions plus the `~/triggers/` verb surface. The intended shape is content-addressed trigger documents versioned by CID like `~/tools/`, a migration off `agent_triggers` that carries firing keys forward so nothing re-fires, a `document-change` source, an `appendTo` continuation, deletion of the CRUD actions, and a desktop editor that replaces the dialogs (which today cannot create a `run-completed` trigger; the API and the agent's `write ~/triggers/<name>` can). The earlier draft-then-activate consent proposal is explicitly not wanted. <!-- id:cB9oVnBU -->

## 2. Delegation budgets: pauses, tree budgets, cost <!-- id:aXlXYVvS -->

A run that exhausts its fan-out budget is told to finish alone and nobody is asked. The follow-on project, in [delegation budgets](./plans/delegation-budgets.md), replaces the refusal with a pause card the person answers, moves the budget to the root of the tree so a grant is one write and a meter is one query, and denominates budgets in tokens and then money. Prod runs 8 model runs at a time, so a fan-out of 16 finishes no faster than 8; the prompt should say so. <!-- id:A5q-XemL -->

## 3. Speed and cost of every turn <!-- id:I2jfqt2d -->

Every provider request re-uploads the whole session, and a cold microVM boot dominates short `execute` calls. Instrumentation (`/api/perf`, per-stage spans) and the warm pool are done; the pool is still opt-in (`SEED_AGENTS_EXEC_WARM_POOL=1`) until it is the proven default. Open: prompt caching and server-side conversation state per provider, context compaction of old tool results, byte-stable prefixes, and the dispatch and prep path ([speed](./plans/speed.md), [model comms latency](./plans/model-comms-latency.md)). Two smaller follow-ups from the 2026-08 production investigation: per-agent log files, and spilling oversized tool outputs to files at append time so a multi-megabyte event stops costing every model turn. <!-- id:prgzeErd -->

## 4. Real parallelism <!-- id:zN1pnOMV -->

The server runs the API, the WebSocket fan-out, the poll loops, and every run on one JavaScript event loop, so a CPU-bound run stalls `/api/health` for seconds. The workflow VM already runs in a worker behind `SEED_AGENTS_WORKFLOW_WORKER=1` as a proof of concept; the staged plan to move agent runs off the main thread is [worker-isolated execution](./plans/worker-isolated-execution.md). Beyond one box, [multi-server architecture](./plans/multi-server-architecture.md) describes sharding by account. <!-- id:6vqXDUkY -->

## 5. Provider hardening <!-- id:bWzCxrxO -->

Anthropic and Google run through Pi with mocked coverage only; they need real-provider smoke tests, a provider test action, capability status in the UI, and a decision on whether `modelDefaults` stays a raw payload override. `cost` is zeroed for every non-subscription model, so usage is counted in tokens and never in money. Per-provider reasoning quirks (`deepseek`, `openrouter`) are unwired. <!-- id:QN20yS-S -->

## 6. Live-model gates <!-- id:KyOePz72 -->

The deterministic gates pass, but the recorded cassettes predate the verb collapse (`agents/e2e/recordings/STALE.md`), so `e2e-replay.test.ts` skips and no scenario has run against a real model since the surface changed. Re-record, and write the missing battery scenarios. <!-- id:vZSPV0j8 -->

## 7. Plan settlement <!-- id:u6kTcJHV -->

A step closes because the model said so or because every attached child succeeded; there is no path for a step the agent finished with its own tools, and a closed step records that it closed but not what closed it. <!-- id:VrByaKEn -->

# Medium priority <!-- id:5vetoXdG -->

- **Grants for `query` and `attributes`.** Both callables exist in the registry, but the app's Tools tab offers only search, web search, execute, and publish, and an agent created from the app stores exactly that list; the UI normalizer also drops the two names when it resaves. Only an agent whose `tools` array is undefined gets them. Either add the toggles or make them ungated. <!-- id:xFWO-fi7 -->
- **Idempotency for an interrupted `ctx.call`.** A call journaled without a result re-executes on resume; fine for reads, a hazard for writes. <!-- id:lm_AQRfE -->
- **WebSocket protocol v2.** Heartbeat, explicit unsubscribe, CBOR server events, subscription limits, backpressure, reconnect cursors, metrics. Agent-run text partials remain ephemeral across a disconnect. <!-- id:CeAzSzD2 -->
- **Provider and secret lifecycle.** Providers can be deleted; secret rotation and a general secret-deletion action do not exist. <!-- id:hKIB9nP3 -->
- **Streaming subscription regression tests** for the `omitUndefined` signing fix and CRLF SSE parsing. <!-- id:Wyvsdbd1 -->
- **Desktop packaging coverage.** The smoke workflow runs on macOS only; Linux and Windows binaries are compiled but never executed in CI. <!-- id:BDc7l7DR -->
- **Rich tool results.** Document previews rendered as documents, and the requested URL beside the resolved one. <!-- id:jOpOPWUp -->

# Security hardening <!-- id:AVYp8ESV -->

1. Nonce caching on top of the signed-action timestamp window (5 minutes; duplicates inside it are accepted). <!-- id:IL5IhLQb -->
2. KMS or OS-keychain storage for the secret encryption key, which today lives in the same SQLite file as the ciphertext. <!-- id:kneZhkch -->
3. Rate limits and quotas; a reachable server accepts any self-signed account's agents. <!-- id:m-HAIpNZ -->
4. An audit log for secret, provider, tool, and trigger events. <!-- id:6REDQh-S -->
5. An outbound network policy for tools and an account-level tool policy above the per-agent one. <!-- id:hIsxUn-h -->

# Documentation <!-- id:zh_wEkwJ -->

Signed-envelope examples as runnable scripts, the delegated-signer flow end to end, a production deployment guide, and a threat model. The [signed API](./signed-api.md) page documents every action but no client library exists outside the frontend monorepo; the protocol package is private. <!-- id:EXhfyWaR -->

# Finished projects <!-- id:0BWMjs4l -->

Each of these was a plan page; the plan is in git, the result is in the reference pages. Shared protocol package (`agents/protocol`). Pi SDK migration (every turn runs through Pi). Anthropic and Google backends (through Pi). Stop and cancel (`StopSession`, `CancelRun` over subtrees). Run records and the runs tree. Domain-aware reads (`resolveIdWithClient` with a domain resolver). Desktop agent unification (the local server as a desktop subprocess; the old assistant runtime deleted). Agent triggers phases 1 to 3, the event-bus first slice, the introspection slice, and headless continuations ([triggers](./triggers.md)). Workflows v1 (runs, children, scripts, progress UI). The five-verb harness and tools as documents. The write tool with CLI parity (now the `write` verb). Tables round-tripping through markdown. The warm microVM pool. Execution timeouts, leveled logging, session wire-size caps, and fair-share dispatch after the 2026-09-07 queue-wait incident. <!-- id:lzEGClKd -->

# Definition of done <!-- id:Kv6fICmJ -->

A future milestone is not done until the code is implemented, tests pass for the touched areas, the reference pages describe the result and this roadmap no longer lists it, security and logging implications are reviewed, and the desktop smoke test has been run when UI or runtime behaviour changed. <!-- id:qlLug2wi -->
