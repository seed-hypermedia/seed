---
name: WebSocket Subscriptions
summary: How a client opens a signed WebSocket subscription to an app environment and receives live account, agent, session, and run updates.
---
The [Seed Agents](../agent.md) WebSocket API delivers live account, agent, session, and run updates after a signed subscription handshake. The handshake uses the same signed envelope as the [signed API](./signed-api.md). <!-- id:xPzzllRE -->

Endpoint: <!-- id:81Qi_5av -->

```text <!-- id:W1ldgCLe -->
/hm/api/apps/ws
```

`/hm/api/apps` is the canonical prefix of the app environment's API. The same socket answers at `/hm/api/agents/ws`, the prefix released clients name, and at `/agents/ws`, which is accepted for older clients that hold an origin-only server URL. <!-- id:8Twx0x3m -->

URL helper: `getAgentWebSocketUrl()` in `frontend/packages/ui/src/agents/client.ts`, which picks the canonical or legacy path from the server URL's shape. <!-- id:RwWUii1G -->

# Transport <!-- id:Ylw5APIb -->

Client → server: <!-- id:My7LMnqv -->
  - binary DAG-CBOR `SignedActionEnvelope` whose action is `Subscribe` (a JSON text frame holding the same bytes as an array of numbers is accepted too). The envelope's `protocol` is checked like an HTTP action's; too old gets an `error` frame with code `protocol_too_old`. <!-- id:iIh1wzuq -->

Server → client: <!-- id:3mOMpyjG -->
  - JSON string `AgentWSEvent` values. <!-- id:cGn80quA -->

Server-to-client events are not individually signed. Authorization happens once, at subscription time, on the socket. <!-- id:qiBmul3r -->

The protocol has no unsubscribe message, no heartbeat or ping, and no backpressure or subscription limit.

# Subscribe action <!-- id:KlNP4q1p -->

```ts <!-- id:O21Jvvv7 -->
type Subscribe = {
  _: 'Subscribe'
  key: `account/${string}` | `agents/${string}` | `sessions/${string}` | `runs/${string}`
  afterSeq?: number
}
```

Omit `afterSeq` when there is no value: [never sign `undefined`](./signed-api.md#never-sign-undefined). The action carries a signed `ts` timestamp, and the server rejects stale or future subscriptions using the same five-minute window as HTTP actions. <!-- id:g9HwBwFE -->

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

Account-wide notifications. Every open desktop window and signed-in web tab holds one, because it feeds the unread indicator. So it carries only the small `account/<id>` change hints and run changes, and never transcript frames. Session appends, streaming partials, and session snapshots go only to direct `sessions/<id>` (and `agents/<id>`) subscribers. The sidebar and lists take the session snapshot and the agent's activity rollup from the hints. The key is the Seed [account](../protocol/identity.md) id. <!-- id:9O2G7Ybf -->

Two reasons carry the agent's fresh **activity rollup** (`AgentActivity`: latest event time and kind, latest message time and sender, that message's session, and whether any run is live): <!-- id:OzgtYWK9 -->
  - `session-event`: coalesced to about one per session per 1.5 s while a transcript grows. <!-- id:yK6_GLlz -->
  - `session-updated`: on a real session status transition, which is what flips `busy`. <!-- id:r4S8_Jm_ -->

Both also carry the session's fresh `SessionInfo` (`session`). Clients write the rollup into their cached agent rows and the snapshot into their cached session lists. An always-visible unread indicator or an open sidebar then costs no `ListAgents`, `ListSessions`, `GetSession`, or `GetAgent` refetch. The open transcript already streams on its own `sessions/<id>` subscription. A client may ignore the fields. <!-- id:a-vij3l8 -->

## `agents/<agentId>` <!-- id:Y8P8IKFA -->

Agent detail updates and related session changes. The agent detail page uses this key. <!-- id:9vTDX5vq -->

## `sessions/<sessionId>` <!-- id:ELCfheex -->

Session event stream from the [Log](../agent/log.md). The session page uses this key and receives: <!-- id:NXHgLurt -->
  - replay of durable events after `afterSeq`; <!-- id:vefKgvP0 -->
  - future durable `append` events from every [actor](../agent/actor.md), including the user. A verb the user ran through `InvokeSessionTool` arrives on this stream as `tool_call` and `tool_result` events stamped `actor: 'user'`; <!-- id:L36itckc -->
  - session status `change` events; <!-- id:3riezm5W -->
  - live `appendPartial` events carrying assistant text deltas, cumulative run usage, and the current `AgentRunActivity` (`phase`, `toolName`, `toolCallId`, `detail`, and the `outputTail` of a long-running tool call). <!-- id:AWpS15pl -->

## `runs/<rootRunId>` <!-- id:qUHl4Dod -->

One subscription streams a whole [run](../agent/runs.md) tree. The key is the ROOT run id, and `root_run_id` is denormalized on every run row for this. On subscribe the server sends a snapshot, one `change` per run in the tree, followed by durable [journal](../agent/journal.md) `append` replay (`afterSeq` applies per run). Live events: <!-- id:HlrThHks -->
  - `change` with a `RunInfo` whenever any run in the tree changes status, usage, or plan; <!-- id:3RReb-lv -->
  - `append` with a workflow journal entry, tagged with the originating `runId`; <!-- id:XkkU9407 -->
  - `appendPartial` with ephemeral workflow progress (`ctx.progress`) and tool activity, tagged with `runId`. <!-- id:4xtACkHI -->

