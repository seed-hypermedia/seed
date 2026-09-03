---
name: The Harness — Implementation Plan
summary: "Three nouns, five verbs: plan and milestone gates for the Seed Agents harness rebuild"
---
# The Harness — implementation plan <!-- id:c5gM31IG -->

Status: **in progress** (started 2026-08-11). Architecture source: the "Three nouns, five verbs" deck (claude.ai<br>artifact `7ec78c32`), superseding the five-collapses deck; grounded in workflows v1 as built on `feat/agent-workflows`<br>(PR #920) and `agents/docs/research/` (branch `agents-planning`). <!-- id:X-LRVYSz -->

Breaking changes are **allowed and preferred** over aliases or dual paths. What must not regress is the v1 spine: the<br>runs queue (leases, boot sweep, park/resume, persisted usage), the QuickJS journaled script engine with content-keyed<br>replay, verbatim-markdown briefings, and the one-card UX law (steer from one place, interrogate one click deep, never<br>lose work). <!-- id:mt08UFRd -->

## Architecture in one paragraph <!-- id:5W3ReZgy -->

Three nouns: the **Space** (one document tree per agent account — `~/tools`, `~/memory`, `~/plans`, `~/triggers`,<br>`agent.md`; every tool is a document with a summary line, an Onyx contract, a description, and source or a builtin<br>binding), the **Log** (per-thread append-only events, each stamped with an `actor`), and the **Runs** (the v1<br>tree-queue, kept verbatim). Five verbs — `read`, `write`, `call`, `delegate`, `plan` — replace the 25-tool registry;<br>everything else is a document under `~/tools/`, collapsed to its summary until touched. The user holds the same five<br>verbs through the same log (symmetry). Two engines: QuickJS scripts orchestrate (journaled), microVM lambdas compute (TS<br>first-class, Python kept). Long-running work is parked runs plus wake sources; triggers are documents that bind event<br>sources to continuations and serve as the event bus. <!-- id:zH51o0mC -->

## Branch & review protocol ("checkmark branches") <!-- id:4C4E58MX -->

Base: `feat/agent-workflows` (rebased onto main 2026-08-11). Milestones land as a stacked series: <!-- id:MTKOe1tD -->

``` <!-- id:uGTYMV8L -->
feat/agent-workflows          ← base (PR #920)
  └─ harness/01-verbs
       └─ harness/02-tools-as-docs
            └─ harness/03-symmetric-log
                 └─ harness/04-exec
                      └─ harness/05-time
                           └─ harness/06-event-bus
```

Per-milestone protocol, in order: <!-- id:DGLlCZJG -->

<!-- id:PYpUQPfY -->
1. **Build** on the milestone branch; commits stay small and story-shaped. <!-- id:mk-YGgoW -->
2. **Gate** (self-verification, all must pass before anything is pushed): <!-- id:HfgxUKYg -->

<!-- id:7rmf9TEu -->
- `bun x tsc --noEmit` in `agents/` (and desktop typecheck when frontend is touched) <!-- id:DNtT3NkB -->
- `bun test` in `agents/` — full suite, no skips added <!-- id:GxvNuVvH -->
- desktop `vitest` for touched UI packages <!-- id:aVPzK5uR -->
- the **prompt-budget test** (M2+): system-prompt bytes for a default agent stay under target <!-- id:E-9cxHz3 -->
- the **simulated-model gate**: a blind subagent, given only the live tool schemas, completes a scripted task <!-- id:ny5T5rrn -->

\     (delegation fan-out, tool discovery, plan maintenance). This replaces the gpt-5-mini cassettes wherever the tool<br>     surface changed, because cassette fingerprints include tool names; re-recording live gates is deferred until<br>     credits exist and is tracked in the review doc. <!-- id:ROoW8GoG -->

<!-- id:pu1HhxJX -->
1. **Self-review**: an adversarial review pass over the milestone diff (correctness, crash/replay safety, <!-- id:5_DXMPek -->

\   prompt-injection surface, UX-contract regressions against the settled v1 decisions). Findings fixed or explicitly<br>   recorded as accepted gaps. <!-- id:Wkz-jJL3 -->

<!-- id:_OwUtQP7 -->
1. **Checkmark**: push the branch, write `agents/docs/harness/reviews/NN-<name>.md` containing: what changed and why, <!-- id:BpZwsyEV -->

\   how it was verified (gate output summaries), known gaps, and a **manual test script for Eric** — concrete desktop<br>   steps with expected outcomes. <!-- id:dB6kR8Ip -->

<!-- id:bcJKom3z -->
1. **Prompt Eric** to review the checkmark. Work continues onto the next milestone without blocking; his feedback is <!-- id:ulWBnvy7 -->

\   folded in as fixup commits on the open milestone and propagated up the stack with rebases. <!-- id:GH36iX9L -->

## Milestones <!-- id:uavnfdvI -->

### M1 — The five verbs (`harness/01-verbs`) <!-- id:ZOmaeCDZ -->

The registry monolith (`agents/protocol/src/tool-registry.ts`, \~1,400 lines, 25 tools) is replaced by five verb<br>definitions plus internal address dispatch. No aliases: the old tool names stop existing; stored transcripts keep their<br>historical events (rendered generically) and replay fine — provider messages carry names verbatim and never re-dispatch<br>old calls. <!-- id:KRp2YJc8 -->

<!-- id:NqdNaaTb -->
- **`read {address, …opts}`** — one dispatcher keyed by address shape: <!-- id:DFVEB97N -->
- `~/memory/**` → agent-memory read/list (dir address ⇒ listing with summary lines) <!-- id:SlUrMPnt -->
- `~/tools/**` → tool contract (M1: from the builtin table; M2: from documents) <!-- id:dm7_WqIM -->
- `hm://…` → existing hypermedia read path; `ipfs://…` → ipfs read <!-- id:QmENM_P- -->
- `https://…` → web read; `activity:` (or `~/activity`) → activity feed with existing filters <!-- id:9pMXxB9n -->
- `~/threads/<id>` → transcript; `run:<id>` → run journal <!-- id:YlHbUKGr -->
- **`write {address, content, …opts}`** — memory writes/deletes, plan documents, `hm://` document operations (absorbing <!-- id:UFERhjN0 -->

\  the 22-command `write` envelope into address+content+intent), `ipfs://`, attachment moves (an attachment is just a<br>  readable source address). <!-- id:HzgjUF_y -->

<!-- id:rIhDWOCJ -->
- **`call {tool, input}`** — dispatch by `tools/…` path over one seam (`registerBuiltin`), which M1 introduces <!-- id:pXoNXw5x -->

\  internally: search, web\_search, navigate, execute land here as bound builtins. Calling an unexpanded tool returns its<br>  contract as the result (touch-expands); the retry runs. <!-- id:A73cqhxq -->

<!-- id:yY5oDQUO -->
- **`delegate {brief, script?, output?, await?, title?, step?}`** — merges `sub_session` (default), `run_workflow` <!-- id:EYYZHZId -->

\  (`script` present ⇒ script child), `start_session` (`await: false` ⇒ detached but still in the run tree).<br>  Verbatim-markdown briefs, typed output with bounded retries, plan-step attachment — all preserved from v1. <!-- id:7UnRRfo8 -->

<!-- id:nmpLxxXs -->
- **`plan {steps | update}`** — absorbs `update_plan`; `set_session_title` is deleted (titling is already automatic and <!-- id:9hjttQks -->

\  agent-authored). <!-- id:Tjgljf0j -->

Files: `protocol/src/tool-registry.ts` (rewrite), `protocol/src/index.ts` (event/type updates), `api-service.ts`<br>(`createAgentServicePiTools` region, the three name-filter chains, delegation paths), shared UI tool renderers<br>(`@shm/ui/agents`), desktop run-card step labels, affected tests across `agents/src/*.test.ts` and desktop. <!-- id:JS9DAmIF -->

Success is measurable: default-agent system prompt shrinks by roughly the difference between 25 schemas and 5; model<br>tool-choice in the simulated gate has no wrong-tool retries. <!-- id:2Z6uiOwD -->

### M2 — Tools as documents (`harness/02-tools-as-docs`) <!-- id:QqL_Zcm_ -->

<!-- id:k_huBenV -->
- Tool documents in the Space: frontmatter-style metadata (name, summary, tags, grants required), Onyx input/output <!-- id:bavnNKqu -->

\  contracts, model-facing description, and source (lambda) or builtin binding id. Storage rides the agent-memory tree<br>  (`~/tools/**`) so read/write/versioning come free; each save produces a CID (content-address the canonical CBOR<br>  encoding). <!-- id:t41pqnOy -->

<!-- id:RYoe5H0u -->
- Boot upsert: builtins materialize/refresh their documents at service start; a forked builtin doc keeps the binding id <!-- id:C_WJ4KHL -->

\  but its contract diff is visible. <!-- id:xTI8cgIc -->

<!-- id:dECbfqn6 -->
- **The index**: generated summary of the Space (one line per tool/group, memory dirs with counts, live plans, active <!-- id:qHzTEvnz -->

\  triggers), injected into every run's system prompt; a CI test asserts the byte budget (\~1.5 KB default agent). <!-- id:N6506ot3 -->

<!-- id:J4O0ULWd -->
- **Touch-expand + pins**: `read` on a tool document (or contract-returning `call`) appends a durable <!-- id:pHfmBxBv -->

\  `expanded {path, cid}` log event and activates the tool via Pi `setActiveToolsByName`; replay/compaction/park-resume<br>  reconstruct the active set from pins. Unpin is explicit. <!-- id:e9oLqZtL -->

<!-- id:bJBHz9Lc -->
- The five verbs' own docs deepen on first use (full help returned beside the first result). <!-- id:DGcPGzA- -->

### M3 — The symmetric log (`harness/03-symmetric-log`) <!-- id:CMMLl3s3 -->

<!-- id:hevDg8P3 -->
- `actor: 'user' | 'agent' | 'system' | 'trigger'` on session events (schema migration; existing rows backfill by event <!-- id:Is-bfz-s -->

\  type). <!-- id:vuY1QcE3 -->

<!-- id:DXcKshdN -->
- Protocol: user-invoked `read`/`write`/`call` against a thread — appended to the log as `actor: user` <!-- id:yHkabDwD -->

\  tool\_call/tool\_result pairs and executed as runs on the interactive queue; the agent sees them in transcript replay on<br>  its next turn, no side channel. <!-- id:aFeQTfCb -->

<!-- id:Xs9CneUx -->
- Desktop: composer `/` palette over the Space (tools, saved plans, triggers); Onyx-schema-generated forms for tool <!-- id:Mjl7Ifyj -->

\  input; results render with the existing card grammar; user edits to plan steps and per-child cancels emit log events<br>  the agent can read. <!-- id:5-RcvEZ8 -->

<!-- id:kEELf3_i -->
- Web parity via the shared `@shm/ui/agents` package where the platform adapters allow. <!-- id:qcXnuN8m -->

### M4 — Execution cleanup + TS (`harness/04-exec`) <!-- id:a7ct7IM6 -->

<!-- id:jgBBl1B_ -->
- `execute {runtime: 'ts' | 'python', code, files?}` — the whole compute surface; option sprawl (image/cpu/memory per <!-- id:f3wAIfhD -->

\  call) collapses to service config. <!-- id:mPly4S-e -->

<!-- id:rDY2pouY -->
- Bun-based TS runner image beside the Python image; one file-framed runner protocol for both; runner-protocol suite <!-- id:j1KP8gau -->

\  runs against the injected fake sandbox, real-microVM smoke stays gated. <!-- id:7vtLkZ0V -->

<!-- id:JAvOZOE7 -->
- Lambda tool documents become callable: `call tools/<lambda>` = validate input (Onyx, outside VM) → `execute` stored <!-- id:rhJdap1u -->

\  source → validate output. Author→test→save flows through `write` + `call`. <!-- id:B8kAfgvG -->

### M5 — Time (`harness/05-time`) <!-- id:yW0mhDEP -->

<!-- id:NiPkIke0 -->
- `runs.wait` gains `event` and `budget-pause` beside `children`/`timer`. <!-- id:EQ4nM2XT -->
- `ctx.sleep(until)` persists wake-at; the dispatch loop's timer sweep wakes due runs (days-scale, restart-proof — <!-- id:whijeEY9 -->

\  kill/restart tests across sleeps). <!-- id:E9vHF_Tl -->

