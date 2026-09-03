---
name: Implementation history
summary: This document summarizes the recent commits that built the Agents feature. Keep it updated when a new milestone lands so future agents can reconstruct why…
---
This document summarizes the recent commits that built the Agents feature. Keep it updated when a new milestone lands so future agents can reconstruct why the system looks the way it does. <!-- id:FZZdraTx -->

# Recent commit notes <!-- id:xsXKBian -->

## MCP servers as tool documents (2026-08-28) <!-- id:o-UZo_et -->

Remote Model Context Protocol servers, rebuilt from the pre-verbs PR #823 onto the harness. An account connects a server (`mcp_servers`, one new table and migration) the way it configures a model provider; an agent enables servers by name (`definition.mcpServers`). Nothing was added to the model-facing surface: every tool a server advertises becomes an `mcp` **tool document** named `<server>__<tool>` in the agent's `~/tools/` (`syncMcpToolDocuments`), so it rides the existing rails — Space index, `read ~/tools/<name>`, `call` with touch-expand, promotion — and a large server collapses to one index line. Discovery runs on save (the response says "connected, N tools" or the failure; a failed discovery still saves and keeps the last good list), on refresh, and quietly whenever a run connects. Connections are lazy and per run (`McpConnectionPool` in the agent turn, script `ctx.call`, and the user's palette verb), closed with the run. `executeMcpTool` re-checks the grant before proxying, throws server and transport errors as `tool_result.error`, and hands image content to vision models inline. Promotion now also covers the agent's own enabled documents (lambdas and MCP projections), defined from the document itself. Desktop/web Tools tab gained the MCP servers section (`mcp-servers.tsx`): per-agent checkbox rows with status/tool-count chips, inline tool lists, a URL-first add dialog that connects on save. Docs: new `mcp.md`, plus `tools.md`, `security.md`, `persistence.md`, `signed-api.md`, `desktop-ui.md`, `glossary.md`. <!-- id:id8dw_d2 -->

## Agent introspection: \~/triggers/, \~/self, thread listing (2026-08-18/19) <!-- id:cKsFvkIl -->

Agents became introspective: they can read everything about themselves and manage their own automations. Three additions, all riding the existing tables (no protocol deletions, no migrations): <!-- id:LearYzTP -->
  - **`~/triggers/` through the verbs.** `read ~/triggers/` lists the agent's triggers with the write contract inline; `read ~/triggers/<name>` returns one trigger (source, prompt markdown, continuation, recent firings); `write ~/triggers/<name>` creates, edits, enables, disables, or deletes by name or id, validated by the same normalizers the signed CRUD actions use, with `enabled` honored as written (default true). A draft→active consent gate was built first and then **removed on the owner's direction** — agents enable and disable their own triggers directly, with no approval step; `security.md` records the threat-model tradeoff. Trigger writes emit `trigger-updated` account events so the desktop Triggers tab updates live. <!-- id:42dRZ8mu -->
  - **`read ~/self`.** The agent's own record: definition (name, model, provider, reasoning level, system prompt), grants, signing-key names, triggers, memory summary, session count, and guidance on what it can and cannot change. <!-- id:E_6JuDnx -->
  - **`read thread:`** (bare address) lists the account's conversations newest-first and searches them — titles plus a bounded scan of recent message text with snippets (`options {query, agentId, limit}`). <!-- id:K77xjOaO -->

The Space index now always advertises the triggers affordance and names active triggers, so "do this every morning" is a request the agent can complete in one turn. Docs: `tools.md`, `security.md`, `persistence.md`, `agent-triggers-plan.md`, `m6-event-bus-design.md`. <!-- id:MmtbXrQ2 -->

## Agent invitations and collaborators <!-- id:RGUoi8e5 -->

Agents can now be shared with Seed accounts through explicit pending invitations and accepted reader/writer roles. The SQLite membership row never changes ownership: every existing agent/session/run query still executes against the owner's account after one centralized access-resolution check. Readers can inspect the complete agent; writers can mutate and interact; collaborator management and deletion remain owner-only. Signed WebSocket subscriptions use the same check and durable service events fan out to accepted collaborators. Desktop adds pending invites to the Agents index and reuses the document collaborator account-search pattern in Agent Settings for invites, roles, revocation, and read-only states. <!-- id:kc2pOhCs -->

## Remote agent content sync hardening <!-- id:8oj0vOOk -->

The desktop already discovered `hm://` references from open agent sessions, but the implementation issued one request and permanently deduplicated it. That request could race the desktop's connection to the remote HM peer or return a cached discovery result from before the agent published, leaving a newly created document/comment unavailable when its link was clicked. Open session WebSockets now turn structured tool-result and assistant-message references into normal live desktop sync subscriptions, recursive for comments, and release them when the session closes. This lifecycle is strictly mounted-session scoped: account/agent sockets and non-selected background sessions do nothing. The write verb's registry extractor again covers its actual document/comment result fields after the five-verb migration and includes exact document versions. <!-- id:j3FeN5Il -->

## The Harness — three nouns, five verbs (2026-08-11 → 2026-08-13) <!-- id:Ix8z81xY -->

