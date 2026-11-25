---
name: Log
summary: The log is the record of everything that happened in a session, a list of events that only grows, shared by the person and the agent, where each event has an actor.
---
The **Log** is everything that happened in a thread. It is a list of events that only grows: messages, tool calls, results, and errors. For example, when you ask a question and the [agent](../agent.md) reads a page to answer it, the log holds your message, the `read` call, its result, and the reply. Each event has an [actor](./actor.md): who did it. The person and the agent write to the same log. <!-- id:xVgDNEcp -->

The log is one of the three nouns of the runtime, beside the [Space](./space.md) and [Runs](./runs.md). Each [session](./session.md) has exactly one. This page says what an event is, who writes to the log, and how the log relates to what the model reads. In the database the log is the table `session_events`; see [persistence](../operate/persistence.md).

# Events

Every event has a sequence number, `seq`, that only grows within its session. Nothing is edited or removed. There are five kinds.

| Event | Records |
| --- | --- |
| `message` | something said: by a person (`role: 'user'`), by the model (`assistant`), or by the server (also `role: 'user'`, with `actor: 'system'`) |
| `tool_call` | a [verb](./tools.md) was called, with its name and input |
| `tool_result` | what the call returned, as `output` or as `error` |
| `tool_spawn` | a [`delegate`](./delegate.md) call created a [child](./child.md), with the child's run and, for a model child, its session |
| `error` | the turn failed |

```ts
type SessionActor = 'user' | 'agent' | 'system' | 'trigger'

type SessionEventPayload =
  | {type: 'message'; role: 'user' | 'assistant' | 'tool'; content: string; rawMarkdown?: string;
     blocks?: AgentMessageBlock[]; contextLines?: string[]; attachments?: SessionAttachmentInfo[];
     toolCallId?: string; actor?: SessionActor; meta?: SessionEventMeta}
  | {type: 'tool_call'; id: string; name: string; input: unknown; actor?: SessionActor}
  | {type: 'tool_spawn'; toolCallId: string; name: string; runId: string; sessionId?: string;
     title: string; actor?: SessionActor}
  | {type: 'tool_result'; toolCallId: string; name: string; output?: unknown; error?: string;
     actor?: SessionActor; meta?: SessionEventMeta}
  | {type: 'error'; message: string; actor?: SessionActor}
```

This is shortened. The full type is `SessionEventPayload` in `apps/protocol/src/index.ts`.

A few rules follow from these shapes.

- **A failed tool is a result, not a crash.** A tool failure becomes `tool_result.error`, so the model can respond to it.
- **A spawn is not a result.** `delegate` adds `tool_spawn` the moment its child exists, so a person can open the child while it works. The call has no `tool_result` until the child finishes. The spawn is never shown to the model.
- **Where an event came from is written once.** `meta` carries what cannot be found out later. For a person's message, that is the [account](../protocol/identity.md) and the exact signer. For a model's message, it is the model, the provider, the [reasoning level](./reasoning-levels.md), the token usage and the duration. The account and the signer differ when a person acts through an authorized device or a delegated key.
- **Some things are not events.** The [plan](./plan.md) is kept on the session and changed in place, so a `plan` call writes no event. Text that is still streaming is sent to subscribers and not stored. Only the finished message is stored.

# Who writes to it

The log is shared. The person holds the same verbs as the agent, and there is no hidden channel between them.

- **A person** writes messages. A person can also run [`read`](./read.md), [`write`](./write.md) and [`call`](./call.md) from the message box; see [running a tool yourself](./wrench-palette.md). Those calls and their results land in the log as `user` events. The agent reads them on its next turn as it reads its own.
- **The agent** writes its replies and its tool calls.
- **The server** writes notes about the conversation: the reminder of what a turn still owes, the notice that a run ended with something open, and the handoff that opens a [continued session](./session-continuation.md).
- **A [trigger](../trigger.md)** that starts a session writes its first message, which reads as a `user` message.

The [actor](./actor.md) page says how each event names who did it.

# The log and what the model reads

The log is the true record, the one people and clients read. The model reads a second copy, the session's [durable store](./durable-sessions.md), which keeps each provider response exactly as it arrived. The server keeps the two the same. If a store is lost, the server builds it again from the log.

Not everything in the log reaches the model in the same form. A verb that a person ran is shown to the model inside a `<user_action>` tag, because a provider has no notion of a tool call made by the user. What the model is given besides the conversation is on [what an agent is told](./prompt.md).

# Reading it

- `GetSession` returns a session's events, and with `afterSeq` only those after that point. A `sessions/<id>` [WebSocket subscription](../build/websocket-subscriptions.md) replays the same way and then streams new events.
- The agent reads a transcript of its own with `read thread:<id>`, as lines of the form `[seq] who: text`.
- In the app, the [session page](./in-the-app.md) turns events into rows and puts finished run cards between them.

A log that tells the truth matters for security as well as for the product. See the [security model](./security.md).

# See also <!-- id:MUjMZKiw -->

- [Session](./session.md)
- [Actor](./actor.md) <!-- id:vzISkCE4 -->
- [Space](./space.md) <!-- id:dPArju-L -->
- [Runs](./runs.md) <!-- id:a9Y9KdmM -->
- [Durable sessions](./durable-sessions.md)
- [Running a tool yourself](./wrench-palette.md) <!-- id:VicfIXdH -->
- [Persistence](../operate/persistence.md) <!-- id:cu7glc4v -->
- [Agents glossary](./glossary.md) <!-- id:PgDRssDP -->
