---
name: Tool Document
summary: A tool document is the content-addressed record in an agent's tools folder that describes one built-in tool or one tool projected from an MCP server.
---
A **tool document** is the stored record of one built-in tool, or of one tool from an MCP server, stored in the same way as a [document](../protocol/documents.md), that an [agent](../agent.md) can call by name. It is listed under `~/tools/` in the agent's [Space](./space.md). For example, `~/tools/search` is the tool document of the built-in `search`. <!-- id:xCacrD0j -->

It is not the same thing as a [tool resource](./call.md#tool-resources), which is a tool someone wrote and published in an app or an agent. An agent has no private code tools.

A tool document is one of two kinds:

- A **builtin** is a tool the runtime itself provides.
- An **mcp** document stands for one tool on a remote [MCP server](./mcp.md). A [call](./call.md) of it is passed on to that server.

Each tool document is stored as [DAG-CBOR](../schema/dag-cbor.md), and its [CID](../cid.md) is its version. This page covers what a tool document holds, the two kinds, and how the Space index shows the tools to the model. The part of a tool document that the model reads is its [contract](./contract.md).

# Tools are documents <!-- id:SM16VRI3 -->

Each agent's tool documents are stored in the `tool_documents` table (`apps/src/tool-documents.ts`). The CID of a tool document is computed over its canonical DAG-CBOR encoding. The Hypermedia network encodes [blobs](../protocol/blobs.md) the same way. So you can always answer the question "what exactly can this agent run". <!-- id:Tt3S2vFy -->

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
- **Builtins** are tool documents whose code is part of the runtime. `ensureBuiltinToolDocuments()` creates and refreshes them for each agent. A row is rewritten only when the registry contract changed (the CID differs). A forked builtin keeps its binding. Its difference from the shipped contract shows as a different CID (`tool-documents.ts`). <!-- id:jx8HtVIW -->
- **Lambdas** do not exist as live tools. On start, the server moves any lambda row into the agent's memory at `~/memory/tools/<name>/` (the code and a `tool.json` with the schemas) and removes it from the registry (`moveLambdaToolsToMemory()`, `tool-documents.ts`). A [write](./write.md) to `~/tools/<name>` is refused, with instructions to publish a tool resource.
- **MCP projections** are the tools of the remote [MCP servers](./mcp.md) an agent enables (`definition.mcpServers`). There is one tool document per tool, named `<server>__<tool>`. `syncMcpToolDocuments()` keeps them in step with the server's cached tool list. Each carries the remote description and input schema, plus `server` and `remoteName`. They cannot be deleted or replaced by hand; disable the server to remove them. Calls to them are passed on to the server. See [MCP servers](./mcp.md). <!-- id:BcWPjduI -->

`ListAgentTools` returns the [Seed app](../software/desktop.md)'s view of the same tool documents: name, kind, summary, description, schemas, `cid`, `enabled`, and `granted` (whether the agent's [grants](./grants.md) offer it). `SaveAgentTool` is refused with status 410 and the same instructions as a `write` to `~/tools/<name>`. <!-- id:EiFnJN0w -->

# The Space index <!-- id:OmLIl6Dh -->

After every turn's input comes a short `<space>` tag built by `buildSpaceIndex()`. It tells the model what it has. It holds: <!-- id:hv-y1xqA -->
  - one line for each enabled tool document (`- name — summary`). Remote tools are marked `(<server> MCP)`. An MCP server with more than six tools becomes one line, `- <server>__* — N tools …`. <!-- id:fUDEa-rz -->
  - a one-line summary of the top level of memory. <!-- id:MeTMOILl -->
  - a triggers line. It names the active [triggers](../trigger.md), and it mentions `read ~/triggers/` and `write ~/triggers/<name>` even when no trigger exists. So an agent asked "do this every morning" knows it can create the automation. <!-- id:M-5n-zT_ -->

The index is cached per [account](../protocol/identity.md), agent, [callable](./callables.md) set and reader level. A tool write or a trigger write clears the cache. The memory line is refreshed away from the prompt path, so a slow walk of memory uses the last result and does not delay the turn. When the index is larger than `SPACE_INDEX_BUDGET_BYTES` (2048), the tool lines become a count. So the index stays correct and small. <!-- id:DWzJqLum -->

The agent always knows what it _could_ open, without paying for every contract first. <!-- id:G7Mcolvq -->

[Space index](./space-index.md) defines the term, and [What an agent is told](./prompt.md) shows where the tag sits in a turn.

# See also <!-- id:MzI1UPwM -->

- [Contract](./contract.md) <!-- id:z87kuCJt -->
- [Space](./space.md) <!-- id:Rb0mxFte -->
- [Space index](./space-index.md) <!-- id:u2O6pLag -->
- [Call](./call.md) <!-- id:TBki8M4V -->
- [MCP servers](./mcp.md) <!-- id:5ZaulNmN -->
- [Tools](./tools.md) <!-- id:7PZACIHz -->
- [Persistence: tool documents](../operate/persistence.md) <!-- id:Qaip89h0 -->
