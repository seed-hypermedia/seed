---
name: Troubleshooting
summary: "A symptom-first guide to agents server problems: missing streams, signature errors, failed reads, stuck or orphaned runs, and a server that stops responding."
---
A quick diagnostic guide for the [Seed Agents](../agent.md) server, organized by symptom. [Operations](./operations.md) has more operational detail. <!-- id:nOzjb6a5 -->

# Streaming response does not appear while model is typing <!-- id:OETTdZNj -->

Expected desktop log chain: <!-- id:1wCRkz3V -->

```text <!-- id:FMeT9vqJ -->
[agents/ws] subscribe sent
[agents/ws] subscribed event
[agents/ui] sending session message
[agents/ws] partial event
[agents/ws] partial state updated
[agents/ui] rendering streaming assistant partial
```

Expected server log chain: <!-- id:kS7VU6wp -->

```text <!-- id:it4yAeW3 -->
[agents/ws] publish partial
[agents/ws] send partial
```

Model execution now goes through Pi SDK events. The old `[agents/openai]` manual-stream logs do not appear on the main path. See [model providers](./model-providers.md). <!-- id:WLPDhFNa -->

Diagnosis: <!-- id:OZhfU5mQ -->
  - If desktop shows `Invalid signature`, check `signAgentAction()` and make sure undefined fields are omitted before signing. <!-- id:uk35MOQp -->
  - If no partial publish appears, inspect the session (desktop session page or `GetSession`) for a durable error event from the Pi or provider path. <!-- id:5TK579Jv -->
  - If server logs `skip partial; no subscription`, desktop is not subscribed to the target session or account. See [WebSocket subscriptions](./websocket-subscriptions.md). <!-- id:ieSRY6Mu -->
  - If desktop logs partial state updates but the UI does not render, inspect `AgentSessionPage` and `PartialAssistantRow`. <!-- id:L2h_XtH4 -->

# WebSocket subscribe returns `Invalid signature` <!-- id:1w_54waV -->

Known fixed cause: <!-- id:n8p9zQ6b -->
  - signing an action object with `afterSeq: undefined` encoded differently across the sign and verify paths. <!-- id:Aso_QWIJ -->

Current mitigation: <!-- id:uFxBgjdT -->
  - `signAgentAction()` recursively omits undefined fields; <!-- id:4NlhQsL9 -->
  - `Subscribe` omits `afterSeq` when not provided. <!-- id:HR4TxvHL -->

If it happens again: <!-- id:-DfwmYgp -->
  1. log the action shape before signing, without private content; <!-- id:bZIKsUfX -->
  2. check that the client and server agree on the protocol version (`X-Agents-Protocol`), since both import their types from `agents/protocol` (see the [signed API](./signed-api.md)); <!-- id:73KJw0uG -->
  3. check CBOR encoding behavior (see [blobs](../protocol/blobs.md) for DAG-CBOR); <!-- id:SNdy4U9O -->
  4. add a regression test. <!-- id:q4NRYIhg -->

# Provider returns no streamed deltas <!-- id:HRSlBUhE -->

The Seed server receives text deltas from Pi SDK `message_update` events. If no deltas appear: <!-- id:QfW4_j9O -->
  - inspect the session for a durable error event; <!-- id:wtb9LeW- -->
  - verify the [provider](./model-providers.md) API key and model name; <!-- id:y5-42lTk -->
  - check whether the provider or backend supports streaming for the selected Pi API mapping; <!-- id:EdsIwMZ1 -->
  - add temporary local diagnostics around `#runPiAgent()` if needed, without logging secrets or full session content. <!-- id:JmPuF06O -->

# A `read` fails <!-- id:1Wm3JQno -->

Check the tool result event in the session [log](./log.md). [`read`](./read.md) takes one address, and the address shape picks the source. So first check that the address has the shape the agent meant. <!-- id:no9JxMOB -->

Common causes: <!-- id:IduHYGln -->
  - malformed [HM URL](../protocol/urls.md) or web URL; <!-- id:3hhBhi48 -->
  - URL cannot be resolved with hypermedia headers; <!-- id:Z9Zr9GwW -->
  - resource fetch fails; <!-- id:YN5Nk5CI -->
  - output exceeds 256 KiB (`MAX_TOOL_RESULT_BYTES`); <!-- id:ewq_Eqlg -->
  - a memory path that does not exist. A directory address without its trailing slash does not fail: `read` answers with the listing. <!-- id:PhOREC0x -->

An `hm://` read can return `not-found` for a [document](../protocol/documents.md) the agent just published. That means the service's `SEED_AGENTS_HM_SERVER_URL` points at a different node than the one the write went through. Check `/api/health` for the URL in effect. Reads never fall back to a public [gateway](../protocol/sites.md). Every read-path HM request times out after 30s (`The operation timed out` in the tool result), so an unresponsive server does not hang the run. <!-- id:wvTAioKf -->

# `call` came back with a tool contract instead of a result <!-- id:TwNmKW4- -->

