# Workflows: agent-authored scripts, sub-sessions, and visible progress

Implementation planning document (2026-08-02). Self-contained: everything needed to build the feature is specified here,
grounded in the code as it was before the work. **Status: implemented 2026-08-03** (phases 1–4 landed on
`feat/agent-workflows`; the progress-card UI and live-model gates are in flight) — see "Implementation divergences (as
built)" at the end for where the code deliberately differs from this plan.

## 1. Summary

Seed Agents gains the ability to perform long-running, decomposable tasks through three connected features:

1. **Workflows.** The agent writes a JavaScript script for itself, per task. The script calls any tool the agent has
   enabled and strings tool calls together with ordinary JS control flow (loops, conditionals, `Promise`-style
   parallelism). The script survives service restarts mid-execution and resumes exactly where it left off.
2. **Sub-sessions.** A new tool spawns a child session that runs to completion and **resolves as success or fail**,
   optionally with a schema-validated result payload. Callable both by the chat agent directly and from inside workflow
   scripts. Child sessions are real sessions — the whole existing session UI works on them.
3. **Visible progress.** The sessions list shows child sessions nested under their parent. The parent session pins a
   **workflow status card at the bottom of the chat** (below all messages, above the composer) showing the step list,
   live child status, progress, elapsed time, and a cancel control. The same card renders **todo lists** for ordinary
   sessions, so plans and workflows share one progress surface.

### User stories

- "Research these 12 competitors and write a comparison doc" → the agent writes a workflow that fans out 12 sub-sessions
  in parallel, collects their typed results, then writes the document — while the user watches 12 child rows tick from
  running to done in the pinned card, and can open any child transcript.
- "Fix every broken link on my site" → a workflow loops: list documents → check links → spawn a sub-session per broken
  page → verify. The desktop can be closed and reopened; the card reconstructs from durable state.
- A plain chat task with five steps → the agent maintains a todo list via a hidden tool; the same pinned card shows
  checkboxes ticking off.

## 2. Current state and gaps

What exists today (all in `agents/src/api-service.ts` unless noted):

- **Sessions and events.** `sessions` + append-only `session_events` (SQLite, `agents/src/sqlite-schema.sql`), replayed
  to clients over the signed WS (`sessions/<id>` key, `append`/`appendPartial`/`change` grammar). This spine is kept
  unchanged.
- **The execution loop.** `#messageSessionOnce` (`:1451`) appends the user message, sets `sessions.status='streaming'`,
  and awaits `#runPiAgent` (`:1656`), which builds an in-memory Pi SDK session, replays durable events into provider
  messages via `#piMessages` (`:2028`), and streams text/tool events back into durable events and WS partials.
- **Run state is in-memory only.** `RunningSession` (`:167`) + the `#runningSessions` map (`:177`). Nothing durable
  records what ran or is running: a crash mid-stream wedges `status='streaming'` forever, and there is no record of
  usage, cost, or timing.
- **Fire-and-forget spawning exists.** The `start_session` tool (`#startSessionFromAgent`, `:1364`) creates a new
  session of the same agent and dispatches its first run detached. Its guards are honest about their limits: the
  spawn-depth and spawn-count maps are in-memory backstops that reset on restart, there is **no durable parent link**
  (the sessions list shows spawned sessions as unrelated top-level rows), and the caller **never receives results** —
  the tool description says so explicitly.
- **Trigger dispatch is fire-and-forget** (`#dispatchTriggerSession`, `:2579`), with `drainTriggerSessions` (`:2625`) as
  the await-all hook for tests/shutdown.
- **Code execution** (`agents/src/code-exec.ts`) runs Python/shell in ephemeral microsandbox microVMs against the agent
  memory directory. It is compute, not orchestration: no tool access from inside, fresh VM per call.
- **Tool registry** (`agents/protocol/src/tool-registry.ts`): each tool owns name, description, JSON `inputSchema`,
  optional `outputSchema`, and render metadata. Tool implementations are Pi `ToolDefinition`s built by
  `createAgentServicePiTools` (`api-service.ts:3768`).
- **Stop control**: `StopSession` aborts a live run via the in-memory map.

Gaps this plan closes: durable run records; a dispatch queue with crash recovery; awaited (not just detached) child
sessions with typed results; session lineage; a workflow engine; and the progress UI.

Explicitly NOT in scope (v2 section at the end): named/published workflows, a workflow registry, external event/signal
waits, continue-as-new, cost-based budgets, multi-worker dispatch.

## 3. Architecture overview

```
                       ┌──────────────────────────────────────────────────────────┐
                       │  runs table  =  the queue  =  the durable run tree       │
                       └──────────────────────────────────────────────────────────┘
 user message ──► enqueue agent run ──► DispatchLoop claims ──► agent-run executor (#runPiAgent, reworked)
 trigger firing ─► enqueue agent run                             │
                                                                 │ model calls sub_session / run_workflow
                                                                 ▼
                                              persist tool_call · create child run(s) · PARK parent
                                                                 │            (status='waiting', no slot held)
                                          ┌──────────────────────┴───────────────────────┐
                                          ▼                                              ▼
                              child agent run (+ real session,            workflow run (QuickJS realm,
                              parent_session_id set, isolated             journaled ctx.* host API; its
                              context, typed return_result)               ctx.agent spawns more child runs)
                                          │                                              │
                                          └───────────── terminal status ────────────────┘
                                                                 │
                                    finalizer: append parent tool_result · requeue parent
                                                                 │
                                                    parent resumes via event replay
```

Three invariants carry the whole design:

1. **Everything that executes is a `runs` row** — a user turn, a trigger turn, a sub-session, a workflow. Runs form a
   tree (`parent_run_id`, denormalized `root_run_id`). The table doubles as the dispatch queue; there is no separate
   jobs table.
2. **Durable spines, never in-memory truth.** Agent runs already have one (session events, replayed by `#piMessages`).
   Workflow runs get the analogous `run_journal`: every effect a script performs is journaled, and resume = replay the
   script against the journal. A crash can lose only work-in-flight, never completed effects, and nothing completed is
   ever re-executed.
3. **Waiting is free.** A parent blocked on children (or a workflow sleeping) holds no worker slot, no provider stream,
   and — after eviction — no memory. Parking and resuming ride the same replay mechanisms as crash recovery, so restarts
   are a non-event by construction.

## 4. Data model

Schema version bump + migration in `agents/src/sqlite.ts` / `sqlite-schema.sql`.

