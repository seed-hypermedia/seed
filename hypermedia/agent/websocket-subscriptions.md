---
name: WebSocket Subscriptions
summary: How a client opens a signed WebSocket subscription to an agents server and receives live account, agent, session, and run updates.
---
The [Seed Agents](../agent.md) WebSocket API delivers live account, agent, session, and run updates after a signed subscription handshake. The handshake uses the same signed envelope as the [signed API](./signed-api.md). <!-- id:xPzzllRE -->

Endpoint: <!-- id:81Qi_5av -->

```text <!-- id:W1ldgCLe -->
/agents/ws
```

Local URL (dev; release builds use port 3050): <!-- id:WN40e7Mr -->

```text <!-- id:5ExdGmxf -->
ws://localhost:3051/agents/ws
```

URL helper: `getAgentWebSocketUrl()` in `frontend/packages/ui/src/agents/client.ts`. <!-- id:RwWUii1G -->

# Transport <!-- id:Ylw5APIb -->

Client → server: <!-- id:My7LMnqv -->
  - binary DAG-CBOR `SignedActionEnvelope` whose action is `Subscribe`. <!-- id:iIh1wzuq -->

Server → client: <!-- id:3mOMpyjG -->
  - JSON string `AgentWSEvent` values. <!-- id:cGn80quA -->

Server-to-client events are not individually signed. Authorization happens once, at subscription time, on the socket. <!-- id:qiBmul3r -->

# Subscribe action <!-- id:KlNP4q1p -->

```ts <!-- id:O21Jvvv7 -->
type Subscribe = {
  _: 'Subscribe'
  key: `account/${string}` | `agents/${string}` | `sessions/${string}` | `runs/${string}`
  afterSeq?: number
}
```

The desktop must omit `afterSeq` when it has no value. Do not sign `afterSeq: undefined`. `signAgentAction()` adds a signed `ts` timestamp, and the server rejects stale or future subscriptions using the same five-minute window as HTTP actions. <!-- id:g9HwBwFE -->

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
  | {_: 'error'; message: string}
