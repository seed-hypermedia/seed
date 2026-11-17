---
name: Actor
summary: The actor of an event in a session log is who did it, which is a person, the agent or the server.
---
The **actor** is who did something. Every event in the [log](./log.md) has one: `user`, `agent` or `system`. For example, a message you type has the actor `user`, and the model's reply has the actor `agent`. <!-- id:laPsThQm -->

The actor exists because the log is shared. A person holds the same [verbs](./tools.md) as the [agent](../agent.md), so the kind of an event does not say who did it. A [`read`](./read.md) call can come from the agent or from a person who [ran the tool themselves](./wrench-palette.md).

| Actor | Events |
| --- | --- |
| `user` | a person's messages, and the calls and results of verbs a person ran |
| `agent` | the model's replies and its own tool calls and results |
| `system` | notes the server writes, such as the reminder of an open [obligation](./obligations.md), and errors |

# How the actor is recorded

The server writes the actor on an event only when a person or the server itself did it. Everything else is the agent's. So an event with no actor written on it gets its actor from its shape:

- a message with the user role is `user`;
- an error is `system`;
- everything else is `agent`.

Old events may have no actor written on them. A program that reads the log must never treat the field as required.

A fourth value, `trigger`, exists in the type. The server never writes it. A message that a [trigger](../trigger.md) started counts as `user`.

# What the actor changes

- **In the app.** The app checks the actor before the role when it draws a row. A tool row that a person ran carries a **You** chip. A system message is drawn as a quiet note.
- **For the agent's tools.** Calls a person made do not count toward [promotion](./promotion.md). So what a person does never changes the agent's tools.

# See also <!-- id:byl9YOUg -->

- [Log](./log.md) <!-- id:NeI2r10y -->
- [Running a tool yourself](./wrench-palette.md) <!-- id:9UdeFK7e -->
- [Trigger](../trigger.md) <!-- id:yGXkjGj7 -->
- [Session](./session.md)
- [Persistence: session events](../operate/persistence.md) <!-- id:AWvyzGfH -->
- [Agents glossary](./glossary.md) <!-- id:yKQf--ew -->
