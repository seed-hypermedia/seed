# The Harness — implementation plan

Status: **in progress** (started 2026-08-11). Architecture source: the "Three nouns, five verbs" deck (claude.ai
artifact `7ec78c32`), superseding the five-collapses deck; grounded in workflows v1 as built on `feat/agent-workflows`
(PR #920) and `agents/docs/research/` (branch `agents-planning`).

Breaking changes are **allowed and preferred** over aliases or dual paths. What must not regress is the v1 spine: the
runs queue (leases, boot sweep, park/resume, persisted usage), the QuickJS journaled script engine with content-keyed
replay, verbatim-markdown briefings, and the one-card UX law (steer from one place, interrogate one click deep, never
lose work).

## Architecture in one paragraph

Three nouns: the **Space** (one document tree per agent account — `~/tools`, `~/memory`, `~/plans`, `~/triggers`,
`agent.md`; every tool is a document with a summary line, an Onyx contract, a description, and source or a builtin
binding), the **Log** (per-thread append-only events, each stamped with an `actor`), and the **Runs** (the v1
tree-queue, kept verbatim). Five verbs — `read`, `write`, `call`, `delegate`, `plan` — replace the 25-tool registry;
everything else is a document under `~/tools/`, collapsed to its summary until touched. The user holds the same five
verbs through the same log (symmetry). Two engines: QuickJS scripts orchestrate (journaled), microVM lambdas compute (TS
first-class, Python kept). Long-running work is parked runs plus wake sources; triggers are documents that bind event
sources to continuations and serve as the event bus.

## Branch & review protocol ("checkmark branches")

Base: `feat/agent-workflows` (rebased onto main 2026-08-11). Milestones land as a stacked series:

```
feat/agent-workflows          ← base (PR #920)
  └─ harness/01-verbs
       └─ harness/02-tools-as-docs
            └─ harness/03-symmetric-log
                 └─ harness/04-exec
                      └─ harness/05-time
                           └─ harness/06-event-bus
```

Per-milestone protocol, in order:

1. **Build** on the milestone branch; commits stay small and story-shaped.
2. **Gate** (self-verification, all must pass before anything is pushed):
   - `bun x tsc --noEmit` in `agents/` (and desktop typecheck when frontend is touched)
   - `bun test` in `agents/` — full suite, no skips added
   - desktop `vitest` for touched UI packages
   - the **prompt-budget test** (M2+): system-prompt bytes for a default agent stay under target
   - the **simulated-model gate**: a blind subagent, given only the live tool schemas, completes a scripted task
     (delegation fan-out, tool discovery, plan maintenance). This replaces the gpt-5-mini cassettes wherever the tool
     surface changed, because cassette fingerprints include tool names; re-recording live gates is deferred until
     credits exist and is tracked in the review doc.
3. **Self-review**: an adversarial review pass over the milestone diff (correctness, crash/replay safety,
   prompt-injection surface, UX-contract regressions against the settled v1 decisions). Findings fixed or explicitly
   recorded as accepted gaps.
4. **Checkmark**: push the branch, write `agents/docs/harness/reviews/NN-<name>.md` containing: what changed and why,
   how it was verified (gate output summaries), known gaps, and a **manual test script for Eric** — concrete desktop
   steps with expected outcomes.
5. **Prompt Eric** to review the checkmark. Work continues onto the next milestone without blocking; his feedback is
   folded in as fixup commits on the open milestone and propagated up the stack with rebases.

## Milestones

### M1 — The five verbs (`harness/01-verbs`)

The registry monolith (`agents/protocol/src/tool-registry.ts`, ~1,400 lines, 25 tools) is replaced by five verb
definitions plus internal address dispatch. No aliases: the old tool names stop existing; stored transcripts keep their
historical events (rendered generically) and replay fine — provider messages carry names verbatim and never re-dispatch
old calls.

- **`read {address, …opts}`** — one dispatcher keyed by address shape:
  - `~/memory/**` → agent-memory read/list (dir address ⇒ listing with summary lines)
  - `~/tools/**` → tool contract (M1: from the builtin table; M2: from documents)
  - `hm://…` → existing hypermedia read path; `ipfs://…` → ipfs read
  - `https://…` → web read; `activity:` (or `~/activity`) → activity feed with existing filters
  - `~/threads/<id>` → transcript; `run:<id>` → run journal
- **`write {address, content, …opts}`** — memory writes/deletes, plan documents, `hm://` document operations (absorbing
  the 22-command `write` envelope into address+content+intent), `ipfs://`, attachment moves (an attachment is just a
  readable source address).
- **`call {tool, input}`** — dispatch by `tools/…` path over one seam (`registerBuiltin`), which M1 introduces
  internally: search, web_search, navigate, execute land here as bound builtins. Calling an unexpanded tool returns its
  contract as the result (touch-expands); the retry runs.
- **`delegate {brief, script?, output?, await?, title?, step?}`** — merges `sub_session` (default), `run_workflow`
  (`script` present ⇒ script child), `start_session` (`await: false` ⇒ detached but still in the run tree).
  Verbatim-markdown briefs, typed output with bounded retries, plan-step attachment — all preserved from v1.
- **`plan {steps | update}`** — absorbs `update_plan`; `set_session_title` is deleted (titling is already automatic and
  agent-authored).

Files: `protocol/src/tool-registry.ts` (rewrite), `protocol/src/index.ts` (event/type updates), `api-service.ts`
(`createAgentServicePiTools` region, the three name-filter chains, delegation paths), shared UI tool renderers
(`@shm/ui/agents`), desktop run-card step labels, affected tests across `agents/src/*.test.ts` and desktop.

Success is measurable: default-agent system prompt shrinks by roughly the difference between 25 schemas and 5; model
tool-choice in the simulated gate has no wrong-tool retries.

### M2 — Tools as documents (`harness/02-tools-as-docs`)

- Tool documents in the Space: frontmatter-style metadata (name, summary, tags, grants required), Onyx input/output
  contracts, model-facing description, and source (lambda) or builtin binding id. Storage rides the agent-memory tree
  (`~/tools/**`) so read/write/versioning come free; each save produces a CID (content-address the canonical CBOR
  encoding).
- Boot upsert: builtins materialize/refresh their documents at service start; a forked builtin doc keeps the binding id
  but its contract diff is visible.
- **The index**: generated summary of the Space (one line per tool/group, memory dirs with counts, live plans, active
  triggers), injected into every run's system prompt; a CI test asserts the byte budget (~1.5 KB default agent).
- **Touch-expand + pins**: `read` on a tool document (or contract-returning `call`) appends a durable
  `expanded {path, cid}` log event and activates the tool via Pi `setActiveToolsByName`; replay/compaction/park-resume
  reconstruct the active set from pins. Unpin is explicit.
- The five verbs' own docs deepen on first use (full help returned beside the first result).

### M3 — The symmetric log (`harness/03-symmetric-log`)

- `actor: 'user' | 'agent' | 'system' | 'trigger'` on session events (schema migration; existing rows backfill by event
  type).
- Protocol: user-invoked `read`/`write`/`call` against a thread — appended to the log as `actor: user`
  tool_call/tool_result pairs and executed as runs on the interactive queue; the agent sees them in transcript replay on
  its next turn, no side channel.
- Desktop: composer `/` palette over the Space (tools, saved plans, triggers); Onyx-schema-generated forms for tool
  input; results render with the existing card grammar; user edits to plan steps and per-child cancels emit log events
  the agent can read.
- Web parity via the shared `@shm/ui/agents` package where the platform adapters allow.

### M4 — Execution cleanup + TS (`harness/04-exec`)

- `execute {runtime: 'ts' | 'python', code, files?}` — the whole compute surface; option sprawl (image/cpu/memory per
  call) collapses to service config.
- Bun-based TS runner image beside the Python image; one file-framed runner protocol for both; runner-protocol suite
  runs against the injected fake sandbox, real-microVM smoke stays gated.
- Lambda tool documents become callable: `call tools/<lambda>` = validate input (Onyx, outside VM) → `execute` stored
  source → validate output. Author→test→save flows through `write` + `call`.

### M5 — Time (`harness/05-time`)

- `runs.wait` gains `event` and `budget-pause` beside `children`/`timer`.
- `ctx.sleep(until)` persists wake-at; the dispatch loop's timer sweep wakes due runs (days-scale, restart-proof —
  kill/restart tests across sleeps).
