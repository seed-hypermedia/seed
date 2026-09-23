# Checkmark review — M4-exec, M5-time, answerable parks, and the event bus underneath (`harness/05-exec`)

Status: **implemented, gates green, not live-verified.** `:3051` runs `harness/01-verbs`, which has none of this;
everything below is driven headless against this branch. Cases for Eric are in `~/Code/Seed/HARNESS-TESTING.html` under
**M4 · Execution** and **M5 · Time** — which cover the first three packages, including how to answer a parked run. The
event-bus slice has no case there yet; its steps are in the test script below.

Four packages, in the order they were built: the execution milestone, the time milestone, the affordance that makes a
parked run answerable, and the first slice of M6 — the event bus underneath the trigger surface. The M6 slice is
deliberately partial; see [the design note](../m6-event-bus-design.md) for what is intentionally left for the day
package.

## What changed — M4, execution

- **One runtime contract.** `execute` takes `{runtime: 'ts' | 'python' | 'shell', code, timeout_secs?}`. Each runtime
  has one command (`bun -e`, `python -c`, `sh -c`) and nothing goes through a shell unless the runtime _is_ the shell —
  the sandbox takes an argv array, so code with quotes, newlines, or `$` needs no escaping.
- **TypeScript runs in its own image.** The default rootfs is a python image with no JavaScript runtime, so `ts` is an
  operator opt-in (`SEED_AGENTS_EXEC_TS_IMAGE`, e.g. `oven/bun`). Unset, the runtime is _not offered_: the enum the
  model reads lists only what this server can run, a call asking for `ts` gets the contract back rather than a sandbox
  failure, and `/api/health` reports `codeExecRuntimes`.

  > **Since this review (2026-08-13, commit `5f4484036`):** `ts` is no longer an opt-in — `SEED_AGENTS_EXEC_TS_IMAGE`
  > defaults to `oven/bun`, so TypeScript lambdas run out of the box. An agent told to make itself a tool should not
  > discover its server cannot run half the ABI it was taught. Setting the variable to an explicitly empty value still
  > withholds the runtime, and everything else here — the enum, the contract-back, the health field — is unchanged.

- **Authored tools run.** A `~/tools/<name>` lambda document is callable by name through `call`: input validated against
  its own schema on the way in, return value against its own output schema on the way out. The M2 "not callable yet"
  error path is gone.
- **Failure is loud.** A non-zero exit surfaces the stderr tail, a run that returns nothing names the entry point that
  should have, and a value the tool's own output schema rejects is reported as the tool's bug. Bad _input_ keeps the
  builtin behaviour: it answers with the contract.

### The lambda ABI

A lambda gets one argument — the validated input — and its return value is the result.

```ts
export default async function (input: {text: string}) {
  console.log('counting') // → logs
  return {words: input.text.split(/\s+/).length} // → result
}
```

```python
def main(input):        # async def works too
    return {"words": len(input["text"].split())}
```

Two decisions worth keeping:

- **The value rides a marked stdout line** (`__SEED_TOOL_RESULT__<json>`), not a file. `/workspace` _is_ the agent's
  memory — a result file would litter it and show up in `changedFiles` — and anywhere else dies with the ephemeral
  sandbox before a second exec could read it. The marker keeps `print`/`console.log` usable: unmarked output comes back
  as `logs`.
- **TS source is imported as a `data:text/typescript;base64,…` module**, so it keeps its natural `export default` and
  its type annotations without ever touching the filesystem. Input is embedded as a JSON string literal valid in both
  languages, so no interpolation can escape into code.

### One thing added beyond the brief

A lambda now rides on the **same grant `execute` needs**. Without that, authoring a tool was a way around an owner who
had turned code execution off. Host capability is checked first, so a server that simply cannot run the runtime says
that instead of sending someone to fix a grant.

## What changed — M5, time

- **`ctx.waitForEvent(match, {timeoutMs, label})`** parks a run until something happens: a matching activity-feed event,
  or an explicit `SignalRun`. Resolves with the payload, or `null` on timeout.