The tool surface was rebuilt from the ground up on a stack of `harness/*` milestone branches, each gated (full suite, adversarial self-review, simulated-model gate) and written up in `docs/harness/reviews/`. Architecture and vocabulary: `docs/harness/plan.md` and `docs/glossary.md`. Breaking changes were preferred over aliases throughout — old tool names simply stopped existing, and stored transcripts keep their historical events without re-dispatching. <!-- id:kgw1Hfuk -->
  - **M1 — the five verbs.** `protocol/src/tool-registry.ts` was rewritten: `seedVerbRegistry` is `read`, `write`, `call`, `delegate`, `plan` plus the hidden `return_result`; `callableToolRegistry` is `search`, `web_search`, `navigate`, `execute`, reachable only through `call`. `api-service.ts` gained the three address dispatchers (`executeReadVerb` / `executeWriteVerb` / `executeCallVerb`). `delegate` absorbed `sub_session`, `run_workflow`, and `start_session`; `plan` absorbed `update_plan`; `set_session_title` was deleted. Provider-facing tool bytes fell 71% (28,886 → 8,483). Calling a tool with wrong input returns its **contract** instead of an error, and the retry runs. <!-- id:sgjBQnVr -->
  - **M2 — tools as documents.** `src/tool-documents.ts` and the `tool_documents` table: every tool is a content-addressed document (canonical DAG-CBOR, CIDv1) under `~/tools/`, builtins upserted at boot, lambdas authored through `write`. `buildSpaceIndex()` injects one byte-budgeted `<space>` block into every system prompt, cached per agent and invalidated at each mutation site. Touch-expand **promotion** is derived from durable events, so it survives resume and restart. Signed public writing moved behind the **publish grant**. <!-- id:fVTssS5B -->
  - **M3 — the symmetric log.** `SessionActor` (`user | agent | system | trigger`) stamps every event, and the `InvokeSessionTool` action lets the user run `read`/`write`/`call` through the exact dispatchers the agent uses, on the same log. The agent reads them back as `<user_action>` frames on its next turn. Desktop: the wrench palette and the "You" chip. <!-- id:iyMomqNZ -->
  - **M4 — execution.** `execute {runtime: 'ts' | 'python' | 'shell', code}` (`CODE_EXEC_RUNTIMES`) is the whole compute surface, each runtime one argv command in a microVM. TypeScript is an operator opt-in (`SEED_AGENTS_EXEC_TS_IMAGE`) and is not offered when unconfigured. Authored `~/tools/**` lambdas became callable by name: input validated outside the VM, source executed, output validated against the tool's own schema. <!-- id:t9yOO-tE -->
  - **M5 — time.** `RunWait` grew `event` and `budget-pause` beside `children`/`timer`, backed by the `run_event_waits` table; `ctx.waitForEvent`, `ctx.continueAsNew` (successors linked by `continued_from_run_id`, not parent), and the new `SignalRun` action. Delivery is exactly-once by construction — journal write and requeue in one transaction. The card gained `ParkedRunActions`: Answer, Answer with data, Resume. <!-- id:JqCQTUEI -->
  - **M6 first slice — the event bus.** `run-completed` joined the trigger sources, firing inline from `#onRunFinalized`; triggers gained a **continuation** (`agent_triggers.continuation_cbor`, NULL = `newThread`) with `wake` delivering into a parked run through the same path `SignalRun` uses; `#triggerAlreadyInChain` walks the firing chain (`TRIGGER_CHAIN_MAX_HOPS`, 8) to stop trigger ping-pong; `matchesActivityCriteria` is now one matcher shared by trigger matching and run event waits. Trigger **documents** and draft→active consent are designed in `docs/harness/m6-event-bus-design.md` and deliberately not built. <!-- id:7vacoaHo -->
  - **Obligations and settlement** (after M6, `918084d75` and `9f56ccdda`). One model of what a run owes — `#openObligations`, one continuation loop, `MAX_RUN_CONTINUATIONS` of 3 — replaced the per-feature nudges. Spending the budget ends the run honestly: `unmetObligations` on the output and `RunInfo` plus a visible notice, never an auto-checked step (typed debt fails the run; plan debt succeeds owing it). Every runtime-authored message is durably `actor: 'system'`. Each turn's replay ends with an ephemeral `<plan_state>` block so a resumed model can see its own checklist, and a step whose attached children all succeeded is settled by the runtime (`RunPlanStep.resolvedBy: 'runtime'`; originally shown as a muted "auto" affix, later dropped since the clickable sub-agent row already carries the provenance); `RunPlan.settledAt` freezes a finished checklist into the log. Model- authored step ids and labels are escaped before being framed back to the model. <!-- id:tsCCq1MJ -->
  - **Verification.** `agents/e2e/live-gate.ts` runs scripted scenarios against a real server and model; `e2e/scripted-provider.ts` plus `e2e/obligations-live-check.ts` and `e2e/narration-check.ts` drive deterministic live checks without provider credits. `HARNESS-TESTING.html` at the repo root is the manual test guide. Suite at the end of this work: **282 pass / 0 fail** across 25 files. <!-- id:GnY_dAPe -->

