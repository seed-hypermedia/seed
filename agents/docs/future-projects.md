# Future projects

This document collects larger projects that are referenced throughout the Agents docs. Use [Roadmap](./roadmap.md) for
current priority order; use this file for project scope and implementation notes. Statuses last reconciled against the
code on **2026-08-13**.

## Completed: Shared Agents protocol package

Status: completed. Protocol types now live in `agents/protocol` as the private package
`@seed-hypermedia/agents-protocol`.

Implemented:

- `agents/protocol/src/index.ts` exports the action, response, model, session, and WebSocket event types from one
  source;
- `agents/src/api.ts` re-exports the shared package so existing Bun service imports continue to work;
- `frontend/apps/desktop/src/agents-client.ts` imports protocol types from the shared package instead of maintaining a
  manual mirror;
- desktop depends on the package through `file:../../../agents/protocol`, and the Bun service depends on it through
  `file:./protocol`;
- the desktop/server action and response unions are now compile-time aliases of the same shared exported types.

## Completed: Pi SDK agentic-loop migration

Status: complete. Every turn runs through `#runPiAgent()`; the manual `fetch()`/SSE/tool loop is gone from the code.
Remaining work is provider hardening, tracked in the roadmap, not migration work. See
[Pi SDK migration project](./pi-sdk-migration.md).

Problem: Seed Agents initially implemented the LLM loop manually with direct OpenAI-compatible `fetch()` calls,
hand-written SSE parsing, and an OpenAI-specific tool loop.

Scope:

- use `@mariozechner/pi-coding-agent` as the model execution and tool orchestration layer;
- keep Seed's signed API, account authorization, SQLite session events, desktop UX, provider/secret records, and `read`
  tool;
- map Seed provider records to Pi provider/model configuration;
- inject decrypted Seed secrets into Pi as runtime-only credentials;
- disable Pi default coding tools and resource discovery until Seed has explicit product/security controls;
- translate Pi streaming/tool/final/error events back into Seed durable events and WebSocket partials;
- expand Anthropic and Google execution through Pi rather than building bespoke Seed provider loops.

Done when:

- the manual OpenAI `fetch()`/SSE/tool loop is not the primary runtime path;
- OpenAI-compatible sessions still work from desktop;
- Anthropic and Google sessions work through Pi or are explicitly blocked with current docs;
- `read` remains durable and visible;
- Seed secrets are not persisted into Pi auth files;
- `cd agents && bun check && bun test` passes.

## Completed: Anthropic execution backend

Status: folded into the Pi SDK migration and delivered through it — Anthropic is a mapped provider type executing
through Pi. What remains is a real-provider smoke test, not a backend.

The original standalone scope, kept for reference:

- implement Anthropic Messages API runner;
- map internal session history to Anthropic format;
- support streaming text deltas;
- support tool-use/tool-result round trips;
- add endpoint trust policy;
- add mocked tests.

Done when:

- an Anthropic provider can run a session end-to-end from desktop;
- streaming markdown behaves the same as OpenAI;
- `read` works through Anthropic tools.

## Completed: Google/Gemini execution backend

Status: folded into the Pi SDK migration and delivered through it. As with Anthropic, only real-provider smoke coverage
is outstanding.

The original standalone scope, kept for reference:

- implement Gemini runner;
- map internal session history to Gemini content format;
- support streaming;
- support function/tool calling;
- add mocked tests and endpoint policy.

Done when:

- Google provider sessions work from desktop;
- tool events are durable and visible;
- errors are persisted as session error events.

## Project: Agent triggers

Status: the scope below is shipped. What is open is the next shape — trigger **documents** with draft→active consent,
designed in `docs/harness/m6-event-bus-design.md` and not built. See [Agent triggers plan](./agent-triggers-plan.md) for
the shipped surface and its banner for what replaced what.

Delivered scope:

- agent-scoped triggers made of a prompt plus a source/filter, over five sources (schedule, document-comment,
  user-mention, site-update, run-completed);
- Triggers tab, New trigger dialog, editable detail page, breadcrumbs, trigger-created session list — except that a
  `run-completed` trigger can only be created through the API;
