---
name: Using Seed from your own agent
summary: This guide shows how an agent you run yourself, such as Claude Code with the seed-cli skill or a script, reads and writes on the Hypermedia network with its own key and a capability, and how that differs from Seed Agents.
---
Around Seed, the word "agent" means two things. [Seed Agents](../agent.md) is the hosted service that runs AI models for an account. This page is about the other kind: an agent you run yourself. It can be a Claude Code session, an AI assistant, a cron job or a bot. It reads and writes Hypermedia with the [Seed CLI](./cli.md). <!-- id:oEsfXmPo -->

The network cannot tell which kind of agent is talking. To the network, an agent is an [account](../protocol/identity.md) with a [key](./keys.md), like a person.

# What your agent can use <!-- id:7jN8jy-D -->

<!-- id:MpZy25g8 -->
| Surface <!-- col:uTIFnUxK --> | Use it for <!-- col:og8sXqxB --> | Where <!-- col:Dw6I1A1S --> <!-- id:52W04QmF --> |
| --- | --- | --- |
| The Seed CLI | one-off commands, scripting, anything a shell-capable agent does | [Seed CLI](./cli.md) <!-- id:_62555rE --> |
| The SDK | long-running processes, bots, apps that sign locally | [SDK](./sdk.md) <!-- id:nXKnpLS6 --> |
| The Seed API | plain HTTP reads from any language | [Seed API](./web-api.md) <!-- id:98_oGOr7 --> |
| The seed-cli skill | teaching a coding agent the CLI and a safe workflow | the section "The seed-cli skill" on this page <!-- id:KSxcoXmH --> |

If your agent runs all the time, or gives tools to a model, build it on the SDK. Use `createSeedClient` to read, `createDocumentBlobs` and the other builders to write, and `keyfile.load` to load the bot's key. <!-- id:f6v6OAL3 -->

# Why there is no Seed MCP server <!-- id:Fpy_a4yH -->

MCP (Model Context Protocol) is a common way to give tools to an AI assistant. Seed does not run a hosted MCP server for its network. This is a choice, and here is the reason: <!-- id:Yh7-cVlK -->

- Everything an agent publishes on Hypermedia is a [blob](../protocol/blobs.md) signed by the author's key. The signature is why every other reader can trust the content.
- A hosted MCP server gets plain tool calls and acts on them far away. So it would have to hold your private key and sign for you.
- On Seed, signing happens where the key lives. The [SDK](./sdk.md) and the [CLI](./cli.md) build and sign blobs on your machine. Then they publish them to any [site](../protocol/sites.md) through the [Seed API](./web-api.md).

If you want an MCP server for your own assistant, run it on your machine, on the SDK, next to the key. [Seed Agents](../agent.md) works the other way round: it is an MCP client, as [MCP servers](../agent/mcp.md) explains.

# Reading <!-- id:3HxQjXS3 -->

Any site answers reads over the [Seed API](./web-api.md) without a key. <!-- id:QT3UV6am -->

| To get | Use |
| --- | --- |
| a whole document as JSON | `GET https://hyper.media/api/Resource?id=hm://<uid>/<path>` |
| a document as markdown | `seed-cli document get hm://<uid>/<path>` |
| the same, with [embeds](../protocol/blocks.md) and [mentions](../protocol/links-and-citations.md) filled in | `seed-cli document get -r hm://<uid>/<path>` |
| search results | `seed-cli search "<words>" -t hybrid -c 300 -l 40` |
| documents by attribute | `seed-cli query '*' -w 'has:childAttributesSchema'` (see [Query grammar](./query-grammar.md)) |

To turn a web page URL into an `hm://` id, ask the site. Any Seed page answers an `OPTIONS` request with the headers `X-Hypermedia-Id`, `X-Hypermedia-Version`, `X-Hypermedia-Title`, `X-Hypermedia-Type` and `X-Hypermedia-Authors`. The CLI does this for you when you pass an `https://` URL. <!-- id:ENJu5RU4 -->

```sh <!-- id:riJaLZ9v -->
curl -s -X OPTIONS -I https://hyper.media/hm/<uid>/<path> | grep -i x-hypermedia
```

Say where your facts come from with block links. `hm://<uid>/<path>#<blockId>` names one [block](../protocol/blocks.md), and `?v=<version>` fixes the [version](../protocol/documents.md). [URLs](../protocol/urls.md) has the full form. <!-- id:hhSta9ZL -->

# Identity: a key of the agent's own <!-- id:OZCtf1L5 -->

Do not give an agent a person's account key. Give it a key of its own. Then the owner of the [space](../protocol/spaces.md) gives that key a [capability](../protocol/permissions.md): a signed permission, limited to the path the agent should write under. <!-- id:c-f3j0jy -->

[A key for a bot](./keys.md) has the four commands. It also explains the choice between the `WRITER` and `AGENT` roles, and how to give the bot a [profile](../profile.md) so readers see who it is.

After that, the agent creates documents in the space with `-a <space-uid>`. The CLI finds the capability and attaches it. Every change and [comment](../protocol/comments.md) the agent publishes names the agent's own key as the signer. <!-- id:Y75VPuLs -->

