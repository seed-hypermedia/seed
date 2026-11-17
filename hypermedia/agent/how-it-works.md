---
name: How agents work
summary: "How the pieces of Seed Agents fit together: the design principles, the components of the apps and the server, and what happens to one message from the moment it is sent."
---
[Seed Agents](../agent.md) is a local-first, account-scoped agent system. The [desktop app](../software/desktop.md) uses it to configure an app environment, store provider secrets, create agents, work in durable sessions, stream model responses, [delegate](./delegate.md) work to children, and inspect everything that executed. <!-- id:j6gFhd29 -->

This page has three parts: the principles the design holds to, the components, and the path one message takes. Read it after the [introduction](../agent.md) and before the pages on single parts.

# Design principles <!-- id:bHJBP28f -->

<!-- id:aTrhlaXK -->
1. **Signed control plane**: every HTTP action is wrapped in a signed DAG-CBOR envelope. See the [signed API](../build/signed-api.md). <!-- id:DoPLxUzT -->
2. **Account isolation**: persisted state belongs to one Seed [account](../protocol/identity.md). Access needs ownership or an accepted agent-level reader or writer collaboration. <!-- id:JartbkEd -->
3. **Durable sessions**: sessions are append-only event logs with replay by sequence number. <!-- id:G2rHB4lC -->
4. **Live clients**: desktop clients subscribe over a signed [WebSocket protocol](../build/websocket-subscriptions.md) and receive live changes. <!-- id:eZIvnI2F -->
5. **Secret redaction**: API keys are encrypted at rest and never returned in API responses. <!-- id:0HDC4TeT -->
6. **Visible tools**: tool calls and tool results are durable session events, rendered in the UI. <!-- id:MArR08vh -->
7. **Shared hypermedia behavior**: [`read`](./read.md) uses [SDK](../build/sdk.md) code shared with the [CLI](../build/cli.md)'s URL resolution. It does not shell out to the CLI. <!-- id:1_gfqzKV -->
8. **Inspectable operation**: durable session events, the signed read actions, and diagnostic logs support debugging local workflows. There is no unauthenticated inspection surface. <!-- id:ldqXhH-1 -->
9. **Few verbs, one address space**: the five verbs `read`, `write`, `call`, `delegate`, `plan`, plus the two session verbs `status` and `continue_session`, are the whole model-facing surface. A new feature arrives as a new address or a new callable. It never adds a tool to the provider payload. <!-- id:Y-pjolWg -->
10. **Configuration is content**: an agent's tools and memory are documents in its [Space](./space.md). The agent and its owner can both address and read them. <!-- id:5lhl3lKX -->
11. **The log is symmetric**: the user holds the same verbs the agent does, every event in the [Log](./log.md) names its actor, and there is no side channel between them. <!-- id:3AOgn7T0 -->
12. **Everything that executes is a run**: turns, children, and scripts are rows in one tree, and that tree is also the queue. Waiting costs nothing and a crash is recoverable. See [Runs](./runs.md). <!-- id:H7vDrg4J -->

Each term above has its own page, listed in the [Agents glossary](./glossary.md). <!-- id:1RALufCn -->

# Major components <!-- id:LF0S8XBg -->

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
  ├─ /hm/api/agents/message signed action API
  ├─ /hm/api/agents/ws signed subscription API
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

The desktop app signs through the [Seed daemon](../software/daemon.md). The service itself is described on the [app environment](../software/app-environment.md) page, and [persistence](../operate/persistence.md) covers the SQLite tables. <!-- id:yIyCWRRk -->

# The life of a message <!-- id:29tMaHyG -->

Steps 1 to 8 set an agent up. Steps 9 to 21 follow one message.

1. A person opens a space in the Seed app. The app finds the space's agents through their [mount documents](./mounting.md).
2. The app reads each agent's server address from its document and checks the server's health at `/hm/api/agents/health`.
3. Desktop opens a signed WebSocket subscription for the selected account. <!-- id:tn8sA958 -->
4. User configures a model provider in the **Model providers** dialog. <!-- id:Ckat4Ybf -->
5. Desktop sends signed `SetSecret` and `SetModelProvider` actions. <!-- id:TNB496ji -->
6. User creates an agent from the home document's **New** menu. <!-- id:6rIhCXQw -->
7. Desktop publishes the agent's document and sends signed `CreateAgent`. <!-- id:Mw42bAcf -->
8. Server persists the agent and broadcasts account changes. <!-- id:U2T3lUGx -->
9. User opens the agent and creates or opens a [session](./session.md). <!-- id:Mx7jRmmi -->
10. Desktop subscribes to `sessions/<sessionId>` over WebSocket. <!-- id:o4auo92c -->
11. A writer sends a message with signed `MessageSession`. Other accepted writers may send at the same time. <!-- id:HR9VWSNS -->
12. Server immediately appends each durable user message with its acting account and exact signer, broadcasts it, and creates a `runs` row. The first turn is claimed inline on the `interactive` queue. Concurrent turns stay queued in append order, because only one model turn may own a session. Session status mirrors run state, so it reads `streaming` while any of those turns are live. <!-- id:oRXM5vFs -->
13. Server opens the session's [durable store](./durable-sessions.md) and brings its conversation up to date with the log. The turn's configuration comes from the Seed provider record, the encrypted secret, the agent's system prompt (its own instructions, which for a mounted agent are its document's latest published version, plus the shared runtime prompt; see [what an agent is told](./prompt.md)), and the tool set: the verbs, plus any callables the transcript shows this thread has already expanded. <!-- id:XnosbwT5 -->
14. Pi Durable runs the provider and model loop. It commits every model response, tool result, and partial answer to the store before anything else sees it. <!-- id:5aLPYqqC -->
15. Server emits `session-partial` service events for model text deltas, cumulative usage, and the current activity phase. <!-- id:Tmz1FBxK -->
16. WebSocket sends `appendPartial` events to subscribed desktop clients. <!-- id:t5ien6K3 -->
17. Desktop renders the partial through the shared assistant markdown renderer. <!-- id:5V6t_xTb -->
18. Tool calls and results are projected from the store's entries and appended as durable Seed events stamped `actor: 'agent'`. A [`call`](./call.md) for a tool the thread has not expanded returns that tool's contract instead of an error (touch-expand). Once the contract is in the transcript, the tool is promoted for the rest of the thread. <!-- id:aSLd8Isz -->
19. If the turn used `delegate`, each child gets its own run row: a model child with its own session, or a script child in the QuickJS engine. The parent's run parks on them without holding resources and resumes when they resolve. <!-- id:nKBBy1Gx -->
20. The final assistant message is appended as a durable event. The run finalizes: it rolls child usage up, settles [plan](./plan.md) steps whose children all succeeded, and records any obligation it ended without meeting. <!-- id:ZwcfQgzb -->
21. Session status re-derives to `idle`, or to `error` when the latest run failed. <!-- id:2lxTmx1B -->

# Limits

- A captured signed request can be replayed for up to five minutes, because the server checks a timestamp and keeps no nonce cache. See the [security model](./security.md).
- The key that encrypts secrets is stored in the same database as the secrets. See [agent identity](./identity.md).
- [Grants](./grants.md) stop at the callable set, one `publish` grant, and the list of enabled MCP servers. There is no policy per address or per destination, and memory writes are never gated.
- The [WebSocket protocol](../build/websocket-subscriptions.md) has no full heartbeat, no backpressure and no limit on subscriptions.
- A message sent while a turn runs waits for the next turn.

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
