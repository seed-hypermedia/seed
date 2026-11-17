---
name: Log
summary: The log is the append-only record of everything that happened in a session, shared by the person and the agent, with every event stamped with its actor.
---
**Log**: everything that happened in a thread, as an append-only list of events: messages, tool calls, spawned children (`tool_spawn`), results, and errors. The plan is not an event: it lives on the session and shows as a card. Each event names its [actor](./actor.md). The person and the agent write to the same log, and the person adds to it with the [wrench palette](./wrench-palette.md). The log is `session_events` in [persistence](../operate/persistence.md). <!-- id:xVgDNEcp -->

The log is one of the three nouns of the runtime, beside the [Space](./space.md) and [Runs](./runs.md). Each [session](./session.md) has exactly one. This page says what an event is, who writes to the log, and how the log relates to what the model reads.

# Events

Every event has a sequence number, `seq`, that only grows within its session. Nothing is edited or removed. There are five kinds.

| Event | Records |
| --- | --- |
| `message` | something said: by a person (`role: 'user'`), by the model (`assistant`), or by the server |
| `tool_call` | a verb was called, with its name and input |
| `tool_result` | what the call returned, as `output` or as `error` |
| `tool_spawn` | a `delegate` call created a child, with the child's run and, for a model child, its session |
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

A few rules follow from these shapes.

- **A failed tool is a result, not a crash.** A tool failure becomes `tool_result.error`, so the model can respond to it.
- **A spawn is not a result.** `delegate` appends `tool_spawn` the moment its child exists, so a transcript can open the child while it works. The call stays without a `tool_result` until the child finishes. The spawn is never replayed to the model.
- **Provenance is stamped once.** `meta` carries what cannot be recovered later: the account and the exact signer of a person's message, or the model, provider, reasoning level, token usage and duration of a model's. The account and the signer differ when a person acts through an authorized device or a delegated key.
- **Some things are not events.** The [plan](./plan.md) is kept on the session and changed in place, so a `plan` call writes no event. Text that is still streaming is sent to subscribers and not stored; only the finished message is.

# Who writes to it

The log is shared. The person holds the same verbs the agent does, and there is no side channel between them.

- **A person** writes messages, and can run `read`, `write` and `call` from the [wrench palette](./wrench-palette.md). Those calls and their results land in the log as `user` events, and the agent reads them on its next turn as it reads its own.
- **The agent** writes its replies and its tool calls.
- **The server** writes notes about the conversation: the reminder of what a turn still owes, the notice that a run ended with something open, and the handoff that opens a continued session.
- **A trigger** that starts a session writes its first message, which reads as a `user` message.

The [actor](./actor.md) page says how each event names who did it.

# The log and what the model reads

The log is the canonical record, the one people and clients read. The model reads a parallel copy, the session's [durable store](./durable-sessions.md), which keeps each provider response exactly as it arrived. The two are kept in step from both sides, and a store that is lost is rebuilt from the log.

Not everything in the log reaches the model in the same form. A verb a person ran is shown to the model as a `<user_action>` block, because a provider has no notion of a tool call made by the user. What the model is given besides the conversation is on [what an agent is told](./prompt.md).

# Reading it

- `GetSession` returns a session's events, and with `afterSeq` only those after that point. A `sessions/<id>` [WebSocket subscription](../build/websocket-subscriptions.md) replays the same way and then streams new events.
- The agent reads a transcript of its own with `read thread:<id>`, as lines of the form `[seq] who: text`.
- In the app, the [session page](./in-the-app.md) turns events into rows and interleaves finished run cards.

Keeping the record honest is a security property as well as a product one. See the [security model](./security.md).

# See also <!-- id:MUjMZKiw -->

- [Session](./session.md)
- [Actor](./actor.md) <!-- id:vzISkCE4 -->
- [Space](./space.md) <!-- id:dPArju-L -->
- [Runs](./runs.md) <!-- id:a9Y9KdmM -->
- [Durable sessions](./durable-sessions.md)
- [Wrench palette](./wrench-palette.md) <!-- id:VicfIXdH -->
- [Persistence](../operate/persistence.md) <!-- id:cu7glc4v -->
- [Agents glossary](./glossary.md) <!-- id:PgDRssDP -->
