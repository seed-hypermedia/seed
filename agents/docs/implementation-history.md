# Implementation history

This document summarizes the recent commits that built the Agents feature. Keep it updated when a new milestone lands so
future agents can reconstruct why the system looks the way it does.

## Recent commit notes

### Web research tools (`web_search`, `web_read`)

Completed:

- Added `agents/src/web-tools.ts` implementing two self-hosted, key-free web tools.
- `web_search` queries a self-hosted SearXNG `GET /search?format=json`, with engine-rotation retry on upstream blocking
  and a `degraded` flag for partial coverage.
- `web_read` uses a tiered, cheapest-first reader: MediaWiki REST/Parsoid API → in-process static extraction
  (`@mozilla/readability` on a `linkedom` DOM + Turndown) → optional Crawl4AI headless-browser `POST /md` escalation
  with one retry. Output bounded to 200 KiB.
- Added `web` config (`SEED_AGENTS_SEARXNG_URL`, `SEED_AGENTS_CRAWLER_URL`, `SEED_AGENTS_CRAWLER_TOKEN`) threaded from
  `Service` into the tool context; registry entries in `agents/protocol/src/tool-registry.ts`; desktop Tools-tab web
  group in `frontend/apps/desktop/src/pages/agents/agent-tools.ts` and `detail.tsx`.
- Tools are opt-in per agent and degrade gracefully when their backends are unconfigured. Added unit tests
  (`src/web-tools.test.ts`) and an end-to-end `web_search` tool-call test in `src/api-service.test.ts`.
- Validated against live SearXNG + Crawl4AI 0.9.0 containers locally; the static and MediaWiki tiers run with no extra
  container.

### Current work: Rich agent editing and presentation

Completed:

- Added a shared rich prompt editor module for agent prompts, trigger prompts, and create-agent prompt entry.
- Converted rich prompt blocks to markdown before signed desktop create/update requests while keeping server-side
  normalization and model-facing markdown conversion intact.
- Replaced the agent session chat composer with the full `CommentEditor`, preserving slash-menu/editor behavior and
  converting rich message blocks to markdown before `MessageSession` submission or queuing.
- Added formatted markdown presentation for user message bubbles plus an info button that shows the exact raw markdown
  text sent to the LLM.
- Shared queued-message UI between the assistant panel and agent session page.

Design note: the session composer now behaves like a rich block editor, so normal Enter belongs to editor editing. Use
`Cmd/Ctrl+Enter` or the send button for submission.

### Current work: Triggered comment replies

Completed:

- Added explicit trigger-session instructions telling models to pass `replyCommentId` when replying to comment activity.
- Documented `write` reply aliases and made `comment.create` accept `replyCommentId`/`replyComment` in addition to
  `reply`/`replyTo`.
- Made comment reply publishing use parent comment versions for `replyParent`/`threadRoot` and derive the target
  document from the parent when needed.

### Current work: Schedule triggers

Completed:

- Added `schedule` trigger sources with interval, weekly day/time, and one-time schedule modes.
- Added a background schedule monitor that records idempotent trigger firings and creates sessions for due occurrences.
- Updated the desktop trigger form to configure schedule triggers.
- One-time schedule triggers are disabled after their first successful run.

### Current work: timestamped signed actions and editable session titles

Completed:

- Added `action.ts` to every signed `AgentAction`; desktop signing and test helpers attach `Date.now()` before Ed25519
  signing.
- Server auth now rejects HTTP actions and WebSocket `Subscribe` envelopes whose signed timestamp is missing, invalid,
  or outside a 30-second local-time window.
- Added signed `UpdateSession` so session titles can be renamed without recreating sessions.
- Made the desktop session-page title an inline debounced editor with a grey saving dot, green saved dot, and red
  failure dot.

Design note: timestamp validation narrows replay risk but does not eliminate same-window replays; add nonce caching by
account/signer as the next hardening step.

### Current work: Agents UI route split and server page

Completed:

- Split the desktop Agents UI into separate lazy page modules for list, server, detail, and session routes.
- Added an `agent-server` route that lists agents for one configured server and exposes server-scoped actions.
- Shared the server-side HM account-key Secrets dialog and model-provider API-key Providers dialog between the Agents
  index and server page.

Design note: keep server-scoped workflows on the server page and agent-scoped workflows on the agent detail page; avoid
rebuilding a monolithic `agents.tsx` switchboard.

