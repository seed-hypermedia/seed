---
name: Session
summary: A session, also called a thread, is one conversation with an agent, made of an append-only log and advanced one turn at a time.
---
A **session** is one conversation with an [agent](../agent.md). These pages also call it a **thread**: the model-facing address is `thread:<id>`, and the two words mean the same thing. A session holds a [log](./log.md) of everything that happened in it, and it moves forward in **turns**. This page says what a session is made of and how its turns work. The exact fields and actions are in the [signed API](../build/signed-api.md) and in [persistence](../operate/persistence.md).

# What a session is made of

- **An agent.** A session belongs to one agent and is stored under the account that owns that agent, whoever takes part in it.
- **A log.** The append-only list of events: messages, tool calls, results and errors. The [log](./log.md) page describes it. The log is the canonical record of the session.
- **A title and a description.** The title says what the whole session is about. The description is the live status of the work. Both show in session lists.
- **A status.** `idle`, `streaming`, `stopped` or `error`.
- **A plan.** The checklist the agent keeps with the [plan](./plan.md) verb. It lives on the session, not in the log, and shows as the run card.
- **Files.** Files a person drops into the composer are session-private. They are stored with the session, the agent reads one with `read attachment:<id>`, and they are deleted with the session. They are never copied to memory or published unless the agent does that itself. A file may be up to 100 MiB and a session may hold 200 of them.
- **Optional overrides.** A session can pin its own model and its own thoroughness preset, in place of the agent's.
- **A parent, sometimes.** A session started by another session, as a model [child](./child.md) of [delegate](./delegate.md), records its parent and the [run](./runs.md) it is the transcript of. Lists of sessions leave children out and show them nested under their parents.
- **A lineage, sometimes.** A session that was [continued](./session-continuation.md) links to its successor, and the successor links back.

Next to the log, each session has a [durable store](./durable-sessions.md): the same conversation in the exact form the model reads it. The log is the record; the store is the model's view of it.

# Turns

A **turn** is one model run of a session, from a message or a wake to the reply. Every turn is a [run](./runs.md) of kind `agent`. In a turn the model may answer at once, or call tools many times first.

A turn starts when:

- a person sends a message;
- a [trigger](./triggers.md) fires and starts a session;
- a parked run wakes, for example because the children it delegated to have finished. See [park](./park.md).

Only one turn owns a session at a time. Several people may write to one session at once: each message is saved and shown at once, in the order it arrived, and nobody is refused because the agent is busy. The turns stay in a queue and run one after another. A message that arrives while a turn is running is answered by the next turn.

A turn can end early. `delegate` parks the run until its children finish. `continue_session` hands the conversation to a successor session. `StopSession` aborts the turn, and text already streamed stays in the log. A turn that fails leaves an error event, and **Retry** runs it again.

# Status

A session's status mirrors its runs. It is `streaming` while any run of the session that has not ended exists, `error` when its latest run failed, and `idle` otherwise. The [runs](./runs.md) table holds the truth about what is live, so a crash cannot leave a session stuck in `streaming`: when the server starts it requeues interrupted runs, and the status follows.

# Title and description

A new session has no title. It can get one in three ways, and a title a person typed always wins:

- **A person** types one (`UpdateSession`). No automatic path overwrites it.
- **The agent** sets it with the `status` verb, described under [tools](./tools.md). The agent sets the title once, early, and updates the description at milestones. A large change of topic calls for a [continuation](./session-continuation.md), not a new title.
- **The server** names a session that is still untitled when a turn parks or ends. It makes one small model call with no tools, on the session's own provider, and stores the first line of the reply. An operator can turn this off (`SEED_APPS_SESSION_TITLE_GENERATION`).

A session created by `continue_session` and a titled child are named by the agent that created them.

# Unread activity

Each session records when its latest message arrived and who sent it: a person, a trigger or the agent. Tool activity and child sessions do not move that mark. The agent carries the same mark rolled up across its sessions, together with a flag that says whether it is busy. Lists use these to show which chats hold something unread without reading any transcript.

# Deleting a session

Deleting a session deletes its log, its durable store and its files. Its runs keep their history without it, and its child sessions become top-level sessions.

# Working with it

- `CreateSession`, `GetSession`, `ListSessions`, `UpdateSession`, `DeleteSession`, `MessageSession`, `StopSession` and `RetrySession` in the [signed API](../build/signed-api.md). Creating and messaging accept a client id that makes a repeat harmless.
- `GetSession` with `afterSeq` returns only the events after that point, and a `sessions/<id>` [WebSocket subscription](../build/websocket-subscriptions.md) replays the same way and then streams new events and live partial text.
- Who may read or write a session follows the agent's [access levels](./sharing.md).
- The agent itself reads its own threads with `read thread:<id>`. It never reads another agent's.
- In the app, the [session page](./in-the-app.md) shows the log, the composer and the run card.

# See also

- [Log](./log.md)
- [Runs](./runs.md)
- [Durable sessions](./durable-sessions.md)
- [Session continuation](./session-continuation.md)
- [Sharing an agent](./sharing.md)
- [Agents glossary](./glossary.md)
