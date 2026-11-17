---
name: Building on Hypermedia
summary: Where to start building on Hypermedia, how the Seed API, the SDK, the CLI and the daemon layer on each other, and which reference or guide to open for each task.
---
You can build on Hypermedia without running any software of your own. Every Seed [site](./protocol/sites.md) answers plain HTTP requests, so a script, a web page or an agent can read [documents](./protocol/documents.md) from `https://hyper.media` and publish signed [blobs](./protocol/blobs.md) back to it. This page says which surfaces exist, how they sit on each other, and which page to open for each job. <!-- id:K6WuzFru -->

If you are new, start with [Getting started](./build/getting-started.md). In about fifteen minutes it reads a document three ways, creates a key and publishes a first page. <!-- id:OiD489pD -->

# The surfaces and how they layer <!-- id:EDxAY8k1 -->

Seed exposes the [protocol](./protocol.md) through several surfaces. They are layered, so what you learn on one carries to the next. <!-- id:N9t06KQr -->

<!-- id:i2ZTgRil -->
| Surface <!-- col:MExJdkeL --> | Reach for it when <!-- col:SO4xzYks --> | Guide <!-- col:C-Wpq21_ --> <!-- id:g0zEAfOb --> |
| --- | --- | --- |
| The Seed API, `/api/<Key>` on any site | you want HTTP from any language, with no install | [Seed API](./build/web-api.md) <!-- id:19MLbT0Y --> |
| The SDK, `@seed-hypermedia/client` | you write TypeScript or JavaScript that reads, signs and publishes | [SDK](./build/sdk.md) <!-- id:3ivQzdA9 --> |
| The Seed CLI, `seed-cli` | you script from a shell, publish a folder, or let an agent act through commands | [Seed CLI](./build/cli.md) <!-- id:dpKb7Lo4 --> |
| The seed-cli skill and your own agent | an agent such as Claude Code should read and write with its own key | [Using Seed from your own agent](./build/agents.md) <!-- id:B22chYa5 --> |
| The daemon's gRPC API | you run a daemon and need keys, sync, peers or subscriptions | [Daemon gRPC](./build/grpc.md) <!-- id:SSe2UDOe --> |
| The signed API of an app environment | your code talks to [Seed Agents](./agent.md): sessions, runs, triggers, tools | [Signed API](./build/signed-api.md) |
| libp2p, the peer protocol | you are writing another node that speaks to Seed peers | [The network](./protocol/network.md) <!-- id:x-FXFVva --> |

The **[Seed API](./build/web-api.md)** is the bottom layer most builders touch. It is the typed request surface every Seed [site](./protocol/sites.md) serves: reads are `GET /api/<Key>`, writes are `POST /api/<Key>` with signed [blobs](./protocol/blobs.md). A site answers for its own [space](./protocol/spaces.md) and for every [account](./protocol/identity.md) it has synced, so `https://hyper.media` is a good default base URL. The [Seed desktop app](./software/desktop.md) serves the same keys on `http://localhost:56004` against your own [daemon](./software/daemon.md). <!-- id:K0cXnuTV -->

```sh <!-- id:OAa4rVl- -->
curl 'https://hyper.media/api/Resource?id=hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed'
```

The **[SDK](./build/sdk.md)** speaks the same keys and adds what plain HTTP does not give you: [blob](./protocol/blobs.md) signing, [CIDs](./protocol/blobs.md) and the publish sequence. Every other Seed surface is built on it. The [CLI](./build/cli.md) bundles it, [Seed Agents](./agent.md) call it, and the Seed app shares its types. If your code signs, use the SDK. <!-- id:BkMrdpv3 -->

The **[Seed CLI](./build/cli.md)** wraps the SDK in commands, and it is also how an agent you run yourself acts on Seed. It runs without installing: <!-- id:rCkzDLPn -->

```sh <!-- id:kWC-0Nix -->
npx -y @seed-hypermedia/cli --help
```

The **[Seed daemon](./software/daemon.md)** sits underneath all of them. It holds the [blobs](./protocol/blobs.md), indexes them and [syncs](./protocol/network.md) with [peers](./protocol/network.md). Its [gRPC API](./build/grpc.md) is the widest surface, and the [web server](./software/web.md) and [desktop app](./software/desktop.md) are its clients. It has no authentication, so its ports must stay on localhost or behind a firewall. Use it when you run your own daemon and need something the Seed API does not expose. <!-- id:4KIZwVMz -->

