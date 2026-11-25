---
name: Session
summary: A session, also called a thread, is one conversation with an agent, made of a log that only grows and moved forward one turn at a time.
---
A **session** is one conversation with an [agent](../agent.md). It is like one chat: you send a message, the agent answers, and the whole exchange is saved. These pages also call it a **thread**. The model sees the address `thread:<id>`, and the two words mean the same thing.

A session holds a [log](./log.md) of everything that happened in it, and it moves forward in **turns**. This page says what a session is made of and how its turns work. The exact fields and actions are in the [signed API](../build/signed-api.md) and in [persistence](../operate/persistence.md).

# What a session is made of

- **An agent.** A session belongs to one agent. The server stores it under the [account](../protocol/identity.md) that owns that agent, whoever takes part in it.
- **A log.** The list of events, which only grows: messages, tool calls, results and errors. The log is the true record of the session. See [log](./log.md).
- **A title and a description.** The title says what the whole session is about. The description says how the work stands at this moment. Both show in session lists.
- **A status.** `idle`, `streaming` or `error`. The type also allows `stopped`, which the server never sets.
- **A plan.** The checklist the agent keeps with the [plan](./plan.md) verb. It lives on the session, not in the log, and shows as the run card.
- **Files.** A file that a person drops into the message box is private to the session. The server stores it with the session, the agent reads it with `read attachment:<id>`, and it is deleted with the session. It is never copied to memory or published unless the agent does that itself. A file may be up to 100 MiB, and a session may hold 200 files.
- **Optional overrides.** A session can set its own model and its own [thoroughness](./delegation-budgets.md) preset, in place of the agent's.
- **A parent, sometimes.** A session that another session started, as a model [child](./child.md) of [delegate](./delegate.md), records its parent and the [run](./runs.md) it is the transcript of. Lists of sessions leave children out and show them under their parents.
- **A successor or a predecessor, sometimes.** A session that was [continued](./session-continuation.md) links to the new session that took over, and the new session links back.

Next to the log, each session has a [durable store](./durable-sessions.md): the same conversation in the exact form the model reads it. The log is the record. The store is the model's view of it.

# Turns

A **turn** is one model run of a session, from a message or a wake to the reply. Every turn is a [run](./runs.md) of kind `agent`. In a turn the model may answer at once, or call tools many times first.

A turn starts when:

- a person sends a message;
- a [trigger](../trigger.md) fires and starts a session (see [triggers](./triggers.md));
- a parked run wakes, for example because the children it delegated to have finished (see [park](./park.md));
- a person presses **Retry**, or `continue_session` starts the first turn of a successor session.

Only one turn owns a session at a time. Several people may write to one session at once:

- the server saves and shows each message at once, in the order it arrived;
- nobody is refused because the agent is busy;
- the turns wait in a queue and run one after another;
- a message that arrives while a turn is running is answered by the next turn.

A turn can end early:

- `delegate` parks the run until its children finish.
- `continue_session` hands the conversation to a successor session.
- `StopSession` stops the turn. Text that was already streamed stays in the log.
- A turn that fails leaves an error event, and **Retry** runs it again.

# Status

A session's status follows its runs:

- `streaming` while the session has any run that has not ended;
- `error` when its latest run failed;
- `idle` otherwise.

The [runs](./runs.md) table holds the truth about what is live. So a crash cannot leave a session stuck in `streaming`. When the server starts, it puts interrupted runs back in the queue, and the status follows.

# Title and description

A new session has no real title. A title that a client sends when it creates the session is only a placeholder. A session can get a real title in three ways, and a title a person typed always wins:

- **A person** types one (`UpdateSession`). Nothing automatic overwrites it.
- **The agent** sets it with the `status` verb, described under [tools](./tools.md). The agent sets the title once, early, and updates the description as the work moves on. When the topic changes a lot, the agent should [continue the session](./session-continuation.md), not rename it.
- **The server** names a session that still has no real title. It starts as soon as the turn is running, and tries again when the turn parks or ends, three times at most. It makes one small model call with no tools, on the session's own provider, and stores the first line of the reply. It does not name a session that used the browser. An operator can turn this off (`SEED_APPS_SESSION_TITLE_GENERATION`).

A session created by `continue_session`, and a child with a title, are named by the agent that created them.

# Unread activity

Each session records when its latest message arrived and who sent it: a person, a trigger or the agent. Tool activity and child sessions do not move that mark. The agent carries the same mark for all its sessions together, with a flag that says whether it is busy. Lists use these to show which chats hold something unread, without reading any transcript.

# Deleting a session

Deleting a session deletes its log, its durable store and its files. Its runs keep their history without it. Its child sessions become top-level sessions.

# Working with it

- `CreateSession`, `GetSession`, `ListSessions`, `UpdateSession`, `DeleteSession`, `MessageSession`, `StopSession` and `RetrySession` in the [signed API](../build/signed-api.md). Creating and messaging accept a client id, so sending the same request twice does no harm.
- `GetSession` with `afterSeq` returns only the events after that point. A `sessions/<id>` [WebSocket subscription](../build/websocket-subscriptions.md) replays the same way and then streams new events and live partial text.
- Who may read or write a session follows the agent's [access levels](./sharing.md#access-levels).
- The agent reads its own threads with `read thread:<id>`. It never reads another agent's threads.
- In the app, the [session page](./in-the-app.md) shows the log, the message box and the run card.

# See also

- [Log](./log.md)
- [Runs](./runs.md)
- [Durable sessions](./durable-sessions.md)
- [Session continuation](./session-continuation.md)
- [Sharing an agent](./sharing.md)
- [Agents glossary](./glossary.md)
