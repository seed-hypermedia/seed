---
name: Tool
summary: A tool is a document typed hm://hyper.media/tool that holds one function. Its name and summary say what it does, its body is its documentation, its schemas say what goes in and what comes out, and the app or agent that uses it supplies the server, the settings and the secrets.
---
A **tool** is a small function that lives in a [document](./protocol/documents.md). For example, a `forecast` tool takes `{city: "Lisbon"}`, asks a weather service on the internet, and returns `{temperature: 21}`. A page, a trigger, an agent or any other client can call it.

The document's [metadata](./metadata.md) declares `type: hm://hyper.media/tool`. A tool can be created anywhere a document can. An [app](./app.md) or an [agent](./agent.md) uses it by listing it with a [card embed](./block/embed-view.md). That **host** supplies the server, the settings and the secrets, and the [app environment](./software/app-environment.md) that runs the host runs the function. **A tool never names a server.** A tool in no host stands on its own: only the people who can write its [space](./protocol/spaces.md) can run it.

# What a tool is made of

| Part | Where | What it holds |
| --- | --- | --- |
| Name | `name` | the tool's name |
| Description | `summary` | what the tool does, what it takes and gives back, and when to use it |
| Documentation | the document's body | how to use the tool |
| Input | `inputSchema` | a published HM [struct](./struct.md), by `ipfs://` [CID](./cid.md) or the [hm:// URL](./protocol/urls.md) of a type document |
| Output | `outputSchema` | optionally, a struct for what the tool returns |
| Code | `code` | `ipfs://<cid>` of a UnixFS folder whose `index.ts` default-exports the function |
| Settings | `publicConfigSchema` | optionally, a struct of the settings the tool reads from its host |
| Secrets | `privateConfigSchema` | optionally, a struct of the secrets the tool reads from its host. Names only, never values |
| Time limit | `timeoutSecs` | optionally, the longest one call may run, in seconds. 60 without it, 300 at most |

The code is one async function. `ctx.app` is the hm:// id of the host, and `ctx.callId` the id of the call:

```ts
export default async function (input: Input, ctx: {app: string; publicConfig: object; privateConfig: object; callId: string}): Promise<Output> {
  // ...
}
```

The server loads `index.ts` and nothing else. So the code is one self-contained file: it cannot import another file of its folder, and it must not count on a package being installed.

The schemas are [Hypermedia schemas](./schema.md), not JSON Schema:

```json
{
  "type": "hm://hyper.media/struct",
  "properties": {
    "city": {"value": {"type": "hm://hyper.media/string"}, "required": true, "description": "The city to forecast, by name."},
    "units": {"value": {"anyOf": ["metric", "imperial"]}, "description": "metric when left out."}
  }
}
```

Describe every field: a caller fills the field in from its description. A fixed set of choices is a [union](./schema/anyof.md) of words. An agent must set `inputSchema` when it publishes a tool. A tool made in the [desktop app](./software/desktop.md) starts without one, and the server then accepts any input.

# Name and description

An agent that has a tool sees the tool's name and description, and nothing else, until it decides to use the tool. These two lines decide whether the tool is picked, and whether it is picked for the right job.

- The name says what the tool is in a word or two, such as `forecast`.
- The description says, in one or two sentences, what the tool does, what it takes and gives back, and when to use it. How to use it goes in the documentation.

| | Description |
| --- | --- |
| Vague | Weather tool. |
| Precise | Returns today's temperature and rain for one city, given its name. Use it when a text needs the current weather. |

# Documentation

The body of the tool's document says how to use the tool: what to prepare before a call, and what to check and do with the result. A schema cannot say that. Write the body like any document, with links, [embeds](./block/embed.md) and media.

- People read it on the tool's page, above Run.
- An agent reads the tool's document before its first call. [What the agent is told](./agent/prompt.md) lists its tools by name and description only. One read returns the documentation with the input and output schemas.
- No call is turned away to make an agent read. A call to a tool the agent has not read runs, and the documentation comes with the result, once in a [session](./agent/session.md). See the [`call` verb](./agent/call.md).
- A [page](./page.md), a [trigger](./trigger.md) and any other caller do not read it. They call the tool directly.

# Settings and secrets

A tool declares what it needs from its host in two schemas, and reads the values from `ctx`:

| Attribute | Declares | The tool reads | Where the values are kept |
| --- | --- | --- | --- |
| `publicConfigSchema` | settings | `ctx.publicConfig` | in the host's document, as `publicConfig`. Anyone who can read the host can read them |
| `privateConfigSchema` | secrets, such as an API key | `ctx.privateConfig` | on the server that runs the host. They are never published |

**A schema holds names, never values.** It is published with the tool, so a secret in it, even as a default, is readable by everyone and travels with every copy. The same goes for the code and the documentation. Whoever uses the tool supplies their own values.

- **Values are matched by field name.** Two tools that both declare `apiKey` get the same value. Give a secret a name that says whose it is, such as `datalabApiKey`.
- **Declare every secret the tool reads.** A tool gets the secrets it declares and no others. A tool that declares none gets all of its host's secrets while it sits under that host, and none when a host only points at it.
- **A missing required value fails the call.** The error says where to set it.

An app asks for the values in its Settings. An agent's Settings tab shows them as **Tool secrets** and **Tool settings**. The secrets are not put in the agent's [memory](./agent/memory.md), because the model reads its memory. A tool on its own takes them on its own page, for its author's runs.

# Files

A tool takes JSON and returns JSON, and nothing else. A file travels inside that JSON, as an object with exactly three fields:

```json
{"name": "figure.png", "mimeType": "image/png", "data": "iVBORw0KGgo…"}
```

`data` is the file's bytes as base64. `name` may carry folders, such as `assets/figure.png`. The object can sit anywhere in the input or the output, alone or in a list. A tool that works on a file declares such a field in its `inputSchema`, and a tool that makes files returns them the same way.

- The tool stores nothing and publishes nothing. The caller gets the bytes and decides where they go.
- One call takes at most 64 MiB of JSON and returns at most 128 MiB. Base64 makes a file a third larger.
- An agent cannot hold bytes. Its [`call` verb](./agent/call.md) names a file to send, and keeps the returned files beside its session.

# How a tool runs

A tool runs in a sandbox on its host's server. It has internet access. It has no signing key, no access to the server's Seed node and no language model. So it neither reads nor publishes documents: the caller passes in the records the tool needs, and does something with the result.

Each call does the same things in order:

1. The server finds the tool's host and checks that the host runs on it. A tool on its own has no host: any app environment runs it for a caller who can write the tool's space.
2. It checks the input against `inputSchema`. If the input does not match, the answer names the fields the tool does take.
3. It checks that the host holds the secrets the tool declares.
4. It runs the code in the sandbox: the latest version, or the version the host pins.
5. It checks the returned value against `outputSchema`.
6. It records the call, signed by its caller, whether it worked or failed.

A call that passes its time limit fails. So a tool that waits on a slow service returns a job before then, and the caller passes the job back in a second call. An app's tools run once a writer of its space has run the app. An agent's tools need no such step.

# Using someone else's tool

A host uses a tool that lives elsewhere by embedding it: a card embed of the tool's hm:// URL in the host's document. Nothing is copied. The tool stays its author's, and any number of hosts can point at it.

| Embed link | The host runs |
| --- | --- |
| `hm://<space>/<tool>?v=<version>` | that exact version, whatever the author publishes later |
| `hm://<space>/<tool>` | the tool's latest version |

**Pin a tool you do not control.** A host that follows the latest version runs whatever the author publishes next, with the host's secrets. The desktop app offers the pin first for a tool from a space you cannot write, and its **Update** moves the pin to a newer version.

- **The call names the host.** One tool can be in many hosts, so the caller says which host a call is for. An agent names itself. Called with no host, the tool runs as a tool on its own.
- **A copy is a different thing.** It is a new document, and it never changes when the original does.

In the desktop app, open the host's Tools tab and choose **Add existing tool**, or open the tool and choose **Use in an app or agent**. Both ask whether to link the tool at its latest version, link it at the version on screen, or copy it. Someone else's tool starts on the pinned choice, and your own on the latest. The document tree lists the tool under the host, as it lists every document the host has a card of.

# Trying code before publishing it

Someone who can write the host's space can run code that is not published yet, with the host's settings and secrets. Nothing is recorded, and nobody else sees the run. The server checks neither the schemas nor the declared config, because a draft's may not be published.

In the desktop app this is **Run** on the tool's page. It runs the code on the screen, checks the schemas itself, and stays disabled while a required setting or secret is not set. On the [signed API](./build/signed-api-apps.md) it is `TestAppTool`.

# Calls are not private

The server does not check who asks for a tool's call records:

- The signed API gives a tool's calls to any signed [account](./protocol/identity.md) that knows the tool's hm:// id, and one call to any signed account that knows the call id.
- The server also gives a running app's recent calls over plain HTTP, with no signature at all.
- Each record holds the input and the output. A [file](#files) is recorded as its name, type and size, without its bytes. An input or an output over 64 KiB loses its long strings.

So follow these rules:

- Never pass a secret as tool input, and never return one. Declare it in `privateConfigSchema`, and read it from `ctx.privateConfig`.
- Never return private data, except inside a file.

Making the host's document private does not hide its call records.

# Who calls a tool

- A [page](./page.md) of the same host, with `seed.app.call(tool, input)`, signed as the viewer. See the [page SDK](./build/page-sdk.md).
- A [trigger](./trigger.md) of the same host. The server records the call as made by the trigger's author.
- An agent, with the `call` verb and the tool's hm:// URL, signed as the agent's account.
- Any client, through the [signed API](./build/signed-api.md) of the server that runs the host.

# The other things called "tool"

The word has three uses in these docs. They are different things.

| Name | What it is | Where it lives |
| --- | --- | --- |
| **Tool** (this page; the agent pages say **tool resource**) | a Seed document with a description, documentation, schemas and code that anyone can read and call | anywhere a document can, on the network |
| **Callable tool** | something an agent reaches through its `call` verb that is not a Seed document: a **builtin** bound in the runtime (`search`, `query`, `web_search`, `execute`…) or a tool projected from a remote [MCP server](./agent/mcp.md) | in the agent's Space, at `~/tools/` |
| **[Tool document](./agent/tool-document.md)** | the content-addressed [DAG-CBOR](./schema/dag-cbor.md) record that describes one callable tool in `~/tools/` | the app environment's database, per agent |

An agent cannot write code into `~/tools/`. When an agent makes a tool, it publishes a tool in the sense of this page. [Agent tools](./agent/tools.md) is the reference for the verbs and the callable tools.

# See also

- [App](./app.md) and [Agent](./agent.md), the two hosts of a tool.
- [Building an app](./build/building-an-app.md) for writing and publishing a tool.
- [The signed API for apps](./build/signed-api-apps.md) for the actions that call a tool and read its calls.
- [Agent tools](./agent/tools.md) and [tool document](./agent/tool-document.md) for the agent runtime's own tools.
- [The app environment](./software/app-environment.md), which runs the sandbox.
