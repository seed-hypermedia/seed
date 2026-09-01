# Session continuation

> Shipped 2026-09-01. Implements Ion's proposal
> [Session Continuation](https://hyper.media/hm/z6MkpVa5nMUR5ZaUEyV1SE48KTNbwTuHRd83RwLgMKc4nGU3/ion/system/session-continuation):
> no rolling-summary compaction; an agent continues into a fresh session at a semantic boundary, and the handoff is a
> durable, inspectable projection.

Seed never compacts a conversation by replacing its early history with a summary. When a transcript stops being the
right working context — the user changed subject, a phase ended, they want to refocus on one thread, they asked for it,
or the model's context is filling — the agent carries the conversation into a **successor** session with the
`continue_session` verb. The predecessor keeps its complete transcript; the successor starts from a **projection**: the
agent's handoff, the exact initiating message, and exact excerpts, with everything else linked and recallable.

## Vocabulary

- **Continuation** — the durable, user-visible transition: predecessor → continuation edge → successor. Distinct from
  parent/child (delegation that returns to its parent). A continuation becomes the foreground conversation.
- **Projection** — the successor's first model context: a purpose-built view with exact references back to sources.
  Derived context, not canonical history.
- **Manifest** — the record of what the projection was built from (`SessionContinuationManifest`), stored on the edge.

## Data model

`session_continuations` (`sqlite-schema.sql`): one row per edge — `predecessor_session_id`, `successor_session_id`
(unique: a session has one immediate predecessor), `origin_session_id` (the first session of the chain), `tool_call_id`
(unique with the predecessor: the idempotency key), `initiating_event_id`, `reason`, `manifest_cbor`. A predecessor may
have several successors (someone came back and branched); `SessionInfo.continuedTo` advertises the newest.

`SessionInfo` carries `continuedFrom` / `continuedTo` (`SessionContinuationLink`: continuation id, other session id and
title, reason, time). `GetSessionResponse.contextWindow` is the model's window so clients can draw the context meter.
`MessageSessionResponse.continuedToSessionId` tells the sending client where the answer went.

Successor events, appended in the creation transaction:

1. `{type: 'message', role: 'user', actor: 'system'}` — the projection (below). Rendered as the handoff card, never as a
   bubble.
2. The initiating user message, copied **verbatim** (content, rawMarkdown, blocks, contextLines, attachments) with
   `meta.continuedFrom = {sessionId, eventId, seq}`. Attachments are hard-linked into the successor's attachment dir
   (`linkSessionAttachment`) so `attachment:<id>` keeps resolving.

The predecessor's transcript gains nothing but the `continue_session` `tool_call`/`tool_result` pair the run loop writes
anyway; the transition card renders from that pair.

## The verb

`continue_session({reason, title, description, handoff, sources?, transfer?})` — `tool-registry.ts`. `title` and
`description` are **required** and set by the predecessor's agent, the way the `status` verb names a session
(`title_source = 'agent'`, so the fallback namer stays out). `handoff` is prose for a colleague who has read nothing:
purpose, currentRequest, establishedFacts, decisions, openQuestions, nextActions, cautions. `sources` are exact
breadcrumbs: `resource` (hm://, ipfs://, http), `memory` (`~/memory/…`, must exist), `session_events`/`session_event`
(seq ranges of a thread, as `read thread:<id>` shows them; validated against the thread). `transfer.plan` is `carry`
(default when the checklist has unfinished steps — it is copied with its owner cleared, so the successor's run adopts
it) or `close`/`omit`.

Availability (`canContinueSession` in `#runPiAgent`): a run exists, it is not a delegated child (`parentRunId`), and it
is not a typed child (`return_result`). Scripts never see it.

## Runtime (`#continueSessionFromAgent`)

1. **Replay** — a row for `(predecessor, tool_call_id)` returns the existing successor and ends the turn.
2. **Validate** — reason/title/description/handoff shapes; refuse while children spawned this turn are parked; refuse
   from a delegated child; cap successors per predecessor (`MAX_SESSION_CONTINUATIONS_PER_SESSION`); find the
   **initiating event** (newest user- or trigger-authored user message) and refuse when it carries `meta.continuedFrom`
   — the session was just continued and nobody has said anything new, so continuing again would loop; validate sources.
3. **Compile the projection** (`compileContinuationProjection`, pure): lineage block, handoff, source list, then within
   `CONTINUATION_PROJECTION_BUDGET_BYTES`: the cited ranges of this thread as `<excerpt>` blocks, then the most recent
   conversational exchanges before the initiating message as `<recent_exchanges>`. Whatever does not fit is listed as
   omitted — linked, not loaded. Every excerpt line is `[seq] who: text` (`transcriptEventLine`, shared with
   `read thread:`), escaped with `escapeActionFraming` like any model-authored text handed back inside a frame.
4. **Create atomically** — successor session (title, description, model override copied, plan carried), edge row with
   the manifest, the two successor events.
5. **End this turn, start the next** — `runningSession.continuation` + `completeAfterTools`: Pi's next provider request
   is refused (`onPayload` throws, the designed ending), `#runPiAgent` throws `SessionContinuedError`,
   `#executeAgentRun` returns `succeeded` with `{continuedToSessionId, continuationId}` and skips obligations (nothing
   is owed here any more). The successor's run is enqueued on the interactive queue with the copied message as its
   `userEventIds`.
6. **Emit** — `session-change` for both sessions (the predecessor now has `continuedTo`, the successor `continuedFrom`),
   `account-change` reasons `session-updated` and `session-continued`.

## What the agent is told

- System prompt (`SESSION_CONTINUATION_PROMPT`): what a continuation is, that transcripts are never compacted, when to
  continue, that calling the verb ends the turn and the successor answers, and that `read thread:<id>` recalls exact
  material.
- The verb contract: the triggers in detail (topic change, phase change, refocus, context pressure, user request), when
  NOT to (unresolved side effects, delegated children, plain follow-ups), what the successor receives, how to write the
  handoff, that title/description are its to set.
- Per turn, where continuing is possible: a `<context_usage tokens window percent>` block (`contextUsageBlock`),
  rendered fresh like `<plan_state>` and never stored. Tokens are the last turn's prompt size —
  `input + cacheRead + cacheWrite` stamped on the newest assistant message's `meta.usage`; the window comes from
  `modelContextWindow(providerType, modelId)` (`model-capabilities.ts`, also used for Pi's model registration). Guidance
  escalates at 70% and 85%.
- Recall: `read thread:<id>` now prints `[seq]`-prefixed lines, accepts `{fromSeq, toSeq, limit}`, and reports the
  thread's `continuedFrom`/`continuedTo`. Thread reads and cited `session_events` sources reach only this agent's own
  threads: agents do not read each other's state and communicate over public interfaces instead.
- Per turn, everywhere: a `<session_status title="…">description</session_status>` block (`sessionStatusBlock`) so the
  `status` verb is a deliberate change, never a restatement — a successor keeps the title and description its
  predecessor gave it. Title = what the whole session is about (a dramatic shift is a continuation, not a rename);
  description = the live status, updated freely (description-only calls are the norm). The `status` tool row shows the
  description in full.

## UI

- **Context meter** (`ContextUsageMeter`): a small pie in the session header (and the assistant sidebar) — muted, amber
  from 70%, red from 85% — computed client-side from the same assistant `meta.usage` and `contextWindow`.
- **Predecessor**: the `continue_session` row renders as a transition row (`ContinuationTransitionCard`): chevron,
  "Continued in “title” (reason)", _Open session_ on the right, and a hover info bubble opening every detail of the
  handoff. A refused call keeps error styling. Typing in a continued session is still allowed and branches. Session
  lists show a "Continued in …" chip.
- **Successor**: a `ContinuationHeader` pill (Continued from “…”, the way back) and the projection rendered as
  `ContinuationHandoffCard` (handoff markdown, sources, loaded excerpts on demand). The replayed user message carries a
  "From previous session" chip.
- **Automatic navigation** (`useFollowContinuation`): a client moves to the successor only if it was following the turn
  — it saw the session streaming or sent the message (the send response's `continuedToSessionId` navigates immediately).
  Fires once per successor; Back returns to the predecessor without being redirected again. Other clients see the card
  and the notice.

## Failure and recovery

- Refused continuation (child, loop, parked children, bad input): the tool result is an error the model reads and the
  transcript shows; nothing is created.
- Crash between the edge and the successor run: the edge and successor exist; the run is enqueued after the transaction
  and, if lost, the successor is a normal session whose replayed message can be retried.
- Replayed tool call: the same successor, by `(predecessor, tool_call_id)`.

## Not yet

Phase 3 of the proposal: budget estimates before continuing, recommended ranges, purpose-specific projections, and
measuring repeated recalls of omitted sources. Forks (branching from an earlier point by a person) do not share the edge
yet.
