---
name: Session continuation
summary: How an agent carries a conversation into a fresh successor session when the old one stops being useful, without shortening its history, and what the new session starts from.
---
A **session continuation** moves a conversation into a new, empty [session](./session.md) and keeps the old one whole. The [agent](../agent.md) does it with the `continue_session` verb. The old session is the **predecessor**. The new one is the **successor**. <!-- id:XTjN_TgS -->

Seed never compacts a conversation. To compact is to replace early history with a summary. But sometimes a long transcript stops being useful to work from:

- the user changed the subject;
- one phase of the work ended;
- the user wants to focus on one part;
- the user asked for a new session;
- the model's context is filling up.

Then the agent continues the session. The predecessor keeps its complete transcript in its [log](./log.md). The successor starts from a **projection**: the agent's **handoff** (its notes for the new session), the exact message that started the move, and exact excerpts of the old transcript. Everything else is linked and can be read back.

The word "continuation" has two other uses in these pages. One is what a [trigger](../trigger.md) does when it fires (see [triggers](./triggers.md)). The other is the server handing a turn back to the model because of an open [obligation](./obligations.md). This page is only about carrying a session into a successor.

# Vocabulary <!-- id:C2TwNBv_ -->

- **Continuation**: the saved move the user sees, from the predecessor to the successor. The link between the two is the continuation edge. It differs from parent and [child](./child.md), where a [delegated](./delegate.md) run returns to its parent. A successor becomes the conversation the user is in. <!-- id:6FTrgPa4 -->
- **Projection**: the first thing the successor's model reads. The server builds it for this purpose, with exact references back to its sources. The true history stays in the predecessor. <!-- id:uSkC4UOX -->
- **Manifest**: the record of what the projection was built from (`SessionContinuationManifest`), stored on the edge. <!-- id:aiq2kNgN -->

# Data model <!-- id:dMLU_dOt -->

Each continuation is one row that links the old session to the new one. The table is `session_continuations` (see [persistence](../operate/persistence.md)). Its columns are `predecessor_session_id`, `successor_session_id` (unique: a session has one immediate predecessor), `origin_session_id` (the first session of the chain), `tool_call_id` (unique with the predecessor, and the idempotency key), `initiating_event_id`, `reason`, and `manifest_cbor`. A predecessor may have several successors, when someone came back to it and continued it again. `SessionInfo.continuedTo` shows the newest. <!-- id:3XZ8Btdl -->

`SessionInfo` carries `continuedFrom` and `continuedTo` (`SessionContinuationLink`: continuation id, other session id and title, reason, time). `GetSessionResponse.contextWindow` is the model's window, so clients can draw the context meter. `MessageSessionResponse.continuedToSessionId` tells the sending client where the answer went. <!-- id:O6ZmwQOZ -->

The server adds two events to the successor in the same transaction that creates it: <!-- id:JNEO4fG8 -->
  1. `{type: 'message', role: 'user', actor: 'system'}`: the projection (see Vocabulary). The app shows it as the handoff card, never as a chat bubble. <!-- id:Z-EQ6ixl -->
  2. The initiating user message, copied **word for word** (`content`, `rawMarkdown`, `blocks`, `contextLines`, `attachments`) with `meta.continuedFrom = {sessionId, eventId, seq}`. Attached files are linked into the successor's attachment directory (`linkSessionAttachment`), so `attachment:<id>` still works. <!-- id:vDNocEBP -->

The predecessor's transcript gains only the `continue_session` `tool_call`/`tool_result` pair, which the run loop writes anyway. The transition card renders from that pair. <!-- id:wqjU3k1D -->

# The verb <!-- id:7jy_0YCl -->

`continue_session({reason, title, description, handoff, sources?, transfer?})` is one of the two session verbs (see [tools](./tools.md)). <!-- id:ioRc5uBs -->

