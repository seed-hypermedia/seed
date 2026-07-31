# North star: the Seed agent harness

Design-stage document (see [readme.md](./readme.md)). This is the unified view of the target architecture — the one
document to read first. Detail lives in the four pillar docs: [orchestration.md](./orchestration.md) (runs, queue,
workflow language), [tool-system.md](./tool-system.md) (actions, registry, discovery, lambdas),
[context-and-threads.md](./context-and-threads.md) (threads, compaction, one-input UX), and
[self-configuration.md](./self-configuration.md) (capabilities, grants, consent). Where this doc and a pillar doc
disagree, this doc's "Resolved decisions" section wins and the pillar doc has a bug.

## The system in one paragraph

The user faces **one text input**. Messages route themselves to system-managed **threads** whose context compacts
automatically and honestly. Everything an agent can do is an **action** — builtin, sandboxed lambda, sub-agent, or
workflow — one callable shape, typed end-to-end by **Onyx** schemas, discovered progressively instead of paid for in
every prompt. Every execution is a durable **run** in a leased, budgeted, crash-recoverable queue; workflows are
sandboxed JavaScript with Temporal-style journaled replay. The harness's own configuration surface — agents, triggers,
lambdas, workflows — is itself a family of gated actions, so the system builds itself out through conversation, with
signed grants and consent cards keeping a human in the loop exactly where autonomy becomes standing. All of it rides the
existing signed CBOR protocol, the append-only SQLite event spine, and the narrow Pi SDK seam that already work today.

## Design principles

1. **Everything is an action.** A builtin tool, a user-authored lambda, a sub-agent, a workflow, a config operation, the
   message router itself — all are `{name, summary, description, input, output, kind}` records in one registry. One
   dispatch seam means one place for validation, capability gates, budgets, journaling, and rendering.
2. **Onyx types everything.** Action I/O, workflow journals, trigger payloads, router decisions, consent cards, run
   receipts. Validation is validate-only (never coerces), errors are structured paths the model can act on, and every
   schema is itself a content-addressed, publishable document.
3. **Everything durable is an append-only event, and replay is deterministic.** Session events remain the conversation
   spine; run journals are the execution spine; compaction appends checkpoints rather than rewriting history. A resumed
   run — after crash, timer, consent, or restart — reconstructs byte-identical context from what was stored. Nothing
   durable is ever recomputed by a model twice.
4. **Content addressing is versioning.** `hm://name` is the mutable pointer used by discovery and configuration;
   `ipfs://cid` is the pinned version used by execution. Journals, `actions_loaded` events, and consent approvals pin
   CIDs, so "what exactly ran" is always answerable and TOCTOU is structurally absent.
5. **Signed identity is trust.** The protocol envelope, capability grants, consent resolutions, published actions, and
   run receipts are all Ed25519-signed objects. Provenance chains terminate in a signature, a trigger firing, or a
   parent run — expressible as portable signed objects, never bare rowids, so cross-account federation is an extension,
   not a rewrite.
6. **Autonomy proposes; humans ratify standing power.** Creation is cheap and `draft`; activation is guarded. Origin
   taint downgrades standing grants to `ask` for autonomous contexts. No agent can grant capabilities, read secrets, or
   delete history — ever.

## The layers

```
┌────────────────────────────────────────────────────────────────────┐
│ 6  One-input surface           router · inbox · consent cards      │  context-and-threads §C/E, self-configuration §b/e
├────────────────────────────────────────────────────────────────────┤
│ 5  Threads & context           lineage · compaction · accounting   │  context-and-threads §A/B/F
├────────────────────────────────────────────────────────────────────┤
│ 4  Orchestration language      ctx.* · journaled replay · signals  │  orchestration §2/3/5
├────────────────────────────────────────────────────────────────────┤
│ 3  Actions & registry          4-kind union · discovery · lambdas  │  tool-system (all)
│    Capability gates            grants · consent · audit  (cross)   │  self-configuration §a/b
├────────────────────────────────────────────────────────────────────┤
│ 2  Runs & dispatch queue       leases · budgets · retry · usage    │  orchestration §1/4
├────────────────────────────────────────────────────────────────────┤
│ 1  Signed protocol & spine     CBOR actions · session_events · WS  │  existing system, preserved
└────────────────────────────────────────────────────────────────────┘
```

