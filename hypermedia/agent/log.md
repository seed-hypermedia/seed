---
name: Log
summary: The log is the append-only record of everything that happened in a thread, shared by the person and the agent, with every event stamped with its actor.
---
**Log**: everything that happened in a thread, as an append-only list of events: messages, tool calls, results, and plan updates. Each event names its [actor](./actor.md). The person and the agent write to the same log, and the person adds to it with the [wrench palette](./wrench-palette.md). The log is `session_events` in [persistence](./persistence.md). <!-- id:xVgDNEcp -->

# See also

- [Actor](./actor.md)
- [Space](./space.md)
- [Runs](./runs.md)
- [Wrench palette](./wrench-palette.md)
- [Desktop UI: the log](./desktop-ui.md)
- [Persistence](./persistence.md)
- [Agents glossary](./glossary.md)