### Current work: Agent detail Tools tab and signing identity selection

Completed:

- Added signed `ListSigningIdentities` and `CreateSigningIdentity` actions for redacted account-scoped HM account-key
  metadata and server-side key generation.
- Added `AgentDefinition.signingKeys` and server validation that selected signing keys exist and are tagged
  `kind: 'hm-account-key'` for the signed account.
- Added an autosaving desktop Tools tab for toggling `read` and `write`, creating a new agent account in a panel when no
  keys exist, and selecting multiple HM account keys for signing and publishing tools.
- Made explicit `tools: []` disable Seed tools while preserving the legacy `read` default for agents whose definition
  omits `tools`.

### Share assistant chat rendering with Agents session UI

Completed:

- Moved shared chat rendering into `frontend/apps/desktop/src/components/assistant-message-rendering.tsx`.
- Kept the assistant panel and Agents session page on the same user/assistant bubble, markdown, streaming cursor, and
  tool-call components.
- Paired durable Agents `tool_call` / `tool_result` events by call ID before rendering them as shared tool bubbles.
- Added `read` support to the read-tool bubble so document results show as document links instead of raw JSON.

### `f9cc356a6 Add agents service milestone 1 skeleton`

Completed:

- Created the standalone `agents/` Bun workspace.
- Added config parsing, SQLite bootstrap, CBOR helpers, signed envelope auth, API service skeleton, and HTTP routes.
- Added initial tests for auth, SQLite, API service, and routes.

Design note: this established the signed CBOR control plane and separate Bun workspace boundary.

### `9ef05d304 Add agents persistence APIs`

Completed:

- Added provider/secret/session APIs.
- Added AES-GCM encrypted secrets and redacted responses.
- Added idempotency storage and migrations.
- Added durable session replay.

Design note: create actions use `clientRequestId`; message actions later use `clientMessageId` without holding long DB
transactions during model calls.

### `30271c6d1 Add desktop agents smoke-test UI`

Completed:

- Added desktop API client and React Query hooks.
- Added basic Agents page.
- Enabled signed desktop actions using daemon `signData`.
- Supported basic provider init, create agent, list agents, create sessions.

### `0a7073c66 Add agents shortcut and server settings`

Completed:

- Added desktop shortcut/menu entry for Agents.
- Added Advanced Settings management for agent server URLs.
- Added health/status display and server status GUI link.

### `c2083fdf9 Add desktop agent detail routes`

Completed:

- Added route schemas for agent and session pages.
- Added agent detail and session detail pages.
- Added hooks for fetching agent/session detail.

### `b485ffc0e Add OpenAI-backed agent chat workflow`

Completed:

- Added `UpdateAgent` and `MessageSession`.
- Added OpenAI-compatible chat-completions execution.
- Added provider secret lookup and trusted OpenAI base URL restriction.
- Added session statuses and durable assistant/error events.
- Added desktop editing and chat UI.

### `7549ab002 Make desktop agents pages scrollable`

Completed:

- Made Agents list/detail/session pages vertically scrollable.

### `2e5e21508 Add agent tool calls and live subscriptions`

Completed:

- Added signed WebSocket `Subscribe` action.
- Added service event emitter and WebSocket fanout.
- Added account/agent/session subscription keys.
- Added durable tool-call/tool-result events.
- Added `read` tool.

Design note: server-to-client WebSocket messages are JSON after signed subscription authorization; they are not
individually signed.

### `c5d49f9e6 Make hypermedia read tool always available`

Completed:

- Made `read` available regardless of saved agent definition `tools` field.
- Broadened tool input acceptance to HM IDs and web URLs.

### `3a91a0e25 Stream agent replies over live subscriptions`

Completed:

- Switched OpenAI calls to streaming.
- Added OpenAI SSE parsing.
- Added `session-partial` service events and WebSocket `appendPartial` events.
- Added desktop partial assistant row and optimistic user message behavior.

### `76f857cd5 Resolve hypermedia URLs inside read tool`

Completed:

- Removed CLI shellout from `read`.
- Resolved web URLs internally.
- Fetched resources through Seed client libraries.
- Rendered markdown in process.

### `3b55a421d Share hypermedia URL resolution with CLI`

Completed:

