---
name: Tool Document
summary: "A tool document is the content-addressed record in an agent's tools folder that describes one tool, whether built in, authored as a lambda, or projected from an MCP server."
---
**tool document**: every tool is a content-addressed document in `~/tools/`, stored as [DAG-CBOR](../protocol/blobs.md) with its [CID](../protocol/blobs.md) as its version. It is one of three kinds. A **builtin** is bound in the runtime. A **lambda** is authored source that runs in the sandbox through [call](./call.md). An **mcp** document projects one tool on a remote [MCP server](./mcp.md), and `call` proxies to it. See [tools](./tools.md). <!-- id:xCacrD0j -->

# See also

- [Contract](./contract.md)
- [Space](./space.md)
- [Space index](./space-index.md)
- [Call](./call.md)
- [MCP servers](./mcp.md)
- [Tools](./tools.md)
- [Persistence: tool documents](./persistence.md)
