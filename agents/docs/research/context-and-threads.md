# Context and threads: the self-managing conversational surface

Design-stage document (see [readme.md](./readme.md)). This doc owns: the thread model that replaces user-managed
sessions, compaction as first-class events, the one-input UX and message routing, thread-oriented protocol additions,
and the desktop UX evolution. Run records, the workflow language, and sub-agent spawning are owned by
[orchestration.md](./orchestration.md); the action/registry data model by [tool-system.md](./tool-system.md); permission
gates for self-configuring actions by [self-configuration.md](./self-configuration.md).

## Overview

Today the user manages sessions by hand: pick an agent from a dropdown, create a session, watch it grow monotonically
until the provider rejects the context (`#piMessages()` at `agents/src/api-service.ts:1952` replays every event, every
run, forever; compaction is explicitly disabled at `:1621`; the context window is a hardcoded 128k fiction at `:3514`).
The north star inverts this: **one text input, and the system manages the containers.**

The design keeps the load-bearing spine — the `sessions` + `session_events` append-only tables, `(serverUrl, sessionId)`
identity, WS replay — and re-frames it:

1. **A thread is a session row plus lineage and lifecycle columns.** No new event store, no data migration of events.
   Existing sessions become root threads of origin `user`.
2. **Compaction is a durable event in the same log.** A `compaction` event records the summary text, the seq range it
   covers, and what was promoted to memory. Replay becomes "events after the last compaction boundary, prefixed by the
   stored summary" — deterministic, because the summary is stored, never recomputed.
3. **Token accounting is honest.** Per-run usage (persisted in the `runs` table from
   [orchestration.md](./orchestration.md)) is the ground truth for "how full is this thread," and a per-model capability
   registry replaces the hardcoded fictions. Accounting feeds automatic compaction triggers.
4. **Messages route themselves.** The default send has no session id: a router resolves it to continue / branch / new
   against the active thread, generalizing the existing `AssistantDraftChat` create-on-first-send flow
   (`frontend/apps/desktop/src/components/assistant-panel.tsx:479`).
5. **Proactive threads land in an inbox**, not a flat session list: trigger-born and delegation-born threads carry an
   attention state and surface as affordances on the one input, not as navigation chores.

## Part A — The thread model

### Threads are sessions, evolved

We do not introduce a second container type. A **thread** is the same durable object as today's session — same id space,
same `(serverUrl, sessionId)` identity, same `session_events` spine, same `sessions/<id>` subscribe key. What changes is
who creates them (the system, mostly), what they know about each other (lineage), and how they end (lifecycle). Protocol
names migrate to "thread" (with session aliases kept; §D), but the storage story is additive:

```sql
-- Additive migration to agents/src/sqlite-schema.sql (sessions table, :69)
ALTER TABLE sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'user';
  -- 'user' | 'trigger' | 'delegation' | 'branch' | 'workflow'
  -- ('delegation' corresponds to run origin 'agent' in orchestration.md's vocabulary;
  --  'external' is reserved for cross-account agent requests, §C)
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions (id);
ALTER TABLE sessions ADD COLUMN root_session_id TEXT;          -- denormalized; = id for roots
ALTER TABLE sessions ADD COLUMN parent_link_cbor BLOB;         -- ThreadParentLink (see below)
ALTER TABLE sessions ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active';
  -- 'active' | 'archived' | 'completed'   (orthogonal to run status)
ALTER TABLE sessions ADD COLUMN attention TEXT NOT NULL DEFAULT 'none';
  -- 'none' | 'unseen' | 'needs_user'      (inbox state, §C)
ALTER TABLE sessions ADD COLUMN context_state_cbor BLOB;       -- ThreadContextState (§B)

CREATE INDEX sessions_by_parent ON sessions (parent_session_id, created_at);
CREATE INDEX sessions_attention ON sessions (account_id, attention, updated_at DESC)
  WHERE attention != 'none';
```

`ThreadParentLink` pins how a child relates to its parent — enough to render lineage and to make branching replayable:

```ts
type ThreadParentLink =
  | {kind: 'branch'; fromSeq: number} // context fork: child replays parent events ≤ fromSeq
  | {kind: 'delegation'; runId: string; actionCallId: string} // spawned by an action call (orchestration.md)
  | {kind: 'workflow'; runId: string; callSeq: number} // spawned by ctx.agent in workflow code; callSeq = run-journal call seq
```

Rules:

- **Roots**: `origin='user' | 'trigger'`, `parent_session_id IS NULL`, `root_session_id = id`. Every existing session
  backfills to this shape (`UPDATE sessions SET root_session_id = id`).
- **Branches** (`origin='branch'`): a context fork. The child owns **no copied events**; its `#piMessages()` reads the
  parent's events up to `fromSeq` (respecting the parent's compaction boundary as of that seq), then its own events.
  Deleting a parent with live branches is refused; archiving is fine.
