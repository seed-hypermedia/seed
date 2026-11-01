---
name: App Tool
summary: The page type of one tool of a Seed Agents app, whose attributes name the tool and its runtime and reference its contract and its code by content id, and whose body is the tool's documentation, the instructions the model reads.
---
An **app tool** is one tool of an [app](./app.md). It lives under the app page's `tools` folder, which types its children with this schema, so adding a tool to an app is publishing one more page. Its [attributes](../schema/typed-documents.md) are the tool: `tool`, the name the model calls; `summary`, the line in the model's Space index; `runtime`, the language of the code (`ts`, run with bun, or `python`); `timeoutSecs`, optionally, how long a call may run (up to thirty minutes); `inputSchema`, the contract a call is validated against, an [`ipfs://` reference](../ipfs-url.md) to a DAG-CBOR object holding a JSON Schema, object-rooted and in the subset the server validates, the same an authored lambda's schema follows; `outputSchema`, optional, likewise, what the tool returns; and `code`, an `ipfs://` reference to the source the agents server runs: one file, or a UnixFS folder whose entry is `index.ts` (`ts`) or `main.py` (`python`). The schemas are objects because a JSON Schema needs lists (`required`, `enum`) and a document's attributes hold scalars and maps. All three are references because a page should carry content ids, not payloads: an attribute's text is indexed with every version of the page, and a folder of code has no place in a string.

The body is the tool's documentation: the instructions the model reads with the contract, written as ordinary blocks. The server reads nothing from it.

At mount, the server fetches the code into a cache under its content id and checks every file against it (a file is one raw block of up to 256 KiB; a folder holds at most 64 files and 2 MiB), finds the entry, and reads the schemas. A content id never changes meaning, so the code is fetched once, whichever mounts name it. At each call the server stages the files into a directory of their own in the sandbox the `execute` tool uses, with the agent's memory mounted at `/workspace`, for the mount the account sees, with exactly the hosts the app declares, and runs the entry. The entry point is the lambda ABI with a second argument, the context the mount provides:

```ts
export default async function (input, ctx) {
  // ctx.args: the mount's argument values, secrets included
  // ctx.usage: {unit, reserved} on a metered server-wide mount, the budget this call may spend
  // ctx.app: {slug, scope}; ctx.workspace: where memory is mounted, /workspace in the sandbox
  // lines written to stderr show as live progress in the chat
  return {summary: 'what happened', usage: {units: 3}}
}
```

A Python tool defines `main(input, ctx)`, or `main(input)` when it needs no context. A folder's other files import beside the entry. The return value is the tool's result, checked against `outputSchema` when there is one. A metered tool reports what it spent as `usage.units`, and the server settles the call's reservation to that.

A server that cannot run the runtime, or whose sandbox is off, refuses the mount and says so. So does a page whose references do not hold up: no `inputSchema`, an object that is not a schema in the subset, no `code`, a file whose bytes do not hash to its id, a folder without its entry. The Apps dialog shows the reason, and links each tool's code and contract, so a person can read what will run before trusting it.

# Writing one

In a markdown folder, the page names its files by relative path, and the [folder sync](../build/publish-a-folder.md) publishes them as the blobs the attributes reference, writing them back when the app changes them. The Datalab converter's tool page is laid out this way, with `convert.ts` and the two schema files beside it:

```yaml
---
name: convert
summary: Convert documents from agent memory into markdown with the Datalab parser.
attributesSchema: hm://hyper.media/agent/app-tool
tool: convert
runtime: ts
timeoutSecs: 1800
inputSchema: ./convert.input.json
outputSchema: ./convert.output.json
code: ./convert.ts
---
```

In the app, the Attributes panel shows each reference as a pill: open it to read the code or the schema (a folder lists its files), or upload a file to replace it. An agent publishes a memory file with `write ipfs://` and sets the attribute to the address it gets back.

This page describes the **agent/app-tool** type. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type.

# See also

- [app](./app.md): the app the tool belongs to, which declares the arguments its code receives and the hosts it may reach.
- [Datalab converter: convert](./apps/convert/tools/convert.md): a tool page, whose contract and code are the files beside it.
- [Tool document](./tool-document.md): what an app tool becomes on the agents server.
- [Tools](./tools.md): the lambda ABI the code follows.
- [IPFS URL](../ipfs-url.md): the reference type the three attributes use.
- [Typed documents](../schema/typed-documents.md): how a folder types its children.
