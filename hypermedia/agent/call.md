---
name: Call
summary: "The call verb runs a callable tool by name (a built-in tool or a tool from an MCP server) or a tool resource by its hm:// URL, and answers a bad call with the tool's contract."
---
**call** is the verb an [agent](../agent.md) uses to run a tool. The agent names the tool and gives its input. For example, `call {tool: "search", input: {query: "release notes"}}` searches for [documents](../protocol/documents.md). <!-- id:Kw1Jh5MX -->

The tool can be one of three kinds:

- a built-in [callable tool](./callables.md): `search`, `query`, `attributes`, `web_search`, [`execute`](./code-execution.md) or `browser` (`query` and `attributes` work on the [attributes](../metadata.md) of documents);
- a tool from an [MCP server](./mcp.md), named `<server>__<tool>`;
- a tool resource in an app or an agent, named by its [hm:// URL](../protocol/urls.md).

When the input is wrong, `call` returns the tool's [contract](./contract.md) and not only an error, so the next try succeeds. This is **touch-expand**, described in [tools](./tools.md#touch-expand-and-promotion). An agent's [grants](./grants.md) set which tools it may call.

This page covers the verb itself: its input, the order in which it finds a tool, and tool resources. The tools it can run are listed on [callable tools](./callables.md).

# Input

```ts <!-- id:EYgCtp5F -->
type CallInput = {
  tool: string
  input?: object
  description?: string
  saveTo?: string
}
```

A [tool resource](#tool-resources) takes and returns files inside its JSON, as `{name, mimeType, data}` objects with the bytes as base64. A model cannot hold bytes, so the verb stands in on both sides:

- **Sending a file.** Where the tool's input takes a file, write `{"fromPath": "~/memory/incoming/paper.pdf"}` for a [memory](./memory.md) file, or `{"fromAttachment": "<id>"}` for a file attached to the [session](./session.md). Add `"name"` to send it under another name. The server puts the file there before the tool runs.
- **Receiving files.** Each file in the tool's output becomes an attachment of the session. Nothing but that session can read it. In the result, the file is replaced by `{name, mimeType, size, attachment: "attachment:<id>"}`. Read one with [`read`](./read.md), or keep one with [`write`](./write.md) and `options.fromAttachment`.
- **`saveTo`** names a memory folder instead. Each returned file is written under it at its `name`, and the result has `path` in place of `attachment`. Use it when the files belong together, such as a document and its images.

A call made outside a session, by a [trigger](../trigger.md) for example, has no attachments. Its files go to `~/memory/tool-output/<call id>` unless `saveTo` names a folder.

`description` is one short line for the person reading the chat. The chat row shows it in place of the raw input. The server reads it from the saved `tool_call` event and never passes it to the tool. Scripts have the same option as `ctx.call(tool, input, {description})`. <!-- id:NMTvAc3j -->

It is optional because most rows already say what they are about. `search`, `web_search`, `read` and `write` rows name their subject, and MCP rows show the call's first short string argument. Only `execute` needs a description, and it takes one in its own input, because code alone does not say what it is for.

# Dispatch order <!-- id:dSIpKStF -->

`executeCallVerb` (`api-service.ts`) finds and runs the tool in this order: <!-- id:iTHt2YHO -->
  1. If `tool` is an `hm://` URL, it is a [tool resource](#tool-resources): run it on this server, signed as the agent. <!-- id:SWV7WM4u -->
  2. Otherwise look the name up in the registry (`normalizeSeedToolName`). For `execute`, use the contract narrowed to this server. <!-- id:CcdLUkqX -->
  3. If it is not a built-in the agent is granted, look for an enabled MCP tool of that name and pass the call to its server (`executeMcpTool`, see [MCP servers](./mcp.md)).
  4. If nothing matches, return the `~/tools` listing with "No callable tool named …". <!-- id:WixN3gx_ -->
  5. Check `input` against the tool's schema. If it fails, return the contract (touch-expand). <!-- id:euze5A7r -->
  6. Run it: `search`, `query`, `attributes`, `web_search`, `execute` or `browser`. <!-- id:dlSy993f -->

A [promoted](./promotion.md) callable is a real provider tool that runs through the same function (`createAgentServicePiTools`, `api-service.ts`). So a promoted tool and a `call` of it behave the same: same checks, same narrowing, same code. <!-- id:NFz3qyK1 -->

# Tool resources <!-- id:tzwll2x7 -->

An agent has no private code tools. A tool it makes is a **tool resource**: a Seed document of type `hm://hyper.media/tool`. It lives in an [app](../app.md) or in an agent's own document, which lists it with a [card embed](../block/embed-view.md). Apps and agents hold tools the same way. <!-- id:8p-mQ8J7 -->

The tool's code is a folder. Its `index.ts` default-exports `async (input, ctx) => output`, with `ctx.app`, `ctx.publicConfig` and `ctx.privateConfig`.

`call` runs a tool resource by its hm:// URL, for example `hm://SPACE/you/weather/forecast`. The server works out which host the call is for: <!-- id:f-bHTuGv -->

1. the app or agent the tool sits directly under, when that lists it;
2. else the calling agent, when the agent's own document [references the tool](../tool.md#using-someone-elses-tool);
3. else nothing: the tool is on its own, and runs only for an account that can write its space.

- A call always runs. An agent is told to [read](./read.md) a tool's document before its first call: the body is the tool's [documentation](../tool.md#documentation), and the read also returns the input and output schemas. If the agent has not read it in this session, the call also returns the documentation, as `documentation` beside the result, and again when the version that runs has changed. A script's call never carries it.
- The run is signed as the calling agent's [account](../protocol/identity.md).
- It runs the tool's latest code in the sandbox, or the version the agent's reference pins.
- The server records who ran it and which version of the tool ran (`app-running.ts`).
- An app's tools work once someone runs the app. An agent's tools work whenever the agent is [mounted](./mounting.md) on the server.
- Pages in the same app call the tools with `seed.app.call` and read the public config with `seed.app.context()`.

The [tool](../tool.md) and [app](../app.md) pages describe tool resources from the author's side.

# See also <!-- id:_y9RQKFJ -->

- [Callable tools](./callables.md)
- [Read](./read.md) <!-- id:VwFRIl6O -->
- [Write](./write.md) <!-- id:6A0ws6UX -->
- [Tool document](./tool-document.md) <!-- id:gza0s7K0 -->
- [Contract](./contract.md) <!-- id:GNslbfWC -->
- [Promotion](./promotion.md) <!-- id:dxaw-QvX -->
- [Grants](./grants.md) <!-- id:w4eEdvoS -->
- [Tools](./tools.md) <!-- id:tz-dWliG -->