- `ctx.waitForEvent(match, {timeout})` registers an **ephemeral trigger** scoped to the run; firing appends the payload
  to the journal and requeues the run; timeout is a timer wait racing it.
- `ctx.continueAsNew(state)` finalizes the run and enqueues a successor carrying declared state only — journal growth
  over week-scale loops stays bounded.
- Card/thread copy for every parked state: "sleeping until 08:00", "waiting for approval", "paused: daily budget", with
  user wake/cancel affordances.

### M6 — The event bus (`harness/06-event-bus`)

- Trigger documents in `~/triggers/**` replace the trigger CRUD protocol surface; monitors read documents.
  `status: draft | active`; activation is the consented step (minimal consent card — the card grammar's question state).
- Sources: the shipped four (schedule, document-comment, user-mention, site-update) plus `document-change` (watch any
  hm:// path or Space dir) and `run-completed` (chain automations). Webhook stays out of scope unless trivial.
- Continuations: `newThread {brief}` (today's behavior), `appendTo {thread}`, `wake {run, signal}` (delivers to a
  waiting `ctx.waitForEvent`), `runPlan {plan}` (saved plan → fresh run).
- Per-trigger budgets with auto-pause; firing history browsable as run records beside the document.

## Test strategy summary

- **Unit/integration**: the existing agents suite is the backbone; every milestone leaves it green and grows it
  (address-dispatch table tests, pin-replay tests, actor-backfill tests, runner protocol, timer-sweep kill/restart,
  trigger-continuation matrix).
- **Determinism**: golden replay tests for the script engine remain untouched proof that journaled semantics survived
  each milestone.
- **Model-facing**: simulated-model gates (blind subagent over the real schemas) per milestone; live gpt-5-mini cassette
  re-record is a single deferred task once credits exist.
- **Manual (Eric)**: each review doc ends with a five-minute desktop script — the checkmark is not done until that
  script passed for me first.