## Durable runs, sub-sessions, and the workflow engine (2026-08-03) <!-- id:Z2o9amfM -->

Landed as ten commits on `feat/agent-workflows` implementing `agents/docs/workflows-v1-plan.md`. The first four: <!-- id:VzBeH5Eu -->
  - `feat(agents): durable runs table + dispatch queue under every agent execution` — every execution is a `runs` row; the table is the dispatch queue (leases, interactive/background, one-live-run-per-session, boot sweep + interrupted tool_call repair); `sessions.status` became a derived mirror, killing the wedged-`streaming` crash mode; usage persists per turn and rolls up child→parent; session lineage columns landed; also fixed a schedule-trigger clock-mixing flake._ <!-- id:tY3xjG6u -->
  - `feat(agents): sub_session tool — awaited child sessions with park/resume and typed results` — awaited delegation with total context isolation, turn parking (refuse-next-provider-request), child finalizers appending the durable tool_result and requeuing the parent, typed `return_result` validation with bounded retries, run actions (GetRun/ListRuns/CancelRun/GetRunJournal) and the `runs/<rootRunId>` WS key._ <!-- id:IemtVANH -->
  - `feat(agents): QuickJS workflow engine — journaled deterministic runs behind run_workflow` — agent-authored JS orchestration with journal replay-from-top resume, determinism lint + realm, sync-VM effect pump (true parallel fan-out), fuel/memory/journal caps, timer parking, its own concurrency pool, and `ctx.step`/`ctx.plan` progress. <!-- id:j6smgqMd -->
  - `feat(agents): update_plan todo tool + Tier-3 live-model validation harness` — always-available todo snapshots on `sessions.plan_cbor`, plus `agents/e2e/run.ts`, the manual real-model gate (default `gpt-5-mini`) asserting on durable state with transcript artifacts. <!-- id:N9L0x5GY -->

The same day continued through six more commits: <!-- id:E2_RRXRT -->
  - `docs(agents)` routing-table pass, plus desktop UX (`feat(desktop)` ×2): the pinned `SessionRunCard` (active/parked/terminal-chip/todo states, durable-first from `ListRuns` + the `runs/<rootRunId>` subscription replay), the collapsed Activity drawer tailing the run tree's journal, session nesting with lazy disclosures in both list surfaces, and child-page breadcrumb/banner/composer-lock. <!-- id:qSn0ddCc -->
  - `fix(agents): six confirmed findings from the adversarial review pass` — a 13-agent review workflow (4 dimensions + adversarial verification) over the branch diff confirmed: an interactive-claim TOCTOU that could double-execute a session (same-session exclusion added to the inline claim; refused claims withdraw + 409); journal matching by arrival order diverging on `ctx.parallel` continuation reordering (empirically reproduced by the verifier; replaced with content-keyed matching — `nondeterministic-replay` no longer exists as a failure mode); `DeleteAgent` FK-crashing on run rows (any agent that ever executed was undeletable); crash-window stranding of parked parents (boot reconcile pass + unconditional wait resolution); `DeleteSession` stranding parked parents (live trees canceled before detach); and a `ListSessions` default that hid agent-started sessions from older clients (default flipped to inclusive; exclusion needs explicit `includeChildren: false`). <!-- id:jYbR0f-G -->
  - `fix(agents,desktop): delegation works out of the box; sessions never list twice` — root cause of the first live report: existing agents' saved tool arrays predate `sub_session`/`run_workflow`, so real models fell back to fire-and-forget `start_session` (children invisible to the card, no resume). Both delegation tools became always-available like `start_session`; `start_session` children joined the caller's run tree while keeping detached turn semantics; both session-list surfaces filter to top-level rows client-side. Verified by three full-stack repros driving `bun src/main.ts` over signed HTTP with a scripted local provider. <!-- id:eQmzuLPH -->
  - `feat(agents): simulated-model validation pass` — with the OpenAI key exhausted, blind Claude-subagent simulated-model gates (see `operations.md`) validated delegation choice and workflow authoring; their guessed-at-contract lists drove bare-string `ctx.plan` steps and the contract-tight ctx documentation in the tool descriptions. <!-- id:MRwcBdrd -->

Validation at head: `bun check` clean; 174 `bun test` tests (park/resume fan-out, typed-validation retry, restart-while-parked, crash recovery, queue semantics, 19 workflow-engine determinism/fault-injection tests including the continuation-reordering replay regression); desktop 567 vitest tests. The Tier-3 live-model gate ran against the real OpenAI endpoint but remains blocked on account credits. <!-- id:UOr3wvas -->

## Sandboxed code execution (`execute_code`) <!-- id:PVfKuIH4 -->

