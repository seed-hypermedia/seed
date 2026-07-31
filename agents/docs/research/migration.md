# Migration: from today's code to the north star

Design-stage document (see [readme.md](./readme.md)). This interleaves the four pillar docs' phase lists
([orchestration.md](./orchestration.md) §8, [tool-system.md](./tool-system.md) §e,
[context-and-threads.md](./context-and-threads.md) §Migration, [self-configuration.md](./self-configuration.md)
§Migration) into one global order. Each global phase is independently shippable, keeps the desktop working, and is
testable on its own; early phases are pure wins on today's system with zero protocol change.

Sizes are rough engineering scale: **S** ≈ days, **M** ≈ 1-2 weeks, **L** ≈ several weeks.

## Do first, this week

1. **Commit the Onyx prototypes.** `frontend/apps/cli/src/utils/onyx.ts` (async resolvers), the CLI `schema` commands,
   and the `schemas/` reference validator + fixtures exist only as uncommitted working-tree files on one machine.
   Everything downstream (registry, workflows, validation plumbing) cites them; losing them loses the toolchain. (S)
2. **Runs table + crash sweep + persisted usage** (phase 1 below) — kills the wedged-`streaming` failure mode and the
   usage black hole with no protocol change.
3. **Honest model capabilities** (also phase 1) — replace the hardcoded `contextWindow: 128000 / maxTokens: 16384`
   fiction (`api-service.ts:3514`) with the extended `model-capabilities.ts` registry + observed-ceiling correction.
4. **Executor binding table** (phase 2) — delete the 4-touch-point problem while behavior stays bit-identical.

## Phase 1 — Runs under the hood (M)

**Delivers:** `runs` + `run_journal` tables; `#messageSessionOnce` (`api-service.ts:1379`) becomes enqueue + claim on an
`interactive` queue; `#runPiAgent` (`:1582`) becomes the agent-run executor; startup sweep + dangling-tool-call resume
rule; usage flushed to `usage_cbor` at tool boundaries; `sessions.status` becomes the derived mirror; honest
capabilities registry + `context_state_cbor` on sessions.

**Depends on:** nothing. **Shippable because:** zero protocol change — the desktop sees identical behavior, minus the
crash-wedge. **Testable:** hard-kill/restart integration tests (the api-service harness already boots the real service
on temp SQLite); usage-persistence assertions. **Risk:** the `#piMessages` resume path must synthesize trailing
`tool_result`s or providers reject the request — this rule ships in the same phase, not later.

## Phase 2 — Action records without behavior change (M)

**Delivers:** `jsonSchemaToOnyx()` + snapshot tests converting every `seedToolRegistry` entry; the
`registerBuiltin(def, execute)` binding table replacing `createAgentServicePiTools()`'s monolith and the `||`
name-filter chain (`api-service.ts:1670-1686`); prompt tool-groups generated from `tags`; the ipld↔dag-json converter +
`parseOnyxError`; onyx-engine imported into the Bun service.

**Depends on:** week-one Onyx commit. **Shippable because:** bit-identical tool behavior — all tools still statically
loaded; this is pure structure. **Testable:** conversion snapshots + JSON-Schema-projection property tests; engine
parity against the reference fixtures. **Risk:** low; this is the phase that makes every later phase cheap.

## Phase 3 — Queue for triggers + thread schema (M)

**Delivers:** trigger firings transactionally enqueue runs (deleting `#dispatchTriggerSession`'s fire-and-forget,
`api-service.ts:2503`); retry/backoff/limits; `drainTriggerSessions` → `awaitQueueIdle` (also de-flakes the agents CI
fetch-mock suite). Additive `sessions` columns (origin/parent/root/lifecycle/attention/context-state) with backfill;
trigger-born sessions get `origin='trigger'`, `attention='unseen'`.