**Layer 1 — the preserved spine.** The signed account-scoped CBOR action API, the `sessions` + `session_events`
append-only tables, WS `append`/`appendPartial`/`change` replay, exactly-once dispatch via deterministic keys +
`INSERT OR IGNORE`, the microVM sandbox with agent memory, and the Pi seam (Seed owns persistence/auth/tools/prompt; Pi
owns loop + provider adapters). Every layer above is additive to this; old clients keep working via aliases and ignored
optional fields throughout.

**Layer 2 — runs.** Every execution is a `runs` row: status, lease, attempts, budget, persisted usage, forming a tree
rooted at a user message, trigger firing, or `CreateRun`. The runs table _is_ the queue — a single dispatch loop claims
atomically under concurrency limits with classified retry/backoff. Crash recovery is a startup sweep plus a
dangling-tool-call resume rule; the wedged-`streaming` failure mode dies here, and `sessions.status` becomes a derived
compatibility mirror. Usage finally persists, rolls up child→parent transactionally, and is priced from a real cost
table.

**Layer 3 — actions.** The static `seedToolRegistry` object literal becomes data: SQLite rows + append-only versions

- FTS, content-addressed records publishable as hypermedia documents, with builtins as boot-upserted rows bound to
  executors by a single `registerBuiltin` call. Discovery replaces the fixed prompt tax: a ~2 KB core (`action_search`,
  `load_actions`, `read`, `memory`, hidden `set_session_title`) plus search-then-load over Pi's shipped
  `setActiveToolsByName`, durable via `actions_loaded` events that pin CIDs. Lambdas (Python-first, `/io` file-framed,
  warm-pooled, validated at both edges outside the VM) make user/agent-authored actions first-class. Skills carry
  procedures the same way actions carry schemas. MCP arrives as a bridge that imports server tools as builtin-kind rows.
  Cutting across this layer, any action may declare a **capability**; the executor evaluates grants into
  `allow`/`ask`/`deny` at the same seam that validates input.

**Layer 4 — the orchestration language.** A workflow is an action whose `source` is a sandboxed JS module run in an
in-process QuickJS-WASM realm with zero ambient authority: every effect is a journaled `ctx` call (`call`, `agent`,
`parallel`, `pipeline`, `sleep`, `waitForEvent`, `continueAsNew`), giving Temporal-grade durable execution —
replay-from-top resume, durable timers, external signals, consent parking — at interpreter cost, not VM cost. Sub-agents
are child runs with total context isolation and Onyx-typed results (`return_result`). Verification (judge panels,
adversarial review) is a curated `verify.*` workflow library, not engine primitives. `run_code` runs the same sandbox as
an anonymous inline workflow, so heavy data flow can skip model context without registration ceremony.

**Layer 5 — threads.** A thread is a session row plus lineage (`branch` shares replayed context; `delegation` and
`workflow` children get typed input only — the context firewall), lifecycle, attention, and cached context state.
Compaction is a durable `compaction` event: stored summary, covered-seq boundary, memory promotions, and an
`activeActions` snapshot — deterministic replay preserved, full transcript retained forever. Token accounting is honest:
the last run's persisted input tokens are the ground truth, a model-capabilities registry with observed-ceiling
correction replaces the hardcoded 128k, and the stable-prefix invariant makes provider prompt-cache economics an
explicit design constraint.

**Layer 6 — the surface.** One input; a three-tier router (explicit → sticky-recent → the `system.route_message` action,
augmented by `thread_search` retrieval) resolves each send to continue/branch/new. `SendMessage` collapses the
create+message two-step. Proactive threads land in an inbox with attention states instead of a flat session list.
Consent cards render frozen, schema-driven inputs; the Grants panel and audit trail make the self-configuring system
legible. Self-configuration itself is just layer-3 actions behind layer-3 gates: `config.create_trigger` has the same
shape as `web_search`.

## How the pieces interlock