This is touch-expand, and it is expected. A [`call`](./call.md) with a missing or invalid input, or for a tool the thread has not expanded yet, answers with the tool's [contract](./contract.md). The model reads it and calls again correctly. When the contract arrives in the transcript, it also [promotes](./promotion.md) that tool to a provider tool for the rest of the thread. <!-- id:i1t-NwX7 -->

If a tool keeps returning its contract, compare the model's input against the `input` schema in `read ~/tools/<name>`. If a tool is missing from `~/tools` entirely, there are two causes. It is not in the agent's [grants](./grants.md) (`definition.tools`; `ListAgentTools` reports `granted: false`). Or the host withholds it: `execute` is dropped when the sandbox probe fails, and `/api/health` reports this as `codeExec: false` with a reason. <!-- id:c8HVk-cZ -->

# Something the user did is not visible to the agent <!-- id:41MdMv1x -->

Verbs the user runs through the [wrench palette](./wrench-palette.md) append to the same log as `actor: 'user'` events. The agent reads them on its next turn. If the agent seems not to know: <!-- id:R5VVhbu6 -->
  1. Run `GetSession` and check that the `tool_call` and `tool_result` events are there with `actor: 'user'`. <!-- id:Dwg5lYb7 -->
  2. `InvokeSessionTool` returns `409` while a run is live. Use the palette between turns. <!-- id:lTVdOjgv -->
  3. The result is context for the NEXT turn. Nothing is pushed into a turn already in flight. <!-- id:FjVIHG5h -->

# Desktop cannot save API key <!-- id:t9e1pRa1 -->

The server rejects secret submission to remote plain HTTP servers. Use HTTPS or local loopback. <!-- id:OGlnHJ8O -->

# Session stuck in `streaming` <!-- id:9Avd0DG9 -->

Since the runs rework, `sessions.status` is a derived mirror of [run](./runs.md) state, and a crash cannot wedge it. The boot sweep requeues interrupted runs. Interrupted tool calls get synthesized results. A boot reconcile pass replays children that finalized inside a crash window. If a session still shows `streaming`: <!-- id:lgnWLAMl -->
  1. Run `ListRuns {sessionId}` and check whether the latest root run is live (`queued`, `claimed`, `running`, or `waiting`). The mirror says `streaming` if and only if it is. <!-- id:jvdfm_lR -->
  2. A run `waiting` with `wait_cbor {reason: 'children'}` is [parked](./park.md) on delegated [children](./child.md). Inspect the tree with `ListRuns {rootRunId}` and check each child's status. `reason: 'timer'` (with `not_before`) wakes on schedule. `reason: 'event'` is parked on `ctx.waitForEvent` and needs a [wake source](./wake-source.md): a `SignalRun` (the run's `wait.answerWith` names the signal, and the card's Answer button sends it), a [trigger](./triggers.md) with a `wake` continuation, a matching activity event, or its own timeout. `reason: 'budget-pause'` waits for a person to resume it. <!-- id:CQeTvjby -->
  3. `StopSession` aborts the live turn AND cancels every run rooted at the session, including descendants. `CancelRun` on any run id is the finer kill switch, and it cascades to that run's subtree. <!-- id:_4-Jmfw6 -->
  4. Restarting the service is always safe: sweep and reconcile recover every documented crash window. <!-- id:KkC31s6i -->

# A delegate row says "Starting the child…" but the child is alive <!-- id:s0To9423 -->

The row links to its child through the parent transcript's `tool_spawn` event. [`delegate`](./delegate.md) appends that event as soon as the child run and session exist, so you can open a live delegation while the child is still queued or its model is still processing the prompt. Two cases fall back to finding the child through the run tree, where the child run's `parent_tool_call_id` names the call: a transcript from before that event existed, and a call whose spawn threw before the child was enqueued. If a row with a live child still shows the spinner text, check `GetSession` for a `tool_spawn` with that `toolCallId`. If it is absent, the server that ran the turn predates the event. <!-- id:HHClNS7Y -->

# Children ran but the parent never resumed <!-- id:hSOtRslw -->

Checklist, in order: <!-- id:3hMFhTPK -->
  1. **Was the child awaited?** `delegate` with `await: false` is detached by design. The child joins the parent's run tree (visible in the progress card), but it never resolves a result and never wakes the parent. Check the parent transcript for the `delegate` input the model sent. If the model keeps detaching work whose result it needs, report it as a prompt problem. The verb's description steers the model to the awaited default. <!-- id:2jUcM9sM -->
  2. Run `ListRuns {rootRunId}` on the parent's root and check whether the children are terminal while the parent is `waiting`. The parent's `wait_cbor.toolCallIds` should shrink as each child's finalizer appends the durable `delegate` tool_result. A restart runs `#reconcileWaitingRunsAtBoot`, which replays any child that finalized without resolving its parent. That pass exists because a child's terminal commit and its parent's wait resolution are separate transactions. <!-- id:qVv02EZb -->
  3. A child that never delivered a required [typed result](./typed-result.md) does not vanish quietly. The parent run records `unmetObligations: [{kind: 'typed-result'}]`, which `GetRun` returns and the card shows. <!-- id:0bGn2DdH -->
  4. Where errors surface: a failed run's `error_cbor` shows in `RunInfo.error` and on the card. Failed script effects appear as `result {status: 'failed'}` [journal](./journal.md) entries, visible in the card's Activity drawer and in `GetRunJournal`. Agent-run failures also append a durable session `error` event after retries run out. <!-- id:kUlpL23z -->