**Depends on:** phase 1. **Shippable because:** triggers gain retry/budget/history with unchanged firing semantics
(watermarks and twin-collapse untouched); thread columns are inert until the UX uses them. **Testable:** extends
`activity-trigger-race.test.ts`; `sqlite.test.ts` schema diff + backfill fixtures.

## Phase 4 — Compaction (M)

**Delivers:** the `compaction` session-event variant; `#piMessages()` boundary read (summary as a user-role fenced
recap); the `builtin:compact_thread` system-origin run; three-tier promote/summarize/drop policy; auto-threshold +
pre-run guard; stable-prefix ordering (memory listing moved out of the system prompt).

**Depends on:** phases 1 (runs, honest accounting) and 3 (context state). **Shippable because:** long threads stop dying
at the provider window — the single biggest UX defect today. **Testable:** golden replay-determinism tests; prefix
byte-stability CI. **Risk:** summary quality; mitigated by keeping the full transcript and the audit `runId`.

## Phase 5 — Registry rows + run protocol + MCP bridge (L)

**Delivers:** `actions`/`action_versions`/`actions_fts` tables with boot-time builtin upsert;
`CreateAction`/`ListActions`/`GetAction`/`ImportAction` etc.; desktop render pipeline queries `ListActions` with the
bundled registry as fallback; output validation goes live (log-only for builtins); the MCP bridge imports server tools
as builtin-kind rows. Plus the run protocol: `CreateRun`/`GetRun`/`ListRuns`/`CancelRun`, `runs/<rootId>` subscriptions,
read-only desktop run views.

**Depends on:** phase 2. **Shippable because:** the registry becomes real and immediately useful (MCP tools) while
agents still load tools statically. **Testable:** registry CRUD/versioning/CID stability; bridge conversion fuzz against
real-world MCP schemas. **Risk:** `jsonSchemaToOnyx` lossy cases — the bridge's open-map fallback is the pressure valve.

## Phase 6 — Capability gates, grants, consent (L)

**Delivers:** `capability_grants`/`consent_requests`/`config_audit`; the `evaluateCapability` seam in the shared
dispatch path; origin downgrade + untrusted-content flag; `ResolveConsentRequest` + grant protocol actions; desktop
consent cards, notification center, Grants panel; first `config.*` wrappers (`config.create_trigger`,
`config.create_agent`, `config.read`) over refactored shared handlers; `lifecycle` columns on `agents`/triggers.

**Depends on:** phases 1 (origins on runs) and 5 (capability field on registry records). **Shippable because:**
`ask`-by-default needs zero user setup, and the first two config actions already enable the flagship trigger-creation
flow with the agent-run consent path (`consent_pending` → continuation run), which does not need the workflow engine.
**Testable:** grant-evaluation matrix; consent-lifecycle service tests; escalation red-team suite. **Risk:** consent UX
quality decides whether self-configuration feels magical or nagging — dogfood here.

## Phase 7 — Workflow engine (L)

**Delivers:** QuickJS-WASM executor (`workflow-host.ts` ctx bridge + journal + replay, `workflow-executor.ts`);
`ctx.call/agent/parallel/pipeline/sleep/now/log/progress/waitForEvent/continueAsNew`; `SignalRun`; workflow-run consent
parking; determinism lint at publish; journal caps; `run_code` as a thin wrapper.

**Depends on:** phases 2 (Onyx validation), 5 (registry + run protocol), 6 (gates for `ctx.call`). **Shippable
because:** workflows are a new capability with no legacy surface to break; `run_code` gives immediate value before
anyone authors registered workflows. **Testable:** the fault-injection replay suite (kill at every await; assert
exactly-once effects and byte-identical output) — build it with the engine, not after. **Risk:** the ctx contract and
journal format are expensive to retrofit — they ship final; the engine internals stay swappable.

## Phase 8 — Sub-agents, trigger targets, verify library (M)