```

# Subscription keys <!-- id:JtmJRPxg -->

## `account/<accountId>` <!-- id:fx6p0P_O -->

Account-wide notifications. Every open desktop window and signed-in web tab holds one, because it feeds the unread indicator. So it carries only the small `account/<id>` change hints and run changes, and never transcript frames. Session appends, streaming partials, and session snapshots go only to direct `sessions/<id>` (and `agents/<id>`) subscribers. The sidebar and lists take the session snapshot and the agent's activity rollup from the hints. The key is the Seed [account](../protocol/identity.md) id. <!-- id:9O2G7Ybf -->

Two reasons carry the agent's fresh **activity rollup** (`AgentActivity`: latest event time and kind, latest message time and sender, that message's session, and whether any run is live): <!-- id:OzgtYWK9 -->
  - `session-event`: coalesced to about one per session per 1.5 s while a transcript grows. <!-- id:yK6_GLlz -->
  - `session-updated`: on a real session status transition, which is what flips `busy`. <!-- id:r4S8_Jm_ -->

Both also carry the session's fresh `SessionInfo` (`session`). Clients write the rollup into their cached agent rows and the snapshot into their cached session lists. An always-visible unread indicator or an open sidebar then costs no `ListAgents`, `ListSessions`, `GetSession`, or `GetAgent` refetch. The open transcript already streams on its own `sessions/<id>` subscription. A client that ignores the fields behaves as before. <!-- id:a-vij3l8 -->

## `agents/<agentId>` <!-- id:Y8P8IKFA -->

Agent detail updates and related session changes. The agent detail page uses this key. <!-- id:9vTDX5vq -->

## `sessions/<sessionId>` <!-- id:ELCfheex -->

Session event stream from the [Log](./log.md). The session page uses this key and receives: <!-- id:NXHgLurt -->
  - replay of durable events after `afterSeq`; <!-- id:vefKgvP0 -->
  - future durable `append` events from every [actor](./actor.md), including the user. A verb the user ran through `InvokeSessionTool` arrives on this stream as `tool_call` and `tool_result` events stamped `actor: 'user'`; <!-- id:L36itckc -->
  - session status `change` events; <!-- id:3riezm5W -->
  - live `appendPartial` events carrying assistant text deltas, cumulative run usage, and the current `AgentRunActivity` (`phase`, `toolName`, `toolCallId`, `detail`, and the `outputTail` of a long-running tool call). <!-- id:AWpS15pl -->

## `runs/<rootRunId>` <!-- id:qUHl4Dod -->

One subscription streams a whole [run](./runs.md) tree. The key is the ROOT run id, and `root_run_id` is denormalized on every run row for this. On subscribe the server sends a snapshot, one `change` per run in the tree, followed by durable [journal](./journal.md) `append` replay (`afterSeq` applies per run). Live events: <!-- id:HlrThHks -->
  - `change` with a `RunInfo` whenever any run in the tree changes status, usage, or plan; <!-- id:3RReb-lv -->
  - `append` with a workflow journal entry, tagged with the originating `runId`; <!-- id:XkkU9407 -->
  - `appendPartial` with ephemeral workflow progress (`ctx.progress`) and tool activity, tagged with `runId`. <!-- id:4xtACkHI -->

The pinned run card on the session page is durable-first. It rebuilds from `ListRuns` and `GetRunJournal`, and uses this stream only for liveness. <!-- id:Iui6gCKg -->

# Authorization <!-- id:WrZAbvQ7 -->

`Service.verifySubscription()` verifies: <!-- id:Df5IOCWO -->
  1. signed envelope shape; <!-- id:JnnBW67S -->
  2. signed action timestamp is within five minutes of server local time; <!-- id:Dca-RSwH -->
  3. Ed25519 [signature](../signature.md); <!-- id:bE9T2ugC -->
  4. signer authorization for account; <!-- id:ezvGnO9q -->
  5. requested key belongs to the account. <!-- id:8C2Q0c3R -->

Rules: <!-- id:VJd0eD_k -->
  - `account/<accountId>` must equal verified account ID. <!-- id:axsKmzfR -->
  - `agents/<agentId>` requires owner or accepted reader or writer access. <!-- id:GUmWMoXO -->
  - `sessions/<sessionId>` requires owner or accepted reader or writer access to its agent. <!-- id:c2GU3GL- -->
  - `runs/<rootRunId>` requires owner or accepted reader or writer access to its agent. <!-- id:JQdvUlVm -->
  - Accepted collaborators receive the agent's live service events under their own account subscription. Pending and revoked collaborators do not. <!-- id:cMdZUdG1 -->
  - A socket may not switch accounts after a successful subscription. <!-- id:JAODdem0 -->

# Replay <!-- id:V2Zm4-wC -->

Only durable session events are replayed. Live partials are not persisted and cannot be replayed. <!-- id:Jy3_Xd4u -->

For `sessions/<id>` with `afterSeq`, the server sends: <!-- id:pSK8r44j -->
  1. `subscribed`; <!-- id:DvtwIk6Y -->
  2. session `change`; <!-- id:mTWZ9qTP -->
  3. durable `append` events where `seq > afterSeq`. <!-- id:Hi-9bxpk -->

# Durable appends vs partial appends <!-- id:Wjl8ZQla -->

## `append` <!-- id:J139aPp4 -->

`append` is durable. It maps to a row in `session_events`. <!-- id:FdScUpRF -->

Desktop behavior: <!-- id:ofVmfTqC -->
  - inserts the event into the `GetSession` cache; <!-- id:GzSQQzFt -->
  - removes matching optimistic user events; <!-- id:RVwuDBnh -->
  - clears the visible partial for that session, because final durable data arrived; <!-- id:diuPSNYn -->
  - while that session is open, extracts [`hm://` references](../protocol/urls.md) from structured tool results and assistant messages, and keeps them subscribed through the desktop [sync](../protocol/network.md) service until the session closes. This runs only for the exact mounted `sessions/<id>` socket (a full session page or the selected Assistant-sidebar session). It never runs for account or agent sockets or background sessions. [Comment](../protocol/comments.md) references recursively subscribe to their target [document](../protocol/documents.md). Newly published comments and documents from a remote agent server are then available locally before their links are opened. <!-- id:zNms67AN -->

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

