---
name: Agents Roadmap
summary: The one live list of what Seed Agents does not do yet and what comes next, reconciled against the code on 2026-09-16, with the finished projects reduced to a line each.
---
This is the only forward-looking page for [Seed Agents](../agent.md). It lists what is open, in rough priority, as of **2026-09-16**. The reference pages ([tools](./tools.md), [triggers](./triggers.md), [persistence](./persistence.md), [security](./security.md), and the rest) describe everything that shipped. The design records and build logs that used to sit beside this page are in git history. The larger open designs each have their own page under [plans](./plans/speed.md). <!-- id:OypE7mEz -->

# What exists today <!-- id:fuShc1t7 -->

These parts are complete enough to build on: <!-- id:hpRRD8nC -->

- a standalone Bun service with a signed CBOR HTTP API and signed WebSocket subscriptions ([signed API](./signed-api.md), [WebSocket subscriptions](./websocket-subscriptions.md));
- SQLite persistence behind a schema gate, and encrypted provider secrets;
- registry-driven [model providers](./model-providers.md) (OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Groq, xAI, Ollama, custom) executing through the Pi SDK, with reasoning levels and ChatGPT subscription sign-in;
- agents, sessions, collaborators, public read, and public chat;
- the [runs](./runs.md) tree as dispatch queue, with leases, boot-sweep recovery, fair-share ordering across accounts, and cancellation over subtrees;
- the five verbs ([read](./read.md), [write](./write.md), [call](./call.md), [delegate](./delegate.md), [plan](./plan.md)) as the whole model-facing surface;
- tools as content-addressed [tool documents](./tool-document.md) with touch-expand and [promotion](./promotion.md);
- remote [MCP servers](./mcp.md);
- model and script [children](./child.md) with [typed results](./typed-result.md) and [journaled](./journal.md) replay;
- budgeted delegation with thoroughness presets;
- [parked](./park.md) runs and every [wake source](./wake-source.md);
- six [trigger](./trigger.md) sources and four continuations;
- the symmetric [log](./log.md) with the [wrench palette](./wrench-palette.md);
- [session continuation](./session-continuation.md) in place of compaction;
- per-agent memory, attachments, self-hosted web search and reading, and sandboxed execution with an opt-in warm microVM pool;
- the shared desktop and web UI ([desktop UI](./desktop-ui.md)), and the local agents server embedded in the [desktop app](../apps/desktop.md);
- delegated signers proven by a published [capability](../protocol/permissions.md) blob.

# Highest priority <!-- id:kVLJTyIl -->

## 1. Trigger documents <!-- id:rvAwOYgb -->

[Triggers](./triggers.md) are the one piece of standing authority an agent holds. They are still SQLite rows behind CRUD actions, plus the `~/triggers/` verb surface. The planned work:

- content-addressed trigger documents versioned by [CID](../protocol/blobs.md), like `~/tools/`;
- a migration off `agent_triggers` that carries [firing](./firing.md) keys forward so nothing re-fires;
- a `document-change` source and an `appendTo` continuation;
- deleting the CRUD actions;
- a desktop editor that replaces the dialogs. The dialogs cannot create a `run-completed` trigger today, but the API and the agent's `write ~/triggers/<name>` can.

The earlier draft-then-activate consent proposal is not wanted. <!-- id:cB9oVnBU -->

## 2. Delegation budgets: pauses, tree budgets, cost <!-- id:aXlXYVvS -->

A run that uses up its fan-out budget is told to finish alone, and nobody is asked. The follow-on project, in [delegation budgets](./plans/delegation-budgets.md), makes three changes. A pause card that the person answers replaces the refusal. The budget moves to the root of the tree, so a grant is one write and a meter is one query. Budgets are counted in tokens, and later in money. Prod runs 8 model runs at a time, so a fan-out of 16 finishes no faster than 8. The prompt should say so. <!-- id:A5q-XemL -->

## 3. Speed and cost of every turn <!-- id:I2jfqt2d -->

Every provider request re-uploads the whole session, and a cold microVM boot takes most of the time in short `execute` calls. Instrumentation (`/api/perf`, per-stage spans) and the warm pool are done. The pool stays opt-in (`SEED_AGENTS_EXEC_WARM_POOL=1`) until it is the proven default. Open: prompt caching and server-side conversation state per provider, context compaction of old tool results, byte-stable prefixes, and the dispatch and prep path ([speed](./plans/speed.md), [model comms latency](./plans/model-comms-latency.md)). Two smaller follow-ups from the 2026-08 production investigation: per-agent log files, and spilling oversized tool outputs to files at append time so a multi-megabyte event no longer costs every model turn. <!-- id:prgzeErd -->

## 4. Real parallelism <!-- id:zN1pnOMV -->

The server runs the API, the WebSocket fan-out, the poll loops, and every run on one JavaScript event loop, so a CPU-bound run stalls `/api/health` for seconds. The workflow VM already runs in a worker behind `SEED_AGENTS_WORKFLOW_WORKER=1` as a proof of concept. The staged plan to move agent runs off the main thread is [worker-isolated execution](./plans/worker-isolated-execution.md). Beyond one box, [multi-server architecture](./plans/multi-server-architecture.md) describes sharding by account. <!-- id:6vqXDUkY -->

## 5. Provider hardening <!-- id:bWzCxrxO -->

