---
name: Building on Hypermedia
summary: This page shows the ways a program can read and publish on Hypermedia, how they fit together, and which reference or guide to open for each task.
---
You can build on Hypermedia without running any software of your own. Every Seed [site](./protocol/sites.md) answers plain HTTP requests. So a script, a web page or an agent can read [documents](./protocol/documents.md) from `https://hyper.media` and publish signed [blobs](./protocol/blobs.md) back to it. This page lists the ways in, shows how they fit together, and tells you which page to open for each job. <!-- id:K6WuzFru -->

If you are new, start with [Getting started](./build/getting-started.md). In about fifteen minutes you read a document three ways, create a key and publish a first page. <!-- id:OiD489pD -->

# The ways in, and how they fit together <!-- id:EDxAY8k1 -->

Seed gives programs several ways to use the [protocol](./protocol.md). Each one is built on the one before it, so what you learn on one helps with the next. <!-- id:N9t06KQr -->

<!-- id:i2ZTgRil -->
| Surface <!-- col:MExJdkeL --> | Reach for it when <!-- col:SO4xzYks --> | Guide <!-- col:C-Wpq21_ --> <!-- id:g0zEAfOb --> |
| --- | --- | --- |
| The Seed API, `/api/<Key>` on any site | you want HTTP from any language, with no install | [Seed API](./build/web-api.md) <!-- id:19MLbT0Y --> |
| The SDK, `@seed-hypermedia/client` | you write TypeScript or JavaScript that reads, signs and publishes | [SDK](./build/sdk.md) <!-- id:3ivQzdA9 --> |
| The Seed CLI, `seed-cli` | you script from a shell, publish a folder, or let an agent act through commands | [Seed CLI](./build/cli.md) <!-- id:dpKb7Lo4 --> |
| The seed-cli skill and your own agent | an agent such as Claude Code should read and write with its own key | [Using Seed from your own agent](./build/agents.md) <!-- id:B22chYa5 --> |
| The daemon's gRPC API | you run a daemon and need keys, sync, peers or subscriptions | [Daemon gRPC](./build/grpc.md) <!-- id:SSe2UDOe --> |
| The signed API of an app environment | your code talks to [Seed Agents](./agent.md): sessions, runs, [triggers](./trigger.md), tools | [Signed API](./build/signed-api.md) |
| libp2p, the peer protocol | you are writing another node that speaks to Seed peers | [The network](./protocol/network.md) <!-- id:x-FXFVva --> |

The **[Seed API](./build/web-api.md)** is where most builders start. Every Seed [site](./protocol/sites.md) serves it. You read with `GET /api/<Key>`, and you write with `POST /api/<Key>` and signed [blobs](./protocol/blobs.md). A site answers for its own [space](./protocol/spaces.md) and for every [account](./protocol/identity.md) it has synced, so `https://hyper.media` is a good default base URL. The [Seed desktop app](./software/desktop.md) serves the same keys on `http://localhost:56004`, from your own [daemon](./software/daemon.md). <!-- id:K0cXnuTV -->

```sh <!-- id:OAa4rVl- -->
curl 'https://hyper.media/api/Resource?id=hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed'
```

The **[SDK](./build/sdk.md)** sends the same requests and adds what plain HTTP does not give you. It signs [blobs](./protocol/blobs.md), computes their [CIDs](./cid.md) and publishes them in the right order. The [CLI](./build/cli.md), [Seed Agents](./agent.md) and the Seed apps are all built on it. If your code signs, use the SDK. <!-- id:BkMrdpv3 -->

The **[Seed CLI](./build/cli.md)** wraps the SDK in commands. It is also how an agent you run yourself acts on Seed. It runs without an install step: <!-- id:rCkzDLPn -->

```sh <!-- id:kWC-0Nix -->
npx -y @seed-hypermedia/cli --help
```

The **[Seed daemon](./software/daemon.md)** is the program under all of them. It stores the [blobs](./protocol/blobs.md), indexes them and [syncs](./protocol/network.md) with [peers](./protocol/network.md). Its [gRPC API](./build/grpc.md) can do the most, and the [web server](./software/web.md) and the [desktop app](./software/desktop.md) are its clients. By default the daemon only answers programs on the same machine, and it trusts every program it answers. So keep its ports on localhost or behind a firewall. Use it when you run your own daemon and need something the Seed API does not offer. <!-- id:4KIZwVMz -->

The **peer protocol** is [libp2p](./protocol/network.md). You need it only to build another program that acts as a node. Start from [the network](./protocol/network.md) and the [Protocol](./protocol.md) tour. <!-- id:CjDp4yAp -->

An **[app environment](./software/app-environment.md)** is the server that runs [Seed Agents](./agent.md). It has its own API beside these. Every request to it is a [signed action](./build/signed-api.md), and live updates arrive over [WebSocket subscriptions](./build/websocket-subscriptions.md).

