---
name: Promotion
summary: Promotion makes a tool a real provider tool for the rest of a thread, once the tool's contract has appeared in that thread.
---
**Promotion** turns a tool the [agent](../agent.md) has used into a tool the model can call directly. It happens when the tool's [contract](./contract.md) enters the transcript, through a [read](./read.md) of the tool or a [call](./call.md) of it. From then on, the [model provider](./model-providers.md) is given the tool for the rest of the thread. <!-- id:Zw253_02 -->

For example, after the agent runs `call {tool: "search", …}` once, the model can call [`search`](./callables.md) itself, with no `call` around it.

- The runtime works out what is promoted only from saved events. So promotion survives a restart.
- Promotion never adds a tool the agent is not allowed. The allowed tools are the callables the agent is [granted](./grants.md) and the tools of its enabled [MCP servers](./mcp.md).
- A promoted tool and a `call` of it behave the same: same checks, same code.
- A tool that a person runs themselves (see [running a tool yourself](./wrench-palette.md)) does not promote anything.

The full rule, with the filter that makes it a security control, is under [touch-expand and promotion](./tools.md#touch-expand-and-promotion). [MCP servers](./mcp.md) covers remote tools.

# See also <!-- id:DEoAyQMp -->

- [Contract](./contract.md) <!-- id:gCu_zFHk -->
- [Call](./call.md) <!-- id:t9fLrdY1 -->
- [Tool document](./tool-document.md) <!-- id:nBHnC0Co -->
- [Grants](./grants.md) <!-- id:sF4AiuOC -->
- [Tools](./tools.md) <!-- id:h_w2na1h -->
- [Security](./security.md) <!-- id:V765ocpt -->
