---
name: Roadmap
summary: Living document, last reconciled against the code on 2026-08-13 (the harness/full line). Larger project descriptions live in Future projects; how the…
---
Living document, last reconciled against the code on **2026-08-13** (the `harness/full` line). Larger project descriptions live in [Future projects](./agent-future-projects.md); how the current system is shaped and named lives in the `docs/glossary.md` and `docs/harness/plan.md`. <!-- id:28QADEsr -->

# Current completed baseline <!-- id:WJudQGtC -->

Complete enough to build on; treat as baseline functionality: <!-- id:XSquofnG -->
  - standalone Bun agents service; signed CBOR HTTP API with a 30-second action window; SQLite persistence and schema gate; encrypted provider secrets; <!-- id:WdKIOdZi -->
  - registry-driven providers (OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Groq, xAI, Ollama, Custom) executing through the Pi SDK, with per-agent reasoning levels and ChatGPT/Codex subscription auth; <!-- id:DkXudon8 -->
  - agent and session CRUD, pending invitations and accepted reader/writer agent collaborators, durable event replay, collaborator-aware WebSocket subscriptions, streaming assistant partials, desktop streaming markdown; <!-- id:zxkvg3si -->
  - the local agents server as a desktop subprocess, with the assistant sidebar unified onto agent sessions across every configured server; <!-- id:3hUeFKJ7 -->
  - **the runs tree** — every turn, child, and script is a run row and the table is the dispatch queue (leases, boot-sweep crash recovery, derived session status, persisted usage with child rollup), plus `StopSession`/`CancelRun` over whole subtrees; <!-- id:vwOi-y5P -->
  - **the five verbs** (`read`, `write`, `call`, `delegate`, `plan`) as the entire model-facing surface, with search, web search, navigate, and execute reached through `call`; <!-- id:vwxoQED2 -->
  - **tools as documents** — content-addressed (DAG-CBOR/CID) documents under `~/tools/`, a byte-budgeted Space index in every system prompt, contract-on-wrong-input, and touch-expand promotion derived from durable events; <!-- id:xBkfbVd6 -->
  - **MCP servers** — remote Streamable HTTP / SSE servers connected per account and enabled per agent, projected into `~/tools/` as `<server>__<tool>` documents, called over lazy per-run connections, managed from the Tools tab (`mcp.md`); no OAuth flow yet, static headers only; <!-- id:vxCc3yxl -->
  - **delegation** — model children with verbatim briefings and typed `return_result`, script children on the QuickJS engine with content-keyed journal replay, detached children still in the run tree, plan-step attachment by stable step id; <!-- id:CoB5EIW_ -->
  - **the symmetric log** — every event stamped with an actor, `InvokeSessionTool` letting the user run the same verbs through the same dispatchers, and the desktop wrench palette with "You"-chipped result rows; <!-- id:cBgjUc_F -->
  - **execution** — `execute {runtime: ts | python | shell}` in microVMs (TypeScript gated on an operator-configured image), and authored `~/tools/**` lambdas callable by name with validation on both edges; <!-- id:ovcQzoHM -->
  - **durable time** — `ctx.sleep`, `ctx.waitForEvent`, `ctx.continueAsNew`, `budget-pause`, `SignalRun`, and card affordances (Answer / Answer with data / Resume) for every parked state; <!-- id:pgUlDedy -->
  - **the event bus, first slice** — `run-completed` as a trigger source, the `wake` continuation delivering into parked runs exactly once, an 8-hop firing-chain loop guard, and one shared activity matcher; <!-- id:GRXwRNGb -->
  - **obligations** — one contract for what a run owes, a bounded continuation loop, honest `unmetObligations` rather than auto-checked steps, runtime-authored messages durably `actor: 'system'`, and runtime step settlement from succeeded children; <!-- id:4-h3X9Oy -->
  - per-agent memory filesystem, session-private attachments, self-hosted `web_search`/`web_read`, schedule and activity triggers. <!-- id:lETFiPgn -->

# Highest priority next steps <!-- id:yeLu-hra -->

## 1. Finish M6 — trigger documents <!-- id:SCQi9KoD -->