# Script child misbehaving <!-- id:H5mKTBzC -->

- `GetRunJournal {runId}` is the flight recorder for a [script](./script.md) run: every effect (`call` and `result`), timer, wait and event, log, step, and plan change, in order. The desktop Activity drawer renders the same stream. <!-- id:54qlgZW1 -->
- `fuel-exhausted` means more than 2s of pure compute between awaits: move heavy work into `ctx.call('execute', …)`. `journal-cap` means more than 5,000 entries or 8 MiB: split the job, or bound a long loop with [`ctx.continueAsNew`](./continue-as-new.md). `workflow-deadlock` means the script awaited a promise that did not come from `ctx`. <!-- id:y3nBAF_m -->
- Sleeps of 60s or more park the run (`waiting` + `not_before`). The dispatcher wakes due timers every second. <!-- id:_2iWQq2C -->
- A resumed script replays its source against the journal. It matches effects by **content key** (`tool|name|inputJSON`, `agent|specJSON`, `sleep|ms`, …) with FIFO consumption per key. It does not match by arrival order, because after a `ctx.parallel` that order depends on real completion timing. An effect whose key has no journaled group executes fresh. A `{description}` narration is display metadata and stays out of the key, so editing a label does not invalidate a journal. <!-- id:L_CPnU0z -->

# A plan step closed itself, or a checklist froze <!-- id:3P_emtsM -->

In both cases the runtime is keeping the card accurate, and both show in the [plan](./plan.md) snapshot: <!-- id:F7NA6psv -->
  - A [step](./step.md) marked `done` with `resolvedBy: 'runtime'` was closed by the runtime: every child [attached](./attachment.md) to that step came back succeeded. The runtime only derives success this way. It does not decide what a failed child means. <!-- id:OZrCmakv -->
  - A plan with `settledAt` set has had every step reach a terminal status. At that point the card can leave the pinned slot and freeze into the log. An edit that reopens a step clears `settledAt`. <!-- id:9Qz3i792 -->
  - A settled plan disappears from `SessionInfo.plan` on the next user message. This is retirement. The new turn clears the session's snapshot so the model plans the new task from scratch. The settled copy stays on the run that owned it (`RunInfo.plan`), and the frozen transcript card renders that copy. <!-- id:TqxWfNmA -->

# Server unresponsive but process alive (100% CPU) <!-- id:r6qSTRho -->

Symptom: health, API, and WebSocket requests all time out, the container stays "Up", and CPU sits at \~100% on one core. Bun runs JS on a single thread, so any synchronous infinite loop wedges the whole server (HTTP, WS, triggers) while the process looks healthy from outside. <!-- id:_IVa2DFM -->

Fast diagnosis: <!-- id:qdTU6rbl -->
  - `docker stats`: one core pegged with flat network I/O points to a JS busy loop, not load; <!-- id:CLDSxI8J -->
  - `docker logs -t --tail 50`: find the last event before the logs went silent, and look for a `tool call start` with no matching `tool call end`; <!-- id:Fh2OFium -->
  - `strace -p <pid> -c` on the host: repeated reads of `/proc/self/statm` plus `futex` and `sched_yield` are GC allocation checks inside a spinning JIT loop; <!-- id:lnefkJD0 -->
  - full tool inputs are stored in `session_events` (DAG-CBOR in `event_cbor`) even when the log line is truncated. Decode them and replay the input against the suspect code path locally. See [persistence](./persistence.md). <!-- id:Vzfv2OJ5 -->

One past cause (fixed 2026-07): `parseMarkdown` in `@seed-hypermedia/client` looped forever on an indented ATX heading (`   ### Foo `). The heading branch matched the raw line while the paragraph collector excluded the trimmed line, so the tokenizer never advanced. Agent-generated `document.create` and `comment.create` markdown hit this within minutes of every restart. The tokenizer now guarantees forward progress on each iteration. <!-- id:NMZemCc_ -->

# Desktop shows no agents <!-- id:FB5I7l2A -->

Confirm the desktop points at the same server URL and database. The server has no unauthenticated listing. To check what an [account](../protocol/identity.md) owns, send a signed `ListAgents` to `/api/message` as that account. <!-- id:cO3JZeRc -->

# Schema mismatch <!-- id:yfzcaJs8 -->

For local data only: <!-- id:Vi1Q0Qv5 -->

```bash <!-- id:QpOWp8jO -->
rm -f agents/data/agents.sqlite agents/data/agents.sqlite-shm agents/data/agents.sqlite-wal
```

Restart the server. <!-- id:y-E4pbt- -->

# See also

- [Operations](./operations.md)
- [Persistence](./persistence.md)
- [Signed API](./signed-api.md)
- [WebSocket subscriptions](./websocket-subscriptions.md)
- [Tools](./tools.md)
- [Security](./security.md)
- [Agents glossary](./glossary.md)
