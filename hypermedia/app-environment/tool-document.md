---
name: Tool Document
summary: A tool document is the content-addressed record in an agent's tools folder that describes one tool, whether built in, authored as a lambda, or projected from an MCP server.
---
**tool document**: every tool is a content-addressed document in `~/tools/`, stored as [DAG-CBOR](../protocol/blobs.md) with its [CID](../protocol/blobs.md) as its version. It is one of three kinds. A **builtin** is bound in the runtime. A **lambda** is authored source that runs in the sandbox through [call](./call.md). An **mcp** document projects one tool on a remote [MCP server](./mcp.md), and `call` proxies to it. See [tools](./tools.md). <!-- id:xCacrD0j -->

# See also <!-- id:MzI1UPwM -->

- [Contract](./contract.md) <!-- id:z87kuCJt -->
- [Space](./space.md) <!-- id:Rb0mxFte -->
- [Space index](./space-index.md) <!-- id:u2O6pLag -->
- [Call](./call.md) <!-- id:TBki8M4V -->
- [MCP servers](./mcp.md) <!-- id:5ZaulNmN -->
- [Tools](./tools.md) <!-- id:7PZACIHz -->
- [Persistence: tool documents](./persistence.md) <!-- id:Qaip89h0 -->