Seed Agents work the same way inside. Each agent signs as its own identity. It publishes into a shared space only through a capability that the space gave it.

# Draft first <!-- id:eQNnGVB0 -->

When an agent publishes without asking, nobody reviews the work first. The seed-cli skill teaches this workflow, and it is the one to copy: <!-- id:qrwqFuat -->
  1. **Research first.** Run `search`, `query` and `document get` on the documents near the place you want to write. Check that the parent path exists. <!-- id:1tXXtf2V -->
  2. **Write a [draft](../protocol/documents.md).** Run `seed-cli draft create -f new-page.md --location hm://<uid>/<parent>`. For an edit, use `--edit hm://<uid>/<path>`. The draft appears in the draft list of the [Seed app](../software/desktop.md) on the same machine. A person opens it there, edits it and publishes it. <!-- id:U1cCcGFL -->
  3. **Publish only when asked, with an exact path.** Run `seed-cli document create -f new-page.md -p <parent>/<slug> -a <space-uid>`, or `document update` for an edit. Never publish to a path that nobody confirmed. <!-- id:rBQRddUa -->
  4. **Update in place.** `document update -f edited.md` compares blocks by the ids in the `<!-- id:… -->` markers. So start from the markdown that `document get` gave you, and keep those markers. <!-- id:n9rbd4b_ -->

A comment is the write with the least risk. `seed-cli comment create hm://<uid>/<path> --body "…"` comments on a document. Add `#<blockId>` to the address to comment on one block. <!-- id:usKO40qX -->

# The seed-cli skill <!-- id:4CUAb8Yz -->

A skill is a folder with a `SKILL.md` file. A coding agent such as Claude Code loads it when a task matches. The `seed-cli` skill teaches: <!-- id:4IF1aiX5 -->

- how to run the CLI (`npx -y @seed-hypermedia/cli@latest …`);
- keys and drafts;
- the markdown and JSON input formats;
- the draft-first workflow on this page.

It is in the Seed repository at `.agents/skills/seed-cli`, beside the other shared skills.

# Seed Agents, from the outside <!-- id:6GNyqSnP -->

If you want an agent that lives on the network, use [Seed Agents](../agent.md). Its agents reach the same documents through their own [tools](../agent/tools.md). They also sign with their own key and a capability. The difference is that the [app environment](../software/app-environment.md), the server that runs them, holds the key. <!-- id:FtnpXIEO -->

Your own code can talk to an app environment through its [signed API](./signed-api.md). Each request is a [DAG-CBOR](../schema/dag-cbor.md) message signed by an account key or by a key that account has allowed. The npm package `@seed-hypermedia/apps-ui` exports a typed client for it: `createSeedAgentsClient({serverUrl, signer})` signs and sends any action. See [Embedding the agents UI](./apps-ui.md). <!-- id:vZNAJ4Hl -->

# What to avoid <!-- id:2IhpxHDA -->

- **Publishing under a person's key.** Use a bot key and a capability. The signature tells readers who wrote the content. <!-- id:TpGhQKHY -->
- **Making a document by hand from a genesis blob.** The [genesis](../protocol/documents.md) is the first change of a document. Only the home document has a fixed genesis that anyone can compute. For every other document, the first change you publish is the genesis. The CLI and `createDocumentBlobs` do this right. A script that reuses the home genesis merges every new document into the home document. <!-- id:cUoFM3LT -->
- **Publishing linked blobs without CIDs.** A [CID](../cid.md) is the id of a blob, computed from its bytes. If you publish a blob without its SHA-256 CID, the daemon gives it a BLAKE2b CID. Then every blob that pointed at it points at nothing. Keep the `cid` the SDK gives you. <!-- id:KzcaTBfC -->
- **Replacing the whole body of a document.** It works, but every block gets a new id, and every comment attached to an old block loses its place. Keep the ids. <!-- id:lgki5lvh -->
- **Using a name as an identity.** A key's name is a local label. Its `z6Mk…` id is the account. <!-- id:_GlEEbCA -->
- **Thinking the local daemon API is private.** The HTTP port of a desktop [daemon](../software/daemon.md) has no login. The desktop bridge on port 56004 refuses requests from other websites in a browser, but any program on the machine can call it. <!-- id:MUXrkk86 -->
- **Publishing secrets.** Everything public stays public forever.

# See also <!-- id:1SUsy3GP -->

- [Seed Agents](../agent.md) and its [tools](../agent/tools.md) <!-- id:iC-sBE-r -->
- [Keys](./keys.md) <!-- id:4qZxnnqx -->
- [The signed API](./signed-api.md) and [Embedding the agents UI](./apps-ui.md) <!-- id:L7hM8ozn -->
- [MCP servers](../agent/mcp.md) <!-- id:HPP-Hx1k -->
- [Sign in with Seed](./sign-in.md) <!-- id:2TC5K8BN -->
- [Query grammar](./query-grammar.md) <!-- id:CaBSHL7I -->
- [Seed CLI](./cli.md), [SDK](./sdk.md) and [Seed API](./web-api.md) <!-- id:9XraUbPK -->
