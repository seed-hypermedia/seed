---
name: Actor
summary: "Every event in a session log names its actor, the one who did it: a user, the agent, the system, or a trigger."
---
**actor**: who did something, recorded on every event in the [log](./log.md). The declared values are `user`, `agent`, `system`, and `trigger`. Only `user` and `system` are ever stamped on an event; the agent's own messages and tool calls derive `agent` from their shape, and `trigger` is reserved and never written, so a message a trigger started reads as `user`. Calls a person runs from the [wrench palette](./wrench-palette.md) carry `user`. <!-- id:laPsThQm -->

The actor exists because the [log](./log.md) is shared: the person holds the same verbs as the agent, so an event's kind alone does not say who did it.

| Actor | Events |
| --- | --- |
| `user` | a person's messages, and the calls and results of verbs a person ran |
| `agent` | the model's replies and its own tool calls and results |
| `system` | notes the server writes, such as the reminder of an open obligation, and errors |
| `trigger` | declared, never written |

An event with no stamp gets its actor from its shape: a message with the user role is `user`, an error is `system`, and everything else is `agent`. Events from before actors existed carry no stamp, so a reader must never treat the field as required.

The app checks the actor before the role when it draws a row: a tool row run by a person carries a **You** chip, and a system message is drawn as a quiet note. Calls a person made do not count toward [promotion](./promotion.md), so a person's activity never changes the agent's tools.

# See also <!-- id:byl9YOUg -->

- [Log](./log.md) <!-- id:NeI2r10y -->
- [Wrench palette](./wrench-palette.md) <!-- id:9UdeFK7e -->
- [Trigger](../trigger.md) <!-- id:yGXkjGj7 -->
- [Session](./session.md)
- [Persistence: session events](../operate/persistence.md) <!-- id:AWvyzGfH -->
- [Agents glossary](./glossary.md) <!-- id:yKQf--ew -->