- **`SignalRun {runId, signal, payload?}`** is the new protocol action — how a person or another system answers a run
  waiting for something the feed cannot express.
- **`ctx.continueAsNew(state)`** ends a run and starts a successor carrying only the declared state, with a fresh
  journal. Nothing after it in the run executes.
- **`budget-pause`** joins `children`/`timer` as a wait reason: a run past its wall-clock budget pauses for a person
  rather than failing.
- **Parked copy** in the run card: `Paused: out of time budget`, `<label> (until 4:15 PM)`, `Sleeping until 4:15 PM`, or
  the sub-session count. The pill reads **Paused** for a budget pause.

### Design choices

**Event waits get their own table** (`run_event_waits`), not a marker on `agent_triggers`. A trigger is user
configuration — listed and edited in the desktop, owned by an agent, carrying prompts and cooldowns. A wait is transient
run state: created by a running script, deleted the moment it delivers, times out, or its run ends. Sharing the table
would mean filtering that marker out of every trigger listing and mutation forever, and a leaked row would read as a
trigger the user never made.

**Delivery is exactly-once by construction.** The journal write and the requeue happen in one SQLite transaction, so a
signal that loses the race — to a timeout wake, a cancellation, or another signal — writes nothing at all. There is no
window where a run wakes without its payload or receives two.

**Timeouts need no cross-layer write.** The wake clears the wait rows; the replay re-issues `ctx.waitForEvent`, sees its
journaled deadline has passed, and resolves `null`. Same shape `ctx.sleep` already uses. The journal, not the clock, is
the record: a payload that won in the database still wins on a replay after the deadline.

