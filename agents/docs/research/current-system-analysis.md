# Current system analysis

Code-grounded map of the Seed Agents system as of 2026-07-30 (worktree `perf-directory-cover-fallback`, detached at
`c1e2f4e8b`), written to ground the north-star design work. File references are relative to the repo root. This is a
snapshot: line numbers drift, but the structural facts are what matter.

## Architecture in one paragraph

A standalone Bun service (`agents/src/main.ts`) exposes a signed DAG-CBOR HTTP action API and a signed WebSocket
subscription API. SQLite is the sole source of truth. Model execution is delegated to the Pi SDK
(`@mariozechner/pi-coding-agent@0.70.2`): each `MessageSession` run creates a fresh in-memory Pi `AgentSession`, injects
the entire durable event log as Pi messages, runs `agent.continue()`, and translates Pi events back into durable session
events plus ephemeral WebSocket partials. The desktop app (Electron) is the only client surface; it runs a local copy of
this server as a subprocess and renders both a full Agents page and the assistant sidebar over the same runtime.

## The execution loop

- Lifecycle owner: `#messageSessionOnce()` (`agents/src/api-service.ts:1379`) — appends durable user message(s), sets
  session status `streaming`, registers an in-memory `RunningSession`, awaits `#runPiAgent()`, then sets `idle`/`error`.
- `#runPiAgent()` (`api-service.ts:1582`) wires Pi per run: in-memory auth/model-registry/settings/session-manager, a
  null `ResourceLoader` (no Pi discovery), `noTools: 'builtin'`, compaction explicitly disabled
  (`SettingsManager.inMemory({compaction: {enabled: false}})`, `:1621`).
- Context construction: `#piMessages()` (`:1952`) reads **all** `session_events` in seq order and rebuilds Pi message
  shapes. No windowing, no truncation, no summarization. `contextWindow: 128000` / `maxTokens: 16384` are hardcoded
  fictions per model (`:3514`); cost tables are zeroed, so Pi's context/cost accounting is meaningless.
- Concurrency: strictly one run per session — a second `MessageSession` while `status='streaming'` gets a 409 (`:1392`).
  The desktop queues locally and flushes queued drafts as one multi-part message when the run ends.
- Failure modes: **no run records** — a run is an in-memory struct plus a status column. A crash mid-run leaves
  `status='streaming'` forever with no recovery path (the only escape is `StopSession` forcing `idle`). Partials are
  never persisted; a reconnect mid-run loses in-flight text.
- Event translation (Pi → durable): assistant text flushed at each `message_end` and before each `tool_call` so ordering
  survives replay; `tool_result` stores structured `details` and re-serializes them in full on every future replay;
  `set_session_title` is invisible; usage is accumulated per run, streamed live, and **never persisted**.
- Seq allocation is `SELECT MAX(seq)+1` outside a transaction (`:2062`) — safe only because of the one-run-per-session
  lock.

## The tool system

- Single static registry: `agents/protocol/src/tool-registry.ts` — one flat object literal of 20+ tools with a
  hand-rolled minimal JSON-Schema type (no Zod, no `$ref`, no unions), UI render metadata, and advisory-only
  `runtimes`/`userConfigurable` flags. `outputSchema` is declared on 13 tools and read by nothing.
- Adding a tool touches 4+ places: registry entry, `SeedToolRegistry` type key, `createAgentServicePiTools()`
  (`api-service.ts:3688` — all tools constructed unconditionally every run), the hardcoded `||` name-filter chain
  (`:1670-1686`), and often `#agentSystemPrompt`'s hardcoded tool-group lists.
- Per-agent enablement is `AgentDefinition.tools?: string[]` — a bare name array, no per-tool config, unknown names
  silently dropped at run time.
- `defineSeedPiTool()` (`:3583`) is the single 20-line adapter chokepoint from registry metadata to Pi `defineTool()`.
  Rich output escape hatch: `{piContent}` lets a tool send image blocks to the model while the durable event keeps
  structured output (only `view_attachment` uses it).
- Prompt cost is unmanaged: full descriptions of every enabled tool (~8-10 KB JSON with defaults), plus a live memory
  listing, signing-identity JSON, and write-tool instruction paragraphs, on every request.
- `write` is a de-facto router: 22 commands behind one schema — the closest existing thing to a namespaced tool group.
- **Pi already ships the progressive-discovery primitive**: `AgentSession.setActiveToolsByName(names)`, `getAllTools()`,
  `getToolDefinition(name)` (rebuilds the system prompt; takes effect next turn). Seed never calls them. Pi 0.70.2 has
  no MCP support.