- **Delegation threads** (`origin='delegation'`): a sub-agent run's conversation, created by the orchestrator. Its
  context is **not** the parent's — it starts from the delegated input (see §F). The parent thread's log holds only the
  action-call and action-result events; the child holds the full sub-conversation, browsable on demand.
- **Delegation vs. workflow lineage**: both are spawned children, but `'delegation'` means an agent's in-conversation
  tool call created the child (the parent _thread_ holds the call/result events; the child run's origin is `'agent'` in
  [orchestration.md](./orchestration.md)'s run-origin vocabulary), while `'workflow'` means `ctx.agent` in workflow code
  did (the parent is a run journal, not a transcript; run origin `'workflow'`; `callSeq` is the journal call seq — the
  only step identifier orchestration.md has).
- **Status split**: today `sessions.status` conflates "is a model streaming" with "what is this thread's life stage."
  Run-level status moves to the `runs` table ([orchestration.md](./orchestration.md)); `sessions.status` stays as the
  derived mirror orchestration.md defines (crash recovery): `streaming` iff a non-terminal agent run references the
  session, otherwise mapped from the last run's outcome into the legacy enum (`error` on failure, `stopped` on
  cancellation, `idle` otherwise) — old clients only ever see legacy values. `lifecycle` carries the container-level
  state. Archived threads are excluded from routing (§C) and from the default list, but their events remain replayable.

### What the user stops managing

The user never picks "new session" again. Threads are created by: the router deciding a message starts a new topic (§C),
a trigger firing (`agents/src/activity-triggers.ts` — unchanged, now setting `origin='trigger'`, `attention='unseen'`),
the orchestrator delegating, or an explicit branch gesture ("try that differently"). Titles stay system-generated:
`set_session_title` **already persists** `sessions.title` (a `title_source` column exists for exactly this) — what it
lacks is a durable trace, since the handler deliberately skips the transcript event. The new work is only surfacing the
rename: the handler additionally appends a durable `thread_renamed` session event `{title, source}`, so renames replay,
sync, and render like every other event. Once title generation moves into system jobs (first-exchange, compaction) that
append this event directly, the tool retires — this event is the mechanism [tool-system.md](./tool-system.md)'s core-set
note ("retires when thread events replace it") points at. Archiving is automatic on inactivity plus manual.

### Handoff: same thread, new agent

Delegation (§F) briefs an isolated child; branching forks context under the same agent. The middle pattern — transfer
the **live conversation, history intact**, to a different agent with different tools — must also be expressible, or
every triage/specialist flow degrades into a lossy re-brief (the call-center-transfer failure mode). So a thread's
`agentId` is current-not-constant:

