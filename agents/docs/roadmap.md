# Roadmap

This roadmap prioritizes next work after the current local Pi-backed desktop workflow. Larger project descriptions live
in [Future projects](./future-projects.md).

## Current completed baseline

The following are complete enough for local use and should be treated as baseline functionality:

- standalone Bun agents service;
- signed CBOR HTTP API;
- SQLite persistence and schema gate;
- encrypted provider secrets;
- provider listing and provider dialogs;
- agent create/list/get/update;
- session create/get/update/message;
- durable event replay;
- Pi SDK-backed model execution with OpenAI-compatible coverage;
- live WebSocket subscriptions;
- streaming assistant partials;
- timestamped signed actions with a 30-second server acceptance window;
- desktop streaming markdown rendering;
- `read` tool using shared URL resolution;
- per-agent Tools tab for toggling Seed-approved tools;
- self-hosted `web_search` (SearXNG) and tiered `web_read` (MediaWiki/static/Crawl4AI) web research tools;
- redacted HM account-key creation/listing and per-agent signing key selection for future write tools;
- built-in `/agents` session inspector;
- streaming/subscription diagnostics;
- shared Agents protocol package consumed by the Bun service and desktop.

## Highest priority next steps

### 1. Complete Pi SDK migration hardening

Why: the first Pi SDK-backed execution path is in place for OpenAI-compatible sessions and maps Anthropic/Google
provider records through Pi. It still needs hardening before the migration is fully complete.

Plan: see [Pi SDK migration project](./pi-sdk-migration.md).

Work:

- run real-provider smoke tests for OpenAI, Anthropic, and Google;
- review whether `provider.modelDefaults` should remain an advanced payload override or become typed settings;
- add Seed-level Pi runtime diagnostics that do not log secrets or full session content;
- add focused multi-turn tool-history regression tests.

### 2. Add automated regression tests for streaming subscriptions

Why: recent manual debugging found a signed `Subscribe` issue caused by explicit `undefined` fields. This should be
locked down.

Work:

- test desktop `signAgentAction()` omits undefined fields;
- test server verifies subscribe envelope without `afterSeq`;
- test WebSocket receives `appendPartial` after signed subscription;
- test CRLF SSE parsing emits partials.

### 3. Augment `read` into a domain-aware SHM read/query tool

Why: users paste clean HM web-domain URLs, and agents should resolve them through the same domain resolver/OPTIONS
workflow used by the editor, omnibar, search input, CLI-like reads, and other Seed clients. There is already a `read`
tool, so build on it instead of adding unrelated duplicate resolver logic.

Work:

- extend `resolveIdWithClient()` in `frontend/packages/client/src/resource-read.ts` to accept `DomainResolverFn` and
  pass it through to `resolveId()`/`resolveHypermediaUrl()`;
- add an agents-service `DomainResolverFn` backed by Seed API `GetDomain` because the Bun service does not have desktop
  `grpcClient`;
- keep existing `read({id, server, dev, format})` compatibility;
- make pasted `https://custom-domain/path` inputs resolve to canonical `hm://` IDs before reading resources;
- include both requested URL/ID and resolved HM URL in outputs;
- consider whether to add a model-facing `query` alias/generalized shape for read-only Seed API keys, while rejecting
  action/write keys;
- add regression tests for domain resolver passthrough, OPTIONS fallback, and durable tool result continuation.

### 4. Add tests for shared assistant message and tool-call rendering

Why: Agents chat and the assistant panel now share user/assistant message, markdown, streaming cursor, and
registry-driven tool-call bubble rendering. Focused regression coverage should protect the shared behavior.

Work:

- add component tests for user/assistant bubbles;
- cover paired durable `tool_call`/`tool_result` events in Agents chat;
- cover `read` document link rendering and any future `query` alias;
- preserve assistant panel streaming tests.

### 5. Implement stop/cancel session

Why: users need control over long or stuck model calls.

Work:

- add signed `StopSession`/`CancelRun` action;
- track active abort controllers;
- append durable stopped event;
- add desktop stop button;
- add tests.

### 6. Add provider test and unsupported-provider warnings

Why: users can configure providers whose Pi-backed execution may not be smoke-tested or fully supported yet.

Work:

- desktop warning badges for configuration-only providers;
- provider test action/button;
- clearer error states.

## Medium priority

### Provider execution follow-through

After the Pi SDK migration, confirm OpenAI, Anthropic, and Google provider mappings work end-to-end and add targeted
capability warnings for anything still unsupported.

### Provider/secret lifecycle

Add delete provider, rotate secret, delete secret, and last-used/error metadata.

### Signing and publishing tools

Implement model-facing signing/publishing tools that use the agent's selected uploaded HM account key, follow
CLI/seed-cli publishing semantics, enforce least privilege, and add durable visible tool events.

### Rich tool result rendering

Extend registry-driven tool rendering with richer document/query previews. `read` already shares the assistant sidebar
tool-call bubble; future work should include requested web URL, resolved HM URL, server, resource type, format, and
result counts where available.

### WebSocket protocol v2

Add heartbeat, unsubscribe, CBOR server events, subscription limits, and better reconnect cursors.

### Run records

Add durable run records for better execution history, cancellation, reconnect recovery, and inspector UI.

## Security hardening priority

1. Add nonce caching on top of the current signed-action timestamp window.
2. KMS/keychain secret key storage.
3. Rate limits and quotas.
4. Audit log for secret/provider/tool/security events.
5. Outbound network policy for tools.

## Code improvement areas found during review

### Protocol package follow-up

Protocol types are shared through `@seed-hypermedia/agents-protocol`. If external clients are added, decide whether to
publish this package or generate language-specific clients from the same source.

### Streaming logs are useful but noisy

Current diagnostics are helpful for development. Before production, add log levels/config so per-delta logs can be
reduced without removing the troubleshooting path.

### Tool history reconstruction is incomplete

Durable tool events are visible, and the Pi path reconstructs historical tool results as Pi tool-result messages where
possible. Tool-heavy multi-turn sessions still need focused regression coverage to ensure context quality stays high.

### Session status is too coarse

`idle/streaming/stopped/error` is not enough for run history, cancellation, retry, and metrics. Add run records.

### Built-in inspector is unauthenticated

The inspector is local/dev diagnostic UI. If exposed remotely, it can reveal account IDs, agent names, session titles,
and event payloads. Production deployment needs auth or local-only binding guidance.

### Provider support mismatch

The UI lets users save Anthropic/Google providers, and the server now maps those provider types through Pi. Until
real-provider smoke tests are complete, the UI should still expose clearer capability status and provider test actions.

### WebSocket partials are ephemeral

This is acceptable for live typing, but disconnects miss partials until final durable append. Run records or draft
assistant events could improve this.

## Documentation roadmap

Next documentation improvements:

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