- Added `frontend/packages/client/src/resource-read.ts`.
- Exported `resolveIdWithClient` from the client package.
- Updated CLI resolver and agent tool to share the helper.

### `4c5740135 Refactor desktop agents provider and create dialogs`

Completed:

- Added standalone `ModelProvidersDialog`.
- Added standalone `CreateAgentDialog`.
- Added `ListModelProviders` API/hook.
- Added UI support for saving OpenAI, Anthropic, and Google provider records/secrets.

Caveat: only OpenAI execution is implemented.

### `dc3605273 Document agents system knowledgebase`

Completed:

- Added first-generation `agents/docs` knowledgebase.

### `168efd822 Render agent replies with streaming markdown`

Completed:

- Exported `AssistantMessageParts` from desktop assistant panel.
- Reused it in Agents session chat.
- Rendered durable assistant messages and live partials as markdown with the same cursor/link behavior as the assistant
  panel.

### `b4b30eb1c Add agents session inspector UI`

Completed:

- Expanded `/agents` from a minimal status page into a live session inspector.
- Added `/agents/api/status` overview with agents, sessions, event counts, and connection count.
- Added `/agents/api/session?id=<sessionId>` for session event inspection.
- Added a richer `agents/src/frontend/app.tsx` diagnostic UI.

### Shared Agents protocol package

Completed:

- Added private package `@seed-hypermedia/agents-protocol` in `agents/protocol`.
- Moved canonical action, response, session event, and WebSocket event types into the shared package.
- Changed `agents/src/api.ts` to re-export the package for service-local compatibility.
- Changed desktop `agents-client.ts` to alias protocol types from the shared package instead of mirroring unions.
- Added Bun and desktop package dependencies so both runtimes compile against one protocol source.

Design note: this eliminates server/desktop protocol drift while keeping the package TypeScript-only and runtime-neutral
for Bun and Vite.

### `f39d21045 Fix agent streaming subscription diagnostics`

Completed:

- Added safe OpenAI streaming diagnostics.
- Added WebSocket subscription/fanout diagnostics.
- Added desktop WebSocket diagnostics.
- Hardened desktop WebSocket message parsing for string, Blob, and ArrayBuffer payloads.
- Fixed `Subscribe` invalid-signature failures caused by signing explicit `undefined` fields.
- Added recursive `omitUndefined()` before desktop signs agent actions.
- Kept partial text visible until durable assistant append arrives.
- Hardened SSE parsing for CRLF separators and final buffered events.

### Pi SDK model execution migration

Completed:

- Added `@mariozechner/pi-coding-agent` to the Bun agents service.
- Replaced the primary `MessageSession` model path with `#runPiAgent()`.
- Created per-run in-memory Pi auth, model registry, settings, resource loader, and session manager.
- Disabled Pi resource discovery and default coding tools for Seed Agents.
- Registered `read` as a Seed-owned Pi custom tool.
- Translated Pi text/tool/final/error events into existing Seed WebSocket partials and durable session events.
- Added mocked streaming OpenAI-compatible coverage for text, tool calls, and provider failure persistence.

Caveats:

- Anthropic and Google are mapped through Pi but still need real-provider smoke tests.

## Current feature baseline after these commits

The feature is locally usable from the desktop app with OpenAI-compatible providers through the Pi SDK-backed runtime.
The best manual acceptance test is:

1. Start agents service.
2. Start desktop.
3. Open Agents.
4. Configure an OpenAI provider.
5. Create an agent.
6. Create/open a session.
7. Send a message.
8. Confirm user message appears optimistically.
9. Confirm WebSocket subscription succeeds.
10. Confirm assistant response streams as markdown.
11. Confirm final durable assistant event remains after refresh.
12. Ask the agent to read an HM/web URL and confirm tool events appear.

## Validation history worth remembering

Recent successful commands during this work:

```bash
direnv exec . bash -lc 'cd agents && bun check && bun test'
direnv exec . bash -lc 'pnpm typecheck'
direnv exec . bash -lc 'pnpm test'
direnv exec . bash -lc 'pnpm --filter @shm/desktop test:unit src/__tests__/assistant-panel.test.tsx src/__tests__/markdown.test.tsx'
```

Known validation caveat:

```bash
direnv exec . bash -lc 'pnpm audit'
```

currently fails due existing repository dependency advisories unrelated to Agents.