- **Action ↔ run**: invoking any action out-of-band, from a workflow, or as a sub-agent creates a run; agent tool calls
  inside a turn stay session events, attributed to their run by `runId`. One vocabulary of origins
  (`user | trigger | workflow | agent | api | system`, `external` reserved) spans runs, grants, and consent.
- **Journal ↔ event log**: workflows journal; agent runs use their session events as the equivalent durable spine. The
  shared guarantee — a persisted result is never re-executed on replay — is what makes consent, crash resume, and
  idempotent retries uniform across both kinds.
- **Compaction ↔ routing**: the stored compaction summary doubles as the thread's routing candidate summary and its
  `thread_search` embedding — context management makes routing better, a virtuous loop.
- **Discovery ↔ determinism**: `actions_loaded` events pin CIDs, so a resumed or branched run sees exactly the tools it
  had, at the versions it had, across compaction boundaries.
- **Grants ↔ budgets ↔ queue**: capability evaluation, per-object daily ceilings (`usage_counters`), and trigger
  auto-pause all happen at the same two seams — action dispatch and run enqueue — so policy has no third place to leak
  past.
- **Receipts ↔ identity**: because action CID, input/output CIDs, journal, and origin chain are already
  content-addressed and signed, a publishable signed run receipt — _this identity produced this output from this exact
  code and input at this cost_ — is nearly free, and it is a claim no mainstream harness can make.

## One message, end to end

The user types into the one input: _"Every morning, check comments across my sites and draft replies for me to
approve."_

1. **Route** (layer 6): no sticky thread matches; `system.route_message` picks `new` with the root agent. A thread is
   created (`origin='user'`), the send becomes an agent-kind run (`origin='user'`) on the `interactive` queue.
2. **Discover** (layer 3): the root agent's core is ~2 KB. It calls
   `action_search("trigger schedule workflow comments")`, gets summaries + signatures, then `load_actions` — a durable
   `actions_loaded` event pins the CIDs of `config.create_workflow`, `config.create_trigger`, and `list_activity_feed`;
   activation applies within the same turn.
3. **Author** (layer 4): the agent writes a workflow — `ctx.call('list_activity_feed', …)` → `ctx.parallel` of
   `ctx.agent({prompt: drafting instructions, input: {comment}, output: 'ipfs://…DraftReply'})` per comment →
   `ctx.waitForEvent('approval', {timeoutMs: ctx.hours(24)})` → `ctx.call('seed.comment-create', …)` per approved draft.
   It calls `config.create_workflow`; the capability gate resolves `ask`.
4. **Consent** (layers 3/6): the gated tool returns `consent_pending` immediately (the transcript stays provider-legal);
   a consent card renders the workflow's name, action list, and Onyx I/O schemas from frozen `input_cbor`. The user
   approves with scope `'thread'` — an ephemeral grant covers the rest of this setup burst. A continuation run resumes
   the agent with the resolution as an ordinary tool result.
5. **Dry-run** (layers 2/4): the draft workflow runs against yesterday's comments — a workflow run with journaled `ctx`
   calls, two parallel sub-agent child runs with isolated contexts and typed `DraftReply` results, usage rolled up to
   the root. The agent shows sample output in the thread; the tool bubble attaches the live `runs/<rootId>` stream.
6. **Activate** (self-configuration): `config.create_trigger` (schedule, 08:00, tz) targeting the workflow, then
   `config.activate_trigger` — always `ask`; the card shows schedule, estimated per-run cost from the dry run, and a
   prefilled `budgetUsdPerDay`. Approved: the trigger is `active` with a stored per-object budget; provenance columns
   record who built it, in which conversation, under which approval.
7. **Every morning** (layers 2/5/6): the schedule monitor's firing transactionally enqueues a workflow run (exactly-once
   by deterministic key; retry/backoff if a provider hiccups; auto-pause if the daily budget trips). Drafts are
   produced, the run parks on `waitForEvent` — holding no worker slot — and the thread surfaces in the inbox as
   `needs_user`. The user's "approve all" is a signal; the parked run wakes, posts replies, finishes. Weeks later the
   thread crosses 75% of its true context window; a `system`-origin compaction run appends a checkpoint, promotes stable
   preferences to agent memory, and the thread's routing summary improves.