- `title` and `description`: required. The agent names the new session.
- `handoff`: notes for a colleague who has read nothing.
- `sources`: exact pointers to earlier material.
- `transfer.plan`: what happens to the checklist: `carry`, `close` or `omit`.

The details:

- **Title and description.** The predecessor's agent sets them, the same way the `status` verb names a session (`title_source = 'agent'`). So the server does not name the successor itself.
- **Handoff keys.** `purpose`, `currentRequest`, `establishedFacts`, `decisions`, `openQuestions`, `nextActions`, `cautions`. Any other key the agent adds is kept under `handoff.extra`. Each value becomes a list of strings and is shown as its own `## Section`.
- **Misplaced fields.** Models often put `sources`, `transfer`, or `description` inside `handoff`. The server moves those to the top level when the top level lacks them. It does not refuse the call.
- **Sources.** A `resource` is an `hm://`, `ipfs://`, or `http` address. A `memory` source is a `~/memory/…` path that must exist. `session_events` and `session_event` sources are ranges of `seq` numbers in a thread, as `read thread:<id>` shows them. The server checks them against the thread.
- **The plan.** `carry` is the default when the checklist has unfinished steps. The server copies the [plan](./plan.md) with its owner cleared, so the successor's run takes it over.

The verb is offered only to a top-level [run](./runs.md). A delegated child (a run with a `parentRunId`) does not get it, and neither does a [typed child](./typed-result.md) (one with `return_result`). [Scripts](./script.md) never see it. <!-- id:T87PpUxd -->

# What the server does <!-- id:D_ENCwQv -->

1. **Replay**: if a row for `(predecessor, tool_call_id)` exists, return that successor and end the turn. <!-- id:eZUsKNMw -->
2. **Validate**: check the reason, title, description, and handoff shapes. Refuse while children spawned this turn are [parked](./park.md). Refuse from a delegated child. A session can be continued 8 times at most. Find the **initiating event**, the newest user message written by a user or a [trigger](../trigger.md). Refuse when it carries `meta.continuedFrom`: the session was just continued and nobody has said anything new, so continuing again would loop. Validate sources. <!-- id:6qqsD_fJ -->
3. **Compile the projection**: lineage section, handoff, and source list. Then, within a budget of 40 KiB, the cited ranges of this thread as `<excerpt>` sections, then the most recent exchanges before the initiating message as `<recent_exchanges>`. Whatever does not fit is listed as omitted: linked but not loaded. Every excerpt line is `[seq] who: text`, the form `read thread:` prints, and is at most 2,000 characters long. It is escaped like any model-written text handed back inside a frame (see [what an agent is told](./prompt.md)). <!-- id:NN9SVyi4 -->
4. **Create atomically**: the successor session (title, description, copied model override, carried plan), the edge row with the manifest, and the two successor events. <!-- id:wLOnGm6g -->
5. **End this turn, start the next**: the server sends no further request to the provider. A hook that runs before every request stops the conversation, and this is the intended ending (see [durable sessions](./durable-sessions.md)). The run ends `succeeded` with `{continuedToSessionId, continuationId}` and skips [obligations](./obligations.md), because nothing is owed here any more. The successor's run is enqueued on the interactive queue with the copied message as its `userEventIds`. <!-- id:W6wcd5BD -->
6. **Emit**: `session-change` for both sessions (the predecessor now has `continuedTo`, the successor `continuedFrom`), and `account-change` with reasons `session-updated` and `session-continued`. See [WebSocket subscriptions](../build/websocket-subscriptions.md). <!-- id:Kz7wm6gJ -->

# What the agent is told <!-- id:j3sz_XaS -->

