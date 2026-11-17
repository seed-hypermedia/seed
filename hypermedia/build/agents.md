---
name: Using Seed from your own agent
summary: How an agent you run yourself, such as Claude Code with the seed-cli skill or a script, reads and writes the Hypermedia network with its own key and a delegated capability, and how that relates to Seed Agents.
---
Two different things are called agents around Seed. [Seed Agents](../agent.md) is the hosted runtime that runs models for an account, with its own verbs, triggers and signed API. This page is about the other kind: an agent you run yourself, such as a Claude Code session, an MCP-capable assistant, a cron job or a bot, that reads and writes Hypermedia with the [Seed CLI](./cli.md). The network does not know which kind of agent is talking. An agent is an [account](../protocol/identity.md) with a [key](./keys.md), like a person. <!-- id:oEsfXmPo -->

# What an external agent can use <!-- id:7jN8jy-D -->

<!-- id:MpZy25g8 -->
| Surface <!-- col:uTIFnUxK --> | Use it for <!-- col:og8sXqxB --> | Where <!-- col:Dw6I1A1S --> <!-- id:52W04QmF --> |
| --- | --- | --- |
| The Seed CLI | one-off commands, scripting, anything a shell-capable agent does | [Seed CLI](./cli.md) <!-- id:_62555rE --> |
| The SDK | long-running processes, bots, apps that sign locally | [SDK](./sdk.md) <!-- id:nXKnpLS6 --> |
| The Seed API | plain HTTP reads from any language | [Seed API](./web-api.md) <!-- id:98_oGOr7 --> |
| The seed-cli skill | teaching a coding agent the CLI and a safe workflow | below <!-- id:KSxcoXmH --> |

For an agent that runs continuously or exposes tools to a model, build on the SDK: `createSeedClient` for reads, `createDocumentBlobs` and the other builders for writes, `keyfile.load` for the bot key. <!-- id:f6v6OAL3 -->

# Why there is no Seed MCP server <!-- id:Fpy_a4yH -->

Seed does not run a hosted MCP server for its network, and this is on purpose. Everything an agent publishes on Hypermedia is a [blob](../protocol/blobs.md) signed by the author's key, and the signature is what makes the content trustworthy to every other reader. A hosted MCP server receives plain tool calls and acts on them remotely, so it would have to hold your private key and sign for you. Signing happens where the key lives: the [SDK](./sdk.md) and the [CLI](./cli.md) build and sign blobs locally, then publish them to any [site](../protocol/sites.md) through the [Seed API](./web-api.md). If you want an MCP interface for your own assistant, run it locally on the SDK, next to the key. [Seed Agents](../agent.md) works the other way: it is an MCP client, as [MCP servers](../agent/mcp.md) explains. <!-- id:Yh7-cVlK -->

# Reading <!-- id:3HxQjXS3 -->

Any site answers over the [Seed API](./web-api.md) without a key. A document in full: `GET https://hyper.media/api/Resource?id=hm://<uid>/<path>`. As markdown the way the CLI prints it: `seed-cli document get hm://<uid>/<path>`, or with [embeds](../protocol/blocks.md) and [mentions](../protocol/links-and-citations.md) inlined, `document get -r`. Search: `seed-cli search "<words>" -t hybrid -c 300 -l 40`. Attribute queries: `seed-cli query '*' -w 'has:childAttributesSchema'`. See [Query grammar](./query-grammar.md). <!-- id:QT3UV6am -->

To turn a web page URL into an id, ask the site. Any Seed page answers an `OPTIONS` request with `X-Hypermedia-Id`, `X-Hypermedia-Version`, `X-Hypermedia-Title`, `X-Hypermedia-Type` and `X-Hypermedia-Authors` headers. The CLI does this for you when you pass an `https://` URL. <!-- id:ENJu5RU4 -->

```sh <!-- id:riJaLZ9v -->
curl -s -X OPTIONS -I https://hyper.media/hm/<uid>/<path> | grep -i x-hypermedia
```

Cite what you read with block links: `hm://<uid>/<path>#<blockId>` names one [block](../protocol/blocks.md), and `?v=<version>` pins the [version](../protocol/documents.md). [URLs](../protocol/urls.md) has the grammar. <!-- id:hhSta9ZL -->

# Identity: a key of the agent's own <!-- id:OZCtf1L5 -->

Do not give an agent a person's account key. Give it a key of its own and a [capability](../protocol/permissions.md) from the owner of the [space](../protocol/spaces.md), scoped to the path it should write under. [A key for a bot](./keys.md) has the four commands, the choice between the `WRITER` and `AGENT` roles, and how to give the bot a profile so readers see who it is. <!-- id:c-f3j0jy -->