Completed: <!-- id:WPFWetcO -->
  - Added `agents/src/code-exec.ts`: an injectable executor over the embedded `microsandbox` npm runtime (napi-rs native bindings; libkrun microVMs on macOS/Linux, WHP on Windows — no separate server process). Each call boots a fresh ephemeral, `restricted`-profile sandbox with the agent's memory bind-mounted at `/workspace` as cwd, a guest write quota from the remaining memory budget, capped cpus/memory/timeout/lifetime, and networking disabled by default. <!-- id:0o5ZJMdB -->
  - `execute_code` tool (python | shell) returns exit code, bounded stdout/stderr, duration, and a `changedFiles` memory diff; changes emit `agent-memory-changed` so the Memory tab refreshes live. System prompt documents the workspace mount and the fresh-sandbox model when the tool is enabled. <!-- id:1umJHs5c -->
  - Config under `exec` (`SEED_AGENTS_EXEC_*`), health `codeExec` capability, desktop Tools-tab "Execute code" group greyed out when the server disables the backend. <!-- id:5iNXlzZO -->
  - Unit tests drive a fake SDK (mount/quota/timeout/diff/truncation assertions); verified end-to-end on Apple Silicon with a real microVM run that read and wrote bind-mounted memory files. <!-- id:X3BUdbfN -->

## Per-agent memory filesystem (`memory_*` tools + Memory tab) <!-- id:P_l7T9KR -->

Completed: <!-- id:uDLJFEFx -->
  - Added `agents/src/agent-memory.ts`: a sandboxed per-agent filesystem at `<stateDir>/memory` with list/read/write/ delete operations, strict relative-path validation (no `..`, no absolute paths, symlinks refused), and size limits (1 MiB/file, 100 MiB/agent, 2000 entries). <!-- id:kPpGLXs6 -->
  - Registered a four-tool memory cluster (`memory_list`, `memory_read`, `memory_write`, `memory_delete`) in the shared tool registry and wired it into Pi execution; when enabled, the system prompt tells the model to check memory at task start and store durable learnings. <!-- id:k2iRXdwi -->
  - Added signed actions `ListAgentMemory` / `ReadAgentMemoryFile` / `WriteAgentMemoryFile` / `DeleteAgentMemoryFile` so users have the same full access as the agent; writes emit `agent-memory-changed` account-change events, also fanned out to `agents/<agentId>` WebSocket subscribers. <!-- id:npPnW2O1 -->
  - Added the desktop Memory tab (`pages/agents/memory.tsx`): file list with inline delete confirmation, monospace editor with Save/Revert, and new-file creation; memory tools are part of `DEFAULT_AGENT_TOOLS` and toggleable as a Tools-tab group. <!-- id:JP7_9BPi -->
  - Unit tests for sandboxing/limits (`src/agent-memory.test.ts`) and a signed-action round-trip test including cross-account denial (`src/api-service.test.ts`). <!-- id:jWIpSvto -->
  - Second iteration added binary/media support: files are UTF-8 text or raw bytes (model never receives binary content), `memory_download` streams web files into memory with a 100 MiB cap and content-type-derived naming, `memory_upload_ipfs` publishes memory files through the HM server's `/ipfs/file-upload` endpoint for use in Hypermedia content, matching signed actions (`DownloadAgentMemoryFile`, `UploadAgentMemoryFileToIpfs`) give the user the same powers, and the Memory tab gained media previews, per-file downloads, local-file upload (button and drag-and-drop onto the list or a specific folder row), URL download, and IPFS publishing with copyable `ipfs://` URLs. Memory-enabled system prompts embed an automatic `<memory_files>` top-level listing (root files/folders with file counts, subfolders unexpanded) so agents start sessions already knowing what they remember. <!-- id:RgP9Ujgw -->

## Web research tools (`web_search`, `web_read`) <!-- id:5al1yD3G -->

Completed: <!-- id:4afPEKoL -->
  - Added `agents/src/web-tools.ts` implementing two self-hosted, key-free web tools. <!-- id:wZmwI7gh -->
  - `web_search` queries a self-hosted SearXNG `GET /search?format=json`, with engine-rotation retry on upstream blocking and a `degraded` flag for partial coverage. <!-- id:JycSjUeR -->
  - `web_read` uses a tiered, cheapest-first reader: MediaWiki REST/Parsoid API → in-process static extraction (`@mozilla/readability` on a `linkedom` DOM + Turndown) → optional Crawl4AI headless-browser `POST /md` escalation with one retry. Output bounded to 200 KiB. <!-- id:eziS4prj -->
  - Added `web` config (`SEED_AGENTS_SEARXNG_URL`, `SEED_AGENTS_CRAWLER_URL`, `SEED_AGENTS_CRAWLER_TOKEN`) threaded from `Service` into the tool context; registry entries in `agents/protocol/src/tool-registry.ts`; desktop Tools-tab web group in `frontend/apps/desktop/src/pages/agents/agent-tools.ts` and `detail.tsx`. <!-- id:pYM5wzf3 -->
  - Tools are opt-in per agent and degrade gracefully when their backends are unconfigured. Added unit tests (`src/web-tools.test.ts`) and an end-to-end `web_search` tool-call test in `src/api-service.test.ts`. <!-- id:6xdv81Q- -->
  - Validated against live SearXNG + Crawl4AI 0.9.0 containers locally; the static and MediaWiki tiers run with no extra container. <!-- id:8XTf_ZRO -->

