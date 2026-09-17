---
name: Building on Hypermedia
summary: Where to start building on Hypermedia, which surface to pick for your task, and a guide for each job from reading your first document to running your own site.
---
You can build on Hypermedia without running any software of your own. Every Seed site answers plain HTTP requests, so a script, a web page or an agent can read documents from `https://hyper.media` today and publish signed content back to it. These guides are task-shaped: each one names a goal, lists what you need, and walks through real commands.

If you are new, start with [Getting started](./build/getting-started.md). In about fifteen minutes it reads a document three ways, creates a key and publishes a first page.

# Pick your entry point

Seed exposes the protocol through several surfaces. They are layered, so what you learn on one carries to the next.

| Surface | Reach for it when | Guide |
| --- | --- | --- |
| The Seed API, `/api/<Key>` on any site | you want HTTP from any language, with no install | [Seed API](./build/web-api.md) |
| The SDK, `@seed-hypermedia/client` | you write TypeScript or JavaScript that reads, signs and publishes | [SDK](./build/sdk.md) |
| The Seed CLI, `seed-cli` | you script from a shell, publish a folder, or let an agent act through commands | [Seed CLI](./build/cli.md) |
| The seed-cli skill and your own agent | an agent such as Claude Code should read and write with its own key | [Using Seed from your own agent](./build/agents.md) |
| The daemon's gRPC API | you run a daemon and need keys, sync, peers or subscriptions | [Daemon gRPC](./build/grpc.md) |
| libp2p, the peer protocol | you are writing another node that speaks to Seed peers | [The network](./protocol/network.md) |

## The canonical path: the Seed API and the SDK

The **Seed API** is the typed request surface every Seed site serves. A request key such as `Resource`, `Search` or `ListComments` names one call with a declared input and output. Reads are `GET /api/<Key>` with the input in the query string. Writes are `POST /api/<Key>` with a [DAG-CBOR](https://ipld.io/specs/codecs/dag-cbor/spec/) body. Responses are JSON wrapped by superjson, so the payload sits under a top-level `json` member.

```sh
curl 'https://hyper.media/api/Resource?id=hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed'
```

The **SDK** speaks the same keys and adds what HTTP alone cannot do for you: key derivation, blob signing, content ids and the publish sequence. Every other Seed surface is built on it. The CLI bundles it, Seed Agents call it, and the Seed app shares its types. If your code must sign, use the SDK rather than hand-building blobs.

Both work against any site. A site answers for its own space and for every account it has synced, so `https://hyper.media` is a good default base URL. The Seed desktop app serves the same keys on `http://localhost:56004` against your own daemon.

## Scripting: the CLI and agent skills

The **Seed CLI** wraps the SDK in commands: read a document, create or update one from markdown, manage keys, comment, query by attribute, and mirror a folder to a space. It runs without installing:

```sh
npx -y @seed-hypermedia/cli --help
```

The CLI is also how external agents act on Seed. The `seed-cli` skill teaches Claude Code the commands, the key setup and a draft-first workflow, where the agent prepares a draft for a person to review before anything is published. Seed does not ship a Model Context Protocol server of its own; external agents use the CLI, the skill or the Seed API. [Seed Agents](./agent.md), the hosted runtime, reads and writes `hm://` addresses through its own verbs and can connect to MCP servers as a client.

## Deep integration: gRPC and libp2p

The **Seed daemon** holds the blobs, indexes them and syncs with peers. Its gRPC API is the widest surface, and the web server and desktop app are its clients. It has no authentication, so its ports must stay on localhost or behind a firewall. Use it when you run your own daemon and need something the Seed API does not expose.

The **peer protocol** is libp2p with the protocol id `/hypermedia/0.9.2`. You only need it to build another implementation of a node. Start from [the network](./protocol/network.md) and the [Protocol](./protocol.md) tour.

# Guides by task

## Start

- [Getting started](./build/getting-started.md) reads a document with curl, the SDK and the CLI, then creates a key and publishes your first document.
- [Keys](./build/keys.md) explains mnemonics, `.hmkey.json` files, where the app, daemon and CLI store keys, and how a headless machine signs.

## Read and publish from code

- [Seed API](./build/web-api.md) is the HTTP reference: base URLs, request encodings, response envelopes, errors, authentication, every key, and the site services under `/hm/api`.
- [SDK](./build/sdk.md) is the `@seed-hypermedia/client` reference, from a first read to building, signing and publishing your own blobs.
- [Query grammar](./build/query-grammar.md) is the language for finding documents by their attributes, shared by Explore, the CLI, the SDK and Seed Agents.
- [Daemon gRPC](./build/grpc.md) lists every daemon service and RPC, marks the unimplemented ones, and shows how to connect.

## Script and automate

- [Seed CLI](./build/cli.md) covers every command group and flag.
- [Publish a folder](./build/publish-a-folder.md) mirrors a directory of markdown files and a space in both directions, which is how this documentation publishes itself.
- [Using Seed from your own agent](./build/agents.md) sets up a bot key with a delegated capability, the seed-cli skill and the draft-first workflow.

## Build for other people

- [Sign in with Seed](./build/sign-in.md) lets a third-party website act as a visitor's account without ever holding their key.
- [Extensions](./build/extensions.md) describes the experimental extension system and how to try it.

## Run and contribute

- [Self-hosting](./build/self-hosting.md) runs your own Seed site on a server and domain you control.
- [Contributing](./build/contributing.md) maps the repository, runs the development environment and tests, and explains how protocol changes land.

# See also

- [The Hypermedia Protocol](./protocol.md), the concepts every guide assumes.
- [The Seed software](./apps.md), a map of the programs these surfaces belong to.
- [Seed API schemas](./rpc.md), the read keys published as Hypermedia Schemas.
- [Seed Agents](./agent.md), the hosted agent runtime.
