---
name: Call
summary: "The call verb runs a callable tool by name (a built-in tool or a tool from an MCP server) or a tool resource by its hm:// URL, and answers a bad call with the tool's contract."
---
**call** runs a [callable tool](./callables.md) by name. The tool can be a built-in (`search`, `query`, `attributes`, `web_search`, `execute`, `browser`), a tool from an [MCP server](./mcp.md) (`<server>__<tool>`), or a tool resource in an app or an agent, named by its hm:// URL. When the input is wrong, `call` returns the tool's [contract](./contract.md) instead of an error, so the next try succeeds. This is **touch-expand**, described in [tools](./tools.md#touch-expand-and-promotion). Which tools an agent may call is set by its [grants](./grants.md). <!-- id:Kw1Jh5MX -->

This page covers the verb itself: its input, the order in which it finds a tool, and tool resources. The tools it can run are listed on [callable tools](./callables.md).

# Input

```ts <!-- id:EYgCtp5F -->
type CallInput = {tool: string; input?: object; description?: string}
```

`description` is optional intent for the user: one short line the chat row shows in place of the raw input. It is read from the durable `tool_call` event and never passed to the tool. Scripts have the same option as `ctx.call(tool, input, {description})`. It is optional because `search`, `web_search`, `read`, and `write` rows already name their subject, and MCP rows show the call's first short string argument. Only `execute`, whose input is opaque, requires a description in its own input. <!-- id:NMTvAc3j -->

# Dispatch order <!-- id:dSIpKStF -->

Dispatch order in `executeCallVerb` (`api-service.ts`): <!-- id:iTHt2YHO -->
  1. Resolve the name through `normalizeSeedToolName` and the registry. For `execute`, swap in the server-narrowed contract. <!-- id:CcdLUkqX -->
  2. If it is not a granted builtin, look for an enabled document of that name. An **MCP projection** is proxied to its server (`executeMcpTool`, see [`mcp.md`](./mcp.md)). A `tool` that is an hm:// URL is a [tool resource](#tool-resources), called on the server that hosts its app or agent. <!-- id:SWV7WM4u -->
  3. Otherwise return the `~/tools` listing with a "no callable tool named …" summary. <!-- id:WixN3gx_ -->
  4. Validate `input` against the tool's schema. On failure, return the contract (touch-expand). <!-- id:euze5A7r -->
  5. Execute: `search` goes to `executeAgentServiceSearch`, `query` to `executeAgentServiceQuery`, `attributes` to `executeAgentServiceAttributes`, `web_search` to `executeWebSearch`, and `execute` to the sandbox. <!-- id:dlSy993f -->

Promoted callables are exposed as real provider tools that route back through the same function (`createAgentServicePiTools`, `api-service.ts`). A promoted tool and a `call` of it behave identically: same validation, same narrowing, same executor. <!-- id:NFz3qyK1 -->

# Tool resources <!-- id:tzwll2x7 -->

An agent has no private code tools. A tool it makes is a **tool resource**: a Seed document typed `hm://hyper.media/tool` in an [app](../app.md), or in an agent's own document, which lists it with a card embed (apps and agents host tools the same way). Its code is a folder whose `index.ts` default-exports `async (input, ctx) => output`, with `ctx.app`, `ctx.publicConfig` and `ctx.privateConfig`. <!-- id:8p-mQ8J7 -->

`call` runs one by its hm:// URL. The run is signed as the calling agent's account, executes the tool's latest code in the sandbox, and is recorded with who ran it and the tool version (`app-running.ts`). An app's tools run once someone runs the app; an agent's tools run whenever the agent is mounted on the server. Pages in the same app reach the tools with `seed.app.call` and the public config with `seed.app.context()`. <!-- id:f-bHTuGv -->

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
