---
name: How agents work
summary: How the pieces of Seed Agents fit together, with the design principles, the components of the apps and the server, and what happens to one message from the moment it is sent.
---
[Seed Agents](../agent.md) is the part of Seed that runs agents. An agent lives on a server called an [app environment](../software/app-environment.md). The [Seed app](../software/desktop.md) talks to that server to set up a model, create agents, chat with them, and see everything they did. <!-- id:j6gFhd29 -->

This page has three parts: the principles the design follows, the components, and the path one message takes. Read it after the [introduction](../agent.md) and before the pages on single parts.

# Design principles <!-- id:bHJBP28f -->

<!-- id:aTrhlaXK -->
1. **Signed control plane**: every HTTP action is wrapped in a signed [DAG-CBOR](../schema/dag-cbor.md) envelope. See the [signed API](../build/signed-api.md). <!-- id:DoPLxUzT -->
2. **Account isolation**: everything the server stores belongs to one Seed [account](../protocol/identity.md). To reach it you must be the owner, or a reader or writer the owner invited. See [sharing](./sharing.md). <!-- id:JartbkEd -->
3. **Durable sessions**: a [session](./session.md) is a log of events that only grows. A client can replay it from any sequence number. <!-- id:G2rHB4lC -->
4. **Live clients**: clients subscribe over a signed WebSocket (see [WebSocket subscriptions](../build/websocket-subscriptions.md)) and receive changes as they happen. <!-- id:eZIvnI2F -->
5. **Secret redaction**: the server stores API keys encrypted and never returns them in a response. <!-- id:0HDC4TeT -->
6. **Visible tools**: every tool call and every tool result is a saved session event, and the app shows it. <!-- id:MArR08vh -->
7. **Shared Hypermedia behavior**: [`read`](./read.md) uses the same [SDK](../build/sdk.md) code as the [CLI](../build/cli.md) to resolve URLs. It does not run the CLI as a program. <!-- id:1_gfqzKV -->
8. **Inspectable operation**: saved session events, the signed read actions, and diagnostic logs help you debug. Nothing can be inspected without a signature. <!-- id:ldqXhH-1 -->
9. **Few verbs, one address space**: the model starts with five verbs, `read`, [`write`](./write.md), `call`, `delegate` and `plan`, plus the two session verbs `status` and [`continue_session`](./session-continuation.md). A new feature arrives as a new address or a new [callable](./callables.md). It never adds a verb. A callable the thread has used is [promoted](./promotion.md) to a tool of its own. <!-- id:Y-pjolWg -->
10. **Configuration is content**: an agent's tools and memory are in its [Space](./space.md). The agent and its owner can both address and read them. <!-- id:5lhl3lKX -->
11. **The log is symmetric**: the person holds the same verbs as the agent. Every event in the [Log](./log.md) has an [actor](./actor.md), and there is no hidden channel between the two. <!-- id:3AOgn7T0 -->
12. **Everything that executes is a run**: turns, children, and scripts are rows in one tree, and that tree is also the queue. Waiting costs nothing, and a run survives a crash. See [Runs](./runs.md). <!-- id:H7vDrg4J -->

The main terms above each have their own page. The [Agents glossary](./glossary.md) lists them. <!-- id:1RALufCn -->

# Major components <!-- id:LF0S8XBg -->

There are three groups: the apps people use, the server, and the libraries they share.

```text <!-- id:9rdPDFNJ -->
Seed app (desktop) and Seed web app, sharing frontend/packages/ui/src/agents
  ├─ Local app environment subprocess (desktop only; same artifact as the Docker image)
  │    configured with the desktop's typed HM API bridge plus its daemon's direct IPFS endpoint
  ├─ Agent views of a mount document, and pages for one agent, one session, one run
  ├─ Assistant sidebar: sessions of any agent on any server the app knows
  ├─ Provider and create-agent dialogs
  ├─ daemon-backed signing for the selected account
  ├─ signed CBOR HTTP client
  ├─ signed WebSocket subscription hook
  └─ chat message renderer shared with the desktop assistant panel

App environment (Bun)
  ├─ /hm/api/apps/message signed action API
  ├─ /hm/api/apps/ws signed subscription API
  ├─ SQLite persistence (state, and the runs table that is also the queue)
  ├─ AES-GCM secret storage
  ├─ Pi Durable model execution loop, one durable conversation per session
  ├─ the verbs (read / write / call / delegate / plan, plus status / continue_session)
  ├─ tool documents in ~/tools + the <space> index with every turn's input
  ├─ run queue: leases, boot sweep, park/resume, wake sources
  ├─ QuickJS script engine with a content-keyed journal
  └─ diagnostic logging

Shared Seed libraries
  ├─ @seed-hypermedia/client for Ed25519 signatures/principals and canonical DAG-CBOR
  │    (the service imports them through the @shm/shared/blobs and @shm/shared/cbor re-exports)
  ├─ @seed-hypermedia/client for URL resolution and markdown conversion
  └─ desktop daemon for selected-account signing
```