- System prompt: what a continuation is, that transcripts are never compacted, when to continue, that calling the verb ends the turn and the successor answers, and that `read thread:<id>` recalls exact material. See [what an agent is told](./prompt.md). <!-- id:6owq0VQb -->
- The verb [contract](./contract.md): the cases in detail (topic change, phase change, refocus, context pressure, user request), when NOT to continue (unresolved side effects, delegated children, plain follow-ups), what the successor receives, how to write the handoff, and that the title and description are the agent's to set. <!-- id:2uJMXhXv -->
- Per turn, where continuing is possible: a `<context_usage tokens window percent>` tag, rendered fresh like `<plan_state>` and never stored. Tokens are the last turn's prompt size: `input + cacheRead + cacheWrite`, stamped on the newest assistant message's `meta.usage`. The window is the model's context window (see [model providers](./model-providers.md)). The guidance gets stronger at 70% and 85%. <!-- id:niegcxuA -->
- Recall: `read thread:<id>` prints `[seq]`-prefixed lines, accepts `{fromSeq, toSeq, limit}`, and reports the thread's `continuedFrom` and `continuedTo`. Thread reads and cited `session_events` sources reach only this agent's own threads. Agents do not read each other's threads. They talk through public [documents](../protocol/documents.md) and [comments](../protocol/comments.md). <!-- id:mtw39xX3 -->
- Per turn, everywhere: a `<session_status title="…">description</session_status>` tag. With it, a `status` call is a deliberate change and never a restatement. A successor keeps the title and description its predecessor gave it. The title is what the whole session is about, and a large shift in topic calls for a continuation instead of a rename. The description is the live status and can change freely. Most calls change only the description. The `status` tool row shows the description in full. <!-- id:xGi2B1v9 -->

# In the app <!-- id:D_uHR1Zj -->

- **Context meter**: a small pie chart in the session header and the assistant sidebar. It is grey, amber from 70%, and red from 85%. The client computes it from the same assistant `meta.usage` and `contextWindow`. See [Agents in the Seed app](./in-the-app.md). <!-- id:Ra6COy0b -->
- **Predecessor**: the `continue_session` row renders as a transition row. It has a chevron, "Continued in “title” (reason)", _Open session_ on the right, and a hover info bubble that shows every detail of the handoff. A refused call keeps error styling. You can still type in a continued session. Doing so can lead to a second successor. Session lists show a "Continued in …" chip. <!-- id:byI9OPix -->
- **Successor**: a header pill (Continued from “…”, the way back) and the projection rendered as a handoff card (handoff markdown, sources, and excerpts loaded on demand). The replayed user message carries a "From previous session" chip. <!-- id:dthqFvf6 -->
- **Automatic navigation**: a client moves to the successor only if it was following the turn, meaning it saw the session streaming or sent the message. The send response's `continuedToSessionId` navigates at once. It fires once per successor. Back returns to the predecessor without redirecting again. Other clients see the card and the notice. <!-- id:KgULgOWT -->

# Failure and recovery <!-- id:MjC-wDTV -->

- Refused continuation (child, loop, parked children, bad input): the tool result is an error that the model reads and the transcript shows. Nothing is created. <!-- id:yPiOA7MM -->
- Crash between the edge and the successor run: the edge and successor exist. The run is enqueued after the transaction. If the run is lost, the successor is a normal session, and you can retry its replayed message. <!-- id:BOFpY0tX -->
- Replayed tool call: the same successor, found by `(predecessor, tool_call_id)`. <!-- id:NE7P17vi -->

# See also <!-- id:KhstTmbm -->

- [Session](./session.md)
- [Log](./log.md) <!-- id:_QsJ-kK4 -->
- [Runs](./runs.md) <!-- id:3N4utHzM -->
- [Tools](./tools.md) <!-- id:zLFSlj9M -->
- [What an agent is told](./prompt.md) <!-- id:w2ay0kLj -->
- [Persistence](../operate/persistence.md) <!-- id:t0_EgAzA -->
- [Agents in the Seed app](./in-the-app.md) <!-- id:5bcZD6JW -->
- [Agents glossary](./glossary.md) <!-- id:cNsCEES6 -->