Every step above is durable, attributable, resumable after a crash, and visible — either in the transcript, the run
tree, the inbox, or the audit trail.

## Why this beats the state of the art

Individually, most mechanisms have precedents — Temporal's replay, Claude Code's subagents/skills/progressive tools,
MCP's ecosystem, LangGraph's graphs. The compounding advantages are the ones only Seed's position affords:

1. **One primitive where others have four.** Tools, sub-agents, workflows, and plugins are separate systems everywhere
   else; here they are kinds of one Onyx-typed action in one registry with one gate, one budget, one journal, one
   renderer.
2. **Durable execution inside the conversational harness.** Temporal-grade workflows (journaled replay, durable timers,
   signals, continue-as-new) live in the same system as chat threads and compaction — no external orchestrator, and
   agent turns and workflows share consent, budgets, and observability.
3. **The registry is a network.** Actions, schemas, skills, and bundles are content-addressed signed hypermedia
   documents. Publishing a lambda is publishing a document; installing one is a consent with an exact CID; upgrades are
   diffs. No other harness's plugin system has versioning, authorship, and distribution as _properties of the
   substrate_.
4. **Provenance as a product.** Signed run receipts make machine work third-party-verifiable — exact code, exact input,
   exact cost, real identity. This is the trust layer inter-agent ecosystems are still chasing, and it falls out of the
   existing signing infrastructure.
5. **Honest, local-first economics.** Persisted usage, real cost tables, per-object budgets, prompt-cache-aware prefix
   stability, and prompt-cost accounting for tool definitions — measured, not vibes — on a stack that runs entirely on
   the user's own machines.
6. **Self-configuration with a real safety story.** Conversation-driven setup is bounded by structural rails —
   draft-then-activate, origin taint, frozen inputs, subset rule, no grant self-escalation — not by prompt guidance.

## Resolved cross-doc decisions

Recorded here after reconciling the pillar docs; the pillar texts have been aligned.

1. **Workflow module field name is `source`** (tool-system.md owns the record shape; orchestration.md updated — the two
   docs had swapped names in opposite directions).
2. **Skills load via `load_actions`** — there is no separate `load_skill` action; the body CID pins into the same
   `actions_loaded` event (tool-system.md owns loading; self-configuration.md updated).
3. **Compaction runs are `origin='system'` always**; the initiator
   (`auto-threshold | user | pre-run-guard | agent-requested`) is recorded in the compaction event's `reason` field, not
   the run origin (orchestration.md owns the origin vocabulary; context-and-threads.md updated).
4. **Run-origin vocabulary is canonical** as defined in orchestration.md §1 (`agent`, not `subagent`/`delegation`; `api`
   at least as tainted as `workflow`; `external` reserved) and is used verbatim by grants, consent, and thread lineage
   mapping.
5. **Consent parking differs by run kind by design**: workflow runs park (`status='waiting'`,
   `wait_cbor.reason='consent'`); agent runs never pend — they persist a `consent_pending` tool result and resume via a
   continuation run (self-configuration.md §b, orchestration.md §1).

## Top open questions

The pillar docs carry 38 open questions; the ones that shape everything else:

1. **Cross-account `agent.request`** — all four docs reserve shapes for it (origin `external`, inbox landing, portable
   provenance, receipts). It needs an owner and a design doc before the reservations drift.
2. **Cost tables** — persisted cost needs real per-model pricing with an owner and an update story (orchestration Q6);
   budgets, receipts, and consent cards all consume it.
3. **Publishing authority** — which account/authority publishes the `seed-action-*` and journal schemas (tool-system
   Q1); blocks pinning the `hm://<seed>` placeholders.
4. **Onyx toolchain commitment** — the CLI resolvers and reference-validator fixtures are uncommitted working-tree
   prototypes; committing them is a hard prerequisite for registry and workflow phases (tool-system §g).
5. **Compaction model choice and router cost floor** (context-and-threads Q2/Q3) — the two places a background model
   spend recurs per thread; both need measurement, not argument.
