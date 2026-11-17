---
name: Tool Document
summary: A tool document is the content-addressed record in an agent's tools folder that describes one built-in tool or one tool projected from an MCP server.
---
A **tool document** is the record of one tool an agent holds. Every tool is a content-addressed document in `~/tools/` in the agent's [Space](./space.md), stored as [DAG-CBOR](../protocol/blobs.md) with its [CID](../protocol/blobs.md) as its version. It is one of two kinds. A **builtin** is bound in the runtime. An **mcp** document projects one tool on a remote [MCP server](./mcp.md), and [call](./call.md) proxies to it. An agent holds no private code tools: a tool an agent makes is a [tool resource](./call.md#tool-resources) in an app or in the agent's own document. <!-- id:xCacrD0j -->

This page covers what a tool document holds, the two kinds, and how the Space index advertises the documents to the model. The model-facing part of a document is its [contract](./contract.md).

# Tools are documents <!-- id:SM16VRI3 -->

Every tool an agent holds is a content-addressed tool document in its [Space](./space.md), stored per agent in the `tool_documents` table (`apps/src/tool-documents.ts`). A document's [CID](../protocol/blobs.md) is computed over its canonical DAG-CBOR encoding, the same encoding the hypermedia network uses for blobs. So you can always answer "what exactly can this agent run". <!-- id:Tt3S2vFy -->

```ts <!-- id:uGnR-4qi -->
type ToolDocument = {
  name: string
  kind: 'builtin' | 'lambda' | 'mcp'
  summary: string // one line, for the Space index and ~/tools listing
  description: string // full model-facing instructions
  input: JsonSchema
  output?: JsonSchema
  source?: string // lambda source
  runtime?: 'typescript' | 'python' // lambda language, default typescript
  binding?: string // builtin executor id, bound at boot
  server?: string // mcp: the account MCP server the call is proxied to
  remoteName?: string // mcp: the tool's name on that server
}
```

The stored type keeps the `lambda` kind and its `source` and `runtime` fields so that old rows can still be read. Nothing creates one.

<!-- id:P5VOO5bh -->
- **Builtins** are documents whose implementation is a runtime binding. `ensureBuiltinToolDocuments()` creates and refreshes them per agent. Rows are rewritten only when the registry contract changed (the CID differs). A forked builtin keeps its binding, and its divergence from the shipped contract shows as a different CID (`tool-documents.ts`). <!-- id:jx8HtVIW -->
- **Lambdas** do not exist as live tools. On start, the server moves any lambda row into the agent's memory at `~/memory/tools/<name>/` (the code and a `tool.json` with the schemas) and removes it from the registry (`moveLambdaToolsToMemory()`, `tool-documents.ts`). `write ~/tools/<name>` is refused with instructions to publish a tool resource instead.
- **MCP projections** are the tools of the remote [MCP servers](./mcp.md) an agent enables (`definition.mcpServers`). There is one document per tool, named `<server>__<tool>`, reconciled by `syncMcpToolDocuments()` from the server's cached discovery. They carry the remote description and input schema plus `server` and `remoteName`. They cannot be deleted or replaced by hand (disable the server instead), and calls to them are proxied to the server. See [`mcp.md`](./mcp.md). <!-- id:BcWPjduI -->

`ListAgentTools` returns the desktop's view of the same documents: name, kind, summary, description, schemas, `cid`, `enabled`, and `granted` (whether the agent's grant set actually offers it). `SaveAgentTool` is refused with status 410 and the same instructions as a `write` to `~/tools/<name>`. <!-- id:EiFnJN0w -->

# The Space index <!-- id:OmLIl6Dh -->

Every turn's input is followed by a compact `<space>` block built by `buildSpaceIndex()`. It has: <!-- id:hv-y1xqA -->
  - one line per enabled tool document (`- name — summary`). Remote tools are tagged `(<server> MCP)`. An MCP server with more than six tools collapses to one `- <server>__* — N tools …` line. <!-- id:fUDEa-rz -->
  - a one-line summary of top-level memory. <!-- id:MeTMOILl -->
  - a triggers line. It names active [triggers](./triggers.md) and advertises `read ~/triggers/` and `write ~/triggers/<name>` even when no triggers exist, so an agent asked "do this every morning" knows it can create the automation. <!-- id:M-5n-zT_ -->

The index is cached per `(account, agent, callable set)` and invalidated on tool or trigger writes; the memory line is refreshed off the prompt path, so an expensive memory walk is served from the last result rather than delaying the turn. Over `SPACE_INDEX_BUDGET_BYTES` (2048) the per-tool lines collapse to a count, so the index stays accurate and small. <!-- id:DWzJqLum -->

The agent always knows what it _could_ expand, without paying for every contract up front. <!-- id:G7Mcolvq -->

The term page is [Space index](./space-index.md), and the [What an agent is told](./prompt.md) shows where the block sits in a turn.

# See also <!-- id:MzI1UPwM -->

- [Contract](./contract.md) <!-- id:z87kuCJt -->
- [Space](./space.md) <!-- id:Rb0mxFte -->
- [Space index](./space-index.md) <!-- id:u2O6pLag -->
- [Call](./call.md) <!-- id:TBki8M4V -->
- [MCP servers](./mcp.md) <!-- id:5ZaulNmN -->
- [Tools](./tools.md) <!-- id:7PZACIHz -->
- [Persistence: tool documents](../operate/persistence.md) <!-- id:Qaip89h0 -->