**Continuations link by `continued_from_run_id`, not `parent_run_id`.** A successor is the same work, not a child.
Nesting each generation under the last would grow the tree without bound into the depth limit and would make
cancel-cascade and usage-rollup semantics say something false. The successor keeps the predecessor's _place_ — same
parent, same session, same `parent_tool_call_id` — and the chain is recorded in both directions (`continuedFromRunId`,
and `continuedAsRunId` on the predecessor's output). That last field also drives a correctness fix: **a continued run
must not resolve its parent's delegate call**, because the work is still going; the successor inherited the call and
answers it when it really finishes.

**A budget resume drops the limit rather than extending it.** Otherwise the run re-parks on its next tick and the button
does nothing. Other budget dimensions stay in force; `maxWallMs` is measured from run creation, so sleeps and parks
count — it is about how long work may stay open, not CPU.

**Which waits the clock owns** is one function (`parkWakeAt`): timer and event-timeout write `not_before` so a single
sweep covers both; children and budget pauses are released by something happening, never by time passing.

## What changed — answering a parked run

M5 could show that a run was waiting on a person and give them nowhere to click. This closes that.

- **`useSignalRun`** plus one shared `ParkedRunActions` component, composed by both the pinned card and the expanded
  delegate bubble — a delegated child that is itself parked gets the same affordance, because a wait should look the
  same wherever it is met.
- **`Answer`** sends the signal; **`Answer with data`** reveals a JSON field first; **`Resume`** releases a budget
  pause. `delivered: false` is reported as information ("This run is no longer waiting for that"), not as a failure —
  the run moved on while the card was open, which is normal.

### Design choices

**No new protocol action for the budget release.** `SignalRun` already routes any signal on a budget-paused run to
`resumeBudgetPause` — that wait is not listening for a payload, it is waiting for permission. One mutation covers both
asks, and the protocol took one optional field instead of a whole new action.

**`answerWith` is a tri-state, and that is the whole feature.** `signalMatchesWait` requires the exact signal name when
the wait declared one, so a button that guessed would be silently ignored — the worst kind of failure, because it looks
like it worked. The park now advertises the name that would answer it: the declared signal, `'answer'` for a wait that
named no criteria, and **nothing at all** for a wait watching the activity feed, which no person can answer by hand and
so gets no button. An invariant test asserts across all three shapes that whatever the host offers, `signalMatchesWait`
accepts.

**Collapsed payload field by default.** The common answer is "yes, go ahead"; making _that_ one click is worth more than
making the rare structured reply one click.

## What changed — the event bus underneath (M6, first slice)

Triggers can now answer a waiting run instead of always starting a thread, and a finished run is itself an event. The
trigger _surface_ is untouched: this is the bus under it.

- **Shared activity matcher.** `matchesActivityCriteria(criteria, event)` moved into `activity-triggers.ts` (which
  already owned resource canonicalisation) and `activityMatchesWait` delegates to it. A parked run watching a document
  and a trigger watching the same document must not answer that question two slightly different ways — resource
  comparison in particular is subtle, with versions, queries, and trailing slashes all having to fall away.
- **`run-completed` source.** Fires inline from `#onRunFinalized` — no new monitor and no new poll loop, because
  finalization is already the one moment that knows a run is done. Filters on agent, terminal status, and a
  case-insensitive title substring; deduped on `run:<id>` through the same `INSERT OR IGNORE` the activity path uses.
- **Firing-chain loop guard.** `#triggerAlreadyInChain` walks back through the firings that caused each run (a
  run-completed firing names the run that caused it) up to 8 hops, catching self-loops _and_ longer cycles, and treating
  any chain deeper than the cap as a loop regardless. Two run-completed triggers can otherwise feed each other forever;
  this is the piece that would burn an account overnight.
- **`wake` continuation.** Rides `#deliverRunEvent` unchanged — same transaction, same exactly-once, same "nobody was
  listening" outcome. Without an explicit `runId` it searches the account's parked runs for one this signal satisfies,
  which is what makes "when the doc changes, unblock whoever is waiting on it" expressible without knowing run ids in
  advance. A firing that finds no listener is recorded as `no-listener` rather than deleted: the history is what a user
  debugs with.
- Continuations live in a new nullable `agent_triggers.continuation_cbor` (NULL = `newThread`, which is what every
  existing trigger did), so **nothing migrates tonight**.

### What is deliberately not here

Trigger documents, the draft→active consent step, the migration, and the protocol deletion are the day package — the
sizing call is argued in the design note. `runPlan` and `appendTo` continuations were dropped from this slice rather
than half-built. And the desktop can _render_ a `run-completed` trigger (summary line and icon) but cannot **create**
one: only the API can, until the document editor arrives.

## Gates

- agents **262 pass / 0 fail** across 23 files, `bun run typecheck` clean.
- desktop **315 pass / 0 fail** across 46 files, `tsc` clean except the pre-existing `forge.config.ts(424,5)` osx-sign
  error.
- Schema parity asserted both ways in `sqlite.test.ts` (fresh-init baseline _and_ applied migrations) for
  `run_event_waits`, `runs.continued_from_run_id`, and `runs.parent_tool_call_id`.
- New coverage: `code-exec.test.ts` (ts offered only when configured and run in that image; an unavailable host offers
  no runtimes; the TS wrapper run under **real bun** and the python wrapper under **real python**, sync and async, plus
  the no-`main` error), `verbs.test.ts` (lambda round-trip, both-edge validation, crash/no-value/grant/host gates,
  narrowed execute contract), `workflow-host.test.ts` (park registers a wait, journaled delivery resumes it, timeout
  resolves null, payload beats a passed deadline, continueAsNew), `run-time.test.ts` (new — real runs through the real
  queue: restart-survival, exactly-once signal, timeout vs late signal, activity wake, continuation handoff with a fresh
  journal, budget pause and release), `run-card.test.tsx` (parked-on-event renders Answer and fires the run's OWN signal
  name; budget-pause renders Resume; a note-less pause falls back to plain copy; a run waiting on children or the feed
  offers nothing), `activity-triggers.test.ts` (the shared matcher's semantics: every field a conjunct, `{}` matches
  nothing, canonical resource comparison), `trigger-events.test.ts` (new — a finished run wakes a parked one end to end,
  no-listener recorded honestly, the loop guard proven with a forged chain, and a four-way source-filter matrix).
- Schema parity also asserted for `agent_triggers.continuation_cbor`.

## Eric's five-minute test

1. **Author and call.** "Make yourself a `word_count` tool that takes `{text}` and returns `{words}`, then count the
   words in 'the quick brown fox jumps'." Expect a `write ~/tools/…` row with a CID, then a row for `word_count` that
   _ran_, with `logs` shown separately from `result`.
2. **Break it on purpose.** Have it return `{words: "five"}`. Expect a failure naming its own output schema — not a
   plausible-looking answer.
3. **Turn code execution off** in the agent's tool settings and call it again: expect the owner-grant refusal, not a
   silent run.
4. **Make it wait.** A script child that waits for a signal called `approved` with a label. Expect the card to say what
   it is waiting for, hold no worker, and survive a server restart.
5. **Answer it from the card.** The parked run shows **Answer** — one click wakes it. Try _Answer with data_ with
   `{"approved": true}` and watch the script receive it. Click Answer twice: the second time says the run is no longer
   waiting, rather than pretending.
6. **Let a budget pause happen.** Expect the **Paused** pill and `Paused: out of time budget`, and **Resume** as the
   only way out.
7. **Chain two automations.** Create a trigger with source `run-completed` and continuation
   `{kind: 'wake', signal: 'go'}` (API only for now), start a script child that waits for `go`, then let any run finish.
   Expect the waiting run to resume with `source: 'trigger'` — and expect the trigger _not_ to fire on the run it
   caused.

## Known gaps

- **No desktop form for a `run-completed` trigger.** The card renders one that exists, but creating one is API-only
  until the trigger-document editor lands with the day package.
- **Activity matching is coarse**: `{eventType, resource, author}`, now through one shared matcher. Anything richer
  belongs with the rest of M6.
- **The shared matcher has one caller today.** Its second consumer is `document-change`, which comes with the day
  package; for now the extraction is held honest by the semantics tests rather than by two live callers.
- **`ts` is off by default** because the shipped image has no bun. Turning it on in prod is an infra change (image with
  `bun` on PATH), not a code change.

  > **Since this review (2026-08-13):** no longer a gap — the `ts` image defaults to `oven/bun` (see the note in the M4
  > section). A prod host still has to be able to pull that image, but nothing needs configuring for the runtime to be
  > offered.

- **Nested-session delegate resolution** (from F3) still keeps its transcript-link fallback: a delegate inside a child
  session has no root run in its own session. Optional follow-up, deferred by the lead.

## Since this review (2026-08-13)

- **The "not live-verified" status is partly retired.** The M4 lambda path was live-verified against real microVMs — the
  `word_count` tool from a failing session now returns its result in both `python` and `ts` — and that session's two
  sandbox bugs are written up in `HARNESS-TESTING.html` under M4.1b. Getting there took pinning microsandbox to 0.6.8 (a
  0.6.8 install elsewhere had migrated the shared `~/.microsandbox` database and locked out every 0.6.6 copy) and
  speaking its `NetworkPolicy.fromProfiles(['public'])` dialect, with the old `nonLocal()` kept as a fallback for
  version-skewed staged runtimes. The M5 and event-bus packages remain gate-verified rather than live-verified.
- **The obligations contract landed on top of this work**, with its own live check: `e2e/scripted-provider.ts` plus
  `e2e/obligations-live-check.ts` drive a real server through both the cooperative and the stubborn shape. A run that
  ends owing an undelivered typed result or unfinished plan steps is asked once with the whole debt, up to three times,
  and then ends honestly carrying `unmetObligations` — nothing is ticked off on the agent's behalf.
- Still true: the desktop cannot create a `run-completed` trigger, the shared matcher still has one live caller, and the
  nested-session delegate fallback is still the transcript link.
