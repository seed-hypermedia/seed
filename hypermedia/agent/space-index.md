---
name: Space index
summary: The Space index is the short block sent with every turn that lists an agent's tools, the top level of its memory and its active triggers.
---
The **Space index** is a short list of what an [agent](../agent.md) has. The model reads it at the start of every turn, as a piece of text named `<space>`. It has one line per tool, a summary of the top level of memory, and the names of the active [triggers](../trigger.md). So the agent always knows what is in its [Space](./space.md). <!-- id:JSgsrBTV -->

The index tells the agent what it could look at, without the cost of loading all of it. A tool's full [contract](./contract.md), a memory file and a trigger's details are each one [`read`](./read.md) away.

# What it holds

- One line per enabled [tool document](./tool-document.md): the name and a one-line summary. A tool from an [MCP server](./mcp.md) is tagged with its server. A server with more than six tools becomes one line that gives the count.
- A one-line summary of the top level of [memory](./memory.md).
- A triggers line. It names the active [triggers](./triggers.md). It also says how to read and write triggers when there are none. So an agent asked to "do this every morning" knows it can.

Above 2048 bytes, the tool lines and the trigger names each become a count. So the index stays correct and small.

# When it is built

The index is one of the [per-turn blocks](./prompt.md#per-turn-blocks). The server builds it when a turn starts, sends it after the turn's input, and never stores it.

It is not part of the system prompt, and there is a reason. The index changes when the agent gains a tool or writes a memory file. A system prompt that changed with it would lose the provider's prompt cache for the whole conversation. See [what an agent is told](./prompt.md).

The server caches the index for each agent and its set of [callables](./callables.md). It drops the cache when a tool or a trigger is written. It refreshes the memory line outside the turn, so a slow scan of a large memory never delays a turn.

To see the current index, open the system-prompt dialog of a [session](./session.md). The index is shown after the prompt.

# See also <!-- id:nl7GKdO- -->

- [Space](./space.md) <!-- id:APig2nNl -->
- [Tool document](./tool-document.md) <!-- id:WxTtUxYz -->
- [Contract](./contract.md) <!-- id:KXtwxzcT -->
- [Tools](./tools.md) <!-- id:pZ5BuDdi -->
- [What an agent is told](./prompt.md) <!-- id:zOwTlMQh -->