Design decisions (the original recommendation proposed a heavier six-part suite; it was cut for "reliable + easy to host on a small single server"): <!-- id:3j8jh3iD -->
  - **SearXNG — kept.** The only realistic self-hostable JSON search API; no substitute. It has no index and federates public engines, so datacenter-IP rate limiting is the main failure mode — mitigated by engine-rotation retry and the `degraded` flag rather than a hard dependency on any one engine. <!-- id:ZgPKk9vC -->
  - **Crawl4AI — kept, optional.** Apache-2.0, one container, clean `/md` markdown. Used as the escalation tier only, because its headless Chromium wants >=4 GB RAM; the lightweight tiers cover the common case so the browser is reserved for pages that need it. <!-- id:brh1V4e4 -->
  - **MediaWiki adapter + static extraction — kept as in-process code, not services.** They add reliability without ops surface. Trafilatura (the original static pick) was replaced by `@mozilla/readability` + Turndown because the agents service is Bun, not Python, so extraction runs in-process with no sidecar. <!-- id:wNBprc_m -->
  - **ReaderLM-v2 — dropped.** CC-BY-NC license (commercial blocker) and needs a GPU; heuristic extraction covers clean articles at a fraction of the cost. <!-- id:qB6g_IfA -->
  - **ArchiveBox — dropped.** Heavy Django + Chromium + worker stack whose output is archival artifacts (WARC/PDF), not agent-ready markdown. <!-- id:gvQR6-IK -->
  - **Firecrawl (self-hosted) — not adopted.** 5–7 containers, \~8 GB RAM, no self-hosted fire-engine, and its search needs SearXNG anyway, so SearXNG + Crawl4AI strictly dominates it on the hosting axis. <!-- id:XAkMU9au -->
  - **Wayback / archive.today — dropped for v1.** They call third-party archives, which conflicts with the "fully self-hostable, no third-party API keys" requirement; can be revisited later as an opt-in fallback. <!-- id:0Jaqt94X -->

## Current work: Rich agent editing and presentation <!-- id:tSJ-7Na4 -->

Completed: <!-- id:K5Xp3yiF -->
  - Added a shared rich prompt editor module for agent prompts, trigger prompts, and create-agent prompt entry. <!-- id:hbiqOXZM -->
  - Converted rich prompt blocks to markdown before signed desktop create/update requests while keeping server-side normalization and model-facing markdown conversion intact. <!-- id:1k4k1QXM -->
  - Replaced the agent session chat composer with the full `CommentEditor`, preserving slash-menu/editor behavior and converting rich message blocks to markdown before `MessageSession` submission or queuing. <!-- id:USIXfpUf -->
  - Added formatted markdown presentation for user message bubbles plus an info button that shows the exact raw markdown text sent to the LLM. <!-- id:AmZOObX0 -->
  - Shared queued-message UI between the assistant panel and agent session page. <!-- id:govy2jwL -->

Design note: the session composer now behaves like a rich block editor, so normal Enter belongs to editor editing. Use `Cmd/Ctrl+Enter` or the send button for submission. <!-- id:RtzrIjy5 -->

## Current work: Triggered comment replies <!-- id:xHq7-Q86 -->

Completed: <!-- id:3rn-UTCi -->
  - Added explicit trigger-session instructions telling models to pass `replyCommentId` when replying to comment activity. <!-- id:a6qxEXfZ -->
  - Documented `write` reply aliases and made `comment.create` accept `replyCommentId`/`replyComment` in addition to `reply`/`replyTo`. <!-- id:uXA6SUqk -->
  - Made comment reply publishing use parent comment versions for `replyParent`/`threadRoot` and derive the target document from the parent when needed. <!-- id:TIBR7ff7 -->

## Current work: Schedule triggers <!-- id:S5ofGfXP -->

Completed: <!-- id:dmCGlpzr -->
  - Added `schedule` trigger sources with interval, weekly day/time, and one-time schedule modes. <!-- id:4BV1yVIZ -->
  - Added a background schedule monitor that records idempotent trigger firings and creates sessions for due occurrences. <!-- id:P4P9-5Tx -->
  - Updated the desktop trigger form to configure schedule triggers. <!-- id:BTNBjfPu -->
  - One-time schedule triggers are disabled after their first successful run. <!-- id:4MirMs6w -->

## Current work: timestamped signed actions and editable session titles <!-- id:HgnuS0Ff -->

Completed: <!-- id:V8k4t3Uj -->
  - Added `action.ts` to every signed `AgentAction`; desktop signing and test helpers attach `Date.now()` before Ed25519 signing. <!-- id:wl3IvZzF -->
  - Server auth now rejects HTTP actions and WebSocket `Subscribe` envelopes whose signed timestamp is missing, invalid, or outside a 30-second local-time window. <!-- id:8rk-hndT -->
  - Added signed `UpdateSession` so session titles can be renamed without recreating sessions. <!-- id:_LJB8XSh -->
  - Made the desktop session-page title an inline debounced editor with a grey saving dot, green saved dot, and red failure dot. <!-- id:lx43OW6R -->

Design note: timestamp validation narrows replay risk but does not eliminate same-window replays; add nonce caching by account/signer as the next hardening step. <!-- id:m7V0sIuR -->

## Current work: Agents UI route split and server page <!-- id:ydl5U7xq -->

