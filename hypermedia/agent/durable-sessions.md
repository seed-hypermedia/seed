---
name: Durable Sessions
summary: How every agent session keeps the transcript its model reads in a Pi Durable store, how that store and the session log stay in step, and how a turn that was cut off continues.
---
[Seed Agents](../agent.md) runs every model turn through [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable), the durable agent harness of the [Pi](https://pi.dev) toolkit. Each session owns one durable store. The root conversation in that store is the transcript the model reads. The session [log](./log.md) stays the record that people and clients read. This page explains how the two fit together.

# Who does what

Three layers run a turn.

  - **pi-ai** (`@earendil-works/pi-ai`) talks to model providers. It owns the wire protocols, auth, and streaming. See [model providers](./model-providers.md).
  - **Pi Durable** (`@earendil-works/pi-durable`) runs the loop. It asks the model, runs the tool calls of each response, and asks again until the model answers. Every step is committed to storage before anything else sees it: the user input, each model response, each tool result, and the partial text of the response in flight.
  - **Seed** owns everything around the loop: the [signed API](./signed-api.md), the [runs](./runs.md) queue, the log, the verbs, the prompts, [parking](./park.md), and [session continuation](./session-continuation.md).

The code that joins them is `#runPiAgent` in `agents/src/api-service.ts` and the helpers in `agents/src/durable-session.ts`.

# The store

A session's store lives in the agents database, in the `session_durable_files` table described under [persistence](./persistence.md). The format is Pi Durable's own: a handful of append-only JSONL files per session. Seed does not write them to disk. It hands Pi Durable a file system whose files are rows of that table, where a file is its rows read in order and an append is one inserted row. So Pi Durable's storage code runs unchanged, and a session's whole state is in one database. The store holds:

  - **entries**: the immutable transcript. `pi.user` is an input, `pi.assistant` is one provider response kept exactly as the provider sent it (text, thinking, tool calls, usage), `pi.tool-result` is one tool result, and `pi.system` records the system prompt and the tools on offer at that point. `seed.replay` is a message Seed wrote from the log, and `pi.reset` starts a new context.
  - **documents**: small JSON state committed together with entries. `pi.agent` holds the model and reasoning level, `pi.live` holds the response and tool calls in flight, and `seed.sync` holds how far the log has been imported and the input the newest import produced.
  - **tasks**: the checkpointed state machines of the turn in flight, one per model request and one per tool call.

One harness owns a store at a time. Only the run that holds the session's turn opens it, at the start of the turn, and closes it at the end. Deleting the session deletes the store's rows with it. The store has the durability of the database it lives in: it survives a process crash, and the newest commits may be lost on power failure.

# A turn

1. The run builds what the turn needs: the provider and model, the system prompt, and the tools (the verbs plus any [promoted](./promotion.md) callables). They are installed in a fresh registry before the store is opened.
2. The store is opened and events that an earlier process committed without writing to the log are written now.
3. What reached the log since the last turn is imported into the conversation. The run's newest user message becomes the input, and is recorded in `seed.sync` in the same commit, under the request id it will be submitted with.
4. The input is submitted with a request id that names the run. Pi Durable asks the model, runs tool calls, and repeats.
5. Each entry the harness commits is projected into the log as session events. Partial text is published to [WebSocket](./websocket-subscriptions.md) subscribers as it is committed, about every 100 ms.
6. When the input is settled, the store is closed.

# Keeping the log and the store in step

The log is the canonical record. The store is the model's view of it. They are kept in step from both sides, and each mark lives where it can be written atomically.

**From the store to the log.** One `pi.assistant` entry becomes an assistant `message` event and one `tool_call` event per call. One `pi.tool-result` entry becomes a `tool_result` event. Each of these rows carries the entry id in `session_events.pi_entry_id`, and the rows of one entry are written in one transaction. When a store is opened, every entry above the highest id in the log is projected again, so a crash between the store's commit and the log's write loses nothing and repeats nothing.

**From the log to the store.** Many things write to the log without the harness: a user message, a verb the user ran from the [wrench palette](./wrench-palette.md), a system notice about an open obligation, the result of a delegated [child](./child.md). Before a turn, every event past the import mark that has no `pi_entry_id` is pending. The import mark lives in the `seed.sync` document and is committed together with the imported entries.

There are three ways to import:

  - **Append.** User messages, user actions, and assistant text that Seed wrote itself are appended behind the entries the harness produced. The run's newest user message becomes the input. This is the usual case. The conversation orders messages by when the model takes them in, so a message that arrived while the previous answer was still streaming follows that answer. A message that arrived after the run's own is left for the run queued for it, so each message is put to the model once.
  - **Edit.** The result of a delegated child arrives after its call was already answered with a placeholder. It is written as a context edit: an entry that carries no message of its own and replaces what the placeholder entry contributes to the model's context. The model reads the real result where the placeholder was, and every other entry is untouched. When nobody said anything new, the input is `<background_work_update>`.
  - **Rebuild.** Some events fit neither: a result the runtime wrote for a call that a restart cut off, or a late result whose placeholder is no longer in the context. A session that has no store yet is the same case. Then a `pi.reset` entry starts a new context and the whole log is replayed behind it, with every result attached to its call. Earlier entries stay in the store, outside the context. A rebuilt context keeps the text, calls, and results of the log, and not the provider's own record of each response.

A store that was lost is rebuilt the same way. A store can also fall behind the log, for example when its rows are restored from an older copy than the log's. Either way the log then names entry ids the store does not hold. Those marks are cleared when the store is opened, so their events are imported like anything else the store has not seen, and no new entry is mistaken for one that was already written to the log.

# What the model reads

Each request holds, in order:

  1. the system prompt, as one section. It carries no clock, so it is byte for byte the same from one turn to the next unless the agent itself changed. The [prompt injection map](./prompt-injection-map.md) lists what it is assembled from.
  2. the conversation: every entry since the newest `pi.reset`, with provider responses exactly as they arrived.
  3. this turn's input.
  4. the state of this turn, as user messages placed right behind the input: the `<plan_state>` checklist, `<context_usage>`, `<session_status>`, and `<current_time>`. They are rendered once per turn, sent with every request of that turn, and never stored.

Because the prefix does not change between requests, a provider's prompt cache keeps working across the turns of a session. Pi Durable also sends each conversation's own session id to providers that route by it.

# When a turn ends early

Three verbs end the turn after the current batch of tool calls: `delegate` when it [parks](./park.md) the run on a child, `return_result` in a [typed child](./typed-result.md), and `continue_session`. The harness would normally send the tool results back to the model. A hook that runs before every request sees that the turn is over and aborts the conversation, so the request never leaves.

A parked `delegate` call is answered in the store with a placeholder that says the child is still running. The log keeps the call unanswered until the child's real result arrives. The next turn then writes that result as an edit of the placeholder, so the model reads the real result in its place.

`StopSession` aborts the conversation the same way. Text that was already streamed stays in the log as an assistant message. The harness leaves a response that was cut off out of the model's context, so that message is imported with the next turn like any other, and the model knows what it had said.

# After a restart

A process that dies in the middle of a turn leaves the turn's input unsettled in the store and its run `running` in the database. The boot sweep requeues the run, as described under [runs](./runs.md). What happens next depends on who opens the store.

  - **The same run.** It finds its own request id on the unsettled input and adopts it. Model responses that were committed are not requested again, and finished tool calls are not repeated. A call that was cut off runs again if its verb is safe to repeat: `read`, `plan`, and `status`. Any other call is answered with an interrupted result, and the model decides what to verify.
  - **The same run, after its answer.** The process died after the answer was committed and before the run was closed. The run finds nothing new and sees that the newest answered input is its own message. It returns that answer and does not ask the model again. The same check covers a message whose run finds it was already taken in and answered by the turn before it.
  - **A different run.** The earlier run failed or was canceled across the restart. The work it left is aborted, calls without a result get the runtime's "interrupted by a service restart" result in the log, and the context is rebuilt.

# What Seed does not use

  - **Compaction.** Seed never replaces history with a summary. A conversation that outgrows its context is carried into a successor session by the agent. See [session continuation](./session-continuation.md).
  - **The harness's own retries.** A failed turn is retried by the run queue, which knows whether a person is waiting. Only a single request's transient failures (a dropped connection, 429, 5xx) are retried in place, twice.
  - **Pi's coding tools and execution environment.** The only tools installed are Seed's verbs.

# Open work

  - A message sent while a turn runs waits for the next turn. Pi Durable can hand it to the running turn at the next tool boundary.
  - A turn that is resumed after a restart knows which calls parked it, because their placeholders say so. It does not know that `continue_session` or `return_result` had already ended it, if the process died in the instant between that call and the end of the turn. The resumed turn then asks the model once more.
  - A rebuild writes the whole log into the store again. Rebuilds are rare (a retry, a restart repair), but a session that hits many of them grows its store with each one.
  - The store's main file grows with every commit and Pi Durable never compacts it. Thirty turns of streamed answers come to about 200 KB. The durable commit and the log write are still two separate writes, even though they now land in the same database. Putting both in one transaction would remove the reconciliation at open.

# See also

- [System overview](./system-overview.md)
- [Persistence](./persistence.md)
- [Log](./log.md)
- [Runs](./runs.md)
- [Model providers](./model-providers.md)
- [Session continuation](./session-continuation.md)
- [Agents roadmap](./roadmap.md)