- A durable **`handoff` session event** `{fromAgent, toAgent, reason}` in the same log changes which agent serves the
  thread from that seq forward. `#piMessages()` already rebuilds context per run; the executor simply uses the agent
  named by the latest handoff event (else the thread's original agent) for system prompt and tools. The event doubles as
  the audit trail.
- User-callable from the thread UI ("transfer to …", `HandoffThread` in §D) and agent-callable as a gated action
  (capability + default mode belong in [self-configuration.md](./self-configuration.md)'s table — a needed addition
  there).
- Handoff is also the Tier-2 router's cheap correction move: when a message was routed to the wrong specialist, handing
  the thread off beats branching (no context loss, no duplicate threads).
- Agent memory stays agent-scoped: the incoming agent sees its own memory listing, never its predecessor's; anything
  that must cross the boundary travels in the thread itself, which the incoming agent reads in full. A handoff is a
  deliberate prompt-prefix change point for cache purposes (§B).

## Part B — Context management

### Compaction as a first-class durable event

Compaction must not break the two invariants the system lives on: the event log is append-only, and replay is
deterministic. So compaction never deletes or rewrites events. It **appends a checkpoint**:

```ts
// New SessionEventPayload variant (agents/protocol/src/index.ts:630)
type CompactionEvent = {
  type: 'compaction'
  /** Events with seq <= coveredThroughSeq are excluded from future model context. */
  coveredThroughSeq: number
  /** The stored summary injected in their place. Computed once, replayed forever. */
  summary: string
  /** Chain: seq of the previous compaction event this one supersedes, if any. */
  previousCompactionSeq?: number
  /** Facts promoted to agent memory during this compaction (paths written). */
  promotedMemory?: {path: string; note: string}[]
  /** Tool-result events whose bulky output was elided from the summary entirely. */
  droppedToolResults?: number
  /** Loaded-action set at the boundary (refs + pinned CIDs), carried forward so post-
   *  compaction replay reconstructs the active tools without scanning past the boundary
   *  (supersedes earlier actions_loaded events; see tool-system.md, Durability). */
  activeActions?: {ref: string; cid: string}[]
  /** Accounting at checkpoint time. */
  tokens: {before: number; after: number}
  /** Run that produced this compaction — an ordinary builtin-kind run in the runs table
   *  (kind='builtin', action_ref='builtin:compact_thread'; orchestration.md — no bespoke run kind). */
  runId: string
  /** How it was initiated. */
  reason: 'auto-threshold' | 'user' | 'pre-run-guard' | 'agent-requested'
}
```

`#piMessages()` (`api-service.ts:1952`) changes from "read all events" to:

```ts
function contextEvents(events: SessionEvent[]): {prefix: string | null; live: SessionEvent[]} {
  const compactions = events.filter((e) => e.event.type === 'compaction')
  const latest = compactions.at(-1) // chain tip; previousCompactionSeq links are for audit/UI
  if (!latest) return {prefix: null, live: events}
  return {
    prefix: latest.event.summary, // injected as a user-role fenced recap block (see below)
    live: events.filter((e) => e.seq > latest.event.coveredThroughSeq && e.event.type !== 'compaction'),
  }
}
```

Because the summary text is stored in the event, replay after crash/restart/resume is byte-identical — the model is
never re-asked to summarize, which also keeps [orchestration.md](./orchestration.md)'s journaled-resume semantics intact
(a resumed run rebuilds exactly the context the original run saw). The full pre-compaction transcript stays in the log:
the UI can render it (collapsed under a "compacted" divider), branches can fork from before the boundary, and audits can
diff summary against source.

**The recap's message shape is user-role, not system-role.** `#piMessages()` emits only user/assistant/toolResult
shapes, and a mid-conversation system-role message has no clean mapping on Anthropic-style providers. The stored summary
therefore enters model context as a **user-role message wrapping the summary in a fenced block** (a `<thread_recap>`
tag, mirroring today's `<window_context>`/`<trigger_context>` framing) — and the deterministic-replay tests target
exactly that shape. Loaded-action state survives the boundary via the event's `activeActions` snapshot, so a
post-compaction run's tool set never silently shrinks (the alternative — scanning the full log for `actions_loaded`
events — would reintroduce a second read path; the snapshot keeps the boundary read the only one).

**Compaction is itself a run.** An **ordinary builtin-kind run** — `kind='builtin'`,
`action_ref='builtin:compact_thread'` in the runs table ([orchestration.md](./orchestration.md)); no bespoke run kind.
Its `origin` is always `'system'` per orchestration.md's origin vocabulary (compaction is service-initiated
maintenance); who initiated it is recorded in the compaction event's `reason` field
(`auto-threshold | user | pre-run-guard | agent-requested`), not in the run origin. It executes a fixed summarization
prompt over the to-be-covered events. It uses the thread's own agent+model by default (configurable to a cheaper model
per agent). Its output is validated (non-empty, token-bounded) before the compaction event is appended; failure leaves
the thread untouched and retries with backoff. Only one compaction run per thread at a time, enforced the same way
message runs are serialized today (`api-service.ts:1392`).

### What gets promoted, summarized, dropped

The compaction prompt implements a three-tier policy:

1. **Promote to agent memory** (durable, cross-thread): stable facts, user preferences, decisions, and identifiers/URLs
   the agent will plausibly need in other threads. Writes go through the existing memory tool surface
   (`agents/src/agent-memory.ts`) _during the compaction run_, and the paths written are recorded in `promotedMemory` —
   so memory writes are attributable to a checkpoint, and a bad compaction can be manually reverted. Deduplication
   against existing memory is the summarizer's job (it sees the memory listing, as runs already do).
2. **Summarize into the checkpoint**: the narrative — what was asked, what was done, what remains open, and compact
   references (`hm://` URLs, file paths, ids) needed to re-derive anything dropped.
3. **Drop from context** (never from the log): bulky `tool_result` payloads, superseded drafts, streamed partials' final
   text that the summary already covers. Today every tool result is re-serialized in full on every replay (analysis
   §"execution loop"); this is where most of the win is.

Ephemeral `context` parts (window context, §C) older than the boundary are always dropped — they described a past window
state and are worthless summarized.

### Honest token accounting

Two fictions die together:

- **Model capabilities**: replace the hardcoded `contextWindow: 128000 / maxTokens: 16384` (`api-service.ts:3514`) with
  a capabilities registry in `agents/protocol/src/model-capabilities.ts` (which already exists for image-input detection
  — extend it): per provider-type + model-id pattern → `{contextWindow, maxOutput, pricing?}`. Unknown models get a
  conservative default (64k) **plus** a runtime correction: if a provider returns a context-length-exceeded error, the
  observed ceiling is recorded in `server_config` and used thereafter. Providers that report limits in their model-list
  responses (`ListProviderModels` already exists) feed the registry dynamically.