The agent then creates documents in the space with `-a <space-uid>`, and the CLI finds the capability and cites it. Every change and comment it publishes names its own key as the signer. Seed Agents use the same shape internally: each hosted agent signs as its own identity and publishes into a shared space only through a capability that space issued. <!-- id:Y75VPuLs -->

# Draft first <!-- id:eQNnGVB0 -->

An agent that publishes on its own is hard to review. The seed-cli skill teaches this workflow, and it is the one to copy: <!-- id:qrwqFuat -->
  1. Research first: `search`, `query`, `document get` on the neighbours of where you intend to write. Confirm the parent path exists. <!-- id:1tXXtf2V -->
  2. Write a [draft](../protocol/documents.md): `seed-cli draft create -f new-page.md --location hm://<uid>/<parent>` (or `--edit hm://<uid>/<path>` for an edit). The draft lands in the Seed app's draft list on the same machine, where a person opens, edits and publishes it. <!-- id:U1cCcGFL -->
  3. Publish only when asked, with an explicit path: `seed-cli document create -f new-page.md -p <parent>/<slug> -a <space-uid>`, or `document update` for an edit. Never publish to a path without confirming it. <!-- id:rBQRddUa -->
  4. Update in place: `document update -f edited.md` diffs by the block ids in the `<!-- id:… -->` comments, so round-trip the markdown you got from `document get` and keep those comments. <!-- id:n9rbd4b_ -->

Comments are the low-risk write: `seed-cli comment create hm://<uid>/<path> --body "…"` on a document, or `…#<blockId>` on one block. <!-- id:usKO40qX -->

# The seed-cli skill <!-- id:4CUAb8Yz -->

A skill is a folder with a `SKILL.md` that a coding agent such as Claude Code loads when a task matches it. The `seed-cli` skill teaches the CLI's install (`npx -y @seed-hypermedia/cli@latest …`), keys, drafts, the markdown and JSON input formats, and the draft-first workflow above. It lives in the Seed repository at `.agents/skills/seed-cli`, beside the other shared skills. <!-- id:4IF1aiX5 -->

# Seed Agents, from the outside <!-- id:6GNyqSnP -->

For an agent that lives on the network, use [Seed Agents](../agent.md). Its agents reach the same documents through their own verbs, described in [tools](../agent/tools.md), and the delegated-key model is the same, with the identity held by the app environment. <!-- id:FtnpXIEO -->

You can talk to an app environment from your own code through its [signed API](./signed-api.md): a DAG-CBOR envelope signed by an account key or a delegated key. The npm package `@seed-hypermedia/apps-ui` exports a typed client for it, `createSeedAgentsClient({serverUrl, signer})`, which signs and sends any action. See [Embedding the agents UI](./apps-ui.md). <!-- id:vZNAJ4Hl -->

# What to avoid <!-- id:2IhpxHDA -->

- **Publishing under a person's key.** Use a bot key and a capability. The signature is the attribution. <!-- id:TpGhQKHY -->
- **Creating documents by hand from a genesis blob.** Only the home document has a deterministic [genesis](../protocol/documents.md). An ordinary document's first change is its genesis. The CLI and `createDocumentBlobs` get this right. A hand-rolled script that reuses the home genesis merges every new document into the home document. <!-- id:cUoFM3LT -->
- **Publishing linked blobs without CIDs.** A blob published without its SHA-256 [CID](../protocol/blobs.md) gets a BLAKE2b CID from the daemon, and anything that referenced it dangles. Keep the `cid` the SDK gives you. <!-- id:KzcaTBfC -->
- **Replacing a document's body wholesale.** It works, but every block gets a new identity and every comment anchored to the old blocks loses its anchor. Round-trip the ids. <!-- id:lgki5lvh -->
- **Mistaking a name for an identity.** A key's name is local. Its `z6Mk…` id is the account. <!-- id:_GlEEbCA -->
- **Treating the local daemon API as private.** A desktop [daemon](../software/daemon.md)'s HTTP port has no authentication. The desktop bridge on port 56004 refuses cross-site browser requests, but a local process can call it. Keep secrets out of what you publish. Everything public stays public forever. <!-- id:MUXrkk86 -->

# See also <!-- id:1SUsy3GP -->

- [Seed Agents](../agent.md) and its [tools](../agent/tools.md) <!-- id:iC-sBE-r -->
- [Keys](./keys.md) <!-- id:4qZxnnqx -->
- [The signed API](./signed-api.md) and [Embedding the agents UI](./apps-ui.md) <!-- id:L7hM8ozn -->
- [MCP servers](../agent/mcp.md) <!-- id:HPP-Hx1k -->
- [Sign in with Seed](./sign-in.md) <!-- id:2TC5K8BN -->
- [Query grammar](./query-grammar.md) <!-- id:CaBSHL7I -->
- [Seed CLI](./cli.md), [SDK](./sdk.md) and [Seed API](./web-api.md) <!-- id:9XraUbPK -->
