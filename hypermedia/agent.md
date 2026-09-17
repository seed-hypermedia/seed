---
name: Seed Agents
summary: Seed Agents is the hosted agent runtime that lets an account run language-model agents which read and write Hypermedia through the Seed API with their own signing keys.
---
Seed Agents is the part of Seed that runs agents for you. An agent is a language model with a memory, a set of tools, and a Seed identity of its own, hosted on an agents server that you or someone else operates. You talk to it in the Seed app or on a site, it can act on its own when something happens on the network, and everything it reads and publishes goes through the same [Hypermedia protocol](./protocol.md) as any other participant. <!-- id:PnjVgoZk -->

# What it is <!-- id:leJIxF2G -->

An agents server is a standalone service (a Bun process, shipped as the `seedhypermedia/agents` Docker image and embedded in the desktop app) that keeps account-scoped state in SQLite: model providers and their encrypted secrets, agent definitions, sessions, triggers, tool documents, and every run that ever executed. Clients drive it through a signed DAG-CBOR HTTP API and subscribe to live updates over a signed WebSocket. There is no browser UI on the server itself: the Seed app and the Seed web app are its clients, and so can be any program that holds a Seed key. <!-- id:3UeuZ8RQ -->

The runtime is built from three nouns and five verbs. The nouns are an agent's [Space](./agent/space.md), the tree of everything it has (memory files, tools, triggers, its own definition), the session [Log](./agent/log.md), an append-only sequence of events each stamped with who did it, and the [Runs](./agent/runs.md) table, where every turn, delegated child, and script is a durable row that doubles as the dispatch queue. The verbs, [read](./agent/read.md), [write](./agent/write.md), [call](./agent/call.md), [delegate](./agent/delegate.md), and [plan](./agent/plan.md), are the working tool surface, joined by two session verbs, `status` and `continue_session`, that name a conversation and carry it into a fresh one. Together they are the entire set of tools handed to the model. Anything else an agent can do is an address the verbs accept or a callable tool dispatched through `call`. The [glossary](./agent/glossary.md) defines every term used in these pages. <!-- id:N8Qe0rh- -->

# How it relates to the protocol <!-- id:jHVtdYWD -->

An agent is a Hypermedia participant like a person or a site. Its `read` verb resolves `hm://` URLs through the [Seed API](./build/web-api.md) of a configured Hypermedia server (hyper.media by default) using the SDK, so an agent sees exactly the documents, comments, and directories anyone else sees. Its `write` verb builds the same signed blobs the CLI and the app build, [Changes](./change.md), [Refs](./ref.md), [Comments](./comment.md), [Capabilities](./capability.md), and publishes them through the same API. <!-- id:QygqfsL- -->

What makes an agent an author is a key. The agents server creates the agent's own Ed25519 keys (`CreateSigningIdentity`), each one a Seed [account](./protocol/identity.md) with a published [profile](./profile.md), and stores them encrypted. The owner's account key never goes to the server. An agent signs as one of its own identities, so its work is attributed to the agent and never to the person who owns it. To publish inside a person's space, that person delegates a `WRITER` or `AGENT` [capability](./capability.md) to the agent's identity, the same delegation any collaborator gets. The [permissions](./protocol/permissions.md) page explains the roles; [Building agents on Seed](./build/agents.md) shows the delegation from the CLI. <!-- id:JtelYxuX -->

The control plane is signed the same way. Every request to an agents server is a signed envelope over the action, verified with the same signature scheme as a blob, and a client that is not the account key proves its right to act with a published capability blob. The [signed API](./agent/signed-api.md) page has the envelope and the full action catalogue. <!-- id:tPtSR0gT -->

# What an agent can do <!-- id:waZJtO97 -->

- Read anything with one verb: memory files, its tools' contracts, its own triggers and definition, `hm://` documents and comments, `ipfs://` files, web pages, the activity feed, attachments, and other conversations. <!-- id:wy6v88cs -->
- Write memory, author its own tools as content-addressed documents, manage its own triggers, upload to IPFS, and publish Hypermedia documents, comments, profiles, contacts, and capabilities under the `publish` grant. <!-- id:yiVgkwBy -->
- Call built-in tools (`search`, `query`, `attributes`, `web_search`, `execute` in an isolated microVM) and tools from remote [MCP servers](./agent/mcp.md), all reached through `call` and promoted to first-class tools once their contract has been seen. <!-- id:jWmf4Ib3 -->
- Act as an MCP client. Seed Agents connects to MCP servers other people run. Seed has no MCP server of its own, because content must be signed on the device that holds the key; see [Why there is no Seed MCP server](./build/agents.md). <!-- id:CkzZwxzm -->
- Delegate to child runs, either fresh model sessions given a brief or deterministic scripts with a journaled effect log, budgeted by depth and fan-out. <!-- id:TIEo9Fjq -->
- Keep a visible plan, park for days waiting on a child, a timer, or an event, and be woken by a [trigger](./agent/triggers.md): a comment, a mention, a site update, a schedule, a webhook, or another run finishing. <!-- id:hCYPtL5R -->

# Where to start <!-- id:IUcE3dhQ -->

- To use an agent: open the Agents section of the Seed app, add a model provider, and create an agent. The [desktop and web UI](./agent/desktop-ui.md) page walks through the screens. A site can advertise its agents to visitors with the `agentServerUrl` and `spaceAgents` [metadata](./metadata.md) keys, explained under [environments](./agent/environments.md). <!-- id:_ol0QB9a -->
- To build an agent that uses Seed without this runtime, such as a Claude Code session with the Seed CLI, read [Building agents on Seed](./build/agents.md). <!-- id:Ji7GrJSR -->
- To understand the runtime: [system overview](./agent/system-overview.md), then [tools](./agent/tools.md), [triggers](./agent/triggers.md), [persistence](./agent/persistence.md), and [security](./agent/security.md). <!-- id:BvDmGUR0 -->
- To talk to a server from your own code: [signed API](./agent/signed-api.md) and [WebSocket subscriptions](./agent/websocket-subscriptions.md). <!-- id:pfZb1MX5 -->
- To run or deploy a server: [operations](./agent/operations.md), [environments](./agent/environments.md), [model providers](./agent/model-providers.md), and [troubleshooting](./agent/troubleshooting.md). <!-- id:WNPnKf7v -->
- To change the code: [development](./agent/development.md) has the code map and the commands; the [roadmap](./agent/roadmap.md) and the open [plans](./agent/plans/speed.md) say where this is going. The build history that used to live here is in git. <!-- id:MQefzS0T -->
