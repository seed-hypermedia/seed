# Checkmark review — M4-exec + M5-time (`harness/05-exec`)

Status: **implemented, gates green, not live-verified.** `:3051` runs `harness/01-verbs`, which has
neither milestone; everything below is driven headless against this branch. Cases for Eric are in
`~/Code/Seed/HARNESS-TESTING.html` under **M4 · Execution** and **M5 · Time**.

## What changed — M4, execution

- **One runtime contract.** `execute` takes `{runtime: 'ts' | 'python' | 'shell', code,
  timeout_secs?}`. Each runtime has one command (`bun -e`, `python -c`, `sh -c`) and nothing goes
  through a shell unless the runtime *is* the shell — the sandbox takes an argv array, so code with
  quotes, newlines, or `$` needs no escaping.
- **TypeScript runs in its own image.** The default rootfs is a python image with no JavaScript
  runtime, so `ts` is an operator opt-in (`SEED_AGENTS_EXEC_TS_IMAGE`, e.g. `oven/bun`). Unset, the
  runtime is *not offered*: the enum the model reads lists only what this server can run, a call
  asking for `ts` gets the contract back rather than a sandbox failure, and `/api/health` reports
  `codeExecRuntimes`.
- **Authored tools run.** A `~/tools/<name>` lambda document is callable by name through `call`:
  input validated against its own schema on the way in, return value against its own output schema
  on the way out. The M2 "not callable yet" error path is gone.
- **Failure is loud.** A non-zero exit surfaces the stderr tail, a run that returns nothing names
  the entry point that should have, and a value the tool's own output schema rejects is reported as
  the tool's bug. Bad *input* keeps the builtin behaviour: it answers with the contract.

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

- **The value rides a marked stdout line** (`__SEED_TOOL_RESULT__<json>`), not a file. `/workspace`
  *is* the agent's memory — a result file would litter it and show up in `changedFiles` — and
  anywhere else dies with the ephemeral sandbox before a second exec could read it. The marker keeps
  `print`/`console.log` usable: unmarked output comes back as `logs`.
- **TS source is imported as a `data:text/typescript;base64,…` module**, so it keeps its natural
  `export default` and its type annotations without ever touching the filesystem. Input is embedded
  as a JSON string literal valid in both languages, so no interpolation can escape into code.

### One thing added beyond the brief

A lambda now rides on the **same grant `execute` needs**. Without that, authoring a tool was a way
around an owner who had turned code execution off. Host capability is checked first, so a server
that simply cannot run the runtime says that instead of sending someone to fix a grant.

## What changed — M5, time

- **`ctx.waitForEvent(match, {timeoutMs, label})`** parks a run until something happens: a matching
  activity-feed event, or an explicit `SignalRun`. Resolves with the payload, or `null` on timeout.
- **`SignalRun {runId, signal, payload?}`** is the new protocol action — how a person or another
  system answers a run waiting for something the feed cannot express.
- **`ctx.continueAsNew(state)`** ends a run and starts a successor carrying only the declared state,
  with a fresh journal. Nothing after it in the run executes.
- **`budget-pause`** joins `children`/`timer` as a wait reason: a run past its wall-clock budget
  pauses for a person rather than failing.
- **Parked copy** in the run card: `Paused: out of time budget`, `<label> (until 4:15 PM)`,
  `Sleeping until 4:15 PM`, or the sub-session count. The pill reads **Paused** for a budget pause.

### Design choices

**Event waits get their own table** (`run_event_waits`), not a marker on `agent_triggers`. A trigger
is user configuration — listed and edited in the desktop, owned by an agent, carrying prompts and
cooldowns. A wait is transient run state: created by a running script, deleted the moment it
delivers, times out, or its run ends. Sharing the table would mean filtering that marker out of
every trigger listing and mutation forever, and a leaked row would read as a trigger the user never
made.

**Delivery is exactly-once by construction.** The journal write and the requeue happen in one SQLite
transaction, so a signal that loses the race — to a timeout wake, a cancellation, or another signal
— writes nothing at all. There is no window where a run wakes without its payload or receives two.

