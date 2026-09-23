---
name: Building on Hypermedia
summary: Where to start building on Hypermedia, which surface to pick for your task, and a guide for each job from reading your first document to running your own site.
---
You can build on Hypermedia without running any software of your own. Every Seed [site](./protocol/sites.md) answers plain HTTP requests, so a script, a web page or an agent can read [documents](./protocol/documents.md) from `https://hyper.media` today and publish signed [blobs](./protocol/blobs.md) back to it. These guides are task-shaped: each one names a goal, lists what you need, and walks through real commands. <!-- id:K6WuzFru -->

If you are new, start with [Getting started](./build/getting-started.md). In about fifteen minutes it reads a document three ways, creates a key and publishes a first page. <!-- id:OiD489pD -->

# Pick your entry point <!-- id:EDxAY8k1 -->

Seed exposes the [protocol](./protocol.md) through several surfaces. They are layered, so what you learn on one carries to the next. <!-- id:N9t06KQr -->

<!-- id:i2ZTgRil -->
| Surface <!-- col:MExJdkeL --> | Reach for it when <!-- col:SO4xzYks --> | Guide <!-- col:C-Wpq21_ --> <!-- id:g0zEAfOb --> |
| --- | --- | --- |
| The Seed API, `/api/<Key>` on any site | you want HTTP from any language, with no install | [Seed API](./build/web-api.md) <!-- id:19MLbT0Y --> |
| The SDK, `@seed-hypermedia/client` | you write TypeScript or JavaScript that reads, signs and publishes | [SDK](./build/sdk.md) <!-- id:3ivQzdA9 --> |
| The Seed CLI, `seed-cli` | you script from a shell, publish a folder, or let an agent act through commands | [Seed CLI](./build/cli.md) <!-- id:dpKb7Lo4 --> |
| The seed-cli skill and your own agent | an agent such as Claude Code should read and write with its own key | [Using Seed from your own agent](./build/agents.md) <!-- id:B22chYa5 --> |
| The daemon's gRPC API | you run a daemon and need keys, sync, peers or subscriptions | [Daemon gRPC](./build/grpc.md) <!-- id:SSe2UDOe --> |
| libp2p, the peer protocol | you are writing another node that speaks to Seed peers | [The network](./protocol/network.md) <!-- id:x-FXFVva --> |

## The canonical path: the Seed API and the SDK <!-- id:cQu9KycP -->

