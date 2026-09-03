---
name: "M6 — The event bus: implementation design"
summary: "Status: the night slice landed; the day package is still design. Written while holding for F4, from the M6 section of plan.md and from the M5 machinery that…"
---
Status: **the night slice landed; the day package is still design.** Written while holding for F4, from the M6 section of `plan.md` and from the M5 machinery that M6 should reuse rather than reinvent. <!-- id:rkd_rsAm -->

As of 2026-08-13 on `harness/full`, the "tonight" subset from [Sizing](#sizing) is built (commit `b7596f83c`, reviewed in [`reviews/05-exec-time.md`](./agent-harness-review-05-exec-time.md)): the `run-completed` source, the `wake` continuation, the shared activity matcher, and the firing-chain loop guard, all riding the existing `agent_triggers` rows. <!-- id:TOc56lER -->

**Update 2026-08-18/19:** a second slice landed — the `~/triggers/**` **verb surface**, still on the existing rows rather than documents. `read ~/triggers/`, `read ~/triggers/<name>`, and `write ~/triggers/<name>` exist, and the agent creates, edits, enables, disables, and deletes its own triggers directly — **the draft→active consent proposed below was built and then removed on the owner's direction** (2026-08-19): agents manage their own triggers without an approval step, and `security.md` records the threat-model tradeoff. Alongside it: `read ~/self` and the `thread:` listing/search, for self-knowledge and cross-session browsing. **Still unbuilt from the day package:** the content-addressed document form (CID per trigger), the `document-change` source, `appendTo`/`runPlan`, the migration off `agent_triggers`, the protocol deletion, and firing-history-as-runs. Each section below is marked with what it actually got. The design text itself is unchanged — read its consent sections as historical design, not as the plan of record. <!-- id:jTat2j5H -->

**Sizing up front: this is a day package, not a night one.** See [Sizing](#sizing) for the split — there is a coherent \~4 hour subset (the bus underneath) that can land tonight and leaves the system strictly better even if the document surface never follows. <!-- id:Qi8gI-10 -->

# What M6 is <!-- id:cSWVgegB -->

Today a trigger is a row created by a protocol action, matched by a monitor, and it can do exactly one thing: start a new thread with a prompt. M6 turns it into a **document in the Space** that binds an **event source** to a **continuation** — which makes "when X happens, do Y" a thing the agent can write for itself, the user can read and edit as text, and the system can treat uniformly. <!-- id:2ERVSTup -->

The three moving parts: <!-- id:R-mNuS1l -->

``` <!-- id:LXtLAkmK -->
source (something happened)  →  trigger document (a rule, in ~/triggers/)  →  continuation (what to do)
```

# 1. The trigger document <!-- id:WwxII73T -->

<!-- id:UHCnfiuO -->
> **Not built.** No `~/triggers/**`, no `TriggerDocument` type, no draft/active/paused lifecycle, no `ActivateTrigger`. <!-- id:LFZflYpW -->
> Triggers are still `agent_triggers` rows with an `enabled` flag. The consent argument below is untouched and still <!-- id:MppCAF5r -->
> governs the day package. <!-- id:fmFXdgvm -->

`~/triggers/<name>.trigger`, stored the way tool documents are stored (per-agent row, canonical DAG-CBOR, CID over the bytes), read and written through the `read`/`write` verbs like everything else in the Space. <!-- id:1gYE_neP -->

```ts <!-- id:8dXxM73R -->
export type TriggerDocument = {
  name: string
  /** One line for the Space index. */
  summary: string
  /** draft: matched against nothing. active: live. paused: matched, but firing is suspended. */
  status: 'draft' | 'active' | 'paused'
  source: TriggerSource
  continuation: TriggerContinuation
  /** Firing limits; exceeding one flips status to 'paused' and records why. */
  budget?: {maxPerHour?: number; maxPerDay?: number; maxTotal?: number}
  /** Set by the server when a budget pauses it, cleared on re-activation. */
  pausedReason?: string
  /** Minimum gap between firings, carried over from agent_triggers.cooldown_ms. */
  cooldownMs?: number
}
```

**Draft → active is the consent step.** An agent may `write ~/triggers/foo.trigger` freely, but a document written by the agent lands as `status: 'draft'` no matter what the agent put in the field, and only a **user action** can make it active. That rule is the whole security story of this milestone: a trigger is standing authority to act without a person present, and an agent that could grant itself that authority — including by writing one on the strength of a web page it just read — is an agent with an unbounded prompt-injection surface. The server enforces it in the write path (agent actor ⇒ status forced to draft, and a `status` change from draft is rejected); the desktop provides the activation affordance (the card grammar's question state); the user's own `write` through the symmetric log is a user action and may set `active` directly. <!-- id:dUtXtXhB -->

# 2. Sources <!-- id:FzmK2aC3 -->

<!-- id:NIPT00yv -->
> **Half built.** `run-completed` shipped exactly as typed here, on `AgentTriggerSource`, firing inline from <!-- id:dxK3hHYG -->
> `#onRunFinalized` with the firing-chain loop guard (`#triggerAlreadyInChain`, `TRIGGER_CHAIN_MAX_HOPS = 8`). <!-- id:QZRAc8ei -->
> `document-change` is **not** built — but its prerequisite is: `matchesActivityCriteria` now lives in <!-- id:7E5RbHby -->
> `activity-triggers.ts` and `activityMatchesWait` delegates to it, so the second consumer only has to call it. Until <!-- id:xEjlEP-m -->
> that consumer exists the extraction is held honest by semantics tests rather than by two live callers. <!-- id:X-7Cy7JO -->

The shipped four keep their shapes exactly (`document-comment`, `user-mention`, `site-update`, `schedule`) so migration is a re-encode, not a rewrite. Two are added: <!-- id:FSOBuOCW -->

```ts <!-- id:21MHS12v -->
| {type: 'document-change'; resource: string; includeChildren?: boolean}
| {type: 'run-completed'; agentId?: string; status?: 'succeeded' | 'failed' | 'canceled'; titleMatch?: string}
```

<!-- id:l4xvMW3q -->
- **`document-change`** watches an `hm://` path (or a Space directory) for new versions. On the activity feed this is a `Ref`/blob event whose resource canonicalises to the watched path — which is _the same question_ `run-events.ts:activityMatchesWait` already answers for M5's event waits. It should be one matcher used twice, not two matchers that agree by luck: extract `matchesActivityCriteria(criteria, event)` and have both the wait matcher and the trigger source matcher call it. (M5 already pays this debt down once — `answerSignalFor` and `signalMatchesWait` are held together by an invariant test — and the same technique applies here.) <!-- id:K3JJ9O0f -->
- **`run-completed`** is not an activity event at all. It fires from `#onRunFinalized`, which already runs for every terminal run, and it is what makes chains possible ("when the nightly research run finishes, draft the summary"). It needs a loop guard: a run started BY a trigger carries `trigger_firing_id`, so a `run-completed` trigger must skip runs whose firing chain already contains it. Without that, two triggers can ping-pong forever. <!-- id:qSmz9z2l -->

# 3. Continuations <!-- id:vU546iBN -->

<!-- id:-Iwps9pY -->
> **Two of four built**, on a nullable `agent_triggers.continuation_cbor` (NULL = `newThread`), so nothing migrated. <!-- id:8fsummlg -->
> `newThread` is `{kind: 'newThread'}` with no `brief` — the trigger's existing `prompt` column still carries it. `wake` <!-- id:7NRj18Rb -->
> shipped as `{kind: 'wake'; signal: string; runId?: string; payload?: unknown}`: `signal` is the required half and <!-- id:Ee5XDH21 -->
> `runId` the optional one, which is the inverse of the sketch below and is what makes "unblock whoever is waiting on <!-- id:TkRo7Q8r -->
> this" expressible. It rides `#deliverRunEvent` unchanged, as designed. `appendTo` and `runPlan` were dropped from the <!-- id:ibVulSOR -->
> slice rather than half-built — and `~/plans/` still does not exist, exactly as this section warned. <!-- id:utQUBtzE -->

```ts <!-- id:DbNaV-19 -->
export type TriggerContinuation =
  | {kind: 'newThread'; brief: string | AgentPromptBlock[]} // today's only behavior
  | {kind: 'appendTo'; sessionId: string; message: string | AgentPromptBlock[]}
  | {kind: 'wake'; runId: string; signal: string; payload?: unknown}
  | {kind: 'runPlan'; plan: string} // ~/plans/<name>
```

`wake` is the one that pays for M5 twice. **It rides `#deliverRunEvent` unchanged**: same transactional journal-write-plus-requeue, same exactly-once guarantee, same "not delivered is a normal outcome" semantics. A trigger that wakes a parked run is, mechanically, a signal with a different sender — which is exactly the shape M5 landed. The only new code is resolving _which_ run: a static `runId` works for a specific park, and `{signal}` alone should mean "any run of this agent parked on this signal", resolved through `listAccountEventWaits` + `signalMatchesWait` — again already written. <!-- id:LoxbKJqV -->

`runPlan` needs `~/plans/` to exist as a document kind. If M6 ships before plans-as-documents, this continuation should be **dropped from the first cut** rather than half-built against a directory that does not exist yet. <!-- id:V626m5-z -->

# 4. Firing history as runs <!-- id:fWJwq4u2 -->

<!-- id:FKEQj-Aa -->
> **Not built.** `trigger_firings` is still the bookkeeping table and still carries the dedup key; a `wake` firing that <!-- id:MUrGBo-d -->
> finds nobody listening is recorded there as `status: 'no-listener'` rather than deleted, which keeps the intent of <!-- id:VhSTp0iI -->
> this section — history a user can debug with — without the table move. <!-- id:Ii2AY7gT -->

Every firing becomes a run row, which deletes a concept: <!-- id:z8oOntZM -->
  - `newThread` already produces a run; today the `trigger_firings` row is a parallel bookkeeping table with its own status/error columns. <!-- id:X8f_Sl0V -->
  - The firing key (`activity_key`, the dedup identity) moves onto the run as `trigger_firing_key TEXT` with a `UNIQUE (account_id, trigger_id, trigger_firing_key)` index — the same exactly-once-per-event property, expressed once. <!-- id:uTYdz920 -->
  - `wake` firings produce no run of their own; they journal into the woken run, which is the correct record — the history you want to see is _in_ the run that was waiting. <!-- id:14ukJKtK -->

`trigger_firings` therefore stops being written and becomes read-only legacy for one release. The desktop "firing history" list becomes a run list filtered by trigger, beside the document — which is the run card it already knows how to render. <!-- id:NtIXIUzZ -->

# 5. Protocol deletions <!-- id:SGKrLJaF -->

<!-- id:0xc289RT -->
> **Not built.** Every action in the table below still exists. What the slice added instead is one optional field: <!-- id:RMfrduZD -->
> `continuation` on `AgentTriggerInput` and `AgentTriggerPatch`. <!-- id:ixRM1Jyw -->

Delete, with no aliases (breaking changes are preferred over dual paths): <!-- id:HyAfw3ga -->

<!-- id:IoZfCkaL -->
| Deleted <!-- col:zwgQWiYL --> | Replaced by <!-- col:ueP_a3pR --> <!-- id:R-B5rg6l --> |
| --- | --- |
| `CreateAgentTrigger` / `UpdateAgentTrigger` / `DeleteAgentTrigger` | `write ~/triggers/<name>.trigger` (+ `{delete: true}`) <!-- id:udgVs2H9 --> |
| `ListAgentTriggers` / `GetAgentTrigger` | `read ~/triggers/` and `read ~/triggers/<name>.trigger` <!-- id:vrtHdJiX --> |
| `AgentTriggerInput` / `AgentTriggerPatch` | the document schema <!-- id:iman5Io1 --> |
| `trigger_firings` status plumbing | run rows <!-- id:1Spy4ff3 --> |

One action is **added**, because activation is a user gesture and not a document write: `ActivateTrigger {agentId, name, active: boolean}`. It is the consent record, and keeping it a distinct action (rather than a `write` with a magic field) is what lets the server refuse the agent cleanly and lets the desktop show a real confirmation. <!-- id:gnPO0EBt -->

`AgentTriggerInfo` survives as a _derived_ read model (document + last-fired + budget state) so the desktop list keeps a stable shape. <!-- id:nm4yvSS6 -->

# 6. Migration and back-compat <!-- id:EsKo3uaN -->

<!-- id:Jft3jfrf -->
> **Not built, and deliberately so** — the slice was designed to need no migration. The only schema change is <!-- id:w3L9xj3u -->
> `ALTER TABLE agent_triggers ADD COLUMN continuation_cbor BLOB`, asserted for parity both ways in `sqlite.test.ts`. <!-- id:9akrFawA -->
> Everything below is still the plan for the day package, and point 5 (carrying the dedup identity forward) is still the <!-- id:bAw3QbIw -->
> step most likely to be skipped. <!-- id:8al1eTlT -->

Existing `agent_triggers` rows are real user configuration on running installs; they must not be lost, and a half-migrated state must not fire twice. <!-- id:PATQnEmr -->
  1. **Migration (newest-first, per the established pattern)** creates `trigger_documents` — or, more likely, _reuses_ `tool_documents` renamed to `space_documents` with a `kind` column, since the two tables would otherwise be identical (name, kind, cid, doc_cbor, enabled, timestamps). That rename is the honest move but it touches every M2 call site; if the night is short, a parallel `trigger_documents` table with a TODO to converge is acceptable and reversible._ <!-- id:LtEhPeSV -->
  2. **Back-fill in the same migration**: every `agent_triggers` row becomes a document — `name` from the row (slugified, deduped), `source` re-encoded as-is, continuation `{kind: 'newThread', brief: <prompt>}`, `status` from `enabled` (an enabled row migrates to `active`: it already had consent), `cooldownMs` carried over. <!-- id:4OjlV1WU -->
  3. **The old table is left in place, unread**, for one release. Deleting it in the same migration makes a rollback lose data; leaving it makes a rollback merely lose the new triggers. <!-- id:VrYIzOgz -->
  4. **The monitors read documents only.** They must never read both, or a migrated trigger fires twice for one event. <!-- id:Lw0oH9MB -->
  5. Dedup identity carries: the back-fill copies `trigger_firings.activity_key` values forward into the new unique index so a migrated trigger does not re-fire for events it already handled. This is the one migration detail most likely to be skipped and most likely to hurt — a user waking up to twelve duplicate threads is the failure mode. <!-- id:IDL-aJOF -->

# 7. Monitor changes <!-- id:zYTkkFuJ -->

> **Built where it applies.** `#onRunFinalized` gained the `run-completed` scan with no new monitor and no new poll <!-- id:CdKXvv32 -->
> loop, and the activity path still delivers to parked runs before scanning triggers. The document-sourced scan and the <!-- id:1OAm2VWp -->
> `ScheduleMonitor` change wait on the document work. Budget accounting is not built (there are no per-trigger budgets <!-- id:dmRpzuJ9 -->
> yet). <!-- id:d7G8dHEG -->
  - `ActivityMonitor` — unchanged in shape. `#processActivityEvent` gains a document-sourced trigger scan beside the run-wait delivery M5 added (which already runs first, and should keep running first: work already underway beats work about to start). <!-- id:CMsmT8_g -->
  - `ScheduleMonitor` — reads schedule sources from documents; `dueOccurrence` is untouched. <!-- id:dBqidTZA -->
  - **New**: `#onRunFinalized` gains the `run-completed` scan. No new monitor, no new poll loop. <!-- id:HFIWjQ-6 -->
  - Budget accounting is a count of runs carrying this trigger's id in a window — no counters to keep in sync, and it survives restarts for free. <!-- id:FkXFcl0U -->

# 8. Test plan <!-- id:NiP6v_dh -->

<!-- id:brtH7ysd -->
> **Built for the slice.** `activity-triggers.test.ts` covers the shared matcher's semantics (every field a conjunct, <!-- id:GcofQgOw -->
> `{}` matches nothing, canonical resource comparison) and `trigger-events.test.ts` (new) drives a real service: a <!-- id:0JRlodlC -->
> finished run wakes a parked one end to end, a no-listener firing is recorded honestly, the loop guard is proven with a <!-- id:AOa1jgeB -->
> forged chain, and a four-way source-filter matrix. `trigger-documents.test.ts`, the migration test, the <!-- id:oyICjeZI -->
> document-change invariant test, and the desktop cases belong to the day package. <!-- id:lxOJAgnU -->

Mirrors how M5 was gated: unit tests for the pure parts, and a service-level file that drives the real thing. <!-- id:H8SCgBEF -->
  - `trigger-documents.test.ts` — schema validation matrix, CID stability, draft-forcing on agent writes, `ActivateTrigger` as the only path to `active`, budget pause and re-activation. <!-- id:mYl4_8WO -->
  - `matchesActivityCriteria` shared-matcher tests, plus an **invariant test** that a `document-change` source and an M5 activity wait accept exactly the same events (the same technique that holds `answerSignalFor`/`signalMatchesWait` together). <!-- id:J_48k-g0 -->
  - `trigger-continuations.test.ts` — the four-way matrix against a real service: `newThread` creates a session and a run; `appendTo` posts into an existing thread; `wake` delivers into a parked run **exactly once** and refuses when the run moved on (reuse M5's `run-time.test.ts` harness wholesale); `runPlan` starts a run from a saved plan. <!-- id:2n-w9VTR -->
  - **Loop guard**: a `run-completed` trigger whose own continuation produces a run does not re-fire on it. This is the test that stops a runaway at 3am. <!-- id:EAKTVmf7 -->
  - **Migration test** in `sqlite.test.ts`, both directions of the established pattern: fresh-init baseline has the table; an old database with two `agent_triggers` rows and one recorded firing migrates to two documents with consent preserved and the firing key carried. <!-- id:nuBMZZmv -->
  - Desktop: trigger list renders from documents; the activation affordance calls `ActivateTrigger`; firing history renders as run records. <!-- id:aA7S4Rwj -->

# Sizing <!-- id:PXPops0J -->

**Day package.** The document schema, the lifecycle, two new sources, four continuations, a data-preserving migration, a protocol deletion, and the desktop surface that follows the deletion is more than one night — and the migration is the part that must not be rushed, because it is the one step that can destroy a user's existing automations. <!-- id:_wc7czv1 -->

The honest split: <!-- id:bZ3sPYl5 -->
  - **Tonight (\~4h, self-contained, no protocol deletions):** the `wake` continuation and `run-completed` source wired to the _existing_ `agent_triggers` rows, plus the shared activity matcher extraction and its invariant test. That is the event _bus_ — triggers that can wake parked runs and chain off finished ones — underneath the surface that M6 will later replace. It leaves the system strictly better even if the document work slips, and none of it is thrown away: the document cut re-points the same continuation dispatcher at a different source of rules. <!-- id:hewRvis3 -->
  - **Day package:** documents, draft→active consent, the migration, the protocol deletion, and the desktop surface. <!-- id:HP3KPLEw -->

I would not start the migration at 4am. I would start the bus. <!-- id:WKt9SNAK -->

**What happened:** the bus was started, and it landed — `run-completed`, `wake`, the shared matcher, the loop guard, on the existing rows, with nothing thrown away. The day package below is untouched and still the next move: documents, draft→active consent, the migration, the protocol deletion, and the desktop surface (including a create form for a `run-completed` trigger, which the API can make today but the UI can only render). <!-- id:wmfFSNfD -->
