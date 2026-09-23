---
name: Call
summary: The call verb runs a callable tool by name, whether a built-in tool, an authored lambda, or a tool from an MCP server, and answers a bad call with the tool's contract.
---
**call**: run a callable tool by name. The tool can be a built-in (`search`, `query`, `attributes`, `web_search`, `execute`), an authored lambda, or a tool from an [MCP server](./mcp.md) (`<server>__<tool>`). When the input is wrong, `call` returns the tool's [contract](./contract.md) instead of an error, so the next try succeeds. This is **touch-expand**, described in [tools](./tools.md). Which tools an agent may call is set by its [grants](./grants.md). <!-- id:Kw1Jh5MX -->

# See also <!-- id:_y9RQKFJ -->

- [Read](./read.md) <!-- id:VwFRIl6O -->
- [Write](./write.md) <!-- id:6A0ws6UX -->
- [Tool document](./tool-document.md) <!-- id:gza0s7K0 -->
- [Contract](./contract.md) <!-- id:GNslbfWC -->
- [Promotion](./promotion.md) <!-- id:dxaw-QvX -->
- [Grants](./grants.md) <!-- id:w4eEdvoS -->
- [Tools](./tools.md) <!-- id:tz-dWliG -->