```sql
CREATE TABLE runs (
    id TEXT PRIMARY KEY,                          -- same id helper as sessions
    account_id TEXT NOT NULL REFERENCES accounts (id),
    root_run_id TEXT NOT NULL,                    -- self for roots; lets one WS subscription cover the tree
    parent_run_id TEXT REFERENCES runs (id),
    depth INTEGER NOT NULL DEFAULT 0,             -- root = 0
    kind TEXT NOT NULL,                           -- 'agent' | 'workflow'
    agent_id TEXT REFERENCES agents (id),         -- both kinds: the owning agent
    session_id TEXT REFERENCES sessions (id),     -- agent runs: transcript session; workflow runs: NULL
    trigger_firing_id TEXT REFERENCES trigger_firings (id),
    origin TEXT NOT NULL,                         -- 'user' | 'trigger' | 'agent' | 'workflow' | 'system'
    title TEXT,                                   -- human label (workflow title / sub-session title)
    model TEXT,                                   -- provider/model actually used (agent runs)
    source_cid TEXT,                              -- workflow runs: CID of source_text (sha256-based CIDv1)
    source_text TEXT,                             -- workflow runs: the JS module verbatim
    input_cbor BLOB NOT NULL,                     -- RunWorkflowInput / SubSessionInput / user-turn descriptor
    output_cbor BLOB,                             -- terminal success payload
    error_cbor BLOB,                              -- RunError {code, message, retryable?, detail?}
    status TEXT NOT NULL,                         -- 'queued'|'claimed'|'running'|'waiting'
                                                  -- |'succeeded'|'failed'|'canceled'
    wait_cbor BLOB,                               -- {reason:'children', toolCallIds: string[]}
                                                  -- | {reason:'timer', wakeAt: number}
    attempt INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 1,
    not_before INTEGER,                           -- backoff / timer wake (ms epoch)
    queue TEXT NOT NULL DEFAULT 'background',     -- 'interactive' | 'background'
    lease_owner TEXT,                             -- service instance id (crash sweep)
    lease_expires_at INTEGER,
    budget_cbor BLOB,                             -- {maxWallMs?, maxChildren?, maxDepth?}
    usage_cbor BLOB,                              -- {tokens..., children: rollup} flushed at tool boundaries
    plan_cbor BLOB,                               -- RunPlan snapshot for the pinned card (§11)
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX runs_dispatch    ON runs (status, queue, not_before, created_at);
CREATE INDEX runs_by_root     ON runs (root_run_id, created_at);
CREATE INDEX runs_by_parent   ON runs (parent_run_id);
CREATE INDEX runs_by_session  ON runs (session_id, created_at DESC);
CREATE INDEX runs_by_account  ON runs (account_id, created_at DESC);

CREATE TABLE run_journal (
    run_id TEXT NOT NULL REFERENCES runs (id),
    seq INTEGER NOT NULL,
    entry_cbor BLOB NOT NULL,                     -- RunJournalEntry (§8.4)
    created_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, seq)
) WITHOUT ROWID;
```

Session lineage (denormalized so list queries never join through runs):

```sql
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions (id);
ALTER TABLE sessions ADD COLUMN run_id TEXT;      -- the run this session is the transcript of (child sessions)
ALTER TABLE sessions ADD COLUMN plan_cbor BLOB;   -- todo list for plain sessions (update_plan tool, §11.4)
CREATE INDEX sessions_by_parent ON sessions (parent_session_id, created_at);
```

Notes:

- `sessions.status` is **kept and becomes a maintained mirror** of run state so existing clients keep working:
  `streaming` iff a non-terminal (`queued|claimed|running|waiting`) agent run references the session; else `error` if
  the latest run `failed`, `stopped` if `canceled`, else `idle`. All writes to it go through one
  `#syncSessionStatusFromRuns(sessionId)` helper.
- The in-memory spawn maps (`#sessionSpawnDepth`, `#sessionSpawnCounts`, `api-service.ts:180-186`) are deleted; depth
  and fan-out are now read from the runs tree, which survives restarts.
- Journal entries store tool inputs/outputs inline (they are bounded by the existing 256 KiB tool-result cap). Total
  journal size per run is capped (§12); a `run_blobs` dedup table is deferred until profiling demands it.

## 5. Run lifecycle

```
            enqueue                claim (lease)          executor
 CreateRun ────────► queued ──────────► claimed ────────► running ──► succeeded
                        ▲                                  │  ▲  │──► failed
                        │  retryable error / crash sweep   │  │  └──► canceled
                        └──────────────────────────────────┘  │
                                               waiting ───────┘
                                     (children | timer; holds no slot)
```

- **Enqueue** inserts the row (`status='queued'`) and pokes the dispatch loop's wake signal. For interactive turns
  (`MessageSession`), enqueue + claim happen synchronously in the action handler so first-token latency is unchanged.
- **Claim** is a single atomic `UPDATE ... WHERE id = (SELECT ...)` setting `claimed` + lease. **Running** is the
  executor acknowledging start (`started_at`).
- **Waiting** (either kind): the run's executor state is torn down (Pi session ended / VM optionally evicted), the lease
  is released, `wait_cbor` records why. Wake = requeue (`status='queued'`, `not_before` for timers).
- **Terminal**: `succeeded` (output validated + stored), `failed` (RunError stored), `canceled`. A finalizer runs in the
  same transaction that writes terminal status: roll usage up into the parent, resolve the parent's pending `tool_call`
  (§7.4), sync the session-status mirror, emit WS changes.

### Error taxonomy

`RunError = {code, message, retryable?, detail?}` with codes:

`tool-error` · `output-schema` (typed result never validated) · `nondeterministic-replay` · `journal-cap` ·
`wall-timeout` · `depth-limit` · `fanout-limit` · `lint` (workflow source rejected) · `source-too-large` · `interrupted`
(crash, attempts exhausted) · `provider-error` (retryable per classification) · `canceled`.

Retryable: provider 429/5xx/network, lease-expiry. Everything else is terminal on first occurrence.

### Crash recovery

