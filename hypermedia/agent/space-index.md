---
name: Space index
summary: The Space index is the compact block sent with every turn's input that lists an agent's tools, top-level memory, and active triggers.
---
**Space index**: the compact `<space>` block the model reads with every turn's input. It has one line per tool, the top level of memory, and the active triggers, so the agent always knows what it can read in its [Space](./space.md). <!-- id:JSgsrBTV -->

It lets the agent know what it could look at without paying for all of it up front. A tool's full [contract](./contract.md), a memory file and a trigger's details are each one `read` away.

# What it holds

- One line per enabled [tool document](./tool-document.md): the name and a one-line summary. A tool from an [MCP server](./mcp.md) is tagged with its server, and a server with more than six tools collapses to one line that gives the count.
- A one-line summary of the top level of [memory](./memory.md).
- A triggers line. It names the active [triggers](./triggers.md), and it says how to read and write triggers even when there are none, so an agent asked to "do this every morning" knows it can.

Above 2048 bytes the tool lines collapse to a count, so the index stays accurate and small.

# When it is built

The index is one of the per-turn blocks: it is rendered when a turn starts, sent behind the turn's input, and never stored. It is not part of the system prompt. It changes whenever the agent gains a tool or writes a memory file, and a system prompt that changed with it would lose the provider's prompt cache for the whole conversation. See [what an agent is told](./prompt.md).

The server caches the index for each agent and its set of callables, and drops the cache when a tool or a trigger is written. The memory line is refreshed outside the turn, so a slow walk of a large memory never delays a turn.

The session's system-prompt dialog shows the current index after the prompt.

# See also <!-- id:nl7GKdO- -->

- [Space](./space.md) <!-- id:APig2nNl -->
- [Tool document](./tool-document.md) <!-- id:WxTtUxYz -->
- [Contract](./contract.md) <!-- id:KXtwxzcT -->
- [Tools](./tools.md) <!-- id:pZ5BuDdi -->
- [What an agent is told](./prompt.md) <!-- id:zOwTlMQh -->