One rule holds everywhere: signing happens where the key lives. The SDK and the CLI build and sign blobs on your machine. Then they publish them through any site. No Seed server signs for you. That is also why Seed has no Model Context Protocol (MCP) server of its own. [Using Seed from your own agent](./build/agents.md) explains what an agent you run uses in its place. <!-- id:c2CpH-tn -->

# Reference <!-- id:-VDg-IxI -->

Open these when you need exact shapes.

- [Seed API](./build/web-api.md) is the HTTP reference: base URLs, how requests are encoded, how responses are wrapped, errors, authentication and the keys. <!-- id:I_bFMzdu -->
- [Site services](./build/site-services.md) covers the other routes a site serves: `/hm/api/*`, `/ipfs/<cid>`, the `.md` and `.json` exports, and how a web URL becomes an `hm://` id.
- [SDK](./build/sdk.md) is the `@seed-hypermedia/client` reference, from a first read to building, signing and publishing your own blobs. <!-- id:RnNKXZJd -->
- [Seed CLI](./build/cli.md) covers the command groups and their flags. <!-- id:Jmg7SSN9 -->
- [Daemon gRPC](./build/grpc.md) lists the daemon's services and RPCs, marks the ones that are not implemented, and shows how to connect. <!-- id:8fERtuHB -->
- [Query grammar](./build/query-grammar.md) is the language for finding documents by their attributes. Explore, the CLI, the SDK and Seed Agents share it. <!-- id:-T7ezoTD -->
- [Markdown dialect](./build/markdown-dialect.md) is the markdown form of a document that loses nothing. The CLI, the SDK and the `.md` export share it.
- [Signed API](./build/signed-api.md) is the app environment's HTTP API: the [signed envelope](./build/signed-api.md#signed-envelope), versions, access levels and the actions. Six more pages hold the actions by topic: [agents](./build/signed-api-agents.md), [sessions and runs](./build/signed-api-sessions.md), [triggers](./build/signed-api-triggers.md), [providers, keys and secrets](./build/signed-api-providers.md), [memory](./build/signed-api-memory.md) and [apps](./build/signed-api-apps.md).
- [WebSocket subscriptions](./build/websocket-subscriptions.md) is how a client gets live account, agent, session and run updates from an app environment.
- [Page SDK](./build/page-sdk.md) is what a [custom page](./page.md) calls to read, write and sign as its viewer. [Page sandbox](./build/page-sandbox.md) lists what such a page may and may not do.
- [The notify API](./build/notify-api.md) is the HTTP API of the notification service.

# Guides by task <!-- id:i4PHxDb- -->

Each guide names a goal, lists what you need, and walks through real commands.

- **Start.** [Getting started](./build/getting-started.md) reads a document with curl, the SDK and the CLI. Then it creates a key and publishes your first document. <!-- id:PpmB86sW -->
- **Publish from your own code.** [Publishing from code](./build/publishing-from-code.md) creates a document, updates it and adds a [comment](./protocol/comments.md), from TypeScript with the SDK.
- **Publish a site from git.** [Publish a folder](./build/publish-a-folder.md) keeps a folder of markdown files and a space the same, in both directions. <!-- id:EpIl294f -->
- **Let visitors act as themselves.** [Sign in with Seed](./build/sign-in.md) lets another website act as a visitor's [account](./protocol/identity.md) without ever holding their key. <!-- id:dMzYGzZR -->
- **Give a script or a server a key.** [Keys](./build/keys.md) covers key files, finding the key the app already has, signing on a machine with no screen, and a key for a bot. <!-- id:7JY3fy60 -->
- **Run your own agent on Seed.** [Using Seed from your own agent](./build/agents.md) sets up a bot key with a [capability](./protocol/permissions.md) from the space owner, the seed-cli skill, and the habit of writing a draft first. <!-- id:QPWhvptq -->
- **Show Seed Agents in your app.** [Embedding the agents UI](./build/apps-ui.md) puts the Seed apps' own agents interface inside another web app. It signs with a key the app controls. <!-- id:UwmsrjX5 -->
- **Build an app or a page.** [Building an app](./build/building-an-app.md) walks through an [app](./app.md) with its tools and pages. [Custom HTML pages](./build/custom-pages.md) explains how a document opens as a sandboxed page.

# See also <!-- id:9kOzZp6w -->

- [The Hypermedia Protocol](./protocol.md), the concepts every guide assumes. <!-- id:uQ7GR5L5 -->
- [App](./app.md), [Tool](./tool.md) and [Page](./page.md), what each one is.
- [Seed Agents](./agent.md), agents that run on an app environment, on your computer or on a server. <!-- id:bUu8evms -->
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
