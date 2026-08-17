# Roadmap

Living document, last reconciled against the code on **2026-08-13** (the `harness/full` line). Larger project
descriptions live in [Future projects](./future-projects.md); how the current system is shaped and named lives in the
root `GLOSSARY.md` and `docs/harness/plan.md`.

## Current completed baseline

Complete enough to build on; treat as baseline functionality:

- standalone Bun agents service; signed CBOR HTTP API with a 30-second action window; SQLite persistence and schema
  gate; encrypted provider secrets;
- registry-driven providers (OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Groq, xAI, Ollama, Custom) executing
  through the Pi SDK, with per-agent reasoning levels and ChatGPT/Codex subscription auth;
- agent and session CRUD, pending invitations and accepted reader/writer agent collaborators, durable event replay,
  collaborator-aware WebSocket subscriptions, streaming assistant partials, desktop streaming markdown;
- the local agents server as a desktop subprocess, with the assistant sidebar unified onto agent sessions across every
  configured server;
- **the runs tree** — every turn, child, and script is a run row and the table is the dispatch queue (leases, boot-sweep
  crash recovery, derived session status, persisted usage with child rollup), plus `StopSession`/`CancelRun` over whole
  subtrees;
- **the five verbs** (`read`, `write`, `call`, `delegate`, `plan`) as the entire model-facing surface, with search, web
  search, navigate, and execute reached through `call`;
- **tools as documents** — content-addressed (DAG-CBOR/CID) documents under `~/tools/`, a byte-budgeted Space index in
  every system prompt, contract-on-wrong-input, and touch-expand promotion derived from durable events;
- **delegation** — model children with verbatim briefings and typed `return_result`, script children on the QuickJS
  engine with content-keyed journal replay, detached children still in the run tree, plan-step attachment by stable step
  id;
- **the symmetric log** — every event stamped with an actor, `InvokeSessionTool` letting the user run the same verbs
  through the same dispatchers, and the desktop wrench palette with "You"-chipped result rows;
- **execution** — `execute {runtime: ts | python | shell}` in microVMs (TypeScript gated on an operator-configured
  image), and authored `~/tools/**` lambdas callable by name with validation on both edges;
- **durable time** — `ctx.sleep`, `ctx.waitForEvent`, `ctx.continueAsNew`, `budget-pause`, `SignalRun`, and card
  affordances (Answer / Answer with data / Resume) for every parked state;
- **the event bus, first slice** — `run-completed` as a trigger source, the `wake` continuation delivering into parked
  runs exactly once, an 8-hop firing-chain loop guard, and one shared activity matcher;
- **obligations** — one contract for what a run owes, a bounded continuation loop, honest `unmetObligations` rather than
  auto-checked steps, runtime-authored messages durably `actor: 'system'`, and runtime step settlement from succeeded
  children;
- per-agent memory filesystem, session-private attachments, self-hosted `web_search`/`web_read`, schedule and activity
  triggers, the built-in `/agents` inspector.

## Highest priority next steps

### 1. Finish M6 — trigger documents and activation consent

Why: triggers are the one piece of standing authority an agent can hold, and today they are protocol rows with no
consent step. The design is written (`docs/harness/m6-event-bus-design.md`); the bus underneath already ships.

Work:

- trigger documents in `~/triggers/**`, read and written through the verbs like the rest of the Space;
- **draft→active consent**: an agent's own write lands as `draft` regardless of what it wrote; only a user action (an
  `ActivateTrigger` gesture) makes a trigger live;
- the `document-change` source and the `appendTo` continuation (`runPlan` waits for `~/plans/` to exist);
- a data-preserving migration off `agent_triggers` that carries firing keys forward so nothing re-fires;
- deletion of the trigger CRUD actions, and the desktop editor that replaces them — including a form for `run-completed`
  triggers, which today can only be created through the API.

### 2. Delegated signers for clients that are not the account key

Why: `verifyEnvelope` already accepts a non-account signer holding an `AGENT`/`OWNER` row in `account_authorizations`,
but nothing writes that table outside tests — `setLocalAuthorization` has no protocol action behind it. In practice the
signer must equal the account, which is what blocks a web device (whose key is its own) from acting for an account.

Work:

- an action that registers a delegated signer, with the capability record that authorizes it;
- decide what proves the delegation (an HM capability blob is the obvious candidate) and how it is revoked;
- tests for authorized, unauthorized, and revoked signers on the action paths that matter.

### 3. Run the live-model gates