Completed: <!-- id:fUaX727x -->
  - Split the desktop Agents UI into separate lazy page modules for list, server, detail, and session routes. <!-- id:GVjI6ype -->
  - Added an `agent-server` route that lists agents for one configured server and exposes server-scoped actions. <!-- id:ysu5hRr3 -->
  - Shared the server-side HM account-key Secrets dialog and model-provider API-key Providers dialog between the Agents index and server page. <!-- id:NS_CqyBe -->

Design note: keep server-scoped workflows on the server page and agent-scoped workflows on the agent detail page; avoid rebuilding a monolithic `agents.tsx` switchboard. <!-- id:cNCM8_h7 -->

## Current work: Agent detail Tools tab and signing identity selection <!-- id:53LU2tWm -->

Completed: <!-- id:hkuajJG3 -->
  - Added signed `ListSigningIdentities` and `CreateSigningIdentity` actions for redacted account-scoped HM account-key metadata and server-side key generation. <!-- id:EKG_cMzG -->
  - Added `AgentDefinition.signingKeys` and server validation that selected signing keys exist and are tagged `kind: 'hm-account-key'` for the signed account. <!-- id:0I44vv4U -->
  - Added an autosaving desktop Tools tab for toggling `read` and `write`, creating a new agent account in a panel when no keys exist, and selecting multiple HM account keys for signing and publishing tools. <!-- id:EN7vFypi -->
  - Made explicit `tools: []` disable Seed tools while preserving the legacy `read` default for agents whose definition omits `tools`. <!-- id:7VNWl0Sw -->

## Share assistant chat rendering with Agents session UI <!-- id:wmMRVkfV -->

Completed: <!-- id:VZ4ZC4eS -->
  - Moved shared chat rendering into `frontend/apps/desktop/src/components/assistant-message-rendering.tsx`. <!-- id:4NsFPjE- -->
  - Kept the assistant panel and Agents session page on the same user/assistant bubble, markdown, streaming cursor, and tool-call components. <!-- id:GlOkY0x6 -->
  - Paired durable Agents `tool_call` / `tool_result` events by call ID before rendering them as shared tool bubbles. <!-- id:GblfRVET -->
  - Added `read` support to the read-tool bubble so document results show as document links instead of raw JSON. <!-- id:PQWM5xKy -->

## `f9cc356a6 Add agents service milestone 1 skeleton` <!-- id:9M7lVIIN -->

Completed: <!-- id:gih0ephT -->
  - Created the standalone `agents/` Bun workspace. <!-- id:zc9yv6KO -->
  - Added config parsing, SQLite bootstrap, CBOR helpers, signed envelope auth, API service skeleton, and HTTP routes. <!-- id:Z9ngYKmS -->
  - Added initial tests for auth, SQLite, API service, and routes. <!-- id:6dMMB_Ix -->

Design note: this established the signed CBOR control plane and separate Bun workspace boundary. <!-- id:F-Vr7OTP -->

## `9ef05d304 Add agents persistence APIs` <!-- id:Ibh3KAve -->

Completed: <!-- id:BzNf4I4- -->
  - Added provider/secret/session APIs. <!-- id:A3xQqW0z -->
  - Added AES-GCM encrypted secrets and redacted responses. <!-- id:Fksx0EQm -->
  - Added idempotency storage and migrations. <!-- id:NhkBqJhV -->
  - Added durable session replay. <!-- id:gwL8g0nI -->

Design note: create actions use `clientRequestId`; message actions later use `clientMessageId` without holding long DB transactions during model calls. <!-- id:0ZpKSaf_ -->

## `30271c6d1 Add desktop agents smoke-test UI` <!-- id:RWo1i2fz -->

Completed: <!-- id:hDF6lGTg -->
  - Added desktop API client and React Query hooks. <!-- id:SIRhQTHd -->
  - Added basic Agents page. <!-- id:SndCjsxd -->
  - Enabled signed desktop actions using daemon `signData`. <!-- id:QbCpqXT7 -->
  - Supported basic provider init, create agent, list agents, create sessions. <!-- id:sVyhvWd2 -->

## `0a7073c66 Add agents shortcut and server settings` <!-- id:6ste5jtY -->

Completed: <!-- id:kPF-Yd9Z -->
  - Added desktop shortcut/menu entry for Agents. <!-- id:M59iQiLX -->
  - Added Advanced Settings management for agent server URLs. <!-- id:iM3Qmh8Z -->
  - Added health/status display and server status GUI link. <!-- id:FZlP9tcx -->

## `c2083fdf9 Add desktop agent detail routes` <!-- id:YzJz4ero -->

Completed: <!-- id:NQlhpP1_ -->
  - Added route schemas for agent and session pages. <!-- id:9n2SgXqw -->
  - Added agent detail and session detail pages. <!-- id:SdcFETEn -->
  - Added hooks for fetching agent/session detail. <!-- id:ogFpzYd9 -->

## `b485ffc0e Add OpenAI-backed agent chat workflow` <!-- id:hWDlZMdu -->

