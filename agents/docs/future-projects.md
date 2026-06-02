# Future projects

This document collects larger projects that are referenced throughout the Agents docs. Use [Roadmap](./roadmap.md) for
current priority order; use this file for project scope and implementation notes.

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

## Project: Pi SDK agentic-loop migration

Status: first implementation in place; hardening remains. See [Pi SDK migration project](./pi-sdk-migration.md).

Problem: Seed Agents initially implemented the LLM loop manually with direct OpenAI-compatible `fetch()` calls,
hand-written SSE parsing, and an OpenAI-specific tool loop. The first Pi SDK path is now in place, but production
hardening and real-provider coverage remain.

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

## Project: Anthropic execution backend

Status: likely folded into the Pi SDK agentic-loop migration.

If the Pi migration is deferred, scope remains:

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

## Project: Google/Gemini execution backend

Status: likely folded into the Pi SDK agentic-loop migration.

If the Pi migration is deferred, scope remains:

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

Status: planned; backend CRUD/persistence, desktop shell, matching utilities, initial ActivityFeed monitor, inspector
visibility, and per-trigger cooldowns started. See [Agent triggers plan](./agent-triggers-plan.md).

Scope:

- save agent-scoped triggers made of a prompt plus an activity source/filter;
- add a Triggers tab, New trigger dialog, editable trigger detail page, breadcrumbs, and trigger-created session list;
- monitor the HM server activity feed with durable watermarks;
- match comment, mention, and site-update events;
- create normal agent sessions when triggers fire;
- track firings idempotently so feed retries do not duplicate sessions.

## Project: Stop/cancel running sessions

Scope:

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

## Project: Run records and richer runtime state

Problem: session status is coarse and partials are ephemeral.

Scope:

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

## Project: Domain-aware SHM read/query tool

Problem: agents need one reliable read path for Seed Hypermedia content, including clean web URLs on custom HM domains.
The current `read` tool already reads resources, but it should be augmented instead of replaced blindly.

Scope:

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

## Project: Shared rich tool-call rendering coverage

Problem: the Agents session page and assistant sidebar now share rich chat/tool rendering, but focused coverage is still
needed for the Agents event-to-bubble adapter.

Scope:

- add desktop tests or focused smoke coverage for pairing durable `tool_call` and `tool_result` events by call ID;
- cover pending calls with the shared running/spinner state;
- cover read-specific bubbles for `read` and any future `query` alias, including requested URL, resolved HM URL,
  resource type, format, and raw-debug access;
- preserve fallback generic rendering coverage for unknown tools/events.

Done when:

- tests protect the shared renderer and Agents adapter behavior;
- assistant sidebar rendering remains unchanged.

## Project: Tool registry and permissions

Problem: `read` is always available.

Scope:

- central tool registry;
- per-agent allowed tools;
- account/global tool policy;
- user-visible permission controls;
- audit log for tool reads;
- outbound URL policy.

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

Scope:

- render `read` results as collapsible document previews;
- show requested URL and resolved HM ID clearly;
- open/copy resolved URL;
- show markdown excerpts;
- preserve raw JSON/debug detail.

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

Scope:

- end-to-end WebSocket tests with real Bun server;
- desktop hook tests for `appendPartial` and malformed messages;
- provider dialog tests;
- create-agent dialog tests;
- OpenAI SSE CRLF parser regression tests;
- cancellation tests once implemented;
- multi-client live update tests.