- **Usage**: per-run usage stops being display-only. The runs table persists `{input, output, cacheRead, cacheWrite}`
  per run ([orchestration.md](./orchestration.md)); the **last run's `input` tokens are the ground truth for the
  thread's current context size** — no tokenizer-guessing. It is cached on the thread:

```ts
type ThreadContextState = {
  /** input tokens of the most recent completed run = actual context size at last model call */
  lastInputTokens: number
  /** effective window for the thread's current model, from the capabilities registry */
  contextWindow: number
  lastCompactionSeq?: number
  /** set when a compaction run is scheduled/underway */
  compactionPending?: boolean
}
```

**Triggering.** After every run completes: if `lastInputTokens > 0.75 * contextWindow`, the thread is marked
compaction-eligible (`compactionPending`). The compaction run is then scheduled **opportunistically, not immediately**:
at thread idle, or aligned with a moment the prompt prefix must change anyway (a `load_actions`, a handoff §A) — because
compaction rewrites the entire cached prefix, firing it purely on a token threshold thrashes the provider prompt cache
(next section). It runs in the background either way; a send that arrives mid-compaction queues exactly as sends during
streaming queue today. A **pre-run guard** handles the pathological case: if a queued message would exceed the window
outright, compaction runs first, synchronously, before the message run (`reason: 'pre-run-guard'`). The thresholds are
per-agent-overridable with these defaults. This is the direct fix for structural weakness #2 ("monotonic context growth
until provider rejection").

### The stable-prefix invariant (prompt-cache economics)

Provider prompt caching makes the stable prefix the dominant cost lever for threads that live for weeks — cached input
is roughly an order of magnitude cheaper, and long-lived threads are the whole point of this design. So cache
preservation is an **explicit design constraint**, not an accident of implementation:

- **Prefix ordering.** The model-facing context is ordered `[static system prompt]` →
  `[tool definitions, append-only in load order — an unload marks a definition inert rather than re-sorting the list; the ordering rule belongs to tool-system.md's load_actions]`
  →
  `[memory listing, moved out of the system prompt into a refreshable user-role block near the tail, so memory writes never invalidate the prefix]`
  → `[conversation]`.
- **Deliberate change points only.** The prefix may change only at `load_actions`, handoff (§A), and compaction — and
  compaction scheduling aligns itself with those moments when it can (above), instead of adding its own.
- **Observable.** Per-run `cacheRead`/`cacheWrite` are already persisted (orchestration.md usage); the thread's
  cache-hit ratio (`cacheRead / input` over recent runs) surfaces in the same context meter (§E), so a change that
  silently 10×'s a long thread's cost is visible — and CI asserts prefix byte-stability across turns absent a deliberate
  change point (testing strategy).

Context state is surfaced honestly in the UI (a quiet fill meter, §E) and over WS (`change` on the thread carries
`contextState`).

## Part C — The one-input UX

### Routing: continue, branch, or new

The default surface is one text input with no agent dropdown and no session picker. A send is resolved by a **router**
into `(agentId, threadId | new, mode)`:

```
Tier 0 — explicit: the user is inside a thread view, or used an explicit affordance
         ("new thread", a branch gesture, an inbox reply). No inference.
Tier 1 — sticky continuation: an active thread exists for this surface (the sidebar's
         current thread) and the message arrived within a recency window → continue it.
Tier 2 — routed: no sticky thread, or the user invoked "send to..." — a cheap model
         call (the router action) picks continue-recent / new-thread / agent, given the
         message, window context, and the K most recent active threads' titles+summaries,
         augmented by thread_search retrieval when recency misses (below).
```

Tier 2 is deliberately an **action** (`system.route_message`, an Onyx-typed builtin per
[tool-system.md](./tool-system.md)) rather than bespoke code: it is auditable, replaceable, and per-account
configurable. Its I/O schema (dag-json):

```json
{
  "name": "RouteMessageInput",
  "type": "hm://<onyx>/map",
  "required": ["message", "candidates"],
  "properties": {
    "message": {"type": "hm://<onyx>/string"},
    "windowContext": {"ref": "hm://<seed>/assistant-window-context"},
    "candidates": {
      "type": "hm://<onyx>/list",
      "items": {
        "type": "hm://<onyx>/map",
        "required": ["threadId", "agentId", "title", "lastActive", "summary"],
        "properties": {
          "threadId": {"type": "hm://<onyx>/string"},
          "agentId": {"type": "hm://<onyx>/string"},
          "title": {"type": "hm://<onyx>/string"},
          "lastActive": {"type": "hm://<onyx>/integer"},
          "summary": {"type": "hm://<onyx>/string"}
        }
      }
    }
  }
}
```

