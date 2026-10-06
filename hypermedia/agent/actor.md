---
name: Actor
summary: "Every event in a session log names its actor, the one who did it: a user, the agent, the system, or a trigger."
---
**actor**: who did something, recorded on every event in the [log](./log.md). The declared values are `user`, `agent`, `system`, and `trigger`. Only `user` and `system` are ever stamped on an event; the agent's own messages and tool calls derive `agent` from their shape, and `trigger` is reserved and never written, so a message a trigger started reads as `user`. Calls a person runs from the [wrench palette](./wrench-palette.md) carry `user`. <!-- id:laPsThQm -->

# See also <!-- id:byl9YOUg -->

- [Log](./log.md) <!-- id:NeI2r10y -->
- [Wrench palette](./wrench-palette.md) <!-- id:9UdeFK7e -->
- [Trigger](./trigger.md) <!-- id:yGXkjGj7 -->
- [Tools: the user holds the same verbs](./tools.md) <!-- id:RDqOdzdj -->
- [Persistence: session events](./persistence.md) <!-- id:AWvyzGfH -->
- [Agents glossary](./glossary.md) <!-- id:yKQf--ew -->