The desktop app signs through the [Seed daemon](../software/daemon.md). The server is described on the [app environment](../software/app-environment.md) page, and [persistence](../operate/persistence.md) covers the SQLite tables. Pi Durable is the library that runs the model loop; see [durable sessions](./durable-sessions.md). <!-- id:yIyCWRRk -->

# The life of a message <!-- id:29tMaHyG -->

Steps 1 to 8 set an agent up. Steps 9 to 21 follow one message.

1. A person opens a space in the Seed app. The app finds the space's agents through their [mount documents](./mounting.md).
2. The app reads each agent's server address from its [document](../protocol/documents.md) and checks the server's health at `/api/health`.
3. The app opens a signed WebSocket subscription for the selected account. <!-- id:tn8sA958 -->
4. The person sets up a [model provider](./model-providers.md) in the **Model providers** dialog. <!-- id:Ckat4Ybf -->
5. The app sends signed `SetSecret` and `SetModelProvider` actions. <!-- id:TNB496ji -->
6. The person creates an agent from the **New** menu of the [home document](../protocol/spaces.md). <!-- id:6rIhCXQw -->
7. The app publishes the agent's document and sends a signed `CreateAgent`. <!-- id:Mw42bAcf -->
8. The server saves the agent and tells subscribed clients that the account changed. <!-- id:U2T3lUGx -->
9. The person opens the agent and creates or opens a [session](./session.md). <!-- id:Mx7jRmmi -->
10. The app subscribes to `sessions/<sessionId>` over WebSocket. <!-- id:o4auo92c -->
11. A writer sends a message with a signed `MessageSession`. Other accepted writers may send at the same time. <!-- id:HR9VWSNS -->
12. The server saves each user message at once, with the account that acted and the exact signer. It sends the message to subscribers and creates a `runs` row. The first turn is claimed at once on the `interactive` queue. Later turns wait in the order their messages arrived, because only one model turn may own a session. The session status follows its runs, so it reads `streaming` while any of those turns is live. <!-- id:oRXM5vFs -->
13. The server opens the session's [durable store](./durable-sessions.md) and brings its conversation up to date with the log. The turn is set up from the provider record, the encrypted secret, the system prompt, and the tools. The system prompt is the agent's own instructions plus the shared Seed instructions; see [what an agent is told](./prompt.md). The tools are the verbs, plus any callables this thread has already used. <!-- id:XnosbwT5 -->
14. Pi Durable runs the loop: it asks the model, runs the tool calls, and asks again. It saves every model response, tool result, and partial answer to the store before anything else sees it. <!-- id:5aLPYqqC -->
15. The server emits `session-partial` events with new model text, token usage so far, and what the turn is doing. <!-- id:Tmz1FBxK -->
16. The WebSocket sends `appendPartial` events to subscribed clients. <!-- id:t5ien6K3 -->
17. The app draws the partial text with the shared markdown renderer. <!-- id:5V6t_xTb -->
18. The server copies tool calls and results from the store into the log as saved events. They carry no actor field, so they read as the agent's. A [`call`](./call.md) for a tool the thread has not used returns that tool's [contract](./contract.md) in place of an error. Once the contract is in the transcript, the tool is promoted for the rest of the thread. <!-- id:aSLd8Isz -->
19. If the turn used [`delegate`](./delegate.md), each [child](./child.md) gets its own run row: a model child with its own session, or a [script](./script.md) child in the QuickJS engine. The parent's run [parks](./park.md) on them, holds no resources, and goes on when they finish. <!-- id:nKBBy1Gx -->
20. The server saves the final assistant message as an event. Then the run finishes: it adds up the token usage of its children, settles the [plan](./plan.md) steps whose children all succeeded, and records any [obligation](./obligations.md) it did not meet. <!-- id:ZwcfQgzb -->
21. The session status becomes `idle`, or `error` when the latest run failed. <!-- id:2lxTmx1B -->

A message sent while a turn runs is saved at once and answered by the next turn.

# Limits

- A captured signed request can be replayed for up to five minutes, because the server checks a timestamp and does not remember the requests it has seen. See the [security model](./security.md).
- The key that encrypts secrets is stored in the same database as the secrets. See [agent identity](./identity.md).
- [Grants](./grants.md) stop at the callable set, one `publish` grant, and the list of enabled [MCP servers](./mcp.md). There is no rule per address or per destination, and memory writes are never gated.
- The protocol of [WebSocket subscriptions](../build/websocket-subscriptions.md) has no full heartbeat, no backpressure and no limit on subscriptions.

# See also <!-- id:9AU1odFA -->

- [Seed Agents](../agent.md) <!-- id:6uBPJsy2 -->
- [Session](./session.md)
- [What an agent is told](./prompt.md)
- [Signed API](../build/signed-api.md) <!-- id:-Alet1OC -->
- [WebSocket subscriptions](../build/websocket-subscriptions.md) <!-- id:wcs36GWm -->
- [Persistence](../operate/persistence.md) <!-- id:y2-XofLJ -->
- [Durable sessions](./durable-sessions.md) <!-- id:epLSXKau -->
- [Tools](./tools.md) <!-- id:pt_odyHy -->
- [Security](./security.md) <!-- id:AOXXb80e -->
- [App environment](../software/app-environment.md) <!-- id:qeaCNGql -->
