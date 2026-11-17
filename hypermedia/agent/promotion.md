---
name: Promotion
summary: Once a tool's contract has appeared in a thread, promotion makes it a provider tool for the rest of that thread.
---
**Promotion** is what happens once a tool's [contract](./contract.md) enters the transcript, through a [read](./read.md) or a [call](./call.md): the tool becomes a provider tool for the rest of the thread. The runtime derives this only from durable events, so it survives restarts. Promotion never adds a tool outside the agent's [grants](./grants.md) and its own enabled tool documents. <!-- id:Zw253_02 -->

A promoted tool and a `call` of it behave the same: same validation, same executor. A person's own tool calls from the [wrench palette](./wrench-palette.md) do not promote anything. The full rule, with the filter that makes it a security control, is under [touch-expand and promotion](./tools.md#touch-expand-and-promotion). [MCP servers](./mcp.md) covers remote tools.

# See also <!-- id:DEoAyQMp -->

- [Contract](./contract.md) <!-- id:gCu_zFHk -->
- [Call](./call.md) <!-- id:t9fLrdY1 -->
- [Tool document](./tool-document.md) <!-- id:nBHnC0Co -->
- [Grants](./grants.md) <!-- id:sF4AiuOC -->
- [Tools](./tools.md) <!-- id:h_w2na1h -->
- [Security](./security.md) <!-- id:V765ocpt -->