Why: triggers are the one piece of standing authority an agent can hold. **Shipped 2026-08-18 (introspection slice):** the `~/triggers/**` verb surface (read listing/detail, write create/edit/enable/disable/delete, `enabled` honored as written — no consent step, by owner decision; see `security.md`) plus `read ~/self` and the `thread:` listing/search. All of it rides the existing `agent_triggers` rows. <!-- id:L1oa8wTm -->

Remaining work: <!-- id:rromFbpu -->
  - the content-addressed document form (CID per trigger, like `~/tools/`), and the migration off `agent_triggers` that carries firing keys forward so nothing re-fires; <!-- id:mYyy_P6m -->
  - the `document-change` source and the `appendTo` continuation (`runPlan` waits for `~/plans/` to exist); the `tool` and `script` continuations shipped 2026-08-30 (`trigger-continuations.md`) — a firing can now run code with no model and escalate to a thread only on failure; <!-- id:Vc9XYI5j -->
  - deletion of the trigger CRUD actions, and the desktop editor that replaces them — including a form for `run-completed` triggers, which today can only be created through the API or an agent's `write ~/triggers/<name>`. <!-- id:G3Bd-4GJ -->

## 2. Delegated signers for clients that are not the account key <!-- id:e6T8Opyd -->

Why: `verifyEnvelope` already accepts a non-account signer holding an `AGENT`/`OWNER` row in `account_authorizations`, but nothing writes that table outside tests — `setLocalAuthorization` has no protocol action behind it. In practice the signer must equal the account, which is what blocks a web device (whose key is its own) from acting for an account. <!-- id:TJMhKOtm -->

Work: <!-- id:XCs_Ls6J -->
  - an action that registers a delegated signer, with the capability record that authorizes it; <!-- id:XJht9mQA -->
  - decide what proves the delegation (an HM capability blob is the obvious candidate) and how it is revoked; <!-- id:YJwi83Vg -->
  - tests for authorized, unauthorized, and revoked signers on the action paths that matter. <!-- id:Jjy3jiPZ -->

## 3. Run the live-model gates <!-- id:Oamg3yX4 -->

Why: the deterministic gates and the scripted-provider live checks pass, but no scenario has run against a real model since the verb surface changed. Blocked on OpenAI credits, not on code. <!-- id:irr2iyRF -->

Work: `agents/e2e/live-gate.ts` end to end; re-record the stale gpt-5-mini cassettes (their fingerprints embed tool names); write the still-missing battery scenarios. <!-- id:to-OOXnp -->

## 4. Provider hardening <!-- id:-2YSMAPM -->

Work: <!-- id:udJ-Ru54 -->
  - real-provider smoke tests for Anthropic and Google (mocked coverage only today); <!-- id:IKkQfJVJ -->
  - a provider test action and clearer capability status in the desktop, including warning badges for provider types that are configurable but unproven; <!-- id:f2AV6tm7 -->
  - decide whether `provider.modelDefaults` stays an advanced payload override or becomes typed settings; <!-- id:RFnGibe3 -->
  - focused multi-turn tool-history regression tests; <!-- id:uSE8yeSN -->
  - runtime diagnostics that log neither secrets nor full session content (provider listings are redacted, but the per-delta streaming logs have no level control — see "Streaming logs are useful but noisy" below). <!-- id:twSKcsog -->

## 5. Plan settlement follow-ups <!-- id:i1QtVpuA -->

Two gaps left by the settlement work, both visible in `#writeSessionPlan` and `RunPlanStep`: <!-- id:vIxF6rUF -->
  - **Turn-settle and evidence-settle do not meet.** A step closes either because the model said so or because every child attached to it succeeded — there is no path for a step the agent completed with its own tools, and when the two disagree the runtime mark simply wins and persists. Whether that is the final rule or a placeholder is undecided. <!-- id:UQkoNl88 -->
  - **A closed step records that it closed, not what closed it.** There is no outcome line — which child, which result, what evidence — so a reader of a settled checklist has to open the children to find out. <!-- id:-FVxHEX2 -->

# Medium priority <!-- id:HRwDygAr -->

