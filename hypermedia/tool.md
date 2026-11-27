---
name: Tool
summary: A tool is a document typed hm://hyper.media/tool that holds one function with an input and an output schema, which the server of its app or agent runs in a sandbox and records every call of.
---
A **tool** is a small function that lives in a [document](./protocol/documents.md). For example, a `forecast` tool takes `{city: "Lisbon"}`, asks a weather service on the internet, and returns `{temperature: 21}`. A page, a trigger, an agent or any other client can call it.

The tool's [metadata](./metadata.md) declares `type: hm://hyper.media/tool`. The document holds three things: what goes in, what comes out, and the code. A tool lives directly under an [app](./app.md) or an [agent](./agent.md), called its host. The host lists the tool with a [card embed](./block/embed-view.md). The [app environment](./software/app-environment.md) that runs the host runs the function. The server refuses a tool written anywhere else.

**Call records.** The server records every call with its input and its output. Only the host's writers read a tool's call records, plus whoever made each call. The section "Who reads call records" below has the details.

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
export default async function (input: Input, ctx: {app: string; publicConfig: object; privateConfig: object; memory: Memory; seed: Seed; agent: Agent}): Promise<Output> {
  // ...
}
```

- `ctx.app` is the hm:// id of the host.
- `ctx.publicConfig` is the host's `publicConfig` metadata.
- `ctx.privateConfig` is the private config that the host's server holds. A [signing key](./signing-key.md) field in it holds the account the key signs as, never the key.
- `ctx.memory` reads and writes the host's memory (see "Memory" below).
- `ctx.seed` reads and publishes documents through the host's server (see "Seed access" below).
- `ctx.agent.start` wakes the host agent with a message (see "Starting the agent" below).

# How a tool runs

A tool runs in a sandbox on its host's server. It has internet access, and reaches its own server only for `ctx.seed`; the rest of the server's machine and its private network stay closed. It holds no key and has no language model.

Each call does the same things in order:

1. The server checks that the host runs on it and lists the tool.
2. It checks the input against `inputSchema`. If the input does not match, the answer names the fields the tool does take.
3. It checks the host's private config against `privateConfigSchema`. If a field is missing, the call fails and says which.
4. It runs the tool's latest code in the sandbox.
5. It checks the returned value against `outputSchema`.
6. It records the call.

The caller signs every call. The record holds who called, the tool's version, the input, the output or the error, how long the call took, and what the tool published (`writes`). The server records a failed call too.

# Memory

A tool works in its host's memory: an [agent](./agent.md)'s tools in the agent's own [memory](./agent/memory.md), and an [app](./app.md)'s tools in the app's private memory, which the server that runs the app keeps for it. The memory is the sandbox's working directory, so plain file access works too.

```ts
await ctx.memory.read('receipts/42.done')        // the file's text, or null when it does not exist
await ctx.memory.write('receipts/42.done', 'sent') // a string, or a value written as JSON
await ctx.memory.list('receipts')                  // names, a directory ending in /
await ctx.memory.remove('receipts/42.done')
```

- **Every call** works in the host's memory: only those the host allows may call its tools at all (see "Who calls a tool").
- **Paths** stay inside the memory; a path that leaves it fails.
- **Write files whole, one per event.** Calls, the agent's sessions and its triggers share an agent's memory, so follow the rules on [memory](./agent/memory.md#what-not-to-keep-in-workspace): no shared file read, changed and written back by concurrent calls.
- An agent's Memory tab updates after a tool changes its memory.

# Starting the agent

A tool under an [agent](./agent.md) can start a session with it: cheap code checks whether there is work, and only then does the model run. A scheduled trigger that checks every 5 minutes then costs a model turn only when something changed.

```ts
const {sessionId} = await ctx.agent.start('Three new issues to triage: #12, #14, #15', {
  title: 'Triage',                   // the session's title
  systemPrompt: 'You triage issues.', // extra instructions for this run
  tools: ['read', 'write'],          // a narrower tool list for this run
})
```

- The session runs in the background, as the agent, like a trigger's session.
- Any call the tool runs may start it. A tool that allows viewers lets viewers wake the agent too, so check its input.
- A call may start the agent at most 3 times. The sessions are listed on the call record (`sessions`).
- An app has no agent to start; `ctx.agent.start` fails in an app's tool.

# Seed access

`ctx.seed` sends each request to the host's server, with a token that is valid only while this call runs.

```ts
await ctx.seed.directory(collectionUrl) // the collection's public records: [{url, id, metadata, updateTime}]
await ctx.seed.resource(recordUrl)      // one public document: {url, version, metadata, content}
await ctx.seed.publish(recordUrl, {name, metadata, content}, {as}) // creates or edits it: {url, version}
```

- **Reads** return public documents only. A [private document](./protocol/privacy.md) is refused.
- **Publishing** signs with one of the host's [signing keys](./signing-key.md): the account a signing-key field of its private config names. With one key, it is used; with several, `as` names the field (`ctx.privateConfig.<field>`). `content` is markdown and replaces the body; `metadata` maps are stored one entry per key.
- The key's account must be able to write the target, through a [capability](./protocol/permissions.md) granted to it, like any writer.
- **Every call may publish.** A tool that allows viewers (`callableBy: "viewers"`) lets them make the host publish, so it must check its input itself.
- Every publish is recorded on the call, with the account that signed it.

An app's tools run once a writer of its [space](./protocol/spaces.md) has run the app. An agent's tools run whenever the agent is mounted on its server.

# Who reads call records

A record holds the full input, the full output (or the error) and what the tool published. A tool can read its host's private config and memory, so its output can carry them. The server therefore checks who asks:

- A writer of the host's [space](./protocol/spaces.md) reads every call of the host's tools.
- Any other signed [account](./protocol/identity.md) reads only the calls it made. Someone else's call answers as no call at all.
- Plain HTTP, with no signature, lists only that calls happened: when, how long, and whether each worked. Never what they carried.
- An agent reading `<tool>/:calls` reads as its owner and its signing accounts.

Still follow these rules:

- Never pass a secret, such as a password or an API key, as tool input: the caller and the host's writers see it.
- Put the secrets a tool needs in the host's private config. The tool reads them from `ctx.privateConfig`, and they appear in the call record only if the code returns them.

# Who calls a tool

**Who may call.** The host's writers, and its [triggers](./trigger.md) (which call as their author, a writer). Viewers too, but only when the tool's document sets `callableBy: "viewers"`; for a [private](./protocol/privacy.md) host that still means writers only, since the server cannot yet tell who may read it. Anyone else is refused before the tool runs, and nothing is recorded.

- A [page](./page.md) of the same host, with `seed.app.call(tool, input)`, signed as the viewer. See the [page SDK](./build/page-sdk.md).
- A [trigger](./trigger.md) of the same host. The server records the call as made by the trigger's author.
- An agent, with the [`call` verb](./agent/call.md) and the tool's hm:// URL, signed as the agent's account.
- Any client, through the [signed API](./build/signed-api.md) of the server that runs the host.

# The other things called "tool"

The word has three uses in these docs. They are different things.

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
