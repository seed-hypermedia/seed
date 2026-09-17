---
name: Call
summary: The call verb runs a callable tool by name, whether a built-in tool, an authored lambda, or a tool from an MCP server, and answers a bad call with the tool's contract.
---
**call**: run a callable tool by name. The tool can be a built-in (`search`, `query`, `attributes`, `web_search`, `execute`), an authored lambda, or a tool from an [MCP server](./mcp.md) (`<server>__<tool>`). When the input is wrong, `call` returns the tool's [contract](./contract.md) instead of an error, so the next try succeeds. This is **touch-expand**, described in [tools](./tools.md). Which tools an agent may call is set by its [grants](./grants.md). <!-- id:Kw1Jh5MX -->

# See also

- [Read](./read.md)
- [Write](./write.md)
- [Tool document](./tool-document.md)
- [Contract](./contract.md)
- [Promotion](./promotion.md)
- [Grants](./grants.md)
- [Tools](./tools.md)
