---
name: Trigger
summary: A trigger is standing configuration that binds an event source to what the agent should do when it fires.
---
**trigger**: standing configuration that binds a **source** to a **continuation**. The source is a [comment](../protocol/comments.md), a mention, a [site](../protocol/sites.md) update, a schedule, a webhook, or **run-completed**. The continuation is a new thread, a **wake** of a [parked](./park.md) run, or a headless **tool** or **script** run. See [triggers](./triggers.md). Triggers live at `~/triggers/<name>` in the [Space](./space.md), and the agent creates, edits, enables, and disables its own triggers there. <!-- id:hNo-TMWM -->

# See also

- [Triggers](./triggers.md)
- [Firing](./firing.md)
- [Trigger continuations](./trigger-continuations.md)
- [Wake source](./wake-source.md)
- [Space](./space.md)
- [Security: agent-managed triggers](./security.md)
