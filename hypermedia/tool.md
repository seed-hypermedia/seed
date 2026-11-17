---
name: Tool
summary: A tool is a document typed hm://hyper.media/tool that holds one function with an input and an output schema, which the server of its app or agent runs in a sandbox and records every call of.
---
A **tool** is a small function that lives in a [document](./protocol/documents.md). For example, a `forecast` tool takes `{city: "Lisbon"}`, asks a weather service on the internet, and returns `{temperature: 21}`. A page, a trigger, an agent or any other client can call it.

The tool's [metadata](./metadata.md) declares `type: hm://hyper.media/tool`. The document holds three things: what goes in, what comes out, and the code. A tool lives directly under an [app](./app.md) or an [agent](./agent.md), called its host. The host lists the tool with a [card embed](./block/embed-view.md). The [app environment](./software/app-environment.md) that runs the host runs the function. The server refuses a tool written anywhere else.

**Calls are not private.** The server records every call with its input and its output. Anyone who can reach the server can read those records. Never pass secrets or private data as a tool's input or output. The section "Calls are not private" below has the details.

# What a tool is made of

| Attribute | Value |
| --- | --- |
| `type` | `hm://hyper.media/tool` |
| `name` | the tool's name |
| `summary` | what it does |
| `inputSchema` | a published HM [struct](./struct.md) for its input, by `ipfs://` [CID](./cid.md) or the [hm:// URL](./protocol/urls.md) of a type document. An agent must set it when it publishes a tool. A tool made in the [desktop app](./software/desktop.md) starts without one, and the server then accepts any input. See [schemas](./schema.md) |
| `outputSchema` | optionally, a published HM struct for what it returns |
| `code` | `ipfs://<cid>` of a UnixFS folder whose `index.ts` default-exports the tool |

The code contract is one async function:

```ts
export default async function (input: Input, ctx: {app: string; publicConfig: object; privateConfig: object}): Promise<Output> {
  // ...
}
```

- `ctx.app` is the hm:// id of the host.
- `ctx.publicConfig` is the host's `publicConfig` metadata.
- `ctx.privateConfig` is the private config that the host's server holds.

# How a tool runs

A tool runs in a sandbox on its host's server. It has internet access. It has no signing key, no access to the server's Seed node and no language model. So it neither reads nor publishes documents. The caller passes in the records the tool needs, and the caller does something with the result.

Each call does the same things in order:

1. The server checks that the host runs on it and lists the tool.
2. It checks the input against `inputSchema`. If the input does not match, the answer names the fields the tool does take.
3. It checks the host's private config against `privateConfigSchema`. If a field is missing, the call fails and says which.
4. It runs the tool's latest code in the sandbox.
5. It checks the returned value against `outputSchema`.
6. It records the call.

The caller signs every call. The record holds who called, the tool's version, the input, the output or the error, and how long the call took. The server records a failed call too.

An app's tools run once a writer of its [space](./protocol/spaces.md) has run the app. An agent's tools run whenever the agent is mounted on its server.

# Calls are not private

The server does not check who asks for a tool's call records:

- The signed API gives a tool's calls to any signed [account](./protocol/identity.md) that knows the tool's hm:// id, and one call to any signed account that knows the call id.
- The server also gives a running app's recent calls over plain HTTP, with no signature at all.
- Each record includes the full input and the full output.

So follow these rules:

- Never pass a secret, such as a password or an API key, as tool input.
- Never return private data as tool output.
- Put the secrets a tool needs in the host's private config. The tool reads them from `ctx.privateConfig`, and they do not appear in the call record unless the code returns them.

Making the app's document private does not hide its call records.

# Who calls a tool

- A [page](./page.md) of the same host, with `seed.app.call(tool, input)`, signed as the viewer. See the [page SDK](./build/page-sdk.md).
- A [trigger](./trigger.md) of the same host. The server records the call as made by the trigger's author.
- An agent, with the [`call` verb](./agent/call.md) and the tool's hm:// URL, signed as the agent's account.
- Any client, through the [signed API](./build/signed-api.md) of the server that runs the host.

# The other things called "tool"

The word has three uses on this [site](./protocol/sites.md). They are different things.

| Name | What it is | Where it lives |
| --- | --- | --- |
| **Tool** (this page; the agent pages say **tool resource**) | a Seed document with schemas and code that anyone can read and call | under an app or an agent, on the network |
| **Callable tool** | something an agent reaches through its `call` verb that is not a Seed document: a **builtin** bound in the runtime (`search`, `query`, `web_search`, `execute`…) or a tool projected from a remote [MCP server](./agent/mcp.md) | in the agent's Space, at `~/tools/` |
| **[Tool document](./agent/tool-document.md)** | the content-addressed [DAG-CBOR](./schema/dag-cbor.md) record that describes one callable tool in `~/tools/` | the app environment's database, per agent |

So in the agent pages, "tool document" is a record inside one agent's server state. It is not a document typed `hm://hyper.media/tool`. An agent cannot write code into `~/tools/`. When an agent makes a tool, it publishes a tool in the sense of this page, under an app or under the agent's own document. [Agent tools](./agent/tools.md) is the reference for the verbs and the callable tools.

# See also

- [App](./app.md) and [Agent](./agent.md), the two hosts of a tool.
- [Page](./page.md) and [Trigger](./trigger.md), which call tools.
- [Building an app](./build/building-an-app.md) for writing and publishing a tool.
- [The signed API for apps](./build/signed-api-apps.md) for the actions that call a tool and read its calls.
- [Agent tools](./agent/tools.md) and [tool document](./agent/tool-document.md) for the agent runtime's own tools.
- [The app environment](./software/app-environment.md), which runs the sandbox.