- `execute_code` (`agents/src/code-exec.ts`): microsandbox microVM per call (no warm pool — boot latency on every call),
  agent memory bind-mounted at `/workspace`, 1 CPU / 512 MiB / 60s defaults, 64 KiB output cap per stream, network on by
  default with non-local policy, availability probe with machine-readable unavailability codes. It is the de-facto
  escape valve for "no tool for that" work, but there is no notion of a named, schema'd, reusable lambda.
- Agent memory (`agents/src/agent-memory.ts`): pure-function sandboxed filesystem under `<stateDir>/memory`,
  agent-scoped and cross-session. `resolveMemoryPath` is the single path gate; symlinks refused everywhere; no
  append/move/glob/partial-read/quota/locking. `execute_code` bypasses all of it via the bind mount.

## Protocol and clients

- `agents/protocol/src/index.ts`: 38 signed actions (agents, providers/secrets/identities, triggers, memory, sessions,
  attachments, chunked uploads, subscribe). WS events: `append` (durable), `appendPartial` ({textDelta, usage,
  activity}), `change`, `error`.
- `MessageSession` content parts: `text` (with optional Seed blocks), `context` (model-facing window-context lines, kept
  out of the visible transcript), `attachment`. The desktop derives per-send window context from the nav route
  (`assistant-window-context.ts`) — an existing, working precedent for implicit context injection.
- The assistant sidebar and the Agents page share one runtime and one data layer
  (`frontend/apps/desktop/src/models/agents.ts`, 1592 lines). `AssistantDraftChat` (`assistant-panel.tsx:479`) already
  implements create-session-on-first-send — the seed of the one-input UX.
- Session identity is `(serverUrl, sessionId)` — ids are only unique per server; the sidebar merges `ListSessions`
  across all configured servers.
- All agent UI is desktop-only. There is no shared `@shm/ui/agents` package on this branch and no web route.
  (`feat/agents-web` exists as a separate unmerged branch stack.)
- Agent selection is an explicit dropdown (`resolveAssistantSelection`); a unified input needs a routing story.

## Data model

```
accounts
 ├─ model_providers / secrets (AES-GCM) / signing identities
 ├─ agents (definition_cbor: name, systemPrompt, provider, model, reasoningLevel, tools[], signingKeys)
 │    ├─ agent_triggers ── trigger_firings (exactly-once via UNIQUE activity_key + INSERT OR IGNORE)
 │    ├─ sessions (title, status: idle|streaming|stopped|error) ── session_events (seq, event_cbor)
 │    └─ state_dir/memory/** (cross-session)  +  state_dir/session-attachments/<sessionId>/**
 ├─ agent_drafts (agent-scoped, not session-scoped)
 └─ activity_watermarks / action_idempotency
```

- No sub-sessions, no forking, no parent/child links, no session-to-session references, no run records.
- Agent definitions are read fresh each run — editing an agent retroactively changes existing sessions.
- Cross-session state: agent memory (strongest), agent drafts, trigger context, and nothing else.

## Proactive execution (triggers)

- Sources: `document-comment`, `user-mention`, `site-update`, `schedule` (interval/weekly/once with full IANA timezone
  math). ActivityMonitor polls HM `ListEvents` with a seen-keys watermark advanced per event; comment/citation twin
  events are collapsed to one firing key.
- Exactly-once is a `UNIQUE` index + `INSERT OR IGNORE` on `trigger_firings`; the session is created before the run, so
  every firing is visible even if the run fails; dispatch is fire-and-forget with **no concurrency limit, no retry, no
  backoff**.
- This is the only automated session origination; nothing else creates or messages sessions programmatically.

## Orchestration: what exists today

Nothing agent-facing. No tool creates sessions, messages sessions, or invokes another agent. The only parallelism is (a)
Pi's default parallel execution of multiple tool calls within one assistant turn, and (b) different sessions running
concurrently in-process. `#dispatchTriggerSession()` (fire-and-forget promise tracking with a drain hook) is the closest
thing to a job runner.

## Context management: what exists today

Essentially nothing. Compaction disabled; full replay every run; token usage displayed but never acted on; no
truncation, summarization, or thread splitting. The only context-shrinking mechanisms are indirect: agent memory (with a
top-level listing injected into the system prompt) and the per-send ephemeral `context` part.

## Onyx: the schema foundation (branch `feat/onyx`)