- HM activity feed monitoring with durable watermarks, per-trigger cooldowns, and exactly-once firing dedup;
- continuations beyond "start a thread": `wake` delivers a firing into a parked run, with an 8-hop chain loop guard.

Open scope: documents in `~/triggers/**`, activation consent, the `document-change` source, `appendTo`/`runPlan`
continuations, the migration off `agent_triggers`, and the desktop editor.

## Completed: Stop/cancel running sessions

Status: completed. `StopSession` aborts the live Pi turn and cancels every run rooted at the session including
descendants; `CancelRun` cancels any run's subtree (queued runs never start, waiting runs never wake, executing runs
abort via Pi abort / VM interrupt). The desktop has a stop button and a cancel control on the pinned run card.

Original scope:

- add `StopSession` or `CancelRun` action;
- track active run abort controllers;
- interrupt provider request;
- append durable stopped/cancelled event;
- set status `stopped` or `idle` with stop metadata;
- add desktop stop button;
- broadcast live state.

Risks:

- concurrent run state must be explicit;
- cancellation races with final provider events must be handled without sleeps.

## Completed: Run records and richer runtime state

Status: completed as the runs foundation of `workflows-v1-plan.md` — the `runs` table doubles as the dispatch queue,
usage persists per turn with child rollup, session events carry no run linkage but sessions carry `run_id`, and
`ListRuns`/`GetRun`/`GetRunJournal` plus `runs/<rootRunId>` subscriptions expose it live and after reconnect.

Original scope:

- add `runs` table;
- persist run status, provider, model, start/end times, token/usage metadata;
- associate partials/tool events/final messages with run IDs;
- expose run data to inspector UI;
- support better recovery after desktop reconnect.

## Project: WebSocket protocol v2

Scope:

- CBOR server-to-client events;
- heartbeat/ping;
- explicit unsubscribe;
- subscription limits;
- backpressure strategy;
- better reconnect cursors;
- optional short-lived subscription capability tokens;
- metrics.

## Completed: Domain-aware SHM read/query tool

Status: delivered. `resolveIdWithClient()` takes a `domainResolver`, and the agents service passes a `GetDomain`-backed
one, so a pasted custom-domain URL resolves to its canonical `hm://` id before the read. The naming question resolved
itself: there is no `query` alias — reading is the `read` verb over any address, and searching is the `search` callable.

Remaining from the original scope: exposing read-only Seed client request keys (`ListComments`, `ListCitations`, …) as a
structured query surface was neither built nor rejected.

Original scope:

- keep `read` as the compatibility base and decide later whether to expose a model-facing `query` alias;
- reuse the existing resolver stack in `@seed-hypermedia/client` (`resolveHypermediaUrl`, `resolveId`, and
  `resolveIdWithClient`) rather than adding agent-specific URL parsing;
- extend `frontend/packages/client/src/resource-read.ts` so `resolveIdWithClient()` accepts and forwards
  `DomainResolverFn` to `resolveId()`;
- support pasted `hm://`, `hm:`, gateway URLs, and clean web URLs such as `https://example.com/path`;
- for web URLs, resolve through the existing workflow: cached/domain resolver first, then OPTIONS-header fallback;
- add an agents-service domain resolver that implements the shared `DomainResolverFn` shape, likely backed by
  `createSeedClient(serverUrl).request('GetDomain', {domain, forceCheck: true})` because the Bun service does not have
  the desktop daemon `grpcClient`;
- include both the user-supplied URL/ID and the resolved HM URL in tool output;
- optionally generalize the tool input to support read-only Seed client request keys (`Resource`, `Search`, `Query`,
  `ListComments`, `ListCitations`, etc.) while explicitly rejecting write/action keys such as `PublishBlobs` and
  `PrepareDocumentChange`;
- preserve markdown output for document/comment `Resource` reads and keep the existing tool-result size bound;
- add tests for domain-resolver passthrough, domain URL resolution, OPTIONS fallback, action-key rejection, and durable
  tool call/result continuation.

Done when:

- asking an agent to read a pasted HM web-domain URL resolves to the correct HM ID without duplicating resolver logic;
- existing `read` calls still work;
- docs clearly state whether `query` is an alias/new default or future naming cleanup.

## Mostly completed: Shared rich tool-call rendering coverage