The desktop keeps the partial visible on `done` and clears it only when a durable `append` arrives. The Pi-backed runtime emits a fresh partial stream for each assistant turn and appends that turn's durable assistant message at Pi `message_end`, before any following tool execution events. Streamed text before a tool call then settles into the durable event list ahead of the durable `tool_call` row. It does not wait until the whole agent run ends. <!-- id:FPf42YK5 -->

# Streaming diagnostics <!-- id:7SQoXZwS -->

Server logs: <!-- id:FLNvd71Y -->
  - `[agents/ws] open` <!-- id:knRDRXQh -->
  - `[agents/ws] subscribed` <!-- id:0S-0pPvn -->
  - `[agents/ws] publish partial` <!-- id:wu7N9Vjz -->
  - `[agents/ws] send partial` <!-- id:KnBaZCXZ -->
  - `[agents/ws] skip partial; no subscription` <!-- id:142-kLCo -->
  - `[agents/ws] close` <!-- id:9pNS00lm -->

Desktop logs: <!-- id:PU7dcq0z -->
  - `[agents/ws] connecting` <!-- id:2qs4WeML -->
  - `[agents/ws] open; signing subscribe` <!-- id:29bR419F -->
  - `[agents/ws] subscribe sent` <!-- id:PHd4Go1O -->
  - `[agents/ws] subscribed event` <!-- id:hZA-6I7E -->
  - `[agents/ws] partial event` <!-- id:GO31b_5F -->
  - `[agents/ws] partial state updated` <!-- id:rYK9XIr8 -->
  - `[agents/ws] partial marked done; keeping visible until durable append` <!-- id:AQ8qW7N5 -->
  - `[agents/ws] ignored malformed message` <!-- id:65NDxmvj -->

Troubleshooting sequence: <!-- id:sttnj-Cy -->
  1. Confirm the desktop receives `subscribed event`. <!-- id:55kyt-pO -->
  2. Confirm server logs `publish partial`. <!-- id:Oft3wYee -->
  3. Confirm server logs `send partial`. `skip partial` means no subscription matched. <!-- id:ktqE5NP1 -->
  4. Confirm the desktop logs `partial event` and `partial state updated`. <!-- id:0KQE_u5d -->
  5. Confirm UI logs `rendering streaming assistant partial`. <!-- id:vtUFFYIB -->

# Known limitations <!-- id:bA1vFtbR -->

- Server-to-client events use JSON. They do not use CBOR. <!-- id:bNYv16Kh -->
- Events are not individually signed. <!-- id:DSPsyFrn -->
- Partial chunks are not durable and are not replayed. <!-- id:XbXehDbz -->
- No explicit unsubscribe message exists. <!-- id:852_Oe-H -->
- No heartbeat or ping protocol exists. <!-- id:xQB-n7mf -->
- No backpressure or subscription-limit handling exists. <!-- id:U8R9vXoS -->
- Desktop reconnect resubscribes, but there is no full persistent cursor manager for every resource type. <!-- id:HUccfbAA -->

# Future work <!-- id:RGNIvPpy -->

The planned WebSocket protocol v2 (heartbeat, explicit unsubscribe, subscription limits, backpressure, reconnect cursors, and metrics) is on the [roadmap](./roadmap.md). <!-- id:kEebyX8V -->

# See also <!-- id:RI2uEBnH -->

- [Signed API](./signed-api.md) <!-- id:1ULln6ca -->
- [System overview](./system-overview.md) <!-- id:ZFWBX-DI -->
- [Persistence](./persistence.md) <!-- id:zIxVyd5y -->
- [Desktop and web UI](./desktop-ui.md) <!-- id:xmPQke6b -->
- [Troubleshooting](./troubleshooting.md) <!-- id:MaaIFsUE -->
