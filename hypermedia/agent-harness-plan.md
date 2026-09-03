---
name: The Harness — implementation plan
summary: 'Status: M1–M5 built; M6 partially built (started 2026-08-11, status recorded 2026-08-13). Architecture source: the "Three nouns, five verbs" deck (claude.ai…'
---
Status: **M1–M5 built; M6 partially built** (started 2026-08-11, status recorded 2026-08-13). Architecture source: the "Three nouns, five verbs" deck (claude.ai artifact `7ec78c32`), superseding the five-collapses deck; grounded in workflows v1 as built on `feat/agent-workflows` (PR #920) and `agents/docs/research/` (branch `agents-planning`). <!-- id:BphNaGBQ -->

The milestone sections below are the plan **as written**. Where the build went another way, an inline **Built:** note says so; [Status as built](#status-as-built) at the end carries the item-by-item table and the things that landed without ever being planned. Nothing in the plan text has been retrofitted to match the code. <!-- id:t5if7eCl -->

Breaking changes are **allowed and preferred** over aliases or dual paths. What must not regress is the v1 spine: the runs queue (leases, boot sweep, park/resume, persisted usage), the QuickJS journaled script engine with content-keyed replay, verbatim-markdown briefings, and the one-card UX law (steer from one place, interrogate one click deep, never lose work). <!-- id:bSSR1IkI -->

# Architecture in one paragraph <!-- id:OTLbyjSp -->

Three nouns: the **Space** (one document tree per agent account — `~/tools`, `~/memory`, `~/plans`, `~/triggers`, `agent.md`; every tool is a document with a summary line, an Onyx contract, a description, and source or a builtin binding), the **Log** (per-thread append-only events, each stamped with an `actor`), and the **Runs** (the v1 tree-queue, kept verbatim). Five verbs — `read`, `write`, `call`, `delegate`, `plan` — replace the 25-tool registry; everything else is a document under `~/tools/`, collapsed to its summary until touched. The user holds the same five verbs through the same log (symmetry). Two engines: QuickJS scripts orchestrate (journaled), microVM lambdas compute (TS first-class, Python kept). Long-running work is parked runs plus wake sources; triggers are documents that bind event sources to continuations and serve as the event bus. <!-- id:ceLCyUp6 -->

**Built:** the Space is `~/tools` and `~/memory`. `~/plans`, `~/triggers` and `agent.md` were never created — the checklist lives behind the `plan` verb, and triggers are still rows. Contracts are JSON Schema, not Onyx; Onyx is not wired into the harness anywhere. Everything else in this paragraph holds, with the user's symmetry desktop-only. <!-- id:ZNcXa6Z8 -->

# Branch & review protocol ("checkmark branches") <!-- id:-H1uiN0r -->

Base: `feat/agent-workflows` (rebased onto main 2026-08-11). Milestones land as a stacked series: <!-- id:APp37YBS -->

``` <!-- id:tYW3qknb -->
feat/agent-workflows          ← base (PR #920)
  └─ harness/01-verbs
       └─ harness/02-tools-as-docs
            └─ harness/03-symmetric-log
                 └─ harness/04-exec
                      └─ harness/05-time
                           └─ harness/06-event-bus
```

**Built:** the last three branches merged into two. Eric's orchestration-UX feedback package arrived between M3 and M4 and took the `harness/04-orchestration-ux` name (review `04-orchestration-ux.md`); execution, time, answerable parks and the M6 first slice then all landed together on `harness/05-exec` (review `05-exec-time.md`). There is no `harness/06-event-bus` branch. Work continues on `harness/full`, which carries the whole stack. <!-- id:USMNjBUq -->

Per-milestone protocol, in order: <!-- id:t5g7vU9g -->
  1. **Build** on the milestone branch; commits stay small and story-shaped. <!-- id:UUZk1WpA -->
  2. **Gate** (self-verification, all must pass before anything is pushed): <!-- id:SLzBhPjB -->
     - `bun x tsc --noEmit` in `agents/` (and desktop typecheck when frontend is touched) <!-- id:Yb0OsS8B -->
     - `bun test` in `agents/` — full suite, no skips added <!-- id:Wa5YKkjr -->
     - desktop `vitest` for touched UI packages <!-- id:KeEzde8L -->
     - the **prompt-budget test** (M2+): system-prompt bytes for a default agent stay under target <!-- id:kJWAc0BB -->
     - the **simulated-model gate**: a blind subagent, given only the live tool schemas, completes a scripted task (delegation fan-out, tool discovery, plan maintenance). This replaces the gpt-5-mini cassettes wherever the tool surface changed, because cassette fingerprints include tool names; re-recording live gates is deferred until credits exist and is tracked in the review doc. <!-- id:F-zADQiW -->
  3. **Self-review**: an adversarial review pass over the milestone diff (correctness, crash/replay safety, prompt-injection surface, UX-contract regressions against the settled v1 decisions). Findings fixed or explicitly recorded as accepted gaps. <!-- id:gg5DRejD -->
  4. **Checkmark**: push the branch, write `agents/docs/harness/reviews/NN-<name>.md` containing: what changed and why, how it was verified (gate output summaries), known gaps, and a **manual test script for Eric** — concrete desktop steps with expected outcomes. <!-- id:vtiK84I7 -->
  5. **Prompt Eric** to review the checkmark. Work continues onto the next milestone without blocking; his feedback is folded in as fixup commits on the open milestone and propagated up the stack with rebases. <!-- id:I3_8cBdC -->

# Milestones <!-- id:3e-S52zB -->

## M1 — The five verbs (`harness/01-verbs`) <!-- id:ynhxuWOA -->

The registry monolith (`agents/protocol/src/tool-registry.ts`, \~1,400 lines, 25 tools) is replaced by five verb definitions plus internal address dispatch. No aliases: the old tool names stop existing; stored transcripts keep their historical events (rendered generically) and replay fine — provider messages carry names verbatim and never re-dispatch old calls. <!-- id:g4PxNZXs -->
  - **`read {address, …opts}`** — one dispatcher keyed by address shape: <!-- id:QebsEhAP -->
    - `~/memory/**` → agent-memory read/list (dir address ⇒ listing with summary lines) <!-- id:xK23F_Lk -->
    - `~/tools/**` → tool contract (M1: from the builtin table; M2: from documents) <!-- id:GzkS71IL -->
    - `hm://…` → existing hypermedia read path; `ipfs://…` → ipfs read <!-- id:1KAFf4Ox -->
    - `https://…` → web read; `activity:` (or `~/activity`) → activity feed with existing filters <!-- id:AEClwI9n -->
    - `~/threads/<id>` → transcript; `run:<id>` → run journal <!-- id:lHFY9hKp -->
  - **`write {address, content, …opts}`** — memory writes/deletes, plan documents, `hm://` document operations (absorbing the 22-command `write` envelope into address+content+intent), `ipfs://`, attachment moves (an attachment is just a readable source address). <!-- id:iq4QCz9p -->
  - **`call {tool, input}`** — dispatch by `tools/…` path over one seam (`registerBuiltin`), which M1 introduces internally: search, web_search, navigate, execute land here as bound builtins. Calling an unexpanded tool returns its contract as the result (touch-expands); the retry runs._ <!-- id:F0Cq1hvP -->
  - **`delegate {brief, script?, output?, await?, title?, step?}`** — merges `sub_session` (default), `run_workflow` (`script` present ⇒ script child), `start_session` (`await: false` ⇒ detached but still in the run tree). Verbatim-markdown briefs, typed output with bounded retries, plan-step attachment — all preserved from v1. <!-- id:tyHFR0mI -->
  - **`plan {steps | update}`** — absorbs `update_plan`; `set_session_title` is deleted (titling is already automatic and agent-authored). <!-- id:V_i81lro -->

**Built** (deviations only): <!-- id:KZCWfJW0 -->
  - Transcripts and runs are addressed as `thread:<id>` and `run:<id>`, not `~/threads/<id>`; the activity feed is `activity:` with no `~/activity` spelling. `attachment:<id>` joined the read dispatcher, which the plan did not name. <!-- id:Q3rS1PGC -->
  - The `call` seam is `callableToolRegistry` plus `enabledCallableTools()` and one executor switch — there is no `registerBuiltin` registration function. <!-- id:IqqB4Boh -->
  - `write` covers `~/memory/…`, `ipfs://` and `hm://`. Plan documents are not a write address: the checklist lives behind the `plan` verb and `~/plans/` was never created. <!-- id:73Zg_UyD -->

Files: `protocol/src/tool-registry.ts` (rewrite), `protocol/src/index.ts` (event/type updates), `api-service.ts` (`createAgentServicePiTools` region, the three name-filter chains, delegation paths), shared UI tool renderers (`@shm/ui/agents`), desktop run-card step labels, affected tests across `agents/src/*.test.ts` and desktop. <!-- id:lMamqoo5 -->

Success is measurable: default-agent system prompt shrinks by roughly the difference between 25 schemas and 5; model tool-choice in the simulated gate has no wrong-tool retries. <!-- id:rdUC9Zro -->

## M2 — Tools as documents (`harness/02-tools-as-docs`) <!-- id:pykjWq6v -->

<!-- id:Qd9-LqA3 -->
- Tool documents in the Space: frontmatter-style metadata (name, summary, tags, grants required), Onyx input/output contracts, model-facing description, and source (lambda) or builtin binding id. Storage rides the agent-memory tree (`~/tools/**`) so read/write/versioning come free; each save produces a CID (content-address the canonical CBOR encoding). <!-- id:pfxepZrf -->
- Boot upsert: builtins materialize/refresh their documents at service start; a forked builtin doc keeps the binding id but its contract diff is visible. <!-- id:yWQre-7U -->
- **The index**: generated summary of the Space (one line per tool/group, memory dirs with counts, live plans, active triggers), injected into every run's system prompt; a CI test asserts the byte budget (\~1.5 KB default agent). <!-- id:R1y31ncj -->
- **Touch-expand + pins**: `read` on a tool document (or contract-returning `call`) appends a durable `expanded {path, cid}` log event and activates the tool via Pi `setActiveToolsByName`; replay/compaction/park-resume reconstruct the active set from pins. Unpin is explicit. <!-- id:9lbfjX23 -->
- The five verbs' own docs deepen on first use (full help returned beside the first result). <!-- id:kX_Eb5v4 -->

**Built** (deviations only): <!-- id:2EeLOtGc -->
  - Tool documents are rows in a `tool_documents` table addressed as `~/tools/**`, **not** files in the agent-memory tree. Versioning therefore does not come free from memory; each save is a fresh canonical DAG-CBOR encoding with a CIDv1, which is what the plan wanted the CID for. The document carries `{name, kind, summary, description, input, output?, source?, runtime?, binding?}` — no `tags`, and grants are not a document field (the `publish` grant landed on the agent definition instead, from M2's review). <!-- id:rD60gTzD -->
  - Builtins upsert **lazily** — the first listing, index build, or `~/tools/<name>` read materializes them — rather than at service start. Same idempotent refresh-on-CID-drift, one less boot step. <!-- id:5Uq7O04a -->
  - Index budget is **2 KB** (`SPACE_INDEX_BUDGET_BYTES`), and it lists tools, the memory top level, and active triggers. Live plans are not in it. <!-- id:miwP_k9a -->
  - Touch-expand needs **no new event type and no `setActiveToolsByName`**: `expandedCallablesFromEvents` scans the session's own durable `tool_call` events, so the transcript _is_ the pin, and the promoted set is handed to Pi as the session's tool list at construction. Replay, park-resume and restart reconstruct it identically. There is no unpin. <!-- id:x6Z-FYe8 -->
  - The verbs' own docs do not deepen on first use; `read ~/tools/<verb>` returns the full contract on demand instead. <!-- id:mCeCFpse -->

## M3 — The symmetric log (`harness/03-symmetric-log`) <!-- id:w5cedJi0 -->

<!-- id:LrsvYymg -->
- `actor: 'user' | 'agent' | 'system' | 'trigger'` on session events (schema migration; existing rows backfill by event type). <!-- id:z156AeeQ -->
- Protocol: user-invoked `read`/`write`/`call` against a thread — appended to the log as `actor: user` tool_call/tool_result pairs and executed as runs on the interactive queue; the agent sees them in transcript replay on its next turn, no side channel. <!-- id:hbGWd5iQ -->
- Desktop: composer `/` palette over the Space (tools, saved plans, triggers); Onyx-schema-generated forms for tool input; results render with the existing card grammar; user edits to plan steps and per-child cancels emit log events the agent can read. <!-- id:BmoUZYWH -->
- Web parity via the shared `@shm/ui/agents` package where the platform adapters allow. <!-- id:2oNvMAZU -->

**Built** (deviations only): <!-- id:91bMbzvz -->
  - `actor` rides the event payload and legacy events derive theirs from shape through `sessionEventActor()`. There is no schema migration and no row backfill — the answer is computed at read time, which is also what makes it identical after compaction. <!-- id:JpE5YbZu -->
  - User verbs execute inline against the same dispatchers, guarded by an in-memory lock the agent's turn 409s against; they are not enqueued as runs on the interactive queue. <!-- id:X4tFCNnH -->
  - Forms are generated from the tool's **JSON Schema** contract (`src/json-schema.ts`), not from Onyx schemas. Onyx is not wired into the harness anywhere — every contract in M1–M5 is JSON Schema. <!-- id:_FLpyW1z -->
  - The palette is a wrench button beside Send, not a `/` composer palette (the composer is a ProseMirror editor that owns its keystrokes — argued in the review). <!-- id:VDQdqnz_ -->
  - No web parity: the palette and actor-stamped rows are desktop-only; nothing landed in `@shm/ui/agents` or the web app. <!-- id:fHxxtiGe -->

## M4 — Execution cleanup + TS (`harness/04-exec`) <!-- id:4wUbvthB -->

<!-- id:TsiCTkS1 -->
- `execute {runtime: 'ts' | 'python', code, files?}` — the whole compute surface; option sprawl (image/cpu/memory per call) collapses to service config. <!-- id:7zoChx-- -->
- Bun-based TS runner image beside the Python image; one file-framed runner protocol for both; runner-protocol suite runs against the injected fake sandbox, real-microVM smoke stays gated. <!-- id:kmN61lHW -->
- Lambda tool documents become callable: `call tools/<lambda>` = validate input (Onyx, outside VM) → `execute` stored source → validate output. Author→test→save flows through `write` + `call`. <!-- id:ZNhkgzS- -->

**Built** (deviations only): <!-- id:T47pr9pr -->
  - `execute` takes `{runtime: 'ts' | 'python' | 'shell', code, timeout_secs?}` — `shell` was added (each runtime is one argv command: `bun -e`, `python -c`, `sh -c`, so nothing is shell-quoted unless the runtime _is_ the shell), and `files?` was not built: `/workspace` is the agent's memory, so files arrive and leave through `~/memory`. <!-- id:Gh4efNk3 -->
  - There is **no file-framed runner protocol**. A lambda's return value rides a marked stdout line (`__SEED_TOOL_RESULT__<json>`) so unmarked output stays usable as `logs`, and TS source is imported as a `data:text/typescript;base64,…` module rather than written to the sandbox filesystem. Reasons in the M4 review. <!-- id:QMhUv7y7 -->
  - Both edges validate against **JSON Schema**, not Onyx. <!-- id:ig59DAd- -->
  - TypeScript runs in its own image (`SEED_AGENTS_EXEC_TS_IMAGE`, default `oven/bun`) because the main rootfs is a Python image; the contract the model reads lists only the runtimes this server can actually run. <!-- id:6_-kv6Kz -->
  - Beyond the plan: a lambda call requires the same `execute` grant its runtime needs, so authoring a tool is not a way around an owner who turned code execution off. <!-- id:kwGeRwdN -->

## M5 — Time (`harness/05-time`) <!-- id:xAsU9zZW -->

<!-- id:sTBbAjFR -->
- `runs.wait` gains `event` and `budget-pause` beside `children`/`timer`. <!-- id:eqczez1Y -->
- `ctx.sleep(until)` persists wake-at; the dispatch loop's timer sweep wakes due runs (days-scale, restart-proof — kill/restart tests across sleeps). <!-- id:7fwpXvA6 -->
- `ctx.waitForEvent(match, {timeout})` registers an **ephemeral trigger** scoped to the run; firing appends the payload to the journal and requeues the run; timeout is a timer wait racing it. <!-- id:REvYKEsV -->
- `ctx.continueAsNew(state)` finalizes the run and enqueues a successor carrying declared state only — journal growth over week-scale loops stays bounded. <!-- id:Ea02-ntR -->
- Card/thread copy for every parked state: "sleeping until 08:00", "waiting for approval", "paused: daily budget", with user wake/cancel affordances. <!-- id:cphG8Y8w -->

**Built** (deviations only): <!-- id:4X4cnnYg -->
  - `ctx.sleep(ms)` keeps its v1 duration signature; the persisted wake-at is derived (`parkWakeAt`), and parallel sleeps keep the earliest deadline. <!-- id:clWdcsfT -->
  - A `waitForEvent` registration is **not** an ephemeral trigger. It gets its own `run_event_waits` table, because a trigger is user configuration a person lists and edits while a wait is transient run state — the argument is in the M5 review. `SignalRun` is the protocol action that answers one by hand. <!-- id:ZVGdHaR6 -->
  - The wake affordances grew past "wake/cancel" into a package of their own: **Answer**, **Answer with data**, and **Resume** for a budget pause, on both the pinned card and a parked delegate child, with the park advertising the signal name that would actually answer it. <!-- id:vjLC3gJs -->

## M6 — The event bus (`harness/06-event-bus`) <!-- id:ojdtl62L -->

<!-- id:PfO1AggW -->
- Trigger documents in `~/triggers/**` replace the trigger CRUD protocol surface; monitors read documents. `status: draft | active`; activation is the consented step (minimal consent card — the card grammar's question state). <!-- id:x4Fr1zFH -->
- Sources: the shipped four (schedule, document-comment, user-mention, site-update) plus `document-change` (watch any hm:// path or Space dir) and `run-completed` (chain automations). Webhook stays out of scope unless trivial. <!-- id:We4ljgAr -->
- Continuations: `newThread {brief}` (today's behavior), `appendTo {thread}`, `wake {run, signal}` (delivers to a waiting `ctx.waitForEvent`), `runPlan {plan}` (saved plan → fresh run). <!-- id:BJCZLiZZ -->
- Per-trigger budgets with auto-pause; firing history browsable as run records beside the document. <!-- id:p8KwbSN5 -->

**Built: the first slice only — the bus, not the surface.** `run-completed` (with an 8-hop firing-chain loop guard) and the `wake` continuation are live on the _existing_ `agent_triggers` rows, through a nullable `continuation_cbor` column where NULL means `newThread`; `matchesActivityCriteria` is now the one matcher both a parked run and a trigger ask. Not built: trigger documents, `status: draft | active` and the consent step, the migration, the protocol deletion, `document-change`, the `appendTo` and `runPlan` continuations, per-trigger budgets, and firing history as runs (firings still live in `trigger_firings`). The desktop can render a `run-completed` trigger but not create one. The sizing argument and the design for the rest are in [`m6-event-bus-design.md`](./agent-harness-m6-event-bus-design.md). <!-- id:FMtU_F8v -->

# Test strategy summary <!-- id:jnIcrGf4 -->

<!-- id:XQXqcZZA -->
- **Unit/integration**: the existing agents suite is the backbone; every milestone leaves it green and grows it (address-dispatch table tests, pin-replay tests, actor-backfill tests, runner protocol, timer-sweep kill/restart, trigger-continuation matrix). <!-- id:4SzfoGFm -->
- **Determinism**: golden replay tests for the script engine remain untouched proof that journaled semantics survived each milestone. <!-- id:fGs49XOk -->
- **Model-facing**: simulated-model gates (blind subagent over the real schemas) per milestone; live gpt-5-mini cassette re-record is a single deferred task once credits exist. <!-- id:3Obc33oy -->
- **Manual (Eric)**: each review doc ends with a five-minute desktop script — the checkmark is not done until that script passed for me first. <!-- id:7a-ZpUMJ -->

**Built** (deviations only): the suite is at **282 pass / 0 fail** across 25 files. The gpt-5-mini cassettes are still stale — `e2e/recordings/STALE.md` is present, so `bun e2e/run.ts` replay skips loudly with exit 0 and `e2e-replay.test.ts` stays green without claiming coverage. The blind simulated-model gate ran for M1; later milestones were gated by unit, service-level and live headless runs instead. Three e2e harnesses joined the plan's list: `e2e/live-gate.ts`, `e2e/narration-check.ts`, and `e2e/scripted-provider.ts` + `e2e/obligations-live-check.ts` (a scripted provider driving a real server, which is how the obligations loop below was verified end to end). <!-- id:NUG3EfZB -->

# Status as built <!-- id:Sjuqma4a -->

Recorded 2026-08-13 against `harness/full`. **Built** means live in code on this branch; **changed** means the capability exists but not in the shape the plan named — the inline **Built:** notes above say how. <!-- id:EgBqtzVG -->

<!-- id:AMo1y--W -->
| Milestone <!-- col:NzRlg289 --> | Item <!-- col:IdViOKbl --> | Status <!-- col:0Tv0oX2A --> <!-- id:Itj45Jtq --> |
| --- | --- | --- |
| M1 verbs | five verbs replace the 25-tool registry, no aliases | built <!-- id:zBODRsyc --> |
|  | `read` address dispatch | changed <!-- id:94phqxMX --> |
|  | `write` address+content+intent | changed <!-- id:WkUS0USk --> |
|  | `call` over one builtin seam, contract-on-miss | changed <!-- id:WTlXiwKd --> |
|  | `delegate` merges the three spawn tools | built <!-- id:s-ebA5Hn --> |
|  | `plan` absorbs `update_plan`; `set_session_title` deleted | built <!-- id:JfCCOlcd --> |
| M2 tools as docs | tool documents with contracts and CIDs | changed <!-- id:9EEPhlkl --> |
|  | builtin materialize/refresh | changed <!-- id:t5mqrDEx --> |
|  | the Space index in every system prompt, byte-budgeted | changed <!-- id:GE--Hgrc --> |
|  | touch-expand pins reconstructed from durable events | changed <!-- id:u99FhCQQ --> |
|  | verb docs deepen on first use | not built <!-- id:ARqfZzqX --> |
| M3 symmetric log | `actor` on session events | changed <!-- id:bfNJ4SZs --> |
|  | user-invoked verbs on the same log | changed <!-- id:MypE7Kin --> |
|  | desktop palette + generated forms | changed <!-- id:5fYQ2Ln- --> |
|  | web parity | not built <!-- id:39m6qsMU --> |
| M4 exec | one `execute` contract, options collapsed to config | changed <!-- id:sUr8_iWI --> |
|  | TS runner image beside Python | built <!-- id:JV4y_NLO --> |
|  | authored lambdas callable, validated both edges | changed <!-- id:X25D_9xJ --> |
| M5 time | `event` and `budget-pause` wait reasons | built <!-- id:4Kjpt6t6 --> |
|  | durable `ctx.sleep`, restart-proof timer sweep | changed <!-- id:yvbfcr8W --> |
|  | `ctx.waitForEvent` + `SignalRun` | changed <!-- id:HUDlUwpH --> |
|  | `ctx.continueAsNew` | built <!-- id:uBJ6pSwe --> |
|  | parked-state copy and wake affordances | built <!-- id:wmsfpNef --> |
| M6 event bus | `run-completed` source + loop guard | built <!-- id:hMU6e6tO --> |
|  | `wake` continuation | built <!-- id:gnMGRIlg --> |
|  | shared activity matcher | built <!-- id:z5w7huap --> |
|  | trigger documents, draft→active consent, migration | not built <!-- id:r-fWsCg6 --> |
|  | protocol deletion, `document-change`, `appendTo`, `runPlan` | not built <!-- id:BZ6fS-0C --> |
|  | per-trigger budgets, firing history as runs | not built <!-- id:JimNeFZQ --> |

## Landed without being planned <!-- id:ERR3gKNR -->

- **Obligations are one contract.** A run that ends owing work — an undelivered typed `return_result`, plan steps left neither finished nor written off — is asked once, with the whole debt in one prompt, up to `MAX_RUN_CONTINUATIONS` (3). Budget spent means an honest ending: `unmetObligations` on the run output and on `RunInfo`, a visible system notice on the log, and **nothing ticked off on the agent's behalf**. Typed debt fails the run (a parent is blocked on a result that is never coming); plan debt succeeds owing it. <!-- id:KNiRild5 -->
- **The runtime speaks as itself.** Every runtime-authored message is durably `actor: 'system'` and renders as a quiet grey aside instead of wearing the user's voice; every event stamps `SessionEventMeta` (model, provider, per-turn usage, duration). <!-- id:H2lG0WxE -->
- **Plan-state visibility.** `<plan_state>` is rendered fresh from session state into each turn's replay and never stored as an event, so the agent can see the checklist it published while its children ran. Step ids and labels are model-authored text handed back inside a frame the model knows, so they get the same `escapeActionFraming` treatment user-action payloads get — a label that _is_ the closing tag is neutralized, not censored. <!-- id:-Re9ffpw -->
- **Runtime-derived settlement.** A plan step whose attached sub-agents all came back succeeded is closed by the runtime, stamped `resolvedBy: 'runtime'` and carried forward across later plan edits. Only success is ever derived this way. `RunPlan.settledAt` records the moment a checklist first went fully terminal, which is when its card leaves the pinned slot and freezes into the log. <!-- id:c7dO1cIz -->
- **`ListAgentTools`** — an owner-facing action listing an agent's tool documents, so the desktop Tools tab shows what the agent wrote for itself. <!-- id:2CIQFUf3 -->
- **Sandbox repair.** microsandbox pinned to 0.6.8 (a 0.6.8 elsewhere had migrated the shared `~/.microsandbox` DB and locked out every 0.6.6 copy) speaking its `NetworkPolicy.fromProfiles(['public'])` dialect with the old `nonLocal()` as fallback; and the `ts` image now defaults to `oven/bun` rather than being an operator opt-in, so TypeScript lambdas run out of the box. <!-- id:8Co68xdc -->