(Sketch in the real `feat/onyx` meta-schema vocabulary: `type` carries a kind URL, maps use `properties`/`required`, and
optionality is omission from `required` — so `windowContext` is optional with no null-union needed. There is no `tag`
keyword anywhere in the meta-schema; union discrimination throughout these docs is by the single-value-`enum`
convention.)

with output `{decision: 'continue' | 'new', threadId?, agentId, confidence, rationale}`. Low confidence falls back to
`continue` on the sticky thread — misrouting into a fresh thread is the expensive mistake (context loss); continuing is
cheap to correct (the correction gesture is "actually, new thread", which branches the message out — the send is just
re-targeted since the message hasn't been consumed by a run yet if caught pre-run, or moved via branch if not). Routing
never happens silently in the dark: the resolved target is shown inline above the input ("↳ continuing _Perf audit_ ·
change") the moment the send resolves.

The `candidates[].summary` comes for free: it is the thread's latest compaction summary head, or the title for
never-compacted threads. Compaction thus makes routing better — a virtuous loop.

### Retrieval: `thread_search`

Recency is not memory. A K-recent candidate list routes "continue what we discussed about the pricing page last month"
wrong, and an agent cannot recall its own prior work beyond what compaction happened to promote to memory. So the design
adds a **`thread_search` builtin** (registered per [tool-system.md](./tool-system.md); near-core — discoverable and
cheap to load) doing semantic search over the account's own history:

- **Index at write time, not query time.** Compaction is the natural indexing moment: the summary is computed once and
  stored, so it is embedded once and stored. Indexed content: compaction summaries, thread titles, and agent memory
  files (embedded on write). Seed already runs an embedding pipeline in production (the hypermedia embedding infra); the
  missing piece is wiring, not new infrastructure.
- **Router integration.** When Tier 1 misses and the Tier-2 recency candidates yield low confidence, the router's
  candidate list is augmented from `thread_search` over the message text — old-but-relevant threads compete with recent
  ones instead of being invisible.
- **Agent-facing.** Exposed as a discoverable action, so "what did we decide about X" resolves against the account's
  threads and memory instead of failing or hallucinating. Results return references (threadId, seq ranges, summary
  snippets) — never wholesale foreign context injected into the current thread.

### Evolving AssistantDraftChat and the window-context part

`AssistantDraftChat` (`assistant-panel.tsx:479`) already implements "the input exists before the container": create
session on first send, attach window context, hand off to the live view. The evolution:

1. The `createSession → messageSession` pair collapses into one `SendMessage` action (§D) that carries the routing
   inputs; the server creates the thread when the router says `new`. This removes the client-side two-step and its
   partial-failure window (session created, message lost).
2. The unsent-input draft becomes per-surface: one draft for the one input. Today this is client-side state in
   `AssistantDraftChat`; it stays client state (or gains a small new server table if cross-device draft sync is ever
   wanted). Note that `agent_drafts` is **not** this — it is the write-tool's Hypermedia _document_ draft store (content
   format, edit/location targets, publish lifecycle) and is untouched by this design.
3. The window-context part (`assistant-window-context.ts`) is kept as the implicit-context mechanism but upgraded from
   prose lines to a **structured, Onyx-typed part** —
   `{type: 'context', window: AssistantWindowContext, lines?: string[]}` — with `lines` retained for old servers.
   Structured context is what the router (above) and the compaction dropper (§B) key on; the model-facing rendering
   stays the current line format. The ephemeral-per-send semantics (never in transcript, dropped at compaction) are
   unchanged — this part is the proven seed of "context the user never manages."

### Proactive threads: the inbox

Trigger-born threads today land undifferentiated in the session list. With `attention` on the thread:

- A trigger firing creates its thread with `attention='unseen'`. If the agent's run ends with an explicit ask-the-user
  (a `needs_user` signal the agent can raise via a builtin action, or an error), it escalates to
  `attention='needs_user'`.
- The one-input surface shows a compact **inbox affordance**: a badge + a stack of attention threads above the input
  ("Site-update watcher found 3 broken links · view"). Opening one makes it the sticky thread — replying routes Tier 0.
- **Interrupt tier**: `needs_user` threads may raise an OS notification (desktop) and pin above the input until answered
  or dismissed. `unseen` never interrupts; it waits to be noticed. Marking seen is `SetThreadAttention` (§D), also fired
  implicitly by opening the thread.
- Delegation threads (`origin='delegation'`) default to `attention='none'` — their parent run surfaces their result; the
  inbox is for things _no_ surface would otherwise show.
- **Cross-account placeholder.** The inbox is also where a future signed `agent.request` from _another account's_ agent
  would land: an Onyx-typed request document addressed to one of this account's published agents, delivered over
  existing Hypermedia sync, creating a thread with the reserved origin `'external'` (§A) and an attention state — and
  running under the strictest origin taint, with the response as a signed reply document linked to the request CID. This
  is deliberately only a shape reservation (origin value + inbox landing + provenance-as-signed-objects) so the thread
  model doesn't bake in single-account assumptions; the request/response protocol itself is undesigned (open questions).

## Part D — Protocol additions

New signed actions (same envelope, `agents/protocol/src/index.ts`; all account-scoped, idempotent via `clientRequestId`
where they create):

```ts
/** The one-input send: routes to a thread, creating one if needed. Replaces the
 *  client-side CreateSession+MessageSession two-step for the default surface. */
export type SendMessage = {
  _: 'SendMessage'
  content: MessageSessionContentPart[] // reused as-is, incl. structured context part
  /** Routing hints — all optional. Explicit threadId = Tier 0 (continue that thread). */
  threadId?: string
  agentId?: string // constrain routing to one agent
  routing?: 'auto' | 'new-thread' // 'new-thread' skips continuation
  clientMessageId?: string
}
export type SendMessageResponse = {
  _: 'SendMessageResponse'
  threadId: string
  created: boolean
  runId: string
  routing: {decision: 'continue' | 'new'; confidence?: number; rationale?: string}
}

export type ListThreads = {
  _: 'ListThreads'
  filter?: {
    lifecycle?: 'active' | 'archived'
    attention?: 'unseen' | 'needs_user'
    origin?: ThreadOrigin
    rootId?: string
    agentId?: string
  }
  limit?: number
  cursor?: SessionListCursor // same keyset cursor, unchanged
}

export type BranchThread = {_: 'BranchThread'; threadId: string; fromSeq: number; clientRequestId?: string}
export type CompactThread = {_: 'CompactThread'; threadId: string} // manual compaction
export type ArchiveThread = {_: 'ArchiveThread'; threadId: string; archived: boolean}
export type SetThreadAttention = {
  _: 'SetThreadAttention'
  threadId: string
  attention: 'none' | 'unseen' | 'needs_user'
}
/** User-initiated handoff (§A): appends the durable `handoff` event; the thread's serving agent changes from there. */
export type HandoffThread = {_: 'HandoffThread'; threadId: string; toAgentId: string; reason?: string}
```

**Backward compatibility.** Session actions are aliases over the same rows: `CreateSession` = create root thread
(`origin='user'`), `ListSessions` = `ListThreads` with no lineage filter (children included, so old clients still see
everything), `MessageSession` = Tier-0 `SendMessage`, `GetSession`/`UpdateSession`/`StopSession`/`DeleteSession`
unchanged. `SessionInfo` gains optional fields (`origin`, `parentSessionId`, `rootSessionId`, `lifecycle`, `attention`,
`contextState`) that old clients ignore. Nothing existing breaks; new clients get `ThreadInfo` as the same shape under
the honest name.

**WS events** (additive to `AgentWSEvent`, `index.ts:687`):

- Compaction events arrive as ordinary `append` events on `sessions/<id>` — no new event kind needed; replay-on-
  reconnect (`Subscribe.afterSeq`) covers them for free. Clients that don't know `type:'compaction'` already tolerate
  unknown payloads (`SessionEventPayload` ends in `Record<string, unknown>`).
- `{_: 'change', key: 'account/<id>', value: {reason: 'thread-attention', threadId, attention}}` — the inbox badge's
  push signal, reusing the existing account-level change channel.
- `{_: 'change', key: 'sessions/<id>', value: ThreadInfo}` now carries `contextState` so the fill meter is live.
- Child-thread activity relevant to a parent (delegation progress) is **not** mirrored into the parent's event stream;
  the parent's run emits its own progress via `appendPartial.activity` as today, and a client wanting child detail
  subscribes to the child key it learned from the action-call event.

## Part E — Desktop UX evolution

Phased, so the sidebar never regresses:

1. **Now → threads land**: sidebar keeps its list, but split into _Attention_ (inbox stack) / _Active_ / _Archived_; the
   agent dropdown demotes to an override inside the send affordance. `resolveAssistantSelection` becomes the Tier-1
   sticky-thread provider. The models layer (`frontend/apps/desktop/src/models/agents.ts`) swaps `ListSessions` for
   `ListThreads` and gains the attention badge query.
2. **One input**: the sidebar's default state is the input + inbox stack + routing chip; the thread list becomes a
   secondary "history" pane. `AssistantDraftChat` is refactored to call `SendMessage` (§C). The full Agents page keeps
   power-user affordances: lineage tree (parent/branch/delegation as an indented tree from `sessions_by_parent`), the
   compaction divider with expandable pre-compaction transcript, per-thread context meter, and run history per thread
   (runs table).
3. **Context transparency**: hovering the meter shows `lastInputTokens / contextWindow`, the thread's recent cache-hit
   ratio (§B stable-prefix invariant), and the last compaction's `tokens.before → after`; a "compact now" item issues
   `CompactThread`; a "promoted to memory" chip on the divider links into the memory browser.

Web (feat/agents-web stack) inherits all of this through the shared protocol; nothing here is desktop-specific except
the OS-notification interrupt tier.

## Part F — Sub-agent contexts and the parent thread

Delegation ([orchestration.md](./orchestration.md) owns spawning, queueing, resumption) intersects threads as follows:

- A sub-agent run gets its **own thread** (`origin='delegation'`,
  `parent_link = {kind:'delegation', runId, actionCallId}`). Its context is constructed from the action's Onyx-typed
  **input** — not the parent transcript. The parent decides what crosses the boundary by what it puts in the input; this
  is the context firewall that makes fan-out cheap and sub-runs cacheable/replayable.
- The parent thread's log records only the action-call and its typed result (plus a `childThreadId` in the call event so
  UIs can deep-link). Parent compaction summarizes the _result_, never the child transcript; child threads compact
  independently under the same §B machinery (relevant for long-running delegates).
