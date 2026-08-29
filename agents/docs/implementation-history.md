# Implementation history

This document summarizes the recent commits that built the Agents feature. Keep it updated when a new milestone lands so
future agents can reconstruct why the system looks the way it does.

## Recent commit notes

### Agent introspection: ~/triggers/, ~/self, thread listing (2026-08-18/19)

Agents became introspective: they can read everything about themselves and manage their own automations. Three
additions, all riding the existing tables (no protocol deletions, no migrations):

- **`~/triggers/` through the verbs.** `read ~/triggers/` lists the agent's triggers with the write contract inline;
  `read ~/triggers/<name>` returns one trigger (source, prompt markdown, continuation, recent firings);
  `write ~/triggers/<name>` creates, edits, enables, disables, or deletes by name or id, validated by the same
  normalizers the signed CRUD actions use, with `enabled` honored as written (default true). A draft→active consent gate
  was built first and then **removed on the owner's direction** — agents enable and disable their own triggers directly,
  with no approval step; `security.md` records the threat-model tradeoff. Trigger writes emit `trigger-updated` account
  events so the desktop Triggers tab updates live.
- **`read ~/self`.** The agent's own record: definition (name, model, provider, reasoning level, system prompt), grants,
  signing-key names, triggers, memory summary, session count, and guidance on what it can and cannot change.
- **`read thread:`** (bare address) lists the account's conversations newest-first and searches them — titles plus a
  bounded scan of recent message text with snippets (`options {query, agentId, limit}`).

The Space index now always advertises the triggers affordance and names active triggers, so "do this every morning" is a
request the agent can complete in one turn. Docs: `tools.md`, `security.md`, `persistence.md`, `agent-triggers-plan.md`,
`m6-event-bus-design.md`.

### Agent invitations and collaborators

Agents can now be shared with Seed accounts through explicit pending invitations and accepted reader/writer roles. The
SQLite membership row never changes ownership: every existing agent/session/run query still executes against the owner's
account after one centralized access-resolution check. Readers can inspect the complete agent; writers can mutate and
interact; collaborator management and deletion remain owner-only. Signed WebSocket subscriptions use the same check and
durable service events fan out to accepted collaborators. Desktop adds pending invites to the Agents index and reuses
the document collaborator account-search pattern in Agent Settings for invites, roles, revocation, and read-only states.

### Remote agent content sync hardening

The desktop already discovered `hm://` references from open agent sessions, but the implementation issued one request
and permanently deduplicated it. That request could race the desktop's connection to the remote HM peer or return a
cached discovery result from before the agent published, leaving a newly created document/comment unavailable when its
link was clicked. Open session WebSockets now turn structured tool-result and assistant-message references into normal
live desktop sync subscriptions, recursive for comments, and release them when the session closes. This lifecycle is
strictly mounted-session scoped: account/agent sockets and non-selected background sessions do nothing. The write verb's
registry extractor again covers its actual document/comment result fields after the five-verb migration and includes
exact document versions.

### The Harness — three nouns, five verbs (2026-08-11 → 2026-08-13)

The tool surface was rebuilt from the ground up on a stack of `harness/*` milestone branches, each gated (full suite,
adversarial self-review, simulated-model gate) and written up in `docs/harness/reviews/`. Architecture and vocabulary:
`docs/harness/plan.md` and `docs/glossary.md`. Breaking changes were preferred over aliases throughout — old tool names
simply stopped existing, and stored transcripts keep their historical events without re-dispatching.

- **M1 — the five verbs.** `protocol/src/tool-registry.ts` was rewritten: `seedVerbRegistry` is `read`, `write`, `call`,
  `delegate`, `plan` plus the hidden `return_result`; `callableToolRegistry` is `search`, `web_search`, `navigate`,
  `execute`, reachable only through `call`. `api-service.ts` gained the three address dispatchers (`executeReadVerb` /
  `executeWriteVerb` / `executeCallVerb`). `delegate` absorbed `sub_session`, `run_workflow`, and `start_session`;
  `plan` absorbed `update_plan`; `set_session_title` was deleted. Provider-facing tool bytes fell 71% (28,886 → 8,483).
  Calling a tool with wrong input returns its **contract** instead of an error, and the retry runs.