Status: the adapter is covered — `agent-session-rows.test.ts` exercises durable `tool_call`/`tool_result` pairing, actor
attribution, and obligation notices, alongside `run-card` and `assistant-message-rendering` tests. What is not
specifically covered is the fallback rendering path for unknown tools.

Original scope:

- add desktop tests or focused smoke coverage for pairing durable `tool_call` and `tool_result` events by call ID;
- cover pending calls with the shared running/spinner state;
- cover read-specific bubbles for `read` and any future `query` alias, including requested URL, resolved HM URL,
  resource type, format, and raw-debug access;
- preserve fallback generic rendering coverage for unknown tools/events.

Done when:

- tests protect the shared renderer and Agents adapter behavior;
- assistant sidebar rendering remains unchanged.

## Mostly completed: Tool registry and permissions

Status: the registry and the permission model shipped, in a different shape than this scope imagined. Tools are
content-addressed documents in each agent's `~/tools/`; the five verbs are always on and are never grants; what a grant
covers is the **callable set** (search / web search / execute) and **publish** (signed public writing), both exposed as
desktop toggles.

Still open: an account- or deployment-level tool policy above the per-agent one, an audit log for tool use, and an
outbound URL policy (see the roadmap's security list).

## Project: Production secret management

Scope:

- OS keychain or KMS-backed encryption key;
- key rotation;
- secret versions;
- delete/rotate secret API;
- backup/restore semantics;
- deployment docs.

## Project: Replay protection for all actions

Current status: signed actions now include `action.ts`, and the server rejects timestamps outside a 30-second local-time
window.

Remaining scope:

- maintain bounded nonce cache by account/signer;
- reject duplicate nonces inside the timestamp window;
- preserve idempotency semantics for retryable writes;
- add tests for duplicate replay rejection.

## Project: Provider management UX

Scope:

- delete provider;
- rotate API key;
- provider test button;
- display last used/error status;
- warn when provider type is configured but execution unsupported;
- model presets/capability metadata.

## Project: Rich tool result rendering

Status: partly delivered by registry-driven rendering — each tool declares its label, primary argument, resource
argument, summary path, and detail rows, so a `read` row already links its `hm://` address and expands to its content,
with raw payloads behind the info dialog. Not delivered: document previews rendered as documents rather than as text,
and showing the requested URL beside the resolved one.

Remaining scope:

- render `read` results as collapsible document previews;
- show requested URL and resolved HM ID clearly;
- open/copy resolved URL;
- show markdown excerpts.

## Project: Delegated signer registration

Problem: `verifyEnvelope` authorizes a signer that is either the account itself or holds an `AGENT`/`OWNER` row in
`account_authorizations` — but no protocol action writes that table; only tests call `setLocalAuthorization`. So every
real client must sign with the account key, which is exactly what a web device cannot do.

Scope:

- an action that registers a delegated signer for an account, and one that revokes it;
- decide what evidence authorizes the registration (an HM capability blob is the obvious candidate) and where the
  capability string on the row comes from;
- surface the authorized signers so a user can see and revoke devices acting for their account;
- tests covering authorized, unauthorized, and revoked signers across the action paths.

Done when: a web device holding its own key can run an agent session for an account it was granted, and revoking the
grant stops it.

## Project: Agent templates and tool-aware creation

Scope:

- prompt templates;
- model defaults per provider;
- tool selection;
- advanced settings;
- validation against provider capabilities;
- import/export agent definitions.

## Project: Server deployment guide

Scope:

- TLS/reverse proxy guidance;
- systemd/launchd examples;
- DB backup/restore;
- secret key management;
- log redaction policy;
- remote desktop connection instructions.

## Project: Testing expansion

Status: cancellation is covered (`runs.test.ts`, `run-time.test.ts` drive real runs through the real queue), and the
service suite runs a real Bun server. The WebSocket, desktop-hook, dialog, and SSE-parser items below are still open.

Scope:

- end-to-end WebSocket tests with real Bun server;
- desktop hook tests for `appendPartial` and malformed messages;
- provider dialog tests;
- create-agent dialog tests;
- OpenAI SSE CRLF parser regression tests;
- cancellation tests once implemented;
- multi-client live update tests.
