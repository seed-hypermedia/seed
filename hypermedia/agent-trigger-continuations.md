---
name: "Trigger continuations: tool and script"
summary: "A trigger's continuation is what a firing does. Until now every firing either started a thread (a model reads the prompt plus the event) or woke a parked…"
---
> Shipped 2026-08-30. Extends the `continuation` slot every trigger already had (`newThread`, `wake`).

A trigger's **continuation** is what a firing does. Until now every firing either started a thread (a model reads the
prompt plus the event) or woke a parked run. Two more kinds run **without a model**:

| kind         | what fires                                                                                  | model involved                                                                      |
| ------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `newThread`  | a thread whose first message is the prompt + `<trigger_context>`                            | always                                                                              |
| `wake`       | a signal delivered into a run parked on `ctx.waitForEvent`                                  | never (the run decides)                                                             |
| **`tool`**   | one tool call: `ctx.call(tool, input)` inside a one-line workflow run                       | never, unless `onFailure: 'thread'` and it fails                                    |
| **`script`** | a workflow module (`export default async function (input, ctx)`) as a headless workflow run | only when the script calls `ctx.delegate`, or on failure with `onFailure: 'thread'` |

The pattern this enables: an agent authors a tool (`write ~/tools/<name>`), wires a webhook to it
(`continuation: {kind: 'tool', tool, input: {payload: '$event.payload'}, onFailure: 'thread'}`), and from then on
deliveries run its code directly; a model is only spun up when the code fails.

## Data model

`TriggerContinuation` (`agents/protocol/src/index.ts`):

```ts
| {kind: 'tool'; tool: string; input?: unknown; onFailure?: 'none' | 'thread'}
| {kind: 'script'; script: string; input?: unknown; onFailure?: 'none' | 'thread'}
```

- `tool` — `read`, `write`, any service callable (`search`, `web_search`, `execute`, `navigate`) or one of the agent's
  enabled `lambda` / `mcp` tool documents. Checked **when the trigger is written**
  (`assertTriggerContinuationCallable`), since a headless firing has nobody to read a "no such tool" error.
- `input` for `tool` — omitted: the tool receives the trigger event itself. Given: a JSON template; string values
  `"$event"` and `"$event.<path>"` are replaced from the event (`resolveTriggerInputTemplate`). For a webhook the posted
  JSON is `"$event.payload"`.
- `script` — linted with the workflow linter at write time (no `Date`, `Math.random`, timers, `fetch`, imports; exactly
  one `export default`); ≤ `WORKFLOW_SOURCE_MAX_BYTES`. `ctx.input` is `{event, input, trigger: {id, name, firingId}}`.
- `prompt` becomes optional for these kinds; when omitted a default recovery prompt is stored
  (`DEFAULT_HEADLESS_TRIGGER_PROMPT`), because the prompt is only used to escalate.

Storage is unchanged (`agent_triggers.continuation_cbor`). One column was added: `trigger_firings.run_id` — the headless
run a firing started (`session_id` stays for thread firings).

## Runtime

Every fire site (webhook, schedule, activity feed, run-completed) calls
`#startTriggerContinuationRun(accountId, trigger, firingId, activity)` before it would create a session. For a headless
continuation it enqueues:

```
{id: `firing-${firingId}`, kind: 'workflow', origin: 'trigger', agentId, triggerFiringId,
 title: `${trigger.name} — ${activitySummary}`, sourceText, sourceCid, input: {input}, queue: 'background', maxAttempts: 1}
```

with **no session and no parent run** — the run is the record. The `tool` kind uses a fixed one-line source
(`TRIGGER_TOOL_CONTINUATION_SOURCE`) so the call rides the same journaled `ctx.call` path a script would; tools
available to the run are exactly what any workflow run gets (read/write, the agent's enabled callables, its tool
documents). The deterministic run id makes a duplicate firing a no-op enqueue, the same property
`#dispatchTriggerSession` relies on.

Firing status vocabulary, now: `created` (thread started) · `running` → `succeeded` (headless) · `delivered` /
`no-listener` (wake) · `error` · `escalated` (headless run failed and a recovery thread was started). `#onRunFinalized`
writes `succeeded` only for the firing row whose `run_id` is the finishing run, so thread firings keep their historical
`created`.

**Escalation.** When a headless run fails and the continuation has `onFailure: 'thread'`,
`#escalateFailedContinuationRun` creates a session titled `<trigger> — automation failed: <summary>`, sets the firing to
`escalated` with that `session_id`, and dispatches the ordinary trigger thread with an extra
`automationFailure: {kind, tool?, runId, error, code?}` inside `<trigger_context>` plus an instruction to
`read run:<id>` and recover. The escalation run id is `firing-<id>-escalation` (the plain id is already taken by the
failed run).

`drainTriggerSessions()` still covers headless runs (it awaits the run queue going idle), so tests can observe them the
same way.

## What the agent is told

- `read ~/triggers/` — the contract now documents all four kinds, the `$event` template, `onFailure`, and the
  author-a-tool-then-wire-a-webhook pattern; every listing entry carries `does` (a one-line continuation summary) next
  to `when`.
- `read ~/triggers/<name>` — summary reads `<when> → <does>`; `recentFirings` carry `runId` and a `run:<id>` address;
  `read run:<id>` now includes the run's `output`.
- `~/tools/write/triggers` (the write guide) has a webhook → tool → escalate example.
- `read ~/self` guidance mentions the model-free option.
- A recovery thread's first message says why it exists and where the failed run's journal is.

## Desktop

- Create dialog and trigger page: a **"When it fires"** selector (`TriggerContinuationFields` in `trigger-types.tsx`)
  with a tool picker fed by `ListAgentTools`, a JSON input template field (draft text is only propagated when it
  parses), a script editor, a signal field for `wake`, and the on-failure toggle. The prompt is relabeled "Recovery
  prompt" for headless kinds.
- Trigger page: **"Recent firings"** (`GetAgentTriggerResponse.firings`, newest first, ≤25) with status, event summary,
  error, "Open thread", and an inline `RunRecordCard` for headless runs — the first UI surface for a run that has no
  session.

## Limits and caveats

- Headless runs have `maxAttempts: 1`: no automatic retry. Idempotency of an interrupted `ctx.call` is the same open
  item as for script children (`roadmap.md`): a call journaled without a result re-executes after a crash.
- `assertTriggerContinuationCallable` checks the registry and the agent's tool documents, not `definition.tools`
  narrowing; a tool the agent definition excludes fails at run time with the workflow's usual "not available in this
  workflow" error, recorded on the firing.
- `ctx.delegate` from a trigger script creates a top-level session (there is no ancestor session to nest under) —
  visible in the agent's session list and from the run card.
- The `execute` tool is callable from a trigger script only where the server offers code execution.

## Tests

`trigger-events.test.ts › headless trigger continuations` (tool with event input, script `ctx.input` shape, quiet
failure vs. escalation thread), `main.test.ts › webhook tool continuation` (`$event.payload` template through the HTTP
path, `GetAgentTrigger.firings`),
`verbs.test.ts › headless continuations are validated when written and explained when read`, and the `run_id` column
assertions in `sqlite.test.ts`.