A client can rebuild a run tree durably from `ListRuns` and `GetRunJournal`, and use this stream only for liveness. <!-- id:Iui6gCKg -->

# Authorization <!-- id:WrZAbvQ7 -->

`Service.verifySubscription()` verifies: <!-- id:Df5IOCWO -->
  1. signed envelope shape; <!-- id:JnnBW67S -->
  2. signed action timestamp is within five minutes of server local time; <!-- id:Dca-RSwH -->
  3. Ed25519 [signature](../signature.md); <!-- id:bE9T2ugC -->
  4. signer authorization for account; <!-- id:ezvGnO9q -->
  5. requested key belongs to the account. <!-- id:8C2Q0c3R -->

Rules: <!-- id:VJd0eD_k -->
  - `account/<accountId>` must equal verified account ID. <!-- id:axsKmzfR -->
  - `agents/<agentId>` requires reader access: owner, accepted reader or writer, or any signed account on a `publicRead` agent. <!-- id:GUmWMoXO -->
  - `sessions/<sessionId>` requires reader access to its agent. <!-- id:c2GU3GL- -->
  - `runs/<rootRunId>` requires reader access to its agent. <!-- id:JQdvUlVm -->

The server fans events out to the owner and collaborator accounts. A public reader's socket is marked with the owner it reads through (`publicReadOf`), and the socket layer forwards the owner's events for that key to it, rewriting `accessRole` on `agents/` change frames to `reader` or `chatter`. A subscriber to `agents/<agentId>` also receives `change` frames whose key is `sessions/<id>` or `account/<ownerId>`, so a client must not drop frames whose key differs from the key it subscribed to. <!-- id:v93ET5CB -->
  - Accepted collaborators receive the agent's live service events under their own account subscription. Pending and revoked collaborators do not. <!-- id:cMdZUdG1 -->
  - A socket may not switch accounts after a successful subscription. <!-- id:JAODdem0 -->

# Replay <!-- id:V2Zm4-wC -->

Only durable session events are replayed. Live partials are not persisted and cannot be replayed. The replay is read in the same step that adds the socket to the session's subscribers, so an event is either in the replay or delivered live, never neither. `GetSession` reads the log last for the same reason: a client adds what its socket delivers to what it fetched. <!-- id:Jy3_Xd4u -->

For `sessions/<id>`, with or without `afterSeq`, the server sends: <!-- id:pSK8r44j -->
  1. `subscribed`; <!-- id:DvtwIk6Y -->
  2. session `change`; <!-- id:mTWZ9qTP -->
  3. durable `append` events where `seq > afterSeq`, or the whole transcript when `afterSeq` is absent. An oversized event, replayed or live, arrives with a `truncated` marker; `GetSessionEvent {sessionId, seq}` returns it whole. <!-- id:Hi-9bxpk -->

# Durable appends vs partial appends <!-- id:Wjl8ZQla -->

## `append` <!-- id:J139aPp4 -->

`append` is durable. It maps to a row in `session_events`. <!-- id:FdScUpRF -->

A client adds the event to its transcript, removes its matching optimistic user event, and clears the visible partial for that session, because final durable data arrived.

## `appendPartial` <!-- id:lCik3Bqk -->

`appendPartial` is non-durable. It represents in-progress assistant text. <!-- id:EQU0HBy_ -->

Example: <!-- id:8qGefmAC -->

```json <!-- id:7B0OHzqV -->
{
  "_": "appendPartial",
  "key": "sessions/abc",
  "partialId": "partial-uuid",
  "patch": {"textDelta": "hello"}
}
```

The server eventually sends: <!-- id:-eigGcgR -->

```json <!-- id:ZHJBsrFh -->
{
  "_": "appendPartial",
  "key": "sessions/abc",
  "partialId": "partial-uuid",
  "patch": {"done": true}
}
```

A client keeps the partial visible on `done` and clears it only when a durable `append` arrives. The runtime emits a fresh partial stream for each model response and appends that response's durable assistant message when its entry is committed to the session's [durable store](../agent/durable-sessions.md), before any following tool execution events. Streamed text before a tool call then settles into the durable event list ahead of the durable `tool_call` row. It does not wait until the whole agent run ends. <!-- id:FPf42YK5 -->

# See also <!-- id:RI2uEBnH -->

- [Signed API](./signed-api.md) <!-- id:1ULln6ca -->
- [Sessions and runs](./signed-api-sessions.md) for `GetSession`, `ListRuns` and `GetRunJournal`
- [How agents work](../agent/how-it-works.md) <!-- id:ZFWBX-DI -->
- [Persistence](../operate/persistence.md) <!-- id:zIxVyd5y -->
- [Agents in the Seed app](../agent/in-the-app.md) <!-- id:xmPQke6b -->
- [Troubleshooting](../operate/troubleshooting.md) <!-- id:MaaIFsUE -->
