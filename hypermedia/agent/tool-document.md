---
name: Tool Document
summary: "A tool document is the content-addressed record in an agent's tools folder that describes one tool, whether built in, authored as a lambda, or projected from an MCP server."
---
**tool document**: every tool is a content-addressed document (DAG-CBOR, CID = version) in `~/tools/`: builtin (runtime binding), **lambda** (authored source, runs in the sandbox via `call`), or **mcp** (a projection of one tool on a remote MCP server, proxied to it via `call`). <!-- id:xCacrD0j -->