**Delivers:** `agent.run` builtin behind `exec.spawn`; `return_result` typed outputs with bounded self-correction;
depth/fan-out/budget caps; `target_cbor` on triggers (action + signal targets, legacy shape compiled); the curated
`verify.*` workflow library; run-tree UI attached to chat tool bubbles.

**Depends on:** phases 6 and 7. **Shippable because:** this is the moment "orchestration" is user-visible — judge panels
and scheduled zero-model monitors work end to end. **Testable:** typed-result retry paths against the mocked Pi
provider; budget reservation/rollup arithmetic; daily-ceiling auto-pause.

## Phase 9 — Discovery (M)

**Delivers:** `action_search`/`load_actions` + `actions_loaded` events + Pi `setActiveToolsByName` wiring with the
same-user-turn activation contract; `prompt_tokens` measurement + per-agent budget; core-set default (~2 KB) behind a
per-agent flag, then default-on.

**Depends on:** phase 5 (could land before 7/8; sequenced here so the registry is populated enough that discovery has
something to find). **Shippable because:** feature-flagged per agent — existing agents unaffected until opted in.
**Testable:** discovery e2e (search → load → call in one turn; resume restores the pinned set across compaction);
prompt-budget CI ceiling.

## Phase 10 — One-input surface (L)

**Delivers:** `SendMessage` + three-tier routing (`system.route_message` action) + `ListThreads`/attention actions;
inbox affordance + routing chip; `AssistantDraftChat` → `SendMessage`; sidebar restructure (Attention/Active/ history);
context meter; `thread_search` (embedding compaction summaries/titles/memory at write time).

**Depends on:** phases 3, 4, 6 (inbox consent cards), 9 (router is a discoverable action). **Shippable because:**
session actions remain aliases — old flows keep working while the new surface rolls out. **Testable:** routing
table-driven tests; protocol-compat suite (existing desktop client tests green against the thread server). **Risk:**
routing quality; the fallback-to-sticky-continue rule keeps mistakes cheap and visible.

## Phase 11 — Lambdas, skills, bundles, write decomposition (L)

**Delivers:** Python-first lambdas (`/io` runner protocol, warm pool for mountless calls, both-edge validation,
`config.create_lambda`/`test`/`publish` flow); skill records + loading via `load_actions`; bundle install;
`PublishAction` to the network; `write` decomposed into individual actions behind an alias facade; JS lambda runtime as
scoped follow-on infrastructure.

**Depends on:** phases 5-7, 9 (discovery makes decomposed/authored actions affordable). **Shippable because:** each
piece (lambdas, skills, bundles, write split) lands separately behind the same registry machinery. **Testable:**
runner-protocol suite on the injected fake sandbox + availability-gated real-microVM smoke; Flow-2 e2e (author → test →
publish under consent).

## Phase 12 — Lineage UX + polish (M)

**Delivers:** branching (`BranchThread`) + handoff (`HandoffThread` + gated agent form) + lineage tree UI; compaction
divider with expandable transcript; run receipts (`config.publish_run_receipt`); hooks (`config.set_hooks`); remaining
`config.*` surface (self-prompt, identities, propose-provider, imports).

**Depends on:** everything prior. This phase is deliberately a basket: each item is S-M and independently droppable from
v1 without weakening the architecture.

## Sequencing rationale

- **Phases 1-4 are pure wins on today's system** — crash recovery, honest accounting, retries, compaction — and none
  changes the protocol. If the project paused after phase 4, the current product would simply be better.
- **The registry (5) precedes gates (6) precedes the engine (7)** because each is the substrate of the next: gates need
  a capability field on records; `ctx.call` needs gates so workflow authority is never broader than chat authority on
  day one.
- **Discovery (9) and the one-input surface (10) are late deliberately**: they change user-visible defaults, so they
  ride on a populated registry, working consent, and compaction-fed routing summaries rather than launching hollow.
- **Cross-account work stays unscheduled** — the reservations (origin `external`, portable provenance, inbox landing)
  are enforced by review in every phase instead.