The **peer protocol** is [libp2p](./protocol/network.md). You only need it to build another implementation of a node. Start from [the network](./protocol/network.md) and the [Protocol](./protocol.md) tour. <!-- id:CjDp4yAp -->

An **[app environment](./software/app-environment.md)**, the server that runs [Seed Agents](./agent.md), has an API of its own beside these. Every request to it is a [signed action](./build/signed-api.md), and live updates arrive over [WebSocket subscriptions](./build/websocket-subscriptions.md).

One rule holds on every surface: signing happens where the key lives. The SDK and the CLI build and sign blobs on your machine and then publish them through any site. No Seed server signs for you, which is also why Seed has no Model Context Protocol server of its own. [Using Seed from your own agent](./build/agents.md) explains what an external agent uses instead. <!-- id:c2CpH-tn -->

# Reference <!-- id:-VDg-IxI -->

Open these when you need exact shapes.

- [Seed API](./build/web-api.md) is the HTTP reference: base URLs, request encodings, response envelopes, errors, authentication and every key. <!-- id:I_bFMzdu -->
- [SDK](./build/sdk.md) is the `@seed-hypermedia/client` reference, from a first read to building, signing and publishing your own blobs. <!-- id:RnNKXZJd -->
- [Seed CLI](./build/cli.md) covers every command group and flag. <!-- id:Jmg7SSN9 -->
- [Daemon gRPC](./build/grpc.md) lists every daemon service and RPC, marks the unimplemented ones, and shows how to connect. <!-- id:8fERtuHB -->
- [Query grammar](./build/query-grammar.md) is the language for finding documents by their attributes, shared by Explore, the CLI, the SDK and Seed Agents. <!-- id:-T7ezoTD -->
- [Markdown dialect](./build/markdown-dialect.md) is the lossless markdown form of a document that the CLI, the SDK and the `.md` export share.
- [Signed API](./build/signed-api.md) is the app environment's HTTP API: the signed envelope, versioning, authorization and every action.
- [WebSocket subscriptions](./build/websocket-subscriptions.md) is how a client receives live account, agent, session and run updates from an app environment.
- [Page SDK](./build/page-sdk.md) is what a custom page calls to read, write and sign as its viewer.

# Guides by task <!-- id:i4PHxDb- -->

Each guide names a goal, lists what you need, and walks through real commands.

- **Start.** [Getting started](./build/getting-started.md) reads a document with curl, the SDK and the CLI, then creates a key and publishes your first document. <!-- id:PpmB86sW -->
- **Publish from your own code.** [Publishing from code](./build/publishing-from-code.md) creates, updates and comments on a document from TypeScript with the SDK.
- **Publish a site from git.** [Publish a folder](./build/publish-a-folder.md) mirrors a directory of markdown files and a space in both directions. <!-- id:EpIl294f -->
- **Let visitors act as themselves.** [Sign in with Seed](./build/sign-in.md) lets a third-party website act as a visitor's [account](./protocol/identity.md) without ever holding their key. <!-- id:dMzYGzZR -->
- **Give a script or a server a key.** [Keys](./build/keys.md) covers key files, finding the key the app already has, signing on a headless machine, and a key for a bot. <!-- id:7JY3fy60 -->
- **Run your own agent on Seed.** [Using Seed from your own agent](./build/agents.md) sets up a bot key with a delegated [capability](./protocol/permissions.md), the seed-cli skill and the draft-first workflow. <!-- id:QPWhvptq -->
- **Show Seed Agents in your app.** [Embedding the agents UI](./build/apps-ui.md) puts the Seed apps' own agents interface inside another web app, signing with a key the app controls. <!-- id:UwmsrjX5 -->
- **Build an app or a page.** [Building an app](./build/building-an-app.md) walks through an [app](./app.md) with its tools and pages, and [Custom HTML pages](./build/custom-pages.md) explains how a document opens as a sandboxed page.

# See also <!-- id:9kOzZp6w -->

