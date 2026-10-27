---
name: App Tool
summary: The page type of one tool of a Seed Agents app, whose attributes name the tool and its runtime and carry its contract and the code the agents server runs for the spaces that mounted the app, and whose body is the tool's documentation, the instructions the model reads.
---
An **app tool** is one tool of an [app](./app.md). It lives under the app page's `tools` folder, which types its children with this schema, so adding a tool to an app is publishing one more page. Its [attributes](../schema/typed-documents.md) are the tool: `tool`, the name the model calls; `summary`, the line in the model's Space index; `runtime`, the language of the code (`ts`, run with bun, or `python`); `timeoutSecs`, optionally, how long a call may run (up to thirty minutes); `inputSchema`, the contract a call is validated against, a JSON Schema as JSON text, object-rooted and in the subset the server validates, the same an authored lambda's schema follows; `outputSchema`, optional, likewise, what the tool returns; and `code`, the source the agents server runs. The schemas are text because a document's attributes hold scalars and maps, and a JSON Schema needs lists (`required`, `enum`).

The body is the tool's documentation: the instructions the model reads with the contract, written as ordinary blocks. The server reads nothing from it.

The server runs the code in the sandbox the `execute` tool uses, with the agent's memory mounted at `/workspace`, for the mount the account sees, with exactly the hosts the app declares. The entry point is the lambda ABI with a second argument, the context the mount provides:

```ts
export default async function (input, ctx) {
  // ctx.args: the mount's argument values, secrets included
  // ctx.usage: {unit, reserved} on a metered server-wide mount, the budget this call may spend
  // ctx.app: {slug, scope}; ctx.workspace: where memory is mounted, /workspace in the sandbox
  // lines written to stderr show as live progress in the chat
  return {summary: 'what happened', usage: {units: 3}}
}
```

A Python tool defines `main(input, ctx)`, or `main(input)` when it needs no context. The return value is the tool's result, checked against `outputSchema` when there is one. A metered tool reports what it spent as `usage.units`, and the server settles the call's reservation to that.

A server that cannot run the runtime, or whose sandbox is off, refuses the mount and says so. So does a page whose attributes do not hold up: no `inputSchema`, a schema that is not JSON or outside the subset, no `code`. The Apps dialog shows the reason.

```yaml
---
name: convert
summary: Convert documents from agent memory into markdown with the Datalab parser.
attributesSchema: hm://hyper.media/agent/app-tool
tool: convert
runtime: ts
timeoutSecs: 1800
inputSchema: |
  {"type": "object", "properties": {"files": {"type": "array", "items": {"type": "string"}}}, "required": ["files"]}
code: |
  export default async function (input, ctx) {
    // …
  }
---
```

This page describes the **agent/app-tool** type. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type.

# See also

- [app](./app.md): the app the tool belongs to, which declares the arguments its code receives and the hosts it may reach.
- [Datalab converter: convert](./apps/convert/tools/convert.md): a tool page, whose contract and code are its attributes.
- [Tool document](./tool-document.md): what an app tool becomes on the agents server.
- [Tools](./tools.md): the lambda ABI the code follows.
- [Typed documents](../schema/typed-documents.md): how a folder types its children.