1. **Startup sweep**: rows with `status IN ('claimed','running')` whose lease is ours or expired → `status='queued'`,
   lease cleared, `attempt` unchanged (a crash is not the run's fault). `waiting` rows are untouched — they were not
   losing anything.
2. **Dangling tool calls** (agent runs): a crash between the persisted `tool_call` (written at `tool_execution_start`,
   `api-service.ts:1851`-area) and its `tool_result` leaves a transcript providers reject. Before re-entering the loop,
   the executor synthesizes a durable `tool_result` for each trailing unmatched `tool_call`:
   `{error: 'interrupted by service restart', sideEffectState: 'unknown'}` — except `sub_session`/`run_workflow` calls
   whose child run still exists, which instead re-park on the child (the child kept running or is itself queued; nothing
   is lost). The model, not the engine, decides whether to re-issue interrupted ordinary tools.
3. **Workflow runs** resume by journal replay (§8.5). Completed `ctx` calls return journaled results; the first
   un-journaled call continues live.
4. The `MessageSession` 409 guard (`Session is already streaming`, `:1464`) changes to "a non-terminal agent run exists
   for this session" — liveness is now lease-based, so the wedged-`streaming` failure mode is structurally gone.

### Cancellation

`CancelRun {runId}` (and `StopSession` on a session, which maps to cancel-the-live-run):

- Marks the run and every non-terminal descendant `canceled` (single recursive CTE update, then per-run cleanup).
- Live agent-run children abort via the existing `#runningSessions` abort path; live workflow VMs are interrupted via
  the QuickJS interrupt handler (a shared `canceled` flag the handler checks); `queued` children simply never start.
- A canceled child resolves its parent's pending tool call as `{status:'canceled'}` — parents observe cancellation as
  data and may continue (a workflow's `ctx.call` throws `ActionError{code:'canceled'}`, catchable).

## 6. The dispatch loop

`agents/src/run-queue.ts`, built on the existing `PollLoop` (`agents/src/poll-loop.ts`) plus an in-process wake signal
on every enqueue so latency is not interval-bound (interval becomes the fallback for timer wakes and backoff expiry).

- **Queues**: `interactive` (user-initiated turns; reserved slots so background fan-out never starves the chat box) and
  `background` (everything else). Limits: `maxConcurrentModelRuns` (default 8) counts agent runs across both queues,
  `interactiveReserved` (default 2) of them held for interactive; workflow runs are cheap (no provider stream) and get
  their own higher cap (default 32).
- **Invariant: one live agent run per session** — checked at claim, preserving today's per-session serialization without
  the racy status column.
- **Retry**: on retryable failure with `attempt < max_attempts`: `status='queued'`,
  `not_before = now + 5s·2^attempt + jitter` (cap 5 min). Defaults: `max_attempts=3` for trigger-origin roots, `1` for
  interactive turns (the user is watching; they retry), `2` for child runs.
- **Trigger integration**: `#dispatchTriggerSession` call sites (`api-service.ts:2430`, `:2543`) become transactional
  enqueues (run insert joins the trigger-firing `INSERT OR IGNORE` transaction, run id derived deterministically from
  the firing id → exactly-once enqueue). `drainTriggerSessions` (`:2625`) becomes `awaitQueueIdle()` — this also
  de-flakes the detached-run fetch-mock problem in the agents CI suite by making run completion observable.
- **Wall-clock budgets** (`budget_cbor.maxWallMs`) are enforced by the loop against `started_at` on each tick.

## 7. Sub-sessions

### 7.1 Tool definition (`sub_session`; per-agent toggle `sub_session`)

````ts
type SubSessionInput = {
  title?: string // shown in sessions list + pinned card; defaults from prompt
  prompt?: string // inline system prompt for an anonymous child (exactly one of prompt | agentId)
  agentId?: string // run under another persisted agent definition of this account
  input: unknown // rendered as the child's first user message: a prose framing line
  //                          plus a fenced ```json block of this value
  tools?: string[] // allow-list intersected with the (child) agent's enabled tools
  output?: JsonSchema // if set, the child must deliver a matching payload via return_result
  budget?: {maxWallMs?: number}
}

type SubSessionResult =
  | {status: 'succeeded'; sessionId: string; output: unknown} // output: validated payload, or {text}
  | {status: 'failed'; sessionId: string; error: {code: string; message: string}}
  | {status: 'canceled'; sessionId: string}
````

Anonymous children (`prompt`) reuse the calling agent's provider/model/signing config with the given system prompt; the
resolved effective definition is embedded in the run's `input_cbor` so the run is self-describing forever.

### 7.2 Semantics

- Creates a `kind:'agent'` child run **plus a real session** with `parent_session_id` = caller's session and `run_id` =
  child run id. All existing session machinery (events, WS, attachments, stop) applies unchanged.
- **Context isolation is total**: the child sees its system prompt and the rendered `input` — never the parent
  transcript. Parents pass data, not history. (Persistent agent memory is shared when the child is the same agent, as
  with `start_session` today.)
- **Limits from the run tree** (durable, replacing the in-memory maps): child depth = parent depth + 1, max 4
  (`depth-limit`); children counted per parent run, max 16 (`fanout-limit`). Service-config overridable.
- `start_session` **remains** as the fire-and-forget variant, reimplemented on the queue (origin `'agent'`, root of its
  own tree, lineage columns set so it now appears nested in the UI too). Its tool description drops the "you will not
  receive its results" clause only for `sub_session`; `start_session` keeps detached semantics.

### 7.3 Typed results: `return_result`

When `output` is set, the child session gets a synthetic always-loaded tool `return_result` whose input schema **is**
that JSON Schema, and its system prompt instructs: finish by calling `return_result`. On call, the service validates the
payload (shared JSON-Schema validator — same one used at tool boundaries); failure returns the error list as the tool
result for self-correction, bounded to 3 attempts, then the run fails with `output-schema`. A valid call ends the run
`succeeded` with that payload as `output_cbor` (any trailing assistant text is still appended to the child transcript).
Without `output`, the run succeeds when the turn completes normally and `output = {text: finalAssistantText}`.

### 7.4 Parking and resume (the mechanism)

This is the heart of the feature; it must be restart-safe.

**Park.** Pi executes the tools of an assistant turn after `message_end`. The `sub_session` executor does NOT await the
child. It (a) creates child run + session in one transaction, (b) lets the durable `tool_call` event stand unanswered,
and (c) throws a sentinel `ParkRunSignal` carrying the pending tool-call ids. The reworked agent-run executor catches
the sentinel (it is not an error): appends nothing further, tears down the Pi session, and sets the run `waiting` with
`wait_cbor = {reason:'children', toolCallIds:[...]}`. When the model issued **several** spawn calls in one turn
(parallel fan-out from chat), all of them are created first; the run parks once on the set.

**Resume.** The child's terminal finalizer (same transaction as its status write): appends the parent-session
`tool_result` event for the matching `toolCallId` with the `SubSessionResult`, removes that id from the parent's
`wait_cbor` set, and — when the set empties — requeues the parent. On claim, the executor re-enters `#runPiAgent`, which
rebuilds provider messages from durable events via the existing `#piMessages` replay; the transcript now contains the
completed tool pair(s), so the model continues its turn with the results in hand, exactly as if the tool had returned
synchronously. No new replay machinery is needed — this is the same path every multi-turn session already exercises.

**Why always park** (no fast-path inline await): provider calls are stateless — resuming costs one context rebuild,
which every tool round-trip pays anyway. One code path, restart-safe by construction, and a parked parent frees its
model-run slot to the children (with a serial fast-path we would deadlock at `maxConcurrentModelRuns` on wide fan-outs).

**User interaction while parked**: `MessageSession` to a waiting session is rejected 409 like `streaming` today (the
one-live-run-per-session invariant); the composer shows the parked state via the pinned card (§11).

## 8. Workflows

### 8.1 Tool definition (`run_workflow`; per-agent toggle `workflow`)

```ts
type RunWorkflowInput = {
  title: string // pinned-card label
  source: string // JS module: `export default async function (input, ctx) { ... }`
  input?: unknown // JSON value passed to the module
  budget?: {maxWallMs?: number; maxChildren?: number; maxDepth?: number}
}
// resolves exactly like SubSessionResult, with runId instead of sessionId
```

Creates a `kind:'workflow'` child run; the calling agent run parks on it via §7.4 (workflow completion resolves the tool
call). Submission-time validation, so authoring errors fail in the same turn as cheap tool errors rather than as run
failures: source size cap (256 KiB), parse check, and a **determinism lint** rejecting `Date`, `Math.random`,
`setTimeout`/`setInterval`, `fetch`, `import`/`require`, `eval`, `XMLHttpRequest`, `crypto` tokens with a message
pointing at the `ctx` equivalent (`ctx.now()`, `ctx.sleep()`, `ctx.call('web_read', ...)`, …).

### 8.2 Execution environment

**In-process QuickJS-WASM realm (`quickjs-emscripten`), NOT the code-exec microVM.** Rationale:

- A workflow is pure control flow; every effect crosses the host boundary as a journaled `ctx` call whose
  implementations have their own sandboxes. A Linux VM adds ambient authority (time, entropy, network, /proc) that
  _breaks_ replay determinism rather than adding safety.
- Resume economics: replay re-executes the script on wakes and restarts. A QuickJS instance costs ~10 ms and a few MB; a
  microVM boot per wake would make durable timers and cheap parking absurd.
- Hard limits come free: WASM linear-memory cap (default 64 MiB per VM) and a QuickJS interrupt handler for fuel (abort
  after 2 s of pure compute between awaits — number-crunching belongs in `execute_code`, which workflows can call).
- Consequence: workflows are **not** gated on the exec backend. `execute_code` stays a callable tool; the `workflow`
  toggle is independent.

The realm is built with zero ambient authority: the module scope sees standard pure built-ins (`Object`, `Array`,
`JSON`, `Math` minus `random`, `structuredClone`) plus the two parameters `(input, ctx)`. Async host calls use
`quickjs-emscripten`'s asyncified context so `await ctx.call(...)` suspends the VM while the host works.

New files: `agents/src/workflow-host.ts` (ctx bridge, journal write/replay, determinism enforcement, lint) and
`agents/src/workflow-executor.ts` (VM lifecycle, fuel/memory caps, park/evict/resume, cancellation interrupt).

### 8.3 The `ctx` API (v1)

| member                                              | semantics                                                                                                                                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.call(toolName, input, opts?)`                  | Journaled tool call through the shared tool seam (§9), checked against the agent's enabled tools. `opts: {timeoutMs?}`. Returns the tool output; throws `ActionError {code, message, retryable}` on tool error (catchable). |
| `ctx.agent(spec)`                                   | Spawn a sub-session (§7 spec, minus `agentId` restrictions — same account only) as a **child of the workflow run**; awaits its `SubSessionResult` and returns `output` on success / throws on fail (catchable).             |
| `ctx.parallel(thunks)`                              | Run thunks concurrently, `Promise.all` semantics (first rejection wins; losers canceled). Results positionally stable regardless of completion order.                                                                       |
| `ctx.parallelSettled(thunks)`                       | `allSettled` variant: `[{status:'fulfilled', value} \| {status:'rejected', error}]`.                                                                                                                                        |
| `ctx.sleep(ms)` / `ctx.minutes(n)` / `ctx.hours(n)` | Durable timer: journals the wake time, parks the run (`waiting`/`timer`, `not_before`), survives restarts.                                                                                                                  |
| `ctx.step(label, fn)`                               | Journals step start/end, updates the run's `plan_cbor` (pinned card rows), returns `fn`'s result. Failed `fn` marks the step failed and rethrows.                                                                           |
| `ctx.plan(steps)`                                   | Replace the card's step list explicitly (same shape as `update_plan`, §11.4) for workflows that know their plan upfront.                                                                                                    |
| `ctx.now()`                                         | Journaled timestamp — recorded once, replayed identically.                                                                                                                                                                  |
| `ctx.log(level, message, data?)`                    | Durable journal entry, streamed to the card's log drawer.                                                                                                                                                                   |
| `ctx.progress({fraction?, label?})`                 | Ephemeral WS patch (not journaled).                                                                                                                                                                                         |
| `ctx.input`, `ctx.runId`                            | Introspection.                                                                                                                                                                                                              |

Not in v1 (see §16): `ctx.waitForEvent`/signals, `ctx.continueAsNew`, `ctx.random` (randomness is input),
`ctx.pipeline`.

Session-scoped tools are not callable from workflows: `view_attachment`, `set_session_title`, `start_session`,
`sub_session` (use `ctx.agent`), `run_workflow` (no nested workflows in v1 — children of a workflow are agent runs only;
depth still applies to them).

The model learns this API from the `run_workflow` tool description plus a compact `<workflow_api>` reference appended to
the system prompt when the `workflow` toggle is on (same pattern as the memory-prompt block, `#agentSystemPrompt`).

### 8.4 Journal format

`RunJournalEntry` (CBOR in `run_journal.entry_cbor`; `seq` is a monotone per-run counter in issuance order):

```ts
type RunJournalEntry =
  | {kind: 'call'; seq: number; tool: string; input: unknown; childRunId?: string} // ctx.call / ctx.agent
  | {kind: 'result'; seq: number; status: 'succeeded' | 'failed' | 'canceled'; output?: unknown; error?: RunError}
  | {kind: 'timer'; seq: number; wakeAt: number} // ctx.sleep park
  | {kind: 'fired'; seq: number} // ctx.sleep completion
  | {kind: 'now'; seq: number; value: number}
  | {kind: 'step'; seq: number; stepId: string; label: string; phase: 'start' | 'end'; ok?: boolean}
  | {kind: 'log'; seq: number; level: 'debug' | 'info' | 'warn' | 'error'; message: string; data?: unknown}
```

`call` and its `result` share the same `seq` (the call's); `ctx.parallel` journals `call` entries in deterministic
issuance order, and results are keyed by seq so nondeterministic completion order never leaks into the program.

### 8.5 Determinism and replay

The engine guarantees: **a workflow function, replayed against its journal, takes the identical path and issues the
identical calls.**

- On first execution, each effectful `ctx` member journals before/after itself as above.
- On replay (crash resume, timer wake after VM eviction): the script runs from the top; a `ctx.call` at seq N whose
  journaled `result` exists returns it immediately (microtask, no I/O); a journaled `call` without a `result` whose
  `childRunId` is still live re-parks; the first call with no journal entry executes live.
- **Divergence detection**: if the replayed call at seq N has a different `tool` or input hash than the journal, the run
  fails `nondeterministic-replay` with a diff diagnostic. The journal records `source_cid`; resuming under a different
  CID (edited source) fails the same way — re-running new code is an explicit new run.
- **VM residency**: while a run is live, its VM stays resident across short waits (children completing, sleeps ≤ 60 s) —
  replay is then only a crash-path. Long sleeps and service pressure evict the VM; wake replays. This keeps v1 simple
  (no snapshotting — replay-from-top is the only resume mechanism) while avoiding replay-per-child on wide fan-outs.
- **Caps**: journal hard cap 5,000 entries / 8 MiB total (`journal-cap` failure naming the limit); per-entry values
  bounded by the tool-result cap.

## 9. Tool execution seam refactor

Today, tool implementations only exist as Pi `ToolDefinition`s (`createAgentServicePiTools`, `api-service.ts:3768`).
Workflows need to execute the same tools without a Pi session. Refactor, no behavior change:

- Extract per-tool executors into `agents/src/tool-executors.ts`:
  `toolExecutors: Record<string, (toolCtx: AgentServicePiToolContext, input: unknown) => Promise<unknown>>`, with
  `createAgentServicePiTools` reduced to wrapping each executor in `defineSeedPiTool` (schema validation, progress
  hooks, size caps stay put).
- The workflow host calls the same executors with a `toolCtx` built for the run (accountId, agentId, definition, memory
  state dir, hmServerUrl, web config, code-exec handle, `onToolProgress` → `appendPartial` on the run key).
- Availability = exactly the `#runPiAgent` allow-list logic (`normalizeSeedToolName`, code-exec availability probe),
  factored into a shared `enabledToolNames(definition, codeExecAvailable)` helper so chat and workflow can never drift.

## 10. Protocol additions

All additive, in `agents/protocol/src/index.ts` (+ desktop client passthrough in
`frontend/apps/desktop/src/agents-client.ts`).

### Types

```ts
export type RunStatus = 'queued' | 'claimed' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled'

export type RunInfo = {
  id: string
  account: string
  rootRunId: string
  parentRunId?: string
  depth: number
  kind: 'agent' | 'workflow'
  agentId?: string
  sessionId?: string // agent runs: the child transcript to link to
  origin: 'user' | 'trigger' | 'agent' | 'workflow' | 'system'
  title?: string
  status: RunStatus
  wait?: {reason: 'children' | 'timer'; wakeAt?: number; pendingChildren?: number}
  plan?: RunPlan
  error?: {code: string; message: string}
  usage?: AgentRunUsage & {childrenTokens?: number}
  createdAt: number
  startedAt?: number
  finishedAt?: number
  updatedAt: number
}

export type RunPlan = {
  title?: string
  steps: Array<{id: string; label: string; status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'}>
}
```

`SessionInfo` gains `parentSessionId?`, `runId?`, `plan?: RunPlan`, `childSessionCount?: number`.

### Actions

- `GetRun {runId}` → `RunInfoResponse`
- `ListRuns {rootRunId? | sessionId? | agentId?; status?; limit?}` → `{runs: RunInfo[]}` — `sessionId` returns runs
  rooted at that session, newest first (the pinned card asks for the latest root and then the tree by `rootRunId`).
- `CancelRun {runId}` → `{canceled: boolean}` (cascades, §5).
- `GetRunJournal {runId; afterSeq?}` → `{entries: RunJournalEntryInfo[]}` (log drawer + debugging; the inspector UI at
  `/agents` gets a run tree view reading the same data).
- `ListSessions` gains `parentSessionId?: string` (list one parent's children) and `includeChildren?: boolean` (default
  false: top-level lists exclude rows with a parent).

### WebSocket

New subscription key `runs/<rootRunId>` (same signed subscribe handshake), streaming the whole tree:

```ts
| {_: 'change'; key: `runs/${string}`; run: RunInfo}                       // any run in the tree changed
| {_: 'append'; key: `runs/${string}`; runId: string; seq: number; entry: RunJournalEntry; createdAt: number}
| {_: 'appendPartial'; key: `runs/${string}`; runId: string;
   patch: {progress?: {fraction?: number; label?: string}; activity?: AgentRunActivity; usage?: AgentRunUsage}}
```

`append` replays from a client-supplied `afterSeq` per run on reconnect, exactly like session events. Descendant
agent-run activity (the existing `AgentRunActivity` phase/tool/output-tail partials) is forwarded onto the run key
tagged with the originating `runId` — `#runPiAgent`'s existing subscribe handler gains a second fan-out target when the
session belongs to a run tree. Session events appended by an agent run also gain a `runId` field inside `event_cbor`
(additive; old clients ignore it).

## 11. Desktop UX

### 11.1 Pinned workflow status card

Placement: `frontend/apps/desktop/src/pages/agents/session.tsx` — a new `<SessionRunCard/>` rendered between the
scrollable message list and `AgentRichMessageComposer` (`:481`), sticky, full composer width. Component lives in a new
`frontend/apps/desktop/src/pages/agents/run-card.tsx`; the assistant sidebar (`assistant-panel.tsx`) renders the same
component in compact mode.

**Data source is durable-first**: `ListRuns {sessionId}` picks the latest root run; subscribe `runs/<rootRunId>` for
liveness. A page refresh or a desktop relaunch mid-workflow reconstructs the card fully from `runs` + `run_journal`;
partials only animate it.

States:

- **Active** (root non-terminal): header row = title, status pill, elapsed timer, cancel button (`CancelRun` on the
  root, with confirm). Body = progress bar (`ctx.progress` fraction/label when present), the **step list** from
  `plan_cbor` (rows: `○ pending` / `◐ running` + live activity label / `✓ done` / `✕ failed` / `– skipped`), and the
  **children strip**: one row per child run — status dot, title, kind icon, live tool/phase tail for running agent
  children — clicking an agent child navigates to its session (`sessionId` on `RunInfo`). Footer = rolled-up token/cost
  usage. A collapsible log drawer streams `ctx.log` entries (`GetRunJournal` + `append`).
- **Parked parent** (session's own run `waiting` on children): banner form — "Waiting on 3 sub-sessions — 1 done · 12m"
  — same children strip. This is what makes a silent parked chat legible; the composer above it is disabled with
  matching copy.
- **Terminal**: collapses to a chip — "✓ Workflow finished · 6 steps · 4 sub-sessions · 128k tok" or "✕ Failed:
  {error.message}" — expandable to the full card; replaced when a newer root run starts; dismissible.
- **Todo mode** (no run, `SessionInfo.plan` present): step list only. One component, two feeders.

### 11.2 Sessions list nesting

Applies to the agent-detail Sessions tab and the assistant sidebar session list (`SessionListItem`,
`assistant-panel.tsx:67`):

- Top-level queries pass `includeChildren: false`. A parent row with `childSessionCount > 0` renders a disclosure ("▸ 4
  sub-sessions", with a summarized status dot: red if any failed, pulsing if any running) that lazily loads
  `ListSessions {parentSessionId}` and renders children indented with a tree line, status dot, and title. Live status
  arrives through the existing account-change/session-change WS events — no new plumbing.
- Orphan safety: deleting a parent session promotes children to top level (`parent_session_id` set NULL by the delete
  path).

### 11.3 Child session page

- Breadcrumb chip in the session header: "⤴ {parent session title}" navigating to the parent (uses `parentSessionId`).
- A slim run banner: status, origin ("Started by workflow: {title}"), and its typed result once terminal.
- While the child's run is live, the composer is **disabled** ("This sub-session is being driven by its parent — watch,
  or open the parent to intervene"); once terminal it becomes a normal session the user can continue.

### 11.4 Todo lists: `update_plan` (always-available, hidden like `set_session_title`)

```ts
type UpdatePlanInput = {
  title?: string
  steps: Array<{id: string; label: string; status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'}>
}
```

Writes `sessions.plan_cbor`, emits a session-change event, renders no chat bubble. The system prompt (all agents) gains:
maintain a plan via `update_plan` for any task with 3+ distinct steps, updating statuses as you go. Workflow
`ctx.step`/`ctx.plan` write the same shape to `runs.plan_cbor`; the card prefers the run plan when a run is active.

### 11.5 Chat bubbles

Registry entries for `sub_session` and `run_workflow` with `render.kind: 'generic'`-derived custom metadata: compact
bubble (title, live status pill, link to child session / expand card), the pending state showing the running child's
phase. Result bubbles show the typed output (JSON, collapsed) or error. The heavyweight progress display lives in the
pinned card, not the bubble — bubbles stay small because a fan-out of 12 would otherwise flood the transcript.

### 11.6 New hooks (`frontend/apps/desktop/src/models/agents.ts`)

`useSessionRuns(serverUrl, account, sessionId)` (latest root + tree, query + invalidation),
`useRunTreeSubscription(serverUrl, account, rootRunId)` (extends the existing signed WS hook with the new key,
maintaining a normalized run-map + journal buffers), `useCancelRun`,
`useChildSessions(serverUrl, account, parentSessionId)`.

## 12. Configuration

New keys in `agents/src/config.ts` (env-overridable, defaults shown):

| key                                     | default | meaning                                      |
| --------------------------------------- | ------- | -------------------------------------------- |
| `SEED_AGENTS_MAX_CONCURRENT_MODEL_RUNS` | 8       | agent runs actually holding provider streams |
| `SEED_AGENTS_INTERACTIVE_RESERVED`      | 2       | of the above, reserved for user turns        |
| `SEED_AGENTS_MAX_CONCURRENT_WORKFLOWS`  | 32      | resident workflow VMs                        |
| `SEED_AGENTS_MAX_RUN_DEPTH`             | 4       | spawn-chain depth                            |
| `SEED_AGENTS_MAX_CHILDREN_PER_RUN`      | 16      | fan-out per run                              |
| `SEED_AGENTS_WORKFLOW_SOURCE_MAX_BYTES` | 262144  | script size cap                              |
| `SEED_AGENTS_WORKFLOW_MEMORY_MB`        | 64      | QuickJS WASM memory cap                      |
| `SEED_AGENTS_WORKFLOW_FUEL_MS`          | 2000    | pure-compute interrupt between awaits        |
| `SEED_AGENTS_JOURNAL_MAX_ENTRIES`       | 5000    | per-run journal cap                          |
| `SEED_AGENTS_JOURNAL_MAX_BYTES`         | 8388608 | per-run journal byte cap                     |
| `SEED_AGENTS_RUN_DEFAULT_MAX_WALL_MS`   | 0 (off) | default wall-clock budget for roots          |

Health response advertises `workflows: true` so the desktop Tools tab can grey the toggles on old servers (same pattern
as `webTools`/`codeExec`).

## 13. Security

- **Workflow JS is untrusted input** (account- or agent-authored). Defense in depth: zero-ambient-authority realm
  (determinism enforcement doubles as authority denial — no `fetch`, no `import`), WASM memory isolation from the Bun
  process, fuel-based CPU interrupts, and the rule that every effect goes through `ctx.call` where it is (a) checked
  against the agent's enabled tool set, (b) schema-validated, (c) size-capped, (d) journaled. The journal is the flight
  recorder: every external effect of a script is enumerable after the fact.
- **No new authority**: a workflow can do exactly what its agent could do tool-by-tool in chat; signing identities and
  server bindings are the agent's own. The dangerous new dimension is _scale_, bounded by depth (4), fan-out (16/run),
  concurrency caps, wall-clock budgets, and `CancelRun` cascade as the kill switch.
- **Prompt injection across the tree**: sub-session outputs re-enter parents as data (schema-validated when typed) in
  tool results, never as trusted instructions; a poisoned child can corrupt only its own return value. Workflow JS
  itself is deterministic code and cannot be injected at run time.
- **Cost**: v1 has no dollar budgets (no cost tables yet). Accepted gap, mitigated by the caps above + visible live
  usage in the card; cost budgets are a v2 item and the `budget_cbor` shape already reserves room.

## 14. Implementation phases

Each phase lands green (`cd agents && bun check && bun test`, `pnpm typecheck`, docs updated per the routing table in
`agents/docs/readme.md`) with the desktop fully working, **and passes its live-model gate from §15.3** — real-model
validation is part of each phase's definition of done, not a follow-up. Sizes are rough implementation effort.

### Phase 1 — Runs under the hood (service only; M)

Schema migration (runs, run_journal, session columns); `agents/src/run-queue.ts` dispatch loop; `MessageSession` →
enqueue + synchronous claim; `#runPiAgent` wrapped as the agent-run executor (park-sentinel plumbing included but
unused); startup sweep + dangling-tool-call synthesis; derived `sessions.status` via `#syncSessionStatusFromRuns`; usage
flush to `usage_cbor` at tool boundaries; trigger enqueue + `awaitQueueIdle`; `start_session` moved onto the queue with
durable lineage. **Accept:** kill -9 mid-stream → restart → session recovers to a well-formed state, no permanent
`streaming`; all existing tests pass with `drainTriggerSessions` swapped; usage visible in run rows.

### Phase 2 — Sub-sessions + protocol + list UX (M–L)

`sub_session` tool + `return_result`; park/resume finalizers; depth/fan-out from the tree; `GetRun`/`ListRuns`/
`CancelRun`/`GetRunJournal`; `runs/<root>` WS key + fan-out; `SessionInfo`/`ListSessions` extensions. Desktop:
lineage-aware session lists (11.2), child page breadcrumb/banner/composer-lock (11.3), compact bubbles (11.5), hooks
(11.6). **Accept:** chat agent fans out 3 parallel sub-sessions, parks, resumes with 3 typed results — across a service
restart mid-children; cancel cascades; children render nested in both lists.

### Phase 3 — Workflow engine (L)

Tool-executor seam refactor (§9); `quickjs-emscripten` dep; `workflow-host.ts` + `workflow-executor.ts`; `ctx` v1
surface; journal + replay + divergence detection; lint; caps; `run_workflow` tool + system-prompt API reference; VM
residency/eviction; health capability flag. **Accept:** fault-injection suite — a workflow killed at every await
boundary resumes to a byte-identical output with each tool executed exactly once; `ctx.sleep(hours)` survives restart;
edited-source resume fails `nondeterministic-replay`; lint rejects `Date.now()` with a pointer to `ctx.now()`.

### Phase 4 — Progress UX (M)

`run-card.tsx` with all four states (11.1); `update_plan` + `ctx.step`/`ctx.plan` feeding `plan_cbor`; children strip;
log drawer; cancel button; assistant-sidebar compact mode; `/agents` inspector run-tree view. **Accept:** the
competitor-research story (§1) is demo-able end to end; killing the desktop mid-run and reopening reconstructs the card
exactly from durable state.

### Phase 5 — Polish + hardening (S–M)

Backoff/retry tuning under real providers; queue-pressure behavior on wide fan-outs; journal-size telemetry;
`troubleshooting.md`/`operations.md`/`tools.md`/`persistence.md`/`websocket-subscriptions.md`/`desktop-ui.md` doc
updates consolidated; prompt-tuning pass on tool descriptions from real agent transcripts.

## 15. Testing plan

Three tiers. Tiers 1–2 are deterministic and run in CI (`bun test`); Tier 3 spends real tokens against a real model and
is the mechanism by which the implementing agent **verifies its own prompt and tool designs end to end** — it is a
required gate per phase, run manually, never part of `bun test`.

### 15.1 Tier 1 — unit/integration, mocked model (CI)

Service (`agents/src/*.test.ts`, extending the real-service-against-temp-SQLite harness):

- **Queue**: fake clock; claim atomicity under concurrent enqueue; per-queue ceilings; interactive reservation;
  one-live-run-per-session; backoff schedule; retryable-vs-terminal classification; exactly-once enqueue under duplicate
  trigger firings (extends `activity-trigger-race.test.ts`).
- **Crash recovery**: hard-kill between `tool_call` and `tool_result` → synthesized interrupted result, well-formed
  provider replay (no dangling tool use); kill mid-stream → sweep requeues; kill while `waiting` → untouched.
- **Park/resume**: single and multi-call fan-out; resume ordering with staggered child completion; restart while parked;
  child cancel → parent receives `{status:'canceled'}`; 409 on messaging a waiting session.
- **Typed results**: mock Pi session returning invalid-then-valid `return_result`; bounded-retry-then-`output-schema`;
  no-schema text fallback.
- **Workflow determinism** (pure, no model): scripted tool host; parameterized fault injection killing the VM at every
  await; positional stability of `ctx.parallel` under randomized completion order; divergence detection on mutated
  source and mutated journal; journal/fuel/memory caps; lint token matrix.
- **Lineage**: depth/fan-out limits from the tree across restarts (the in-memory-map regression the old backstops
  allowed); orphan promotion on parent delete.
- **WS**: reconnect mid-run with `afterSeq` → journal replay, no cross-tree partial leakage; snapshot the full event
  stream for a canonical two-level workflow (golden file).

### 15.2 Tier 2 — desktop (CI)

Hook tests for the run-map reducer (change/append/appendPartial interleavings, reconnect); card state matrix render
tests (active/parked/terminal/todo); session-list nesting with lazy child loading.

### 15.3 Tier 3 — live-model validation harness (the self-verification loop)

Precedent: `agents/e2e-reasoning.ts` already drives the real `Service` (in-memory SQLite, temp data dir, signed
envelopes) against the real OpenAI API as a manual script. This grows into a scenario harness:

- **Layout**: `agents/e2e/run.ts <scenario…|all>` + one module per scenario under `agents/e2e/scenarios/`. Each scenario
  boots a fresh real `Service`, registers an OpenAI provider, and asserts on **durable state** — run rows, journal
  entries, session events, tool_call/result pairing — never on eyeballed prose. Exit non-zero on failure; print a
  PASS/FAIL table plus per-scenario token spend.
- **Credentials**: `OPENAI_API_KEY` loaded from the repo-root `.keys` file (or env override). Key never logged, never
  committed. Default model **`gpt-5-mini`** (cheap); `--model` flag for spot-checks on stronger models before release.
  Full battery target cost: well under $1 per run.
- **Transcript artifacts**: every scenario dumps its full session transcripts + journals to a timestamped directory so
  failed prompt designs can be diagnosed and tool descriptions iterated from real model behavior.
- **Repeatability**: behavioral scenarios run `--n 5` repetitions where the assertion is about model _choice_ (tool
  adoption rates), with explicit pass thresholds below — one lucky run is not a pass.

Scenarios, grouped by the phase they gate:

**Phase 1 gate — queue does not regress chat.** `chat-smoke`: plain conversation + one `read` tool round-trip through
the new enqueue+claim path; assert identical durable event shapes to today and first-token latency within noise of the
pre-queue baseline.

**Phase 2 gate — sub-session tool design works with a real model.**

- `sub-basic`: "delegate summarizing X to a sub-session, then compare with your own view." Assert: exactly one
  `sub_session` call with well-formed input; parent parks (`waiting`/`children` observed in run rows mid-flight); child
  completes; parent resumes and its final text references the child's output.
- `sub-typed`: spawn with `output: {answer: string, confidence: number}` schema. Assert child ends via valid
  `return_result`; record schema-retry count (>1 average retry across reps → fix the `return_result` prompt framing).
- `sub-fanout`: task naturally needing 3 parallel workers. Assert ≥2 `sub_session` calls before parking (one park on the
  set), all resolve, synthesis mentions all children. Measures whether the tool description elicits parallel fan-out at
  all.
- `sub-failure`: child given an impossible task + tight `maxWallMs`. Assert parent receives `{status:'failed'}` and
  degrades gracefully in prose instead of hallucinating a result.
- `sub-restraint` (over-use guard): 5 trivial prompts ("what is 2+2") with the tool enabled. Pass: 0/5 spurious spawns;
  failures drive the "do not use this for work you can simply do yourself" description wording.

**Phase 3 gate — real models can author correct workflow scripts.** This is the highest-risk prompt surface; the
`<workflow_api>` reference and `run_workflow` description are iterated against these numbers.

- `wf-hello`: "use a workflow to read these two docs and produce a combined summary." Assert model-authored source
  passes lint first try, run succeeds, journal well-formed (call/result pairing, seqs monotone).
- `wf-battery`: 10 task prompts of graded complexity (sequential pipeline, conditional branch, retry loop, fan-out +
  aggregate, sleep-and-recheck). Pass thresholds on `gpt-5-mini`, n=3 each: **≥80% first-try lint pass, ≥70% end-to-end
  run success**; every failure class gets a transcript autopsy and either a prompt fix or a lint/error- message fix (the
  error text is itself a prompt — assert the model repairs its script on the retry after seeing it).
- `wf-parallel`: task requiring concurrent children. Assert generated script uses `ctx.parallel` (not a serial loop) and
  consumes results positionally.
- `wf-crash-live`: start a model-authored workflow, SIGKILL the service between two journaled calls, restart, assert
  resume completes with every tool executed exactly once and the final output consistent — the full determinism story
  exercised on real model output, not a fixture.
- `wf-error-handling`: one `ctx.call` deterministically fails mid-plan. Assert the script (per prompt guidance) either
  catches and degrades or fails with a clean `tool-error` — and that the parent chat turn then explains the failure
  accurately from the `RunWorkflowResult`.

**Phase 4 gate — progress surfaces actually get fed.**

- `todo-adoption`: 5 multi-step chat tasks. Pass: ≥4/5 runs call `update_plan` before starting work AND issue ≥1 status
  update mid-task; below threshold → iterate the system-prompt wording, re-run.
- `plan-steps`: model-authored workflow for a 3-stage task. Assert `ctx.step`/`ctx.plan` used and `plan_cbor` snapshots
  advance (pending → running → done) as observed over the `runs/<root>` subscription — i.e. the pinned card would have
  moved.
- `card-reconstruction`: mid-`wf-battery` run, drop the WS connection and re-fetch cold via `ListRuns`/`GetRunJournal`;
  assert the reconstructed card model equals the streamed one (the durable-first claim in §11.1, proven live).

**Release sweep** (before each release while the feature is hot): full battery on `gpt-5-mini`, plus `wf-hello`,
`sub-typed`, and `todo-adoption` on one Anthropic and one Google model via their configured providers, since tool-call
formatting differs per provider family.

## 16. Deferred (v2 and beyond)

In rough priority order, all additive on top of the v1 formats:

1. **External events**: `ctx.waitForEvent(name)` + a signed `SignalRun` action → human-approval steps ("draft, wait for
   my approval, then publish") and webhook-style waits. The `wait_cbor` shape already reserves the slot.
2. **`ctx.continueAsNew`** for long-lived periodic workflows (journal cap is the v1 stopgap).
3. **Trigger targets**: let a trigger fire a workflow directly (schedule → zero-model poll loops; mention → judge panel
   before replying) instead of only prompting an agent session.
4. **Named workflows**: save/publish reusable workflows with declared input/output schemas; agents invoke by name;
   sharing via hypermedia publishing.
5. **Cost budgets**: per-model pricing tables → `maxCostUsd` budgets enforced at tool boundaries, per-trigger daily
   ceilings with auto-pause.
6. **Cross-agent/`agentId` restrictions relaxed**, verification-pattern library (judge panels, adversarial review) as
   stock workflow snippets in the prompt docs.
7. **Multi-worker dispatch** (lease heartbeat is columned but dormant), `run_blobs` journal dedup, parked-VM LRU tuning.

## 17. Open questions

1. **Auto-continue on completion**: when a parked parent resumes, the model takes a turn to act on results — always? Or
   should `sub_session` accept `notify: 'silent'` where results just land in the transcript without a model turn?
   (Default plan: always continue; the turn is what makes the results actionable.)
2. **Child composer lock**: v1 locks live children read-only (intervene via parent or cancel). Is user interjection into
   a running child worth designing sooner?
3. **`ctx.agent` model override**: should workflow-spawned children be able to pick a different model (cheap models for
   fan-out workers)? Leaning yes — `spec.model` validated against the account's configured providers; small addition,
   large cost win.
4. **Journal entry for `ctx.progress`**: strictly ephemeral (plan) vs journaling the last progress value so the card
   shows it after restart. Leaning: persist latest onto `runs.plan_cbor` opportunistically, keep the stream ephemeral.
5. **`run_workflow` from triggers** before v2 trigger-targets: a trigger prompt can already tell the agent to write a
   workflow; is that good enough for the interim?

## Implementation divergences (as built, 2026-08-03)

The feature landed on `feat/agent-workflows` across ten commits (phases 1–4, desktop UX, an adversarial review pass, and
two live-feedback fix rounds). Where the implementation deliberately differs from the sections above, the code is the
source of truth:

1. **Journal row seq, call correlation, and content-keyed matching** (§8.4/§8.5): `run_journal`'s primary key is
   `(run_id, seq)`, so a call and its result cannot share a `seq`. Entries carry their own storage `seq` plus a
   `callSeq` correlating the entries of one ctx call, and a `key` — the effect's deterministic content key. Replay
   matches by key with FIFO per-key consumption, **not** by order: continuation ordering after `ctx.parallel` follows
   real completion timing, so the plan's order-based matching failed genuinely deterministic workflows on resume
   (empirically reproduced during adversarial review). Consequences: `nondeterministic-replay` does not exist as a
   failure mode — a journal miss executes live (the source is pinned per run via `source_cid`/`source_text`, so edited
   code cannot cause it) and unconsumed groups log a warning; and identical-key effects (two bare `ctx.now()` calls in
   parallel branches) may swap recorded values across a resume — never re-executing, but not byte-pinned per branch.
2. **Workflows do not park on children** (§8.2/§6): a workflow awaiting `ctx.agent` children holds its VM resident and
   awaits their terminal status in-process; only long timers (`ctx.sleep` ≥ 60s) park. To make resident-await safe,
   workflow runs execute in their own concurrency pool (32) separate from the 8 agent-run provider slots, so an awaiting
   workflow can never starve its children. Crash recovery still works: the boot sweep requeues the workflow and journal
   replay reconnects to still-live children by `childRunId`.
3. **Canceled runs mirror to session status `idle`**, not `stopped` (§4): preserves the exact pre-runs StopSession
   behavior old clients and tests expect.
4. **Trigger runs keep `maxAttempts: 1`** (§6): the retry/backoff machinery is implemented and unit-tested, but enabling
   multi-attempt trigger runs is deferred — `awaitQueueIdle()` (used by tests and shutdown) cannot span real backoff
   windows, and the plan's retry cadence needs a test-clock story first.
5. **`ctx.now()` and `ctx.log()` are async** (§8.3): all journaled ctx members return promises; scripts must `await`
   them.
6. **Depth 3 / fan-out 10** (§7.2): the limits reuse the pre-existing `start_session` constants
   (`MAX_SESSION_SPAWN_DEPTH`, `MAX_SESSION_SPAWNS_PER_SESSION`) rather than the plan's 4/16, now enforced from the
   durable run tree.
7. **Parking mechanism** (§7.4): Pi tool executors cannot throw a sentinel out of the loop (throws become tool errors),
   so the turn ends by _refusing the next provider request_: the spawn executors register park intents and `onPayload`
   throws before the batch-following request is sent; the executor treats that as the designed ending. Suppression of
   the durable tool_result for parked calls happens in the `tool_execution_end` handler.
8. **`update_plan` is always available** (§11.4) rather than an opt-in toggle — it is hidden, session-scoped, and
   harmless, exactly like `set_session_title`.
9. **Tier-3 harness status** (§15.3): `agents/e2e/run.ts` implements the chat-smoke, sub-basic, sub-typed,
   sub-restraint, wf-hello, and todo-adoption scenarios. It verified end-to-end against the live OpenAI endpoint, but
   the pass/fail gates could not be run to green because the OpenAI account has no API credits; the remaining battery
   scenarios (wf-battery, wf-crash-live, card-reconstruction, release sweep) are still to be written. In lieu, **blind
   simulated-model gates** ran (a fresh LLM given only the registry descriptions; see `operations.md`): delegation
   choice matched design intent across parallel-fan-out/detached/trivial scenarios, and an authored ~100-line workflow
   lint-passed and executed correctly first try in the real engine; the simulators' uncertainty lists drove the
   contract-tight ctx documentation and bare-string `ctx.plan` support.
10. **Delegation is always available** (§7.1/§8.1): `sub_session` and `run_workflow` are not Tools-tab toggles — they
    are always-on in run-backed sessions like `start_session` (`userConfigurable: false`). Live testing showed why:
    agents saved before this branch have explicit `tools` arrays without them, and real models fell back to
    fire-and-forget `start_session` for delegation, which never resumes the parent.
11. **`start_session` joins the run tree** (§7.2): its children stay detached from the caller's _turn_ (no park, no
    result) but are children in the caller's run _tree_ — visible in the progress card, cancel-cascaded, usage rolled up
    — and its description routes delegation-with-results to `sub_session`.
12. **`ListSessions` children are included by default** (§10): the plan's exclude-by-default hid agent-started sessions
    from older deployed clients that cannot send the field. Exclusion now requires explicit `includeChildren: false`;
    the current desktop sends it and additionally filters client-side.
13. **The activity drawer shipped** (§11.1 mentioned a log drawer; the E-list cut it): the run card gained a collapsed
    journal tail (log/step/call lines + failed results) across active, parked, and expanded-terminal states.
