---
name: Call
summary: "The call verb invokes a callable tool by name, whether a built-in tool, an authored lambda, or a tool projected from an MCP server, and answers a bad call with the tool's contract."
---
**call**: invoke a callable tool by name: a built-in (`search`, `query`, `attributes`, `web_search`, `execute`), an authored lambda, or an MCP projection (`<server>__<tool>`). Wrong input returns the tool's **contract** instead of an error — that's **touch-expand**. <!-- id:Kw1Jh5MX -->
