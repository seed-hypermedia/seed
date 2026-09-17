---
name: Using Seed from your own agent
summary: How an agent you run yourself, such as Claude Code with the seed-cli skill or a script, reads and writes the Hypermedia network with its own key and a delegated capability, and how that relates to Seed Agents.
---
Two different things are called agents around Seed. [Seed Agents](../agent.md) is the hosted runtime that runs models for an account, with its own five verbs, triggers and signed API. This page is about the other thing: an agent you run yourself, a Claude Code session, an MCP-capable assistant, a cron job or a bot, that wants to read and write Hypermedia. The good news is that nothing about the network knows or cares which kind of agent is talking: an agent is an account with a key, exactly like a person. <!-- id:oEsfXmPo -->

# What an external agent can use <!-- id:7jN8jy-D -->

<!-- id:MpZy25g8 -->
| Surface <!-- col:uTIFnUxK --> | Use it for <!-- col:og8sXqxB --> | Where <!-- col:Dw6I1A1S --> <!-- id:52W04QmF --> |
| --- | --- | --- |
| The Seed CLI | one-off commands, scripting, anything a shell-capable agent does | [Seed CLI](./cli.md) <!-- id:_62555rE --> |
| The SDK | long-running processes, bots, apps that sign locally | [SDK](./sdk.md) <!-- id:nXKnpLS6 --> |
| The Seed API | plain HTTP reads from any language | [Seed API](./web-api.md) <!-- id:98_oGOr7 --> |
| The seed-cli skill | teaching Claude Code the CLI and a safe workflow | below <!-- id:KSxcoXmH --> |

# Why there is no Seed MCP server <!-- id:Fpy_a4yH -->

Seed does not run a hosted MCP server for its network, and that is a deliberate choice rather than a missing feature. Everything an agent publishes on Hypermedia, a document change, a comment, a capability, is a blob signed by the author's key, and the signature is what makes the content trustworthy to every other reader. A hosted MCP server in the usual shape receives plain tool calls and acts on them remotely, so it would have to hold your private key and sign on your behalf. Your keys should never leave your device, so that shape does not fit. <!-- id:Yh7-cVlK -->

Instead, signing happens where the key lives. The [SDK](./sdk.md) and the [CLI](./cli.md), which is built on the SDK, build and sign blobs locally and then publish them to any site through the [Seed API](./web-api.md). An agent should use one of those, with a key of its own that the account owner delegates to (see below). Reads need no key at all, so a read-only integration can call the Seed API over plain HTTP. <!-- id:eb6o5ENX -->

If you still want an MCP interface for your own assistant, run it locally on the SDK, next to the key, so tools sign on your machine. [Seed Agents](../agent.md) is the other direction: it is an MCP _client_, and its agents can call tools from any remote MCP server an account connects ([MCP servers](../agent/mcp.md)). <!-- id:K9_KLFQw -->

# Reading <!-- id:3HxQjXS3 -->

Any site answers over the [Seed API](./web-api.md) without a key. A document in full: `GET https://hyper.media/api/Resource?id=hm://<uid>/<path>`. As markdown the way the CLI prints it: `seed-cli document get hm://<uid>/<path>`, or with embeds and mentions inlined, `document get -r`. Search: `seed-cli search "<words>" -t hybrid -c 300 -l 40`. Attribute queries: `seed-cli query '*' -w 'has:childAttributesSchema'`; see [Query grammar](./query-grammar.md). <!-- id:QT3UV6am -->

To turn a web page URL into an id, ask the site: any Seed page answers an `OPTIONS` request with `X-Hypermedia-Id`, `X-Hypermedia-Version`, `X-Hypermedia-Title`, `X-Hypermedia-Type` and `X-Hypermedia-Authors` headers. The CLI does this for you when you pass an `https://` URL. <!-- id:ENJu5RU4 -->

```sh <!-- id:riJaLZ9v -->
curl -s -X OPTIONS -I https://hyper.media/hm/<uid>/<path> | grep -i x-hypermedia
```

Cite what you read with block links: `hm://<uid>/<path>#<blockId>` names one block, `?v=<version>` pins the version. [URLs](../protocol/urls.md) has the grammar. <!-- id:hhSta9ZL -->

