# Troubleshooting

This document is a quick diagnostic guide. More operational detail is in [Operations](./operations.md).

## Streaming response does not appear while model is typing

Expected desktop log chain:

```text
[agents/ws] subscribe sent
[agents/ws] subscribed event
[agents/ui] sending session message
[agents/ws] partial event
[agents/ws] partial state updated
[agents/ui] rendering streaming assistant partial
```

Expected server log chain:

```text
[agents/ws] publish partial
[agents/ws] send partial
```

Model execution now goes through Pi SDK events, so the previous `[agents/openai]` manual-stream logs are not expected on
the primary path.

Diagnosis:

- If desktop shows `Invalid signature`, check `signAgentAction()` and make sure undefined fields are omitted before
  signing.
- If no partial publish appears, inspect the session in `/agents` for a durable error event from the Pi/provider path.
- If server logs `skip partial; no subscription`, desktop is not subscribed to the target session/account.
- If desktop logs partial state updates but UI does not render, inspect `AgentSessionPage` and `PartialAssistantRow`.

## WebSocket subscribe returns `Invalid signature`

Known fixed cause:

- signing an action object with `afterSeq: undefined` encoded differently across sign/verify paths.

Current mitigation:

- `signAgentAction()` recursively omits undefined fields;
- `Subscribe` omits `afterSeq` when not provided.

If it happens again:

1. log the action shape before signing without private content;
2. compare desktop `agents-client.ts` protocol mirror with `agents/src/api.ts`;
3. check CBOR encoding behavior;
4. add a regression test.

## Provider returns no streamed deltas

The Seed server receives text deltas from Pi SDK `message_update` events. If no deltas appear:

- inspect `/agents` for a durable error event;
- verify the provider API key and model name;
- check whether the provider/backend supports streaming for the selected Pi API mapping;
- add temporary local diagnostics around `#runPiAgent()` if needed, without logging secrets or full session content.

## A `read` fails

Check the tool result event in the session log or the `/agents` inspector. `read` takes one address and the address
shape picks the source, so the first question is always whether the address was the shape the agent meant.

Common causes:

- malformed HM/web URL;
- URL cannot be resolved with hypermedia headers;
- resource fetch fails;
- output exceeds 256 KiB (`MAX_TOOL_RESULT_BYTES`);
- a memory path that does not exist. A directory address without its trailing slash is not one of these: `read` answers
  with the listing rather than an error.

An `hm://` read that returns `not-found` for a document the agent just published means the service's
`SEED_AGENTS_HM_SERVER_URL` points at a different node than the one the write went through — check `/api/health` for the
URL actually in effect. Reads never fall back to a public gateway, and every read-path HM request times out after 30s
(`The operation timed out` in the tool result) rather than hanging the run on an unresponsive server.

## `call` came back with a tool contract instead of a result

That is touch-expand working, not a failure. A `call` with a missing or invalid input — or for a tool the thread has not
expanded yet — answers with the tool's contract so the model can read it and call again correctly. The contract's
arrival in the transcript also promotes that tool to a first-class provider tool for the rest of the thread.

If a tool keeps returning its contract, compare the model's input against the `input` schema in `read ~/tools/<name>`.
If a tool is missing from `~/tools` entirely, it is either not granted (`definition.tools`, see `ListAgentTools` —
`granted: false` says exactly this) or withheld by the host: `execute` is dropped when the sandbox probe fails, which
`/api/health` reports as `codeExec: false` with a reason.

## Something the user did is not visible to the agent

Verbs the user runs through the wrench palette append to the same log as `actor: 'user'` events, and the agent reads
them on its next turn. If the agent seems not to know:

1. `GetSession` — are the `tool_call`/`tool_result` events there with `actor: 'user'`?
2. `InvokeSessionTool` returns `409` while a run is live; the palette is meant to be used between turns.
3. The result is context for the NEXT turn. Nothing is pushed into a turn already in flight.

## Desktop cannot save API key

Remote plain HTTP servers are rejected for secret submission. Use HTTPS or local loopback.

## Session stuck in `streaming`

Since the runs rework, `sessions.status` is a derived mirror of run state and a crash cannot wedge it: the boot sweep
requeues interrupted runs, interrupted tool calls get synthesized results, and a boot reconcile pass replays children
that finalized inside a crash window. If a session still shows `streaming`:

1. `ListRuns {sessionId}` → is the latest root run genuinely live (`queued`/`claimed`/`running`/`waiting`)? The mirror
   says `streaming` iff yes.