## Idempotency for interrupted `ctx.call` <!-- id:BT2EBgv4 -->

A call journaled without a result re-executes on resume, because whether it took effect is unknowable (`workflow-host.ts`). Fine for reads; a `write` interrupted mid-crash could double-apply. Needs either idempotency keys on the effect or a documented contract that script tools must be idempotent. <!-- id:9WrihMpy -->

## Streaming subscription regression tests <!-- id:DdE0HVu0 -->

The signed-`Subscribe` failure caused by explicit `undefined` fields was fixed by `omitUndefined()` in `agents-client.ts`, but nothing tests it. Still unwritten: desktop signing omits undefined fields; the server verifies a subscribe envelope without `afterSeq`; a WebSocket receives `appendPartial` after a signed subscription; CRLF SSE parsing emits partials. <!-- id:lclyXiau -->

## WebSocket protocol v2 <!-- id:grDWzRRL -->

Heartbeat, explicit unsubscribe, CBOR server events, subscription limits, backpressure, better reconnect cursors. <!-- id:nsaelxWK -->

## Provider and secret lifecycle <!-- id:fhJ6ZpC0 -->

Delete provider, rotate secret, delete secret, last-used/error metadata. <!-- id:QksM-jR5 -->

## Desktop packaging coverage <!-- id:OrovpBQr -->

`desktop-smoke-test.yml` builds and runs on macOS only; the Linux and Windows binaries are compiled but never executed in CI. A fresh install also has no agent to talk to — auto-provisioning a built-in `Assistant` is still open. <!-- id:Wvvh2sbX -->

# Security hardening priority <!-- id:uvtGf3iY -->

1. Nonce caching on top of the signed-action timestamp window (the window exists; duplicate-nonce rejection does not). <!-- id:m3QcV6NM -->
2. KMS/keychain storage for the secret encryption key. <!-- id:WHSh8-RK -->
3. Rate limits and quotas. <!-- id:7aKg56T3 -->
4. Audit log for secret/provider/tool/security events. <!-- id:C4NUyg8N -->
5. Outbound network policy for tools. <!-- id:OPn_ZSqp -->

# Code improvement areas found during review <!-- id:tqZHhtFV -->

## Protocol package follow-up <!-- id:z8dDfx7A -->

Protocol types are shared through `@seed-hypermedia/agents-protocol`. If external clients are added, decide whether to publish this package or generate language-specific clients from the same source. <!-- id:BcbBxhXG -->

## Streaming logs are useful but noisy <!-- id:sxylNRBE -->

Diagnostics are helpful in development and have no log-level control. Before production, add levels/config so per-delta logs can be reduced without removing the troubleshooting path. <!-- id:K8cj84C3 -->

## WebSocket partials are ephemeral <!-- id:VfGyqCuZ -->

Acceptable for live typing, but a disconnect misses partials until the durable append. Run journals cover this for script children; agent-run text partials remain ephemeral. <!-- id:NA_2gwyO -->

# Documentation roadmap <!-- id:YZTOxGnv -->

- production deployment guide; <!-- id:qaFIgjd0 -->
- signed-envelope examples with small code snippets; <!-- id:4CtkJiRs -->
- sequence diagrams; <!-- id:08ipm1r9 -->
- threat model; <!-- id:bJomJwB3 -->
- model-provider troubleshooting guide; <!-- id:OW3ogl3a -->
- UI screenshots when design stabilizes. <!-- id:OfZYinDc -->

# Definition of done for future milestones <!-- id:T2X3BQ4P -->

A future Agents milestone is not done until: <!-- id:UoR6lXF4 -->
  - code is implemented; <!-- id:kSVyqr9X -->
  - tests pass for touched areas; <!-- id:VCP0LsJe -->
  - docs are updated and linked from `readme.md`; <!-- id:nuvBRZdT -->
  - completed/remaining status is reflected in this roadmap; <!-- id:6FAe0Ppq -->
  - security and logging implications are reviewed; <!-- id:oEcM-D0e -->
  - manual desktop smoke test is performed when UI/runtime behavior changes. <!-- id:JF3INr_Q -->
