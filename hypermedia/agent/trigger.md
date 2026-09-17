---
name: Trigger
summary: A trigger is standing configuration that binds an event source to what the agent should do when it fires.
---
**trigger** — standing configuration binding a **source** (comment, mention, site update, schedule, webhook, or **run-completed**) to a **continuation** (a new thread, a **wake** of a parked run, or a headless **tool** or **script** run). See [triggers](./triggers.md). Readable and writable at `~/triggers/<name>`: the agent creates, edits, enables, and disables its own triggers directly. <!-- id:hNo-TMWM -->