<!-- id:WZ43vve9 -->
- `ctx.waitForEvent(match, {timeout})` registers an **ephemeral trigger** scoped to the run; firing appends the payload <!-- id:5GadRG8b -->

\  to the journal and requeues the run; timeout is a timer wait racing it. <!-- id:rD8sY_I0 -->

<!-- id:5b--ev6H -->
- `ctx.continueAsNew(state)` finalizes the run and enqueues a successor carrying declared state only — journal growth <!-- id:2267hWiv -->

\  over week-scale loops stays bounded. <!-- id:nyQMXqHA -->

<!-- id:DK30jmDH -->
- Card/thread copy for every parked state: "sleeping until 08:00", "waiting for approval", "paused: daily budget", with <!-- id:tcy67o-F -->

\  user wake/cancel affordances. <!-- id:S4XKvxSa -->

### M6 — The event bus (`harness/06-event-bus`) <!-- id:szPidsNp -->

<!-- id:bM1c7AmU -->
- Trigger documents in `~/triggers/**` replace the trigger CRUD protocol surface; monitors read documents. <!-- id:PMaPD7lJ -->

\  `status: draft | active`; activation is the consented step (minimal consent card — the card grammar's question state). <!-- id:72D3ItxQ -->

<!-- id:FveQ3hxh -->
- Sources: the shipped four (schedule, document-comment, user-mention, site-update) plus `document-change` (watch any <!-- id:1rsVT7vg -->

\  hm:// path or Space dir) and `run-completed` (chain automations). Webhook stays out of scope unless trivial. <!-- id:3OSqyoyC -->

<!-- id:tSTKaeOI -->
- Continuations: `newThread {brief}` (today's behavior), `appendTo {thread}`, `wake {run, signal}` (delivers to a <!-- id:OQK3eOHY -->

\  waiting `ctx.waitForEvent`), `runPlan {plan}` (saved plan → fresh run). <!-- id:LlI2H_TL -->

<!-- id:Qea1ftTU -->
- Per-trigger budgets with auto-pause; firing history browsable as run records beside the document. <!-- id:jlnQIDXH -->

## Test strategy summary <!-- id:KzN__Q0r -->

<!-- id:lSCJtAGj -->
- **Unit/integration**: the existing agents suite is the backbone; every milestone leaves it green and grows it <!-- id:0Q7bRdQk -->

\  (address-dispatch table tests, pin-replay tests, actor-backfill tests, runner protocol, timer-sweep kill/restart,<br>  trigger-continuation matrix). <!-- id:a0PKQJHJ -->

<!-- id:eu7ftswp -->
- **Determinism**: golden replay tests for the script engine remain untouched proof that journaled semantics survived <!-- id:wvms8eIC -->

\  each milestone. <!-- id:FkXLluYu -->

<!-- id:yzK9bbkf -->
- **Model-facing**: simulated-model gates (blind subagent over the real schemas) per milestone; live gpt-5-mini cassette <!-- id:GiL7xrbI -->

\  re-record is a single deferred task once credits exist. <!-- id:loW2Du7B -->

<!-- id:_cQMy7SV -->
- **Manual (Eric)**: each review doc ends with a five-minute desktop script — the checkmark is not done until that <!-- id:MBoXiX0x -->

\  script passed for me first. <!-- id:xC_uB4rJ -->