The **[Seed API](./build/web-api.md)** is the typed request surface every Seed [site](./protocol/sites.md) serves. A request key such as `Resource`, `Search` or `ListComments` names one call with a declared input and output. Reads are `GET /api/<Key>` with the input in the query string. Writes are `POST /api/<Key>` with a [DAG-CBOR](https://ipld.io/specs/codecs/dag-cbor/spec/) body. Responses are JSON wrapped by superjson, so the payload sits under a top-level `json` member. <!-- id:K0cXnuTV -->

```sh <!-- id:OAa4rVl- -->
curl 'https://hyper.media/api/Resource?id=hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed'
```

The **[SDK](./build/sdk.md)** speaks the same keys and adds what plain HTTP does not give you: key derivation, [blob](./protocol/blobs.md) signing, [CIDs](./protocol/blobs.md) and the publish sequence. Every other Seed surface is built on it. The [CLI](./build/cli.md) bundles it, [Seed Agents](./agent.md) call it, and the Seed app shares its types. If your code signs, use the SDK. <!-- id:BkMrdpv3 -->

Both work against any site. A site answers for its own [space](./protocol/identity.md) and for every [account](./protocol/identity.md) it has synced, so `https://hyper.media` is a good default base URL. The [Seed desktop app](./apps/desktop.md) serves the same keys on `http://localhost:56004` against your own [daemon](./apps/daemon.md). <!-- id:pbLApTIr -->

## Scripting: the CLI and agent skills <!-- id:8eTCaHD4 -->

The **[Seed CLI](./build/cli.md)** wraps the SDK in commands. It reads a [document](./protocol/documents.md), creates or updates one from markdown, manages [keys](./build/keys.md), posts [comments](./protocol/comments.md), [queries by attribute](./build/query-grammar.md), and [mirrors a folder](./build/publish-a-folder.md) to a [space](./protocol/identity.md). It runs without installing: <!-- id:rCkzDLPn -->

```sh <!-- id:kWC-0Nix -->
npx -y @seed-hypermedia/cli --help
```

The CLI is also how external agents act on Seed. The [`seed-cli` skill](./build/agents.md) teaches Claude Code the commands, the key setup and a draft-first workflow, where the agent prepares a draft for a person to review before anything is published. Seed has no Model Context Protocol server. External agents use the CLI, the skill or the Seed API. [Seed Agents](./agent.md), the hosted runtime, reads and writes `hm://` addresses through its own verbs. It can also connect to [MCP servers](./agent/mcp.md) as a client. <!-- id:c2CpH-tn -->

## Deep integration: gRPC and libp2p <!-- id:h1NI606K -->

The **[Seed daemon](./apps/daemon.md)** holds the [blobs](./protocol/blobs.md), indexes them and [syncs](./protocol/network.md) with [peers](./protocol/network.md). Its [gRPC API](./build/grpc.md) is the widest surface. The [web server](./apps/web.md) and [desktop app](./apps/desktop.md) are its clients. It has no authentication, so its ports must stay on localhost or behind a firewall. Use it when you run your own daemon and need something the Seed API does not expose. <!-- id:4KIZwVMz -->

The **peer protocol** is [libp2p](./protocol/network.md) with the protocol id `/hypermedia/0.9.2`. You only need it to build another implementation of a node. Start from [the network](./protocol/network.md) and the [Protocol](./protocol.md) tour. <!-- id:CjDp4yAp -->

# Guides by task <!-- id:i4PHxDb- -->

## Start <!-- id:98qNNG1d -->

- [Getting started](./build/getting-started.md) reads a document with curl, the SDK and the CLI, then creates a key and publishes your first document. <!-- id:PpmB86sW -->
- [Keys](./build/keys.md) explains mnemonics, `.hmkey.json` files, where the app, daemon and CLI store keys, and how a headless machine signs. <!-- id:7JY3fy60 -->

## Read and publish from code <!-- id:-VDg-IxI -->

- [Seed API](./build/web-api.md) is the HTTP reference: base URLs, request encodings, response envelopes, errors, authentication, every key, and the site services under `/hm/api`. <!-- id:I_bFMzdu -->
- [SDK](./build/sdk.md) is the `@seed-hypermedia/client` reference, from a first read to building, signing and publishing your own blobs. <!-- id:RnNKXZJd -->
- [Query grammar](./build/query-grammar.md) is the language for finding documents by their attributes, shared by Explore, the CLI, the SDK and Seed Agents. <!-- id:-T7ezoTD -->
- [Daemon gRPC](./build/grpc.md) lists every daemon service and RPC, marks the unimplemented ones, and shows how to connect. <!-- id:8fERtuHB -->

## Script and automate <!-- id:SPH7ZBHQ -->

- [Seed CLI](./build/cli.md) covers every command group and flag. <!-- id:Jmg7SSN9 -->
- [Publish a folder](./build/publish-a-folder.md) mirrors a directory of markdown files and a space in both directions, which is how this documentation publishes itself. <!-- id:EpIl294f -->
- [Using Seed from your own agent](./build/agents.md) sets up a bot key with a delegated [capability](./protocol/permissions.md), the seed-cli skill and the draft-first workflow. <!-- id:QPWhvptq -->

## Build for other people <!-- id:MErBNcr1 -->

- [Sign in with Seed](./build/sign-in.md) lets a third-party website act as a visitor's [account](./protocol/identity.md) without ever holding their key. <!-- id:dMzYGzZR -->

## Run and contribute <!-- id:agwd8rC- -->

- [Self-hosting](./build/self-hosting.md) runs your own Seed site on a server and domain you control. <!-- id:HWNYDw78 -->
- [Contributing](./build/contributing.md) maps the repository, runs the development environment and tests, and explains how protocol changes land. <!-- id:LA51Kkao -->

# See also <!-- id:9kOzZp6w -->

- [The Hypermedia Protocol](./protocol.md), the concepts every guide assumes. <!-- id:uQ7GR5L5 -->
- [The Seed software](./apps.md), a map of the programs these surfaces belong to. <!-- id:yVWdtHaJ -->
- [Seed Agents](./agent.md), the hosted agent runtime. <!-- id:bUu8evms -->
- [Glossary](./glossary.md), one-line definitions of every term. <!-- id:VqJpifp_ -->
