---
name: "Agent tool document"
summary: "A tool as a content-addressed document in the agent's space."
---

Every tool an agent holds is a content-addressed document: **builtins** are runtime bindings, **lambdas** carry TypeScript or Python source run in the execute sandbox, and **mcp** documents are projections of a remote MCP server's advertised tools. The CID is computed over canonical DAG-CBOR exactly as the network encodes blobs — so "what exactly can this agent run" is always answerable, and publishing a tool to the network is publishing bytes that already exist. Input and output are JSON Schemas (open maps here; tools keep their existing schema language).

Referenced from [agent-definition](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-definition)'s `tools` by name.