Why: the deterministic gates and the scripted-provider live checks pass, but no scenario has run against a real model
since the verb surface changed. Blocked on OpenAI credits, not on code.

Work: `agents/e2e/live-gate.ts` end to end; re-record the stale gpt-5-mini cassettes (their fingerprints embed tool
names); write the still-missing battery scenarios.

### 4. Provider hardening

Work:

- real-provider smoke tests for Anthropic and Google (mocked coverage only today);
- a provider test action and clearer capability status in the desktop, including warning badges for provider types that
  are configurable but unproven;
- decide whether `provider.modelDefaults` stays an advanced payload override or becomes typed settings;
- focused multi-turn tool-history regression tests;
- runtime diagnostics that log neither secrets nor full session content (provider listings are redacted, but the
  per-delta streaming logs have no level control — see "Streaming logs are useful but noisy" below).

### 5. Plan settlement follow-ups

Two gaps left by the settlement work, both visible in `#writeSessionPlan` and `RunPlanStep`:

- **Turn-settle and evidence-settle do not meet.** A step closes either because the model said so or because every child
  attached to it succeeded — there is no path for a step the agent completed with its own tools, and when the two
  disagree the runtime mark simply wins and persists. Whether that is the final rule or a placeholder is undecided.
- **A closed step records that it closed, not what closed it.** There is no outcome line — which child, which result,
  what evidence — so a reader of a settled checklist has to open the children to find out.

## Medium priority

### Idempotency for interrupted `ctx.call`

A call journaled without a result re-executes on resume, because whether it took effect is unknowable
(`workflow-host.ts`). Fine for reads; a `write` interrupted mid-crash could double-apply. Needs either idempotency keys
on the effect or a documented contract that script tools must be idempotent.

### Streaming subscription regression tests

The signed-`Subscribe` failure caused by explicit `undefined` fields was fixed by `omitUndefined()` in
`agents-client.ts`, but nothing tests it. Still unwritten: desktop signing omits undefined fields; the server verifies a
subscribe envelope without `afterSeq`; a WebSocket receives `appendPartial` after a signed subscription; CRLF SSE
parsing emits partials.

### WebSocket protocol v2

Heartbeat, explicit unsubscribe, CBOR server events, subscription limits, backpressure, better reconnect cursors.

### Provider and secret lifecycle

Delete provider, rotate secret, delete secret, last-used/error metadata.

### Run history in the inspector

The `runs` table backs execution history, cancellation, and reconnect recovery, but the built-in `/agents` inspector
still shows only sessions and events.

### TypeScript execution in deployed images

`execute {runtime: 'ts'}` is off unless `SEED_AGENTS_EXEC_TS_IMAGE` names an image with a JavaScript runtime. Turning it
on in production is an infra change, not a code change.

### Desktop packaging coverage

`desktop-smoke-test.yml` builds and runs on macOS only; the Linux and Windows binaries are compiled but never executed
in CI. A fresh install also has no agent to talk to — auto-provisioning a built-in `Assistant` is still open.

## Security hardening priority

1. Nonce caching on top of the signed-action timestamp window (the window exists; duplicate-nonce rejection does not).
2. KMS/keychain storage for the secret encryption key.
3. Rate limits and quotas.
4. Audit log for secret/provider/tool/security events.
5. Outbound network policy for tools.
6. Auth or local-only binding for the `/agents` inspector, which is unauthenticated and reveals account ids, session
   titles, and event payloads.

## Code improvement areas found during review

### Protocol package follow-up

Protocol types are shared through `@seed-hypermedia/agents-protocol`. If external clients are added, decide whether to
publish this package or generate language-specific clients from the same source.

### Streaming logs are useful but noisy

Diagnostics are helpful in development and have no log-level control. Before production, add levels/config so per-delta
logs can be reduced without removing the troubleshooting path.

### WebSocket partials are ephemeral

Acceptable for live typing, but a disconnect misses partials until the durable append. Run journals cover this for
script children; agent-run text partials remain ephemeral.

## Documentation roadmap

- production deployment guide;
- signed-envelope examples with small code snippets;
- sequence diagrams;
- threat model;
- model-provider troubleshooting guide;
- UI screenshots when design stabilizes.

## Definition of done for future milestones

A future Agents milestone is not done until:

- code is implemented;
- tests pass for touched areas;
- docs are updated and linked from `readme.md`;
- completed/remaining status is reflected in this roadmap;
- security and logging implications are reviewed;
- manual desktop smoke test is performed when UI/runtime behavior changes.