2. A run `waiting` with `wait_cbor {reason: 'children'}` is parked on delegated children — inspect the tree with
   `ListRuns {rootRunId}` and check each child's status. `reason: 'timer'` (with `not_before`) wakes on schedule.
   `reason: 'event'` is parked on `ctx.waitForEvent` and needs a wake source: a `SignalRun` (the run's `wait.answerWith`
   names the signal, and the card's Answer button sends it), a trigger with a `wake` continuation, a matching activity
   event, or its own timeout. `reason: 'budget-pause'` waits for a person to resume it.
3. `StopSession` aborts the live turn AND cancels every run rooted at the session including descendants; `CancelRun` on
   any run id is the finer-grained kill switch (cascades to its subtree).
4. Restarting the service is always safe: sweep + reconcile recover every documented crash window.

## Children ran but the parent never resumed

Checklist, in order:

1. **Was the child awaited?** `delegate` with `await: false` is detached by design — the child joins the parent's run
   tree (visible in the progress card) but never resolves a result and never wakes the parent. Check the parent
   transcript for the `delegate` input the model actually sent. If the model keeps detaching work whose result it needs,
   that is a prompt problem worth reporting; the verb's description routes it to the awaited default.
2. `ListRuns {rootRunId}` on the parent's root: are the children terminal while the parent is `waiting`? The parent's
   `wait_cbor.toolCallIds` should shrink as each child's finalizer appends the durable `delegate` tool_result. A restart
   runs `#reconcileWaitingRunsAtBoot`, which replays any child that finalized without resolving its parent — that pass
   exists because a child's terminal commit and its parent's wait-resolution are separate transactions.
3. A child that never delivered a required typed result does not vanish quietly: the parent run records
   `unmetObligations: [{kind: 'typed-result'}]`, which `GetRun` returns and the card shows.
4. Where errors surface: a failed run's `error_cbor` shows in `RunInfo.error` and the card; failed script effects appear
   as `result {status: 'failed'}` journal entries (visible in the card's Activity drawer and `GetRunJournal`); agent-run
   failures also append a durable session `error` event after retries exhaust.

## Script child misbehaving

- `GetRunJournal {runId}` is the flight recorder: every effect (`call`/`result`), timer, wait/event, log, step, and plan
  change in order. The desktop Activity drawer renders the same stream.
- `fuel-exhausted` means more than 2s of pure compute between awaits (move heavy work into `ctx.call('execute', …)`);
  `journal-cap` means more than 5,000 entries or 8 MiB (split the job, or bound a long loop with `ctx.continueAsNew`);
  `workflow-deadlock` means the script awaited a promise that did not come from `ctx`.
- Sleeps ≥ 60s park the run (`waiting` + `not_before`); the dispatcher wakes due timers every second.
- A resumed script replays its source against the journal, matching effects by **content key** (`tool|name|inputJSON`,
  `agent|specJSON`, `sleep|ms`, …) with FIFO consumption per key — not by arrival order, which after a `ctx.parallel`
  depends on real completion timing. An effect whose key has no journaled group executes fresh. A `{description}`
  narration is display metadata and stays out of the key, so editing a label does not invalidate a journal.

## A plan step closed itself, or a checklist froze

Both are the runtime keeping the card honest, and both are visible in the plan snapshot:

- a step marked `done` with `resolvedBy: 'runtime'` was closed by the runtime, not the model: every child attached to
  that step came back succeeded. Only success is ever derived this way — a failed child's meaning is a judgment call the
  runtime does not make.
- a plan with `settledAt` set has had every step reach a terminal status, which is when the card can leave the pinned
  slot and freeze into the log. An edit that reopens a step clears it.

## Server unresponsive but process alive (100% CPU)

Symptom: health/API/WebSocket all time out, the container stays "Up", and CPU sits at ~100% on one core. Bun runs JS on
a single thread, so any synchronous infinite loop wedges the entire server (HTTP, WS, triggers) while the process looks
healthy from outside.

Fast diagnosis:

- `docker stats` — one core pegged with flat network I/O suggests a JS busy loop, not load;
- `docker logs -t --tail 50` — find the last event before logs went silent; look for a `tool call start` with no
  matching `tool call end`;
- `strace -p <pid> -c` on the host — repeated reads of `/proc/self/statm` plus `futex`/`sched_yield` are GC allocation
  checks inside a spinning JIT loop;
- full tool inputs are persisted in `session_events` (DAG-CBOR in `event_cbor`) even when the log line is truncated —
  decode them and replay the input against the suspect code path locally.

One past cause (fixed 2026-07): `parseMarkdown` in `@seed-hypermedia/client` looped forever on an indented ATX heading
(`  ### Foo`) because the heading branch matched the raw line while the paragraph collector excluded the trimmed line,
so the tokenizer never advanced. Agent-generated `document.create`/`comment.create` markdown hit this within minutes of
every restart. The tokenizer now guarantees forward progress each iteration.

## Built-in inspector is empty

Check:

```bash
curl http://localhost:3051/agents/api/status # dev port; release builds use 3050
```

If agents exist in desktop but not inspector, confirm desktop is pointing at the same server URL/database.

## Schema mismatch

For local data only:

```bash
rm -f agents/data/agents.sqlite agents/data/agents.sqlite-shm agents/data/agents.sqlite-wal
```

Restart the server.
