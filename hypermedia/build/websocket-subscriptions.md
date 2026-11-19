---
name: WebSocket Subscriptions
summary: A client opens a WebSocket to an app environment, sends signed Subscribe actions, and receives live updates about an account, an agent, a session, or a run.
---
An [app environment](../software/app-environment.md) can tell you about changes as they happen. You open a WebSocket and send one signed `Subscribe` action for each thing you want to follow. The server then sends you updates about that [account](../protocol/identity.md), [agent](../agent.md), [session](../agent/session.md) or [run](../agent/runs.md). The signed envelope is the same one the [signed API](./signed-api.md#signed-envelope) uses. <!-- id:xPzzllRE -->

Endpoint: <!-- id:81Qi_5av -->

```text <!-- id:W1ldgCLe -->
/hm/api/apps/ws
```

`/hm/api/apps` is the main prefix of the app environment's API. The same socket answers at `/hm/api/agents/ws`, the path released clients use. It also answers at `/agents/ws`, for older clients whose server URL has no path. <!-- id:8Twx0x3m -->

`getAgentWebSocketUrl()` in `frontend/packages/ui/src/agents/client.ts` builds the URL. It picks the main path or an older one from the shape of the server URL. <!-- id:RwWUii1G -->

# Transport <!-- id:Ylw5APIb -->

The client sends: <!-- id:My7LMnqv -->
  - a binary frame with a `SignedActionEnvelope`, encoded as [DAG-CBOR](../schema/dag-cbor.md), whose action is `Subscribe`. A JSON text frame that holds the same bytes as an array of numbers works too. The server checks the envelope's `protocol` as it does for an HTTP action. A version that is too old gets an `error` frame with code `protocol_too_old`. <!-- id:iIh1wzuq -->

The server sends: <!-- id:3mOMpyjG -->
  - `AgentWSEvent` values, each as a JSON text frame. <!-- id:cGn80quA -->

The server does not sign each event. It checks your right to follow a key once, when you subscribe. <!-- id:qiBmul3r -->

There is no message to unsubscribe, and no heartbeat or ping. The server does not slow down for a slow client, and it does not limit the number of subscriptions.

# Subscribe action <!-- id:KlNP4q1p -->

```ts <!-- id:O21Jvvv7 -->
type Subscribe = {
  _: 'Subscribe'
  key: `account/${string}` | `agents/${string}` | `sessions/${string}` | `runs/${string}`
  afterSeq?: number
}
```

Leave `afterSeq` out when you have no value for it: [never sign `undefined`](./signed-api.md#never-sign-undefined). The action carries a signed `ts` timestamp. The server refuses a subscription whose `ts` is more than five minutes from its own clock, as it does for HTTP actions. <!-- id:g9HwBwFE -->

# Server events <!-- id:o7iR-u63 -->

```ts <!-- id:iuamjr10 -->
type AgentWSEvent =
  | {_: 'connected'; connectedAt: number}
  | {_: 'subscribed'; key: string; accountId: string}
  | {_: 'append'; key: `sessions/${string}`; event: SessionEvent}
  | {
      _: 'appendPartial'
      key: `sessions/${string}`
      partialId: string
      patch: {textDelta?: string; done?: boolean; usage?: AgentRunUsage; activity?: AgentRunActivity}
    }
  | {_: 'change'; key: `sessions/${string}`; value: SessionInfo}
  | {_: 'change'; key: `agents/${string}`; value: AgentInfo}
  | {
      _: 'change'
      key: `account/${string}`
      value: {reason: string; agentId?: string; sessionId?: string; activity?: AgentActivity; session?: SessionInfo}
    }
  | {_: 'change'; key: `runs/${string}`; value: RunInfo}
  | {_: 'append'; key: `runs/${string}`; runId: string; seq: number; entry: Record<string, unknown>; createdAt: number}
  | {
      _: 'appendPartial'
      key: `runs/${string}`
      runId: string
      partialId: string
      patch: {progress?: {fraction?: number; label?: string}; activity?: AgentRunActivity; usage?: AgentRunUsage}
    }
  | {_: 'error'; message: string; code?: ProtocolErrorCode}
```

# Subscription keys <!-- id:JtmJRPxg -->

## `account/<accountId>` <!-- id:fx6p0P_O -->

This key is for news about the whole account. The key is the Seed account id. Every open window of the [Seed app](../software/desktop.md) and every signed-in web tab holds one, because it feeds the unread mark. So the server keeps it light. It sends only small frames: the `account/<id>` change hints, agent changes (`change` frames keyed `agents/<id>`) and run changes. It never sends the text of a conversation. New session events, streaming text and session snapshots go only to those who subscribe to `sessions/<id>` or `agents/<id>`. The sidebar and the lists take the session snapshot and the agent's activity summary from the hints. <!-- id:9O2G7Ybf -->

Two reasons carry the agent's latest **activity summary** (`AgentActivity`: the time and kind of the latest event, the time and sender of the latest message, that message's session, and whether any run is live): <!-- id:OzgtYWK9 -->
  - `session-event`: sent about once per session every 1.5 s while a conversation grows. <!-- id:yK6_GLlz -->
  - `session-updated`: when a session's status changes, which is what flips `busy`. The same reason is also sent when a session is renamed or its model changes; those carry `session` and no `activity`. <!-- id:r4S8_Jm_ -->

Both also carry the session's latest `SessionInfo` (`session`). A client writes the summary into its cached agents and the snapshot into its cached session lists. An unread mark or an open sidebar then needs no new `ListAgents`, `ListSessions`, `GetSession` or `GetAgent` request. An open conversation already gets its events on its own `sessions/<id>` subscription. A client may ignore these fields. <!-- id:a-vij3l8 -->

## `agents/<agentId>` <!-- id:Y8P8IKFA -->

Changes to one agent and to its sessions. The agent's detail page uses this key. <!-- id:9vTDX5vq -->

## `sessions/<sessionId>` <!-- id:ELCfheex -->

The events of one session, from its [Log](../agent/log.md). The session page uses this key and receives: <!-- id:NXHgLurt -->
  - replay of durable events after `afterSeq`; <!-- id:vefKgvP0 -->
  - future durable `append` events from every [actor](../agent/actor.md), including the user. A verb the user ran through `InvokeSessionTool` arrives on this stream as `tool_call` and `tool_result` events stamped `actor: 'user'`; <!-- id:L36itckc -->
  - session status `change` events; <!-- id:3riezm5W -->
  - live `appendPartial` events carrying assistant text deltas, cumulative run usage, and the current `AgentRunActivity` (`phase`, `toolName`, `toolCallId`, `detail`, and the `outputTail` of a long-running tool call). <!-- id:AWpS15pl -->

## `runs/<rootRunId>` <!-- id:qUHl4Dod -->

One subscription follows a whole tree of runs: a run and every run it started. The key is the id of the ROOT run, which every run in the tree stores as `root_run_id`. If you subscribe with a child run's id, you get the first snapshot and then nothing, because live events are sent only under the root's key. When you subscribe, the server sends a snapshot: one `change` per run in the tree, then the stored [journal](../agent/journal.md) entries as `append` events (`afterSeq` applies to each run). After that it sends live events: <!-- id:HlrThHks -->
  - `change` with a `RunInfo` whenever any run in the tree changes status, usage, or plan; <!-- id:3RReb-lv -->
  - `append` with a workflow journal entry, tagged with the originating `runId`; <!-- id:XkkU9407 -->
  - `appendPartial` with ephemeral workflow progress (`ctx.progress`) and tool activity, tagged with `runId`. <!-- id:4xtACkHI -->

A client can always build the tree again from `ListRuns` and `GetRunJournal`, and use this subscription only for live updates. <!-- id:Iui6gCKg -->

# Authorization <!-- id:WrZAbvQ7 -->

`Service.verifySubscription()` checks: <!-- id:Df5IOCWO -->
  1. signed envelope shape; <!-- id:JnnBW67S -->
  2. signed action timestamp is within five minutes of server local time; <!-- id:Dca-RSwH -->
  3. Ed25519 [signature](../signature.md), the scheme every [blob](../blob.md) is signed with; <!-- id:bE9T2ugC -->
  4. signer authorization for account; <!-- id:ezvGnO9q -->
  5. the account may read the thing the key points at (see the rules below). <!-- id:8C2Q0c3R -->

Rules: <!-- id:VJd0eD_k -->
  - `account/<accountId>` must equal verified account ID. <!-- id:axsKmzfR -->
  - `agents/<agentId>` requires reader access: owner, accepted reader or writer, or any signed account on a `publicRead` agent. <!-- id:GUmWMoXO -->
  - `sessions/<sessionId>` requires reader access to its agent. <!-- id:c2GU3GL- -->
  - `runs/<rootRunId>` requires reader access to its agent. <!-- id:JQdvUlVm -->

The server sends an agent's events to its owner and to its collaborators. A public reader gets the owner's events for the key it subscribed to, and `accessRole` on `agents/` change frames is rewritten to `reader` or `chatter` for it. A subscriber to `agents/<agentId>` also receives `change` frames whose key is `sessions/<id>` or `account/<ownerId>`. So a client must not drop a frame because its key differs from the key the client subscribed to. <!-- id:v93ET5CB -->
  - An accepted collaborator receives the agent's live events on its own account subscription. A collaborator that has not accepted, or was removed, does not. <!-- id:cMdZUdG1 -->
  - After one successful subscription, a socket cannot change to another account. <!-- id:JAODdem0 -->

# Replay <!-- id:V2Zm4-wC -->

Replay means the server sends you the stored events you missed. Only stored session events are replayed. Live partial text is not stored, so it cannot be replayed. The server reads the replay in the same step that adds your socket to the session's subscribers. So you get each event either in the replay or live, and none is lost. `GetSession` reads the log last for the same reason: a client adds what its socket delivers to what it fetched. <!-- id:Jy3_Xd4u -->

For `sessions/<id>`, with or without `afterSeq`, the server sends: <!-- id:pSK8r44j -->
  1. `subscribed`; <!-- id:DvtwIk6Y -->
  2. session `change`; <!-- id:mTWZ9qTP -->
  3. durable `append` events where `seq > afterSeq`, or the whole transcript when `afterSeq` is absent. An event that is too large, replayed or live, arrives with a `truncated` marker; `GetSessionEvent {sessionId, seq}` returns it whole. <!-- id:Hi-9bxpk -->

# Durable appends vs partial appends <!-- id:Wjl8ZQla -->

## `append` <!-- id:J139aPp4 -->

`append` is a stored event. It matches one row in `session_events`. <!-- id:FdScUpRF -->

A client adds the event to the conversation it shows. It removes the matching user message it had shown ahead of the server, and clears the partial text for that session, because the final data has arrived.

## `appendPartial` <!-- id:lCik3Bqk -->

`appendPartial` is not stored. It carries the agent's text while the agent is still writing it. <!-- id:EQU0HBy_ -->

Example: <!-- id:8qGefmAC -->

```json <!-- id:7B0OHzqV -->
{
  "_": "appendPartial",
  "key": "sessions/abc",
  "partialId": "partial-uuid",
  "patch": {"textDelta": "hello"}
}
```

Later the server sends: <!-- id:-eigGcgR -->

```json <!-- id:ZHJBsrFh -->
{
  "_": "appendPartial",
  "key": "sessions/abc",
  "partialId": "partial-uuid",
  "patch": {"done": true}
}
```

A client keeps the partial text visible on `done` and clears it only when a stored `append` arrives. The server starts a new partial for each model response. It appends the stored assistant message of that response as soon as the session's [durable store](../agent/durable-sessions.md) has it, before the events of any tool call that follows. So text streamed before a tool call becomes a stored event ahead of the stored `tool_call` event. It does not wait for the whole run to end. <!-- id:FPf42YK5 -->

# See also <!-- id:RI2uEBnH -->

- [Signed API](./signed-api.md) <!-- id:1ULln6ca -->
- [Sessions and runs](./signed-api-sessions.md) for `GetSession`, `ListRuns` and `GetRunJournal`
- [How agents work](../agent/how-it-works.md) <!-- id:ZFWBX-DI -->
- [Persistence](../operate/persistence.md) <!-- id:zIxVyd5y -->
- [Agents in the Seed app](../agent/in-the-app.md) <!-- id:xmPQke6b -->
- [Troubleshooting](../operate/troubleshooting.md) <!-- id:MaaIFsUE -->