- [The Hypermedia Protocol](./protocol.md), the concepts every guide assumes. <!-- id:uQ7GR5L5 -->
- [Apps and Tools](./app.md), what an app, a tool and a page are.
- [Seed Agents](./agent.md), the hosted agent runtime. <!-- id:bUu8evms -->
- [Running Seed](./operate.md), for self-hosting a site or an app environment. <!-- id:HWNYDw78 -->
- [Working on Seed](./contribute.md), for changing the Seed repository itself. <!-- id:LA51Kkao -->
- [The Seed software](./software.md), a map of the programs these surfaces belong to. <!-- id:yVWdtHaJ -->
- [Glossary](./glossary.md), one-line definitions of every term. <!-- id:VqJpifp_ -->

# Reference pages <!-- id:PAhOMrU1 attrs:{"childrenType":"Grid","columnCount":3} -->

<./build/web-api.md> <!-- id:vplTSOZ7 type:Embed attrs:{"view":"Card"} -->

<./build/site-services.md> <!-- id:PpTeNrkW type:Embed attrs:{"view":"Card"} -->

<./build/sdk.md> <!-- id:VAtraoD8 type:Embed attrs:{"view":"Card"} -->

<./build/markdown-dialect.md> <!-- id:buvoCspn type:Embed attrs:{"view":"Card"} -->

<./build/cli.md> <!-- id:hPmJm9eo type:Embed attrs:{"view":"Card"} -->

<./build/grpc.md> <!-- id:CTTjS8hq type:Embed attrs:{"view":"Card"} -->

<./build/query-grammar.md> <!-- id:xBg20jH8 type:Embed attrs:{"view":"Card"} -->

<./build/signed-api.md> <!-- id:vntUEOJH type:Embed attrs:{"view":"Card"} -->

<./build/signed-api-agents.md> <!-- id:y4tS7Fgm type:Embed attrs:{"view":"Card"} -->

<./build/signed-api-sessions.md> <!-- id:dSfCjtP9 type:Embed attrs:{"view":"Card"} -->

<./build/signed-api-triggers.md> <!-- id:oLJGRKHF type:Embed attrs:{"view":"Card"} -->

<./build/signed-api-providers.md> <!-- id:Z71RDlOM type:Embed attrs:{"view":"Card"} -->

<./build/signed-api-memory.md> <!-- id:JKR0LnLo type:Embed attrs:{"view":"Card"} -->

<./build/signed-api-apps.md> <!-- id:VODaXTff type:Embed attrs:{"view":"Card"} -->

<./build/websocket-subscriptions.md> <!-- id:lQ5SHqSo type:Embed attrs:{"view":"Card"} -->

<./build/page-sdk.md> <!-- id:2emMaC07 type:Embed attrs:{"view":"Card"} -->

<./build/page-sandbox.md> <!-- id:OIg8MCIc type:Embed attrs:{"view":"Card"} -->

<./build/notify-api.md> <!-- id:Uzj4wrAV type:Embed attrs:{"view":"Card"} -->

# Guide pages <!-- id:ZMpc6kuh attrs:{"childrenType":"Grid","columnCount":3} -->

<./build/getting-started.md> <!-- id:tzbvCkWO type:Embed attrs:{"view":"Card"} -->

<./build/publishing-from-code.md> <!-- id:TjURNDsr type:Embed attrs:{"view":"Card"} -->

<./build/publish-a-folder.md> <!-- id:aDy2OZlw type:Embed attrs:{"view":"Card"} -->

<./build/sign-in.md> <!-- id:maGsluvV type:Embed attrs:{"view":"Card"} -->

<./build/keys.md> <!-- id:kSRC2MvV type:Embed attrs:{"view":"Card"} -->

<./build/agents.md> <!-- id:pQ5bL3F7 type:Embed attrs:{"view":"Card"} -->

<./build/apps-ui.md> <!-- id:XAxY9LO6 type:Embed attrs:{"view":"Card"} -->

<./build/building-an-app.md> <!-- id:AaJgjlAz type:Embed attrs:{"view":"Card"} -->

<./build/custom-pages.md> <!-- id:FhAlk7k7 type:Embed attrs:{"view":"Card"} -->