# Identity: a key of the agent's own <!-- id:OZCtf1L5 -->

Do not give an agent a person's account key. Give it a key and a capability: <!-- id:c-f3j0jy -->
  1. `seed-cli key generate -n bot --show-mnemonic` on the agent's machine, or `seed-cli key export` a key from elsewhere and put the file's contents in `SEED_CLI_KEYFILE`. <!-- id:6XnRV2Af -->
  2. The owner of the space grants it: `seed-cli capability create --delegate <bot-uid> --role WRITER --path /drafts`. <!-- id:_WjkG8Na -->
  3. The agent creates documents under the space with `-a <space-uid>`; the CLI finds the capability and cites it. `document update` and `document delete` look the capability up without the flag. <!-- id:sNl1onVm -->

This is the same shape Seed Agents use internally: each hosted agent signs as its own identity and publishes into a shared space only through a capability that space issued. The `AGENT` role says "acts on behalf of"; `WRITER` says "may write". Capabilities are not revocable today, so scope them to a path and rotate the bot's key when in doubt. [Keys](./keys.md) and [Permissions](../protocol/permissions.md) have the details. <!-- id:Y75VPuLs -->

Attribution follows from the signature: every change and comment the bot publishes names the bot's key as its signer, and the capability links it to the account. Give the bot a profile (`seed-cli account profile set --name "Reports bot" -k bot`) so readers see who it is. <!-- id:xJOCwRyM -->

# Draft first <!-- id:eQNnGVB0 -->

An agent that publishes on its own is hard to review. The workflow the seed-cli skill teaches, and the one to copy, is: <!-- id:qrwqFuat -->
  1. Research first: `search`, `query`, `document get` on the neighbours of where you intend to write; confirm the parent path exists. <!-- id:1tXXtf2V -->
  2. Write a draft, not a document: `seed-cli draft create -f new-page.md --location hm://<uid>/<parent>` (or `--edit hm://<uid>/<path>` for an edit). The draft lands in the Seed app's draft list on the same machine, where a person opens, edits and publishes it. <!-- id:U1cCcGFL -->
  3. Publish only when asked, with an explicit path: `seed-cli document create -f new-page.md -p <parent>/<slug> -a <space-uid>`, or `document update` for an edit. Never publish to a path without confirming it. <!-- id:rBQRddUa -->
  4. Update, do not replace: `document update -f edited.md` diffs by the block ids in the `<!-- id:… -->` comments, so round-trip the markdown you got from `document get` and keep those comments. <!-- id:n9rbd4b_ -->

Comments are the low-risk write: `seed-cli comment create hm://<uid>/<path> --body "…"` on a document, or `…#<blockId>` on one block. <!-- id:usKO40qX -->

# The seed-cli skill for Claude Code <!-- id:4CUAb8Yz -->

A skill is a folder with a `SKILL.md` that Claude Code loads when a task matches it. There is a `seed-cli` skill that teaches the CLI's install (`npx -y @seed-hypermedia/cli@latest …`), keys, drafts, the markdown and JSON input formats, and the draft-first workflow above. It is installed per user. The skills installer puts it in `~/.agents/skills/seed-cli` and links `~/.claude/skills/seed-cli` to it, where Claude Code finds it. It is not in the Seed repository, and the repository's own `docs/agent-setup.md` asks that shared team workflows live in the repo's `.agents/skills/` folder rather than in a home directory. The CLI package ships a second, older skill file as `docs/CLI-REFERENCE.md` (skill name `seed-hypermedia`) inside the npm tarball; nothing installs it for you. <!-- id:4IF1aiX5 -->

Both skills predate parts of the current CLI. When the skill and this documentation disagree, this documentation is right; in particular `--dev` means `https://dev.hyper.media` plus the dev keyring and cannot be combined with `--server`, keys come from the vault before the keyring, `-a, --account` exists, and there is no `seed-grpc` skill. <!-- id:sjsHvtl6 -->

# Seed Agents, from the outside <!-- id:6GNyqSnP -->