Onyx is the self-describing IPLD/DAG-CBOR schema system that should type the next-generation action system. Spec +
reference impl live at `feat/onyx:onyx/` (entry: `onyx/README.md`); the TS engine at
`feat/onyx:frontend/packages/ui/src/onyx/onyx-engine.ts` (335 lines).

- **Data model**: nine IPLD value kinds (`null, boolean, integer, float, string, bytes, list, map, link`). The
  meta-schema is a discriminated union of **seven** variants (map, list, scalar, link, include, union, var), each a
  closed map, and it validates against itself. 13-key vocabulary; closed maps by default; applied generics via
  `params`/`var`/`args` (the `Change<Block>` pattern); extension by ref + refinement (no `extends` keyword).
- **Content addressing**: each schema canonically DAG-CBOR-encodes to a CIDv1. Refs are never rewritten to CIDs, so
  editing a dependency doesn't churn dependents' CIDs. Three reference forms: `hm://authority/name` (mutable name — the
  only way to express recursion), `ipfs://cid` (pinned version), bundled basename (dev alias). 98 schemas published
  under the onyx account DID.
- **Schemas as documents**: `schemaDefinition` metadata (ipfs CID) marks a doc as _defining_ a schema; `schema` metadata
  marks a doc as _conforming_ to one (resolved through the type-doc's definition); `childrenSchema` constrains a
  directory's children. The CLI `schema` group (list/get/validate/check/deps/cid/publish) already round-trips all of
  this.
- **Engine API**: `validate(schema, data) → string[]` (never throws, empty = valid), `resolveSchema`, `schemaForCid`,
  `collectRefs`/`dependencies`/`dependents`, plus an `OnyxRegistry` overlay arg for locally-defined unpublished schemas.
  Validate-only by design — no coercion, no defaults.
- **Standalone use in the agents service is trivial**: `onyx-engine.ts` has exactly one import (the generated schema
  bundle, pure JSON). The CLI already imports it React-free across the workspace boundary and ships async resolvers
  (`resolveSchemaRef`, `effectiveDocSchema` in `frontend/apps/cli/src/utils/onyx.ts`) usable as-is in Bun. Gaps: an
  ipld→dag-json converter (~20 lines) for validating decoded CBOR, `parseOnyxError` for structured errors, and
  memoization of resolution for hot paths.
- **No function type exists — by design.** An action signature is idiomatically a closed map
  `{name, input: <schema>, output: <schema>}`; a registry is an `anyOf` union tagged by single-value `enum` (the
  `hypermedia-op` pattern); third-party extension follows the `example-poll-block` ref-refinement pattern; `hm://` vs
  `ipfs://` gives stable-name vs pinned-version handler identity for free. The planned-but-unbuilt Phase 6 "RPC typing"
  and Phase 2 "Onyx → TypeScript codegen" from `notes/onyx-integration-plan.md` are exactly what a typed action system
  needs.
- Onyx vs the current hand-rolled tool `JsonSchema`: near-1:1 mapping (`object→map`, `array→list`,
  `additionalProperties:false` is Onyx's default), gaining unions, refs/reuse, generics, and content addressing.

## Load-bearing strengths to preserve

1. **Signed, account-scoped CBOR protocol** with idempotent actions — the trust model is sound and clients exist.
2. **Durable append-only session events + WS replay** — the event-sourcing spine works and the desktop UX depends on it.
3. **The Pi seam**: Seed owns persistence/auth/tools/prompt; Pi owns the loop and provider adapters. The seam is narrow
   (`#piMessages` in, `subscribe` handler out, `defineSeedPiTool` for tools) and has proven flexible.
4. **Exactly-once trigger firing** via deterministic keys + unique index — the same pattern generalizes to any
   at-most-once dispatch need.
5. **Agent memory + microVM code exec** — a real sandbox with a real filesystem, already bind-mount composable.
6. **Registry-driven UI rendering** (`render` metadata) — declarative tool bubbles that new tools inherit.

## Structural weaknesses the redesign must fix

1. **No orchestration primitives at all** (the headline gap).
2. **Monotonic context growth** until provider rejection; no compaction/threading; sessions are the only container.
3. **Static, hand-maintained tool registry** with 4+ touch points per tool, dead `outputSchema`, advisory-only flags,
   hand-rolled schema language.
4. **No run records**: coarse session status, wedged-streaming failure mode, unpersisted usage, no history of what ran
   when at what cost.
5. **No programmatic session/agent control surface** — agents cannot create agents, sessions, triggers, or tools, so
   self-configuration is impossible today.
6. **Fire-and-forget dispatch** with no queue, retry, or concurrency control.
7. **Desktop-only clients**; protocol types shared, UI not.