- **M2 — tools as documents.** `src/tool-documents.ts` and the `tool_documents` table: every tool is a content-addressed
  document (canonical DAG-CBOR, CIDv1) under `~/tools/`, builtins upserted at boot, lambdas authored through `write`.
  `buildSpaceIndex()` injects one byte-budgeted `<space>` block into every system prompt, cached per agent and
  invalidated at each mutation site. Touch-expand **promotion** is derived from durable events, so it survives resume
  and restart. Signed public writing moved behind the **publish grant**.
- **M3 — the symmetric log.** `SessionActor` (`user | agent | system | trigger`) stamps every event, and the
  `InvokeSessionTool` action lets the user run `read`/`write`/`call` through the exact dispatchers the agent uses, on
  the same log. The agent reads them back as `<user_action>` frames on its next turn. Desktop: the wrench palette and
  the "You" chip.
- **M4 — execution.** `execute {runtime: 'ts' | 'python' | 'shell', code}` (`CODE_EXEC_RUNTIMES`) is the whole compute
  surface, each runtime one argv command in a microVM. TypeScript is an operator opt-in (`SEED_AGENTS_EXEC_TS_IMAGE`)
  and is not offered when unconfigured. Authored `~/tools/**` lambdas became callable by name: input validated outside
  the VM, source executed, output validated against the tool's own schema.
- **M5 — time.** `RunWait` grew `event` and `budget-pause` beside `children`/`timer`, backed by the `run_event_waits`
  table; `ctx.waitForEvent`, `ctx.continueAsNew` (successors linked by `continued_from_run_id`, not parent), and the new
  `SignalRun` action. Delivery is exactly-once by construction — journal write and requeue in one transaction. The card
  gained `ParkedRunActions`: Answer, Answer with data, Resume.
- **M6 first slice — the event bus.** `run-completed` joined the trigger sources, firing inline from `#onRunFinalized`;
  triggers gained a **continuation** (`agent_triggers.continuation_cbor`, NULL = `newThread`) with `wake` delivering
  into a parked run through the same path `SignalRun` uses; `#triggerAlreadyInChain` walks the firing chain
  (`TRIGGER_CHAIN_MAX_HOPS`, 8) to stop trigger ping-pong; `matchesActivityCriteria` is now one matcher shared by
  trigger matching and run event waits. Trigger **documents** and draft→active consent are designed in
  `docs/harness/m6-event-bus-design.md` and deliberately not built.
- **Obligations and settlement** (after M6, `918084d75` and `9f56ccdda`). One model of what a run owes —
  `#openObligations`, one continuation loop, `MAX_RUN_CONTINUATIONS` of 3 — replaced the per-feature nudges. Spending
  the budget ends the run honestly: `unmetObligations` on the output and `RunInfo` plus a visible notice, never an
  auto-checked step (typed debt fails the run; plan debt succeeds owing it). Every runtime-authored message is durably
  `actor: 'system'`. Each turn's replay ends with an ephemeral `<plan_state>` block so a resumed model can see its own
  checklist, and a step whose attached children all succeeded is settled by the runtime
  (`RunPlanStep.resolvedBy: 'runtime'`; originally shown as a muted "auto" affix, later dropped since the clickable
  sub-agent row already carries the provenance); `RunPlan.settledAt` freezes a finished checklist
  into the log. Model- authored step ids and labels are escaped before being framed back to the model.
- **Verification.** `agents/e2e/live-gate.ts` runs scripted scenarios against a real server and model;
  `e2e/scripted-provider.ts` plus `e2e/obligations-live-check.ts` and `e2e/narration-check.ts` drive deterministic live
  checks without provider credits. `HARNESS-TESTING.html` at the repo root is the manual test guide. Suite at the end of
  this work: **282 pass / 0 fail** across 25 files.

### Durable runs, sub-sessions, and the workflow engine (2026-08-03)

Landed as ten commits on `feat/agent-workflows` implementing `agents/docs/workflows-v1-plan.md`. The first four:

- `feat(agents): durable runs table + dispatch queue under every agent execution` — every execution is a `runs` row; the
  table is the dispatch queue (leases, interactive/background, one-live-run-per-session, boot sweep + interrupted
  tool_call repair); `sessions.status` became a derived mirror, killing the wedged-`streaming` crash mode; usage
  persists per turn and rolls up child→parent; session lineage columns landed; also fixed a schedule-trigger
  clock-mixing flake.