**Timeouts need no cross-layer write.** The wake clears the wait rows; the replay re-issues
`ctx.waitForEvent`, sees its journaled deadline has passed, and resolves `null`. Same shape
`ctx.sleep` already uses. The journal, not the clock, is the record: a payload that won in the
database still wins on a replay after the deadline.

**Continuations link by `continued_from_run_id`, not `parent_run_id`.** A successor is the same
work, not a child. Nesting each generation under the last would grow the tree without bound into the
depth limit and would make cancel-cascade and usage-rollup semantics say something false. The
successor keeps the predecessor's *place* — same parent, same session, same `parent_tool_call_id` —
and the chain is recorded in both directions (`continuedFromRunId`, and `continuedAsRunId` on the
predecessor's output). That last field also drives a correctness fix: **a continued run must not
resolve its parent's delegate call**, because the work is still going; the successor inherited the
call and answers it when it really finishes.

**A budget resume drops the limit rather than extending it.** Otherwise the run re-parks on its next
tick and the button does nothing. Other budget dimensions stay in force; `maxWallMs` is measured
from run creation, so sleeps and parks count — it is about how long work may stay open, not CPU.

**Which waits the clock owns** is one function (`parkWakeAt`): timer and event-timeout write
`not_before` so a single sweep covers both; children and budget pauses are released by something
happening, never by time passing.

## Gates

- agents **255 pass / 0 fail**, `bun run typecheck` clean.
- desktop **311 pass / 0 fail** across 46 files, `tsc` clean except the pre-existing
  `forge.config.ts(424,5)` osx-sign error.
- Schema parity asserted both ways in `sqlite.test.ts` (fresh-init baseline *and* applied
  migrations) for `run_event_waits`, `runs.continued_from_run_id`, and `runs.parent_tool_call_id`.
- New coverage: `code-exec.test.ts` (ts offered only when configured and run in that image; an
  unavailable host offers no runtimes; the TS wrapper run under **real bun** and the python wrapper
  under **real python**, sync and async, plus the no-`main` error), `verbs.test.ts` (lambda
  round-trip, both-edge validation, crash/no-value/grant/host gates, narrowed execute contract),
  `workflow-host.test.ts` (park registers a wait, journaled delivery resumes it, timeout resolves
  null, payload beats a passed deadline, continueAsNew), `run-time.test.ts` (new — real runs through
  the real queue: restart-survival, exactly-once signal, timeout vs late signal, activity wake,
  continuation handoff with a fresh journal, budget pause and release).

## Eric's two-minute test

1. **Author and call.** "Make yourself a `word_count` tool that takes `{text}` and returns
   `{words}`, then count the words in 'the quick brown fox jumps'." Expect a `write ~/tools/…` row
   with a CID, then a row for `word_count` that *ran*, with `logs` shown separately from `result`.
2. **Break it on purpose.** Have it return `{words: "five"}`. Expect a failure naming its own output
   schema — not a plausible-looking answer.
3. **Turn code execution off** in the agent's tool settings and call it again: expect the
   owner-grant refusal, not a silent run.
4. **Make it wait.** A script child that waits for a signal called `approved` with a label. Expect
   the card to say what it is waiting for, hold no worker, and survive a server restart.
5. **Let a budget pause happen.** Expect the **Paused** pill and `Paused: out of time budget`, and
   nothing but a human releasing it.

## Known gaps

- **No desktop affordance for `SignalRun`.** A parked run shows its label, but the only way to
  answer it today is a signed envelope over the same path `agents/e2e/live-gate.ts` uses. A
  one-click approve/release on the parked card is the obvious next UX package — worth deciding
  before M6.
- **Activity matching is coarse**: `{eventType, resource, author}`, canonicalised the same way
  trigger sources are. Anything richer belongs with M6's event bus, not here.
- **`ts` is off by default** because the shipped image has no bun. Turning it on in prod is an infra
  change (image with `bun` on PATH), not a code change.
- **Nested-session delegate resolution** (from F3) still keeps its transcript-link fallback: a
  delegate inside a child session has no root run in its own session. Optional follow-up, deferred
  by the lead.