Anthropic and Google run through Pi with mocked coverage only. They need real-provider smoke tests, a provider test action, capability status in the UI, and a decision on whether `modelDefaults` stays a raw payload override. `cost` is zeroed for every non-subscription model, so usage is counted in tokens and never in money. Per-provider reasoning quirks (`deepseek`, `openrouter`) are not wired up. See [model providers](./model-providers.md). <!-- id:QN20yS-S -->

## 6. Live-model gates <!-- id:KyOePz72 -->

The deterministic gates pass, but the recorded cassettes predate the verb collapse (`agents/e2e/recordings/STALE.md`), so `e2e-replay.test.ts` skips and no scenario has run against a real model since the surface changed. Re-record, and write the missing battery scenarios. <!-- id:vZSPV0j8 -->

## 7. Plan settlement <!-- id:u6kTcJHV -->

A [plan](./plan.md) [step](./step.md) closes when the model says so, or when every [attached](./attachment.md) child succeeded. No path exists for a step the agent finished with its own tools. A closed step records that it closed, but not what closed it. <!-- id:VrByaKEn -->

# Medium priority <!-- id:5vetoXdG -->

- **Grants for `query` and `attributes`.** Both callables exist in the registry. The app's Tools tab offers only search, web search, execute, and publish, and an agent created from the app stores exactly that list in its [grants](./grants.md). The UI normalizer also drops the two names when it resaves. Only an agent whose `tools` array is undefined gets them. Either add the toggles or make them ungated. <!-- id:xFWO-fi7 -->
- **Idempotency for an interrupted `ctx.call`.** A call journaled without a result re-executes on resume. That is fine for reads and a hazard for writes. <!-- id:lm_AQRfE -->
- **WebSocket protocol v2.** Heartbeat, explicit unsubscribe, CBOR server events, subscription limits, backpressure, reconnect cursors, metrics. Agent-run text partials remain ephemeral across a disconnect. <!-- id:CeAzSzD2 -->
- **Provider and secret lifecycle.** Providers can be deleted. Secret rotation and a general secret-deletion action do not exist. <!-- id:hKIB9nP3 -->
- **Streaming subscription regression tests** for the `omitUndefined` signing fix and CRLF SSE parsing. <!-- id:Wyvsdbd1 -->
- **Desktop packaging coverage.** The smoke workflow runs on macOS only. Linux and Windows binaries are compiled but never executed in CI. <!-- id:BDc7l7DR -->
- **Rich tool results.** Document previews rendered as documents, and the requested URL beside the resolved one. <!-- id:jOpOPWUp -->

# Security hardening <!-- id:AVYp8ESV -->

1. Nonce caching on top of the signed-action timestamp window (5 minutes; duplicates inside it are accepted). <!-- id:IL5IhLQb -->
2. KMS or OS-keychain storage for the secret encryption key, which today lives in the same SQLite file as the ciphertext. <!-- id:kneZhkch -->
3. Rate limits and quotas. A reachable server accepts agents from any self-signed [account](../protocol/identity.md). <!-- id:m-HAIpNZ -->
4. An audit log for secret, provider, tool, and trigger events. <!-- id:6REDQh-S -->
5. An outbound network policy for tools and an account-level tool policy above the per-agent one. <!-- id:hIsxUn-h -->

# Documentation <!-- id:zh_wEkwJ -->

Signed-envelope examples as runnable scripts, the delegated-signer flow end to end, a production deployment guide, and a threat model. The [signed API](./signed-api.md) page documents every action, but no client library exists outside the frontend monorepo. The protocol package is private. <!-- id:EXhfyWaR -->

# Finished projects <!-- id:0BWMjs4l -->

Each of these was a plan page. The plan is in git, and the result is in the reference pages. Shared protocol package (`agents/protocol`). Pi SDK migration (every turn runs through Pi). Anthropic and Google backends (through Pi). Stop and cancel (`StopSession`, `CancelRun` over subtrees). Run records and the runs tree. Domain-aware reads (`resolveIdWithClient` with a domain resolver). Desktop agent unification (the local server as a desktop subprocess; the old assistant runtime deleted). Agent triggers phases 1 to 3, the event-bus first slice, the introspection slice, and headless continuations ([triggers](./triggers.md)). Workflows v1 (runs, children, scripts, progress UI). The five-verb harness and tools as documents. The write tool with CLI parity (now the `write` verb). Tables round-tripping through markdown. The warm microVM pool. Execution timeouts, leveled logging, session wire-size caps, and fair-share dispatch after the 2026-09-07 queue-wait incident. <!-- id:lzEGClKd -->

# Definition of done <!-- id:Kv6fICmJ -->

A milestone is done when all of these hold: <!-- id:qlLug2wi -->

- the code is implemented;
- tests pass for the touched areas;
- the reference pages describe the result, and this roadmap no longer lists it;
- security and logging implications are reviewed;
- the desktop smoke test has run, if UI or runtime behaviour changed.

# See also

- [Seed Agents](../agent.md)
- [System overview](./system-overview.md)
- [Delegation budgets](./plans/delegation-budgets.md)
- [Speed](./plans/speed.md)
- [Worker-isolated execution](./plans/worker-isolated-execution.md)
- [Multi-server architecture](./plans/multi-server-architecture.md)
- [Model comms latency](./plans/model-comms-latency.md)
- [Security](./security.md)