Completed: <!-- id:uDW3q_j_ -->
  - Added `UpdateAgent` and `MessageSession`. <!-- id:n0Ek6ndK -->
  - Added OpenAI-compatible chat-completions execution. <!-- id:oS8lVXfn -->
  - Added provider secret lookup and trusted OpenAI base URL restriction. <!-- id:ia4V24A9 -->
  - Added session statuses and durable assistant/error events. <!-- id:qF5Ru4-Z -->
  - Added desktop editing and chat UI. <!-- id:cb_u7AEN -->

## `7549ab002 Make desktop agents pages scrollable` <!-- id:3i-FlHhZ -->

Completed: <!-- id:aCZvyl9k -->
  - Made Agents list/detail/session pages vertically scrollable. <!-- id:VrS1g4v_ -->

## `2e5e21508 Add agent tool calls and live subscriptions` <!-- id:_5zGWQmA -->

Completed: <!-- id:6V05Yv8l -->
  - Added signed WebSocket `Subscribe` action. <!-- id:1VZYFFmY -->
  - Added service event emitter and WebSocket fanout. <!-- id:VBXRcEZP -->
  - Added account/agent/session subscription keys. <!-- id:khaE6ZJ8 -->
  - Added durable tool-call/tool-result events. <!-- id:whz46O6B -->
  - Added `read` tool. <!-- id:4S-nPk6j -->

Design note: server-to-client WebSocket messages are JSON after signed subscription authorization; they are not individually signed. <!-- id:ukgXjmLw -->

## `c5d49f9e6 Make hypermedia read tool always available` <!-- id:Nru0s4cF -->

Completed: <!-- id:HXhCtjZw -->
  - Made `read` available regardless of saved agent definition `tools` field. <!-- id:yLZPfKJT -->
  - Broadened tool input acceptance to HM IDs and web URLs. <!-- id:pWZe2m4B -->

## `3a91a0e25 Stream agent replies over live subscriptions` <!-- id:75-ND56B -->

Completed: <!-- id:evZY2Tr1 -->
  - Switched OpenAI calls to streaming. <!-- id:OJ1DJ33W -->
  - Added OpenAI SSE parsing. <!-- id:qzgEwOis -->
  - Added `session-partial` service events and WebSocket `appendPartial` events. <!-- id:tvlKfwm_ -->
  - Added desktop partial assistant row and optimistic user message behavior. <!-- id:Xl0-l3pF -->

## `76f857cd5 Resolve hypermedia URLs inside read tool` <!-- id:3EZNBW_S -->

Completed: <!-- id:J3dIlcNo -->
  - Removed CLI shellout from `read`. <!-- id:RoIJ8CYr -->
  - Resolved web URLs internally. <!-- id:cNkC3jJs -->
  - Fetched resources through Seed client libraries. <!-- id:TS_0FqMb -->
  - Rendered markdown in process. <!-- id:nUxKA71t -->

## `3b55a421d Share hypermedia URL resolution with CLI` <!-- id:3k7WizjH -->

Completed: <!-- id:miXAikEk -->
  - Added `frontend/packages/client/src/resource-read.ts`. <!-- id:QSBtPZD2 -->
  - Exported `resolveIdWithClient` from the client package. <!-- id:bEUMEYTo -->
  - Updated CLI resolver and agent tool to share the helper. <!-- id:9wfI4RpI -->

## `4c5740135 Refactor desktop agents provider and create dialogs` <!-- id:Ru5vJfTW -->

Completed: <!-- id:fPkUUlAO -->
  - Added standalone `ModelProvidersDialog`. <!-- id:aEUQmjAk -->
  - Added standalone `CreateAgentDialog`. <!-- id:RDjBdsr2 -->
  - Added `ListModelProviders` API/hook. <!-- id:c-Xza5bs -->
  - Added UI support for saving OpenAI, Anthropic, and Google provider records/secrets. <!-- id:wr75jbjf -->

Caveat: only OpenAI execution is implemented. <!-- id:wfAS2FvD -->

## `dc3605273 Document agents system knowledgebase` <!-- id:U2TlSXKJ -->

Completed: <!-- id:765Ey0N3 -->
  - Added first-generation `agents/docs` knowledgebase. <!-- id:Su9LBf0Q -->

## `168efd822 Render agent replies with streaming markdown` <!-- id:1VQuxYpz -->

Completed: <!-- id:zfM_Er1h -->
  - Exported `AssistantMessageParts` from desktop assistant panel. <!-- id:j5KivbXb -->
  - Reused it in Agents session chat. <!-- id:Lhdwk7sZ -->
  - Rendered durable assistant messages and live partials as markdown with the same cursor/link behavior as the assistant panel. <!-- id:-l7sHACR -->

## `b4b30eb1c Add agents session inspector UI` <!-- id:oN5mCuEn -->

Completed: <!-- id:Pg-qOsyb -->
  - Expanded `/agents` from a minimal status page into a live session inspector. <!-- id:ljxOK_p6 -->
  - Added `/agents/api/status` overview with agents, sessions, event counts, and connection count. <!-- id:FABvqW5N -->
  - Added `/agents/api/session?id=<sessionId>` for session event inspection. <!-- id:bwaN9zD- -->
  - Added a richer `agents/src/frontend/app.tsx` diagnostic UI. <!-- id:93yRIOu2 -->