- `feat(agents): sub_session tool — awaited child sessions with park/resume and typed results` — awaited delegation with
  total context isolation, turn parking (refuse-next-provider-request), child finalizers appending the durable
  tool_result and requeuing the parent, typed `return_result` validation with bounded retries, run actions
  (GetRun/ListRuns/CancelRun/GetRunJournal) and the `runs/<rootRunId>` WS key.
- `feat(agents): QuickJS workflow engine — journaled deterministic runs behind run_workflow` — agent-authored JS
  orchestration with journal replay-from-top resume, determinism lint + realm, sync-VM effect pump (true parallel
  fan-out), fuel/memory/journal caps, timer parking, its own concurrency pool, and `ctx.step`/`ctx.plan` progress.
- `feat(agents): update_plan todo tool + Tier-3 live-model validation harness` — always-available todo snapshots on
  `sessions.plan_cbor`, plus `agents/e2e/run.ts`, the manual real-model gate (default `gpt-5-mini`) asserting on durable
  state with transcript artifacts.

The same day continued through six more commits:

- `docs(agents)` routing-table pass, plus desktop UX (`feat(desktop)` ×2): the pinned `SessionRunCard`
  (active/parked/terminal-chip/todo states, durable-first from `ListRuns` + the `runs/<rootRunId>` subscription replay),
  the collapsed Activity drawer tailing the run tree's journal, session nesting with lazy disclosures in both list
  surfaces, and child-page breadcrumb/banner/composer-lock.
- `fix(agents): six confirmed findings from the adversarial review pass` — a 13-agent review workflow (4 dimensions +
  adversarial verification) over the branch diff confirmed: an interactive-claim TOCTOU that could double-execute a
  session (same-session exclusion added to the inline claim; refused claims withdraw + 409); journal matching by arrival
  order diverging on `ctx.parallel` continuation reordering (empirically reproduced by the verifier; replaced with
  content-keyed matching — `nondeterministic-replay` no longer exists as a failure mode); `DeleteAgent` FK-crashing on
  run rows (any agent that ever executed was undeletable); crash-window stranding of parked parents (boot reconcile
  pass + unconditional wait resolution); `DeleteSession` stranding parked parents (live trees canceled before detach);
  and a `ListSessions` default that hid agent-started sessions from older clients (default flipped to inclusive;
  exclusion needs explicit `includeChildren: false`).
- `fix(agents,desktop): delegation works out of the box; sessions never list twice` — root cause of the first live
  report: existing agents' saved tool arrays predate `sub_session`/`run_workflow`, so real models fell back to
  fire-and-forget `start_session` (children invisible to the card, no resume). Both delegation tools became
  always-available like `start_session`; `start_session` children joined the caller's run tree while keeping detached
  turn semantics; both session-list surfaces filter to top-level rows client-side. Verified by three full-stack repros
  driving `bun src/main.ts` over signed HTTP with a scripted local provider.
- `feat(agents): simulated-model validation pass` — with the OpenAI key exhausted, blind Claude-subagent simulated-model
  gates (see `operations.md`) validated delegation choice and workflow authoring; their guessed-at-contract lists drove
  bare-string `ctx.plan` steps and the contract-tight ctx documentation in the tool descriptions.

Validation at head: `bun check` clean; 174 `bun test` tests (park/resume fan-out, typed-validation retry,
restart-while-parked, crash recovery, queue semantics, 19 workflow-engine determinism/fault-injection tests including
the continuation-reordering replay regression); desktop 567 vitest tests. The Tier-3 live-model gate ran against the
real OpenAI endpoint but remains blocked on account credits.

### Sandboxed code execution (`execute_code`)

Completed:

- Added `agents/src/code-exec.ts`: an injectable executor over the embedded `microsandbox` npm runtime (napi-rs native
  bindings; libkrun microVMs on macOS/Linux, WHP on Windows — no separate server process). Each call boots a fresh
  ephemeral, `restricted`-profile sandbox with the agent's memory bind-mounted at `/workspace` as cwd, a guest write
  quota from the remaining memory budget, capped cpus/memory/timeout/lifetime, and networking disabled by default.
- `execute_code` tool (python | shell) returns exit code, bounded stdout/stderr, duration, and a `changedFiles` memory
  diff; changes emit `agent-memory-changed` so the Memory tab refreshes live. System prompt documents the workspace
  mount and the fresh-sandbox model when the tool is enabled.