If what you want is an agent that lives on the network rather than on your laptop, that is [Seed Agents](../agent.md). Its agents address the same things this page does through five verbs: `read` takes `hm://`, `ipfs://`, `https://` and the agent's own `~/memory/…`, `~/tools/…` and `~/triggers/…` addresses, and `write` takes the same except `https://`; `call` invokes `search`, `query`, `attributes`, `web_search`, `execute` or a tool projected from an MCP server; `delegate` spawns a child run; `plan` keeps a checklist. Writes to `hm://` go through the same SDK builders the CLI uses, with `options.action` choosing the operation: omitted for a new document, then `update`, `move`, `redirect`, `fork`, `delete`, `comment`, `capability.grant`, `contact.create` and the rest. See [tools](../agent/tools.md), [read](../agent/read.md) and [write](../agent/write.md). <!-- id:FtnpXIEO -->

You can talk to a Seed Agents server from your own code through its signed API: a DAG-CBOR envelope signed by an account key or a delegated key, posted to `/api/message`. There is no standalone client library outside the Seed monorepo yet; the envelope and every action are documented in [the signed API](../agent/signed-api.md). A site advertises its agents to readers with the `agentServerUrl` and `spaceAgents` keys of its home document; see [Metadata](../metadata.md). <!-- id:vZNAJ4Hl -->

# What to avoid <!-- id:2IhpxHDA -->

- **Publishing under a person's key.** Use a bot key and a capability; the signature is the attribution. <!-- id:TpGhQKHY -->
- **Creating documents by hand from a genesis blob.** Only the home document has a deterministic genesis; an ordinary document's first change is its genesis. The CLI and `createDocumentBlobs` get this right; a hand-rolled script that reuses the home genesis merges every new document into the home document. <!-- id:cUoFM3LT -->
- **Publishing linked blobs without CIDs.** A blob published without its SHA-256 CID gets a BLAKE2b CID from the daemon, and anything that referenced it dangles. Keep the `cid` the SDK gives you. <!-- id:KzcaTBfC -->
- **Replacing a document's body wholesale.** It works, but every block gets a new identity and every comment anchored to the old blocks loses its anchor. Round-trip the ids. <!-- id:lgki5lvh -->
- **Mistaking a name for an identity.** A key's name is local; its `z6Mk…` id is the account. <!-- id:_GlEEbCA -->
- **Treating the local daemon API as private.** A desktop daemon's HTTP port has no authentication; the desktop bridge on port 56004 refuses cross-site browser requests, but a local process can call it. Keep secrets out of what you publish; everything public is public forever. <!-- id:MUXrkk86 -->

# Working with it <!-- id:_9T-NDqV -->

## In the Seed app <!-- id:ACg52Ek9 -->

Drafts an agent writes with `draft create` appear in the app; a person reviews and publishes them. The app's assistant panel is a Seed Agents client, not an external agent. <!-- id:-RIcSUIh -->

## CLI <!-- id:dvQIgY6Z -->

The whole page is the CLI; the reference is [Seed CLI](./cli.md). <!-- id:YoLWK_Wu -->

## SDK <!-- id:OLdMSkdA -->

For an agent that runs continuously or exposes tools to a model, build on [the SDK](./sdk.md): `createSeedClient` for reads, `createDocumentBlobs` and the other builders for writes, `keyfile.load` for the bot key. <!-- id:f6v6OAL3 -->

## Web API <!-- id:P0A02tNq -->

Reads need no key and work from any language; writes are `POST /api/PublishBlobs` with blobs you signed. See [Seed API](./web-api.md). <!-- id:SeH6LMAi -->

## Agents <!-- id:6gtoDdnb -->

For Seed Agents, this page's operations are the `read`, `write` and `call` verbs; the delegated-key model is the same, with the identity held by the agents server. <!-- id:bmathU4w -->

# See also <!-- id:1SUsy3GP -->

- [Seed Agents](../agent.md), [tools](../agent/tools.md), [the signed API](../agent/signed-api.md), [MCP](../agent/mcp.md) <!-- id:iC-sBE-r -->
- [Keys](./keys.md), [Sign in with Seed](./sign-in.md), [Query grammar](./query-grammar.md) <!-- id:4qZxnnqx -->