## Shared Agents protocol package <!-- id:I7I7Meqq -->

Completed: <!-- id:op_QplJK -->
  - Added private package `@seed-hypermedia/agents-protocol` in `agents/protocol`. <!-- id:f3Xs3Jnf -->
  - Moved canonical action, response, session event, and WebSocket event types into the shared package. <!-- id:zPv37Hgj -->
  - Changed `agents/src/api.ts` to re-export the package for service-local compatibility. <!-- id:GnwZcGfJ -->
  - Changed desktop `agents-client.ts` to alias protocol types from the shared package instead of mirroring unions. <!-- id:ePZ6HDFY -->
  - Added Bun and desktop package dependencies so both runtimes compile against one protocol source. <!-- id:Ml08sAaN -->

Design note: this eliminates server/desktop protocol drift while keeping the package TypeScript-only and runtime-neutral for Bun and Vite. <!-- id:l2NTs2_6 -->

## `f39d21045 Fix agent streaming subscription diagnostics` <!-- id:gydUALUG -->

Completed: <!-- id:dXZcEc1z -->
  - Added safe OpenAI streaming diagnostics. <!-- id:qAQ3BYd8 -->
  - Added WebSocket subscription/fanout diagnostics. <!-- id:OoTzLHrx -->
  - Added desktop WebSocket diagnostics. <!-- id:5rRRGNZX -->
  - Hardened desktop WebSocket message parsing for string, Blob, and ArrayBuffer payloads. <!-- id:xU5TWWOX -->
  - Fixed `Subscribe` invalid-signature failures caused by signing explicit `undefined` fields. <!-- id:eV2bdOhO -->
  - Added recursive `omitUndefined()` before desktop signs agent actions. <!-- id:ksrrNIf7 -->
  - Kept partial text visible until durable assistant append arrives. <!-- id:yWd5TYPB -->
  - Hardened SSE parsing for CRLF separators and final buffered events. <!-- id:HfsjMAjP -->

## Pi SDK model execution migration <!-- id:sJL-RfoD -->

Completed: <!-- id:aE382zaC -->
  - Added `@mariozechner/pi-coding-agent` to the Bun agents service. <!-- id:w9V9maMN -->
  - Replaced the primary `MessageSession` model path with `#runPiAgent()`. <!-- id:VLCOdfLG -->
  - Created per-run in-memory Pi auth, model registry, settings, resource loader, and session manager. <!-- id:8FCdiscS -->
  - Disabled Pi resource discovery and default coding tools for Seed Agents. <!-- id:jA_raOko -->
  - Registered `read` as a Seed-owned Pi custom tool. <!-- id:RGfnNKBG -->
  - Translated Pi text/tool/final/error events into existing Seed WebSocket partials and durable session events. <!-- id:4oK8oh4e -->
  - Added mocked streaming OpenAI-compatible coverage for text, tool calls, and provider failure persistence. <!-- id:R_w7R287 -->

Caveats: <!-- id:RPPOugRI -->
  - Anthropic and Google are mapped through Pi but still need real-provider smoke tests. <!-- id:QedbojNb -->

# Current feature baseline after these commits <!-- id:a_25BQyf -->

The feature is locally usable from the desktop app with OpenAI-compatible providers through the Pi SDK-backed runtime. The best manual acceptance test is: <!-- id:9UVmqK-O -->
  1. Start agents service. <!-- id:TMAhXmbe -->
  2. Start desktop. <!-- id:wyqlj7y2 -->
  3. Open Agents. <!-- id:3yfLyTvE -->
  4. Configure an OpenAI provider. <!-- id:zmZsKsev -->
  5. Create an agent. <!-- id:0C2q_L8v -->
  6. Create/open a session. <!-- id:Ff8mWmyV -->
  7. Send a message. <!-- id:A4_GMbnH -->
  8. Confirm user message appears optimistically. <!-- id:kBDkOwyZ -->
  9. Confirm WebSocket subscription succeeds. <!-- id:LHZDsk7f -->
  10. Confirm assistant response streams as markdown. <!-- id:ANmdBN7w -->
  11. Confirm final durable assistant event remains after refresh. <!-- id:P0nJztAj -->
  12. Ask the agent to read an HM/web URL and confirm tool events appear. <!-- id:lFbg1Kww -->

# Validation history worth remembering <!-- id:q8CXzdAv -->

Recent successful commands during this work: <!-- id:Br5whtLN -->

```bash <!-- id:pjU74iYb -->
direnv exec . bash -lc 'cd agents && bun check && bun test'
direnv exec . bash -lc 'pnpm typecheck'
direnv exec . bash -lc 'pnpm test'
direnv exec . bash -lc 'pnpm --filter @shm/desktop test:unit src/__tests__/assistant-panel.test.tsx src/__tests__/markdown.test.tsx'
```

Known validation caveat: <!-- id:hbvUKwmU -->

```bash <!-- id:6WV01J5X -->
direnv exec . bash -lc 'pnpm audit'
```

currently fails due existing repository dependency advisories unrelated to Agents. <!-- id:seX-kBaL -->