- Optional context grants are explicit inputs, not ambient access: a parent may pass its latest compaction summary, or
  specific event ranges, as ordinary input fields. There is no "child reads parent memory" backdoor beyond agent memory
  itself, which remains agent-scoped as today.
- Branches (`origin='branch'`) are the one lineage kind that _does_ share replayed context (parent events ≤ `fromSeq`),
  which is why they are distinct from delegation in `ThreadParentLink`.

## Migration from current code

| Current                                                                                       | Change                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions` table (`agents/src/sqlite-schema.sql:69`)                                          | additive columns (§A); backfill `root_session_id=id`, `origin='user'` (`'trigger'` where `trigger_firings.session_id` matches)                                                              |
| `session_events` (`:108`)                                                                     | unchanged; gains `compaction` payload variant                                                                                                                                               |
| `#piMessages()` (`api-service.ts:1952`)                                                       | compaction-boundary read (§B) + branch parent-prefix read (§A)                                                                                                                              |
| `contextWindow: 128000` (`api-service.ts:3514`)                                               | capabilities registry in `agents/protocol/src/model-capabilities.ts` + observed-ceiling correction                                                                                          |
| usage accumulated, never persisted (`#runPiAgent`)                                            | persisted per run (orchestration.md); thread `context_state_cbor` updated at run end                                                                                                        |
| `SettingsManager.inMemory({compaction:{enabled:false}})` (`:1621`)                            | stays disabled — Pi never compacts; Seed owns compaction as durable events                                                                                                                  |
| `CreateSession`/`MessageSession` two-step in `AssistantDraftChat` (`assistant-panel.tsx:479`) | single `SendMessage`; old actions kept as aliases                                                                                                                                           |
| `assistant-window-context.ts` context lines                                                   | structured `window` field added; `lines` kept for compat                                                                                                                                    |
| trigger sessions (`activity-triggers.ts`)                                                     | set `origin='trigger'`, `attention='unseen'`; exactly-once machinery untouched                                                                                                              |
| unsent-input draft (client state in `AssistantDraftChat`)                                     | one per-surface draft for the unified input — client state (optionally a new small server table for cross-device sync); `agent_drafts` (the write-tool's document-draft store) is untouched |
| `set_session_title` handler (persists title, skips transcript event)                          | additionally appends the durable `thread_renamed` event (§A)                                                                                                                                |

Sequencing: (1) schema migration + honest capabilities + persisted usage; (2) compaction events + auto-trigger; (3)
`SendMessage`/`ListThreads` + inbox; (4) branching + lineage UI. Each step ships independently useful.

## Security considerations

- **Summary integrity**: the compaction summary becomes model-facing "truth" about past events. It is produced by a
  model reading the thread's own (already model-visible) events, so it adds no new injection surface — but a poisoned
  thread can poison its summary durably. Mitigation: the compaction prompt is fixed system-side (not agent-editable
  except via [self-configuration.md](./self-configuration.md) gates), the event records `runId` for audit, and the
  pre-compaction transcript is never destroyed, so any summary is verifiable against source.
- **Memory promotion** widens blast radius from thread to agent: promoted writes are attributed in the compaction event
  (`promotedMemory[].path` + note) and go through the existing `resolveMemoryPath` gate; no new filesystem surface.
- **Routing**: `SendMessage` resolves targets strictly within the signed account's own agents/threads; the router action
  sees only that account's candidates. Routing `rationale` is returned to the client, not stored in the thread (it may
  quote other threads' titles).
- **Lineage**: `BranchThread` requires the parent to belong to the same account; child reads of parent events reuse the
  same account check as `GetSession`. Delegation threads inherit the _child agent's_ tool permissions, never the
  parent's (orchestration.md).
- **Handoff**: `HandoffThread` (and its gated agent-callable form, §A) targets only the same account's active agents;
  the durable `handoff` event is the audit trail, and the incoming agent's tool permissions apply from the handoff seq
  forward — permission sets never blend.
- **Attention/notifications**: `needs_user` content shown in OS notifications is title-only (system-generated), not
  arbitrary agent text, to keep prompt-injected exfiltration out of the notification channel.

## Testing strategy

- **Replay determinism**: golden tests over `#piMessages()` — a log with N compaction chains must produce identical Pi
  message arrays across process restarts and after appending new events; branch threads must produce parent-prefix +
  own-events exactly. Extend `api-service.test.ts`'s existing session-event fixtures.
- **Compaction lifecycle**: unit-test the trigger math (threshold, pre-run guard) with fake run usage; integration test
  with a mocked Pi session that a compaction run appends exactly one valid event, records promotions, and that failure
  leaves the log unchanged (fetch-mock flakes noted in memory — keep compaction runs off the shared mocked
  `globalThis.fetch` path by injecting the summarizer).
- **Routing**: table-driven tests of Tier 0/1 (pure functions), and contract tests of the Tier-2 action against a stub
  model: explicit `threadId` always wins; low confidence falls back to sticky-continue; `routing:'new-thread'` never
  continues.
- **Protocol compat**: run the existing desktop client test-suite (`models/agents.ts` queries) unmodified against a
  thread-enabled server — session aliases must keep it green. Add WS tests for `thread-attention` change events and
  compaction `append` replay via `Subscribe.afterSeq`.
- **Migration**: `sqlite.test.ts` already diff-tests live schema against `sqlite-schema.sql`; add the additive columns
  there plus a backfill test over a fixture DB with trigger-born sessions.
- **Capabilities honesty**: per-provider tests that a context-length error updates the observed ceiling and that the
  next run's guard uses it.
- **Handoff replay**: a log containing `handoff` events must rebuild context with the correct agent's prompt/tools per
  segment across restarts; the agent-callable form respects its capability gate.
- **Prefix stability**: golden tests assert the serialized model-facing prefix is byte-identical across consecutive
  turns absent load/unload, handoff, or compaction events, and that the compaction recap enters as a **user-role fenced
  block** (never system-role) — the cache-regression analogue of tool-system.md's prompt-budget CI ceiling.

## Open questions

1. **Branch semantics vs. provider caching**: branch threads replay parent prefixes — given the stable-prefix invariant
   (§B), does prefix-sharing across branches merit provider prompt-cache-aware scheduling (run siblings on the same
   provider connection), or is that premature?
2. **Compaction model choice**: default to the thread's own model, or a designated cheap account-level summarizer model?
   (Cost favors the latter; summary quality and style-consistency favor the former.) Needs measurement.
3. **Router cost floor**: is Tier 2 rare enough (Tier 0/1 should cover >90% of sends) that a small hosted model per send
   is acceptable, or do we want an embedded/local classifier for the common case?
4. **Cross-server routing**: identity is `(serverUrl, sessionId)` and the sidebar merges servers; should `SendMessage`
   ever route across servers (client-side federation of candidates), or is the sticky server always right?
5. **Retention**: with the full pre-compaction transcript retained forever, do heavy tool-result payloads need a
   cold-storage tier (move `event_cbor` bulk to files/IPFS with a stub in SQLite), and at what size threshold?
6. **`needs_user` as structured ask**: should the agent's ask-the-user signal carry an Onyx-typed question/choices
   payload (renderable as buttons in the inbox), and does that belong here or in [tool-system.md](./tool-system.md) as a
   builtin action's output schema?
7. **Multi-window stickiness**: Tier 1 assumes one sticky thread per surface; with several desktop windows, is
   stickiness per-window (likely) and how does that interact with the single per-surface draft?
8. **`thread_search` index plumbing**: which embedding model/infra (reuse the production hypermedia embedding pipeline
   vs. a local table in the agents SQLite), and does memory-file indexing belong to the memory action
   ([tool-system.md](./tool-system.md)) or here with compaction?
9. **Handoff briefing**: agent memory is agent-scoped, so a handoff target starts with only the thread history — should
   the `handoff` event optionally carry an outgoing agent's briefing note (durable, in-log), or is history always
   sufficient?
10. **Skills interplay**: if [tool-system.md](./tool-system.md) adopts a skills tier (loadable procedure documents with
    always-visible one-line summaries), loaded skill bodies become context items — do they snapshot into the compaction
    event like `activeActions` and reload by ref on demand, and are they droppable at tier 3?
11. **Cross-account requests**: §C reserves origin `'external'` and the inbox landing for signed `agent.request`s from
    other accounts; the request/response document shapes, delivery semantics, and strictest-taint execution rules need
    an owner — this doc, or a new federation design doc?
