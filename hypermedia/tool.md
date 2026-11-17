---
name: Tool
summary: A tool is a document typed hm://hyper.media/tool, listed by an app or an agent, that holds one function with an input and an output schema, which the host's server runs in a sandbox and records every call of.
---
A **tool** is a [document](./protocol/documents.md) whose [metadata](./metadata.md) declares `type: hm://hyper.media/tool`. It holds one function: what goes in, what comes out, and the code. It lives directly under an [app](./app.md) or an [agent](./agent.md), which lists it with a card embed, and the [app environment](./software/app-environment.md) that runs that host runs the function. A tool written anywhere else is refused.

# What a tool is made of

| Attribute | Value |
| --- | --- |
| `type` | `hm://hyper.media/tool` |
| `name` | the tool's name |
| `summary` | what it does |
| `inputSchema` | a published HM struct for its input, by `ipfs://` CID or the hm:// URL of a type document. Required. See [schemas](./schema.md) |
| `outputSchema` | optionally, a published HM struct for what it returns |
| `code` | `ipfs://<cid>` of a UnixFS folder whose `index.ts` default-exports the tool |

The code contract is one async function:

```ts
export default async function (input: Input, ctx: {app: string; publicConfig: object; privateConfig: object}): Promise<Output> {
  // ...
}
```

`ctx.app` is the hm:// id of the host, `ctx.publicConfig` is the host's `publicConfig` metadata, and `ctx.privateConfig` is the private config its server holds.

# How a tool runs

A tool is a sandboxed function on its host's server. It has internet access. It has no signing key, no access to the server's Seed node and no language model, so it neither reads nor publishes documents: the caller passes in the records it needs and does something with the result.

Each call does the same things in order:

1. The server checks that the host runs on it and lists the tool.
2. It checks the input against `inputSchema`. A mismatch is answered with the fields the tool does take.
3. It runs the tool's latest code in the sandbox.
4. It checks the returned value against `outputSchema`.
5. It records the call.

Every call is signed by the caller. The record holds who called, the tool's version, the input, the output or the error, and how long it took. A failed call is recorded too. Anyone who can read the tool can read its calls, and calls carry their inputs and outputs, so a tool that handles private data belongs in a private app.

An app's tools run once a writer of its space has run the app. An agent's tools run whenever the agent is mounted on its server.

# Who calls a tool

- A [page](./page.md) of the same app, with `seed.app.call(tool, input)`, signed as the viewer. See the [page SDK](./build/page-sdk.md).
- A [trigger](./trigger.md) of the same host. The call is recorded as made by the trigger's author.
- An agent, with the [`call` verb](./agent/call.md) and the tool's hm:// URL, signed as the agent's account.
- Any client, through the [signed API](./build/signed-api.md) of the server that runs the host.

# The other things called "tool"

The word has three uses on this site. They are different things.

| Name | What it is | Where it lives |
| --- | --- | --- |
| **Tool** (this page; the agent pages say **tool resource**) | a Seed document with schemas and code that anyone can read, fork and call | under an app or an agent, on the network |
| **Callable tool** | something an agent reaches through its `call` verb that is not a Seed document: a **builtin** bound in the runtime (`search`, `query`, `web_search`, `execute`…) or a tool projected from a remote [MCP server](./agent/mcp.md) | in the agent's Space, at `~/tools/` |
| **[Tool document](./agent/tool-document.md)** | the content-addressed DAG-CBOR record that describes one callable tool in `~/tools/` | the app environment's database, per agent |

So "tool document" in the agent pages does not mean a document typed `hm://hyper.media/tool`. It is a record inside one agent's server state. An agent cannot write code into `~/tools/`: a tool an agent makes is a tool in the sense of this page, published under an app or under the agent's own document. [Agent tools](./agent/tools.md) is the reference for the verbs and the callable tools.

# See also

- [App](./app.md) and [Agent](./agent.md), the two hosts of a tool.
- [Page](./page.md) and [Trigger](./trigger.md), which call tools.
- [Building an app](./build/building-an-app.md) for writing and publishing a tool.
- [Agent tools](./agent/tools.md) and [tool document](./agent/tool-document.md) for the agent runtime's own tools.
- [The app environment](./software/app-environment.md), which runs the sandbox.