- Config under `exec` (`SEED_AGENTS_EXEC_*`), health `codeExec` capability, desktop Tools-tab "Execute code" group
  greyed out when the server disables the backend.
- Unit tests drive a fake SDK (mount/quota/timeout/diff/truncation assertions); verified end-to-end on Apple Silicon
  with a real microVM run that read and wrote bind-mounted memory files.

### Per-agent memory filesystem (`memory_*` tools + Memory tab)

Completed:

- Added `agents/src/agent-memory.ts`: a sandboxed per-agent filesystem at `<stateDir>/memory` with list/read/write/
  delete operations, strict relative-path validation (no `..`, no absolute paths, symlinks refused), and size limits (1
  MiB/file, 100 MiB/agent, 2000 entries).
- Registered a four-tool memory cluster (`memory_list`, `memory_read`, `memory_write`, `memory_delete`) in the shared
  tool registry and wired it into Pi execution; when enabled, the system prompt tells the model to check memory at task
  start and store durable learnings.
- Added signed actions `ListAgentMemory` / `ReadAgentMemoryFile` / `WriteAgentMemoryFile` / `DeleteAgentMemoryFile` so
  users have the same full access as the agent; writes emit `agent-memory-changed` account-change events, also fanned
  out to `agents/<agentId>` WebSocket subscribers.
- Added the desktop Memory tab (`pages/agents/memory.tsx`): file list with inline delete confirmation, monospace editor
  with Save/Revert, and new-file creation; memory tools are part of `DEFAULT_AGENT_TOOLS` and toggleable as a Tools-tab
  group.
- Unit tests for sandboxing/limits (`src/agent-memory.test.ts`) and a signed-action round-trip test including
  cross-account denial (`src/api-service.test.ts`).
- Second iteration added binary/media support: files are UTF-8 text or raw bytes (model never receives binary content),
  `memory_download` streams web files into memory with a 100 MiB cap and content-type-derived naming,
  `memory_upload_ipfs` publishes memory files through the HM server's `/ipfs/file-upload` endpoint for use in Hypermedia
  content, matching signed actions (`DownloadAgentMemoryFile`, `UploadAgentMemoryFileToIpfs`) give the user the same
  powers, and the Memory tab gained media previews, per-file downloads, local-file upload (button and drag-and-drop onto
  the list or a specific folder row), URL download, and IPFS publishing with copyable `ipfs://` URLs. Memory-enabled
  system prompts embed an automatic `<memory_files>` top-level listing (root files/folders with file counts, subfolders
  unexpanded) so agents start sessions already knowing what they remember.

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

Design decisions (the original recommendation proposed a heavier six-part suite; it was cut for "reliable + easy to host
on a small single server"):

- **SearXNG — kept.** The only realistic self-hostable JSON search API; no substitute. It has no index and federates
  public engines, so datacenter-IP rate limiting is the main failure mode — mitigated by engine-rotation retry and the
  `degraded` flag rather than a hard dependency on any one engine.
- **Crawl4AI — kept, optional.** Apache-2.0, one container, clean `/md` markdown. Used as the escalation tier only,
  because its headless Chromium wants >=4 GB RAM; the lightweight tiers cover the common case so the browser is reserved
  for pages that need it.
- **MediaWiki adapter + static extraction — kept as in-process code, not services.** They add reliability without ops
  surface. Trafilatura (the original static pick) was replaced by `@mozilla/readability` + Turndown because the agents
  service is Bun, not Python, so extraction runs in-process with no sidecar.
- **ReaderLM-v2 — dropped.** CC-BY-NC license (commercial blocker) and needs a GPU; heuristic extraction covers clean
  articles at a fraction of the cost.
- **ArchiveBox — dropped.** Heavy Django + Chromium + worker stack whose output is archival artifacts (WARC/PDF), not
  agent-ready markdown.
- **Firecrawl (self-hosted) — not adopted.** 5–7 containers, ~8 GB RAM, no self-hosted fire-engine, and its search needs
  SearXNG anyway, so SearXNG + Crawl4AI strictly dominates it on the hosting axis.
- **Wayback / archive.today — dropped for v1.** They call third-party archives, which conflicts with the "fully
  self-hostable, no third-party API keys" requirement; can be revisited later as an opt-in fallback.

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
