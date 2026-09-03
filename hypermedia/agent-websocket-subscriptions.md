---
name: WebSocket subscriptions
summary: The Agents WebSocket API delivers live account, agent, and session updates after a signed subscription handshake.
---
The Agents WebSocket API delivers live account, agent, and session updates after a signed subscription handshake. <!-- id:xPzzllRE -->

Endpoint: <!-- id:81Qi_5av -->

```text <!-- id:W1ldgCLe -->
/agents/ws
```

Local URL (dev; release builds use port 3050): <!-- id:WN40e7Mr -->

```text <!-- id:5ExdGmxf -->
ws://localhost:3051/agents/ws
```

Desktop URL helper: `getAgentWebSocketUrl()` in `frontend/apps/desktop/src/agents-client.ts`. <!-- id:RwWUii1G -->

# Transport <!-- id:Ylw5APIb -->

Client → server: <!-- id:My7LMnqv -->
  - binary DAG-CBOR `SignedActionEnvelope` whose action is `Subscribe`. <!-- id:iIh1wzuq -->

Server → client: <!-- id:3mOMpyjG -->
  - JSON string `AgentWSEvent` values. <!-- id:cGn80quA -->

Server-to-client events are not individually signed; authorization happens at subscription time on the socket. <!-- id:qiBmul3r -->

# Subscribe action <!-- id:KlNP4q1p -->

```ts <!-- id:O21Jvvv7 -->
type Subscribe = {
  _: 'Subscribe'
  key: `account/${string}` | `agents/${string}` | `sessions/${string}` | `runs/${string}`
  afterSeq?: number
}
```

Desktop must omit `afterSeq` when absent. Do not sign `afterSeq: undefined`. `signAgentAction()` adds a signed `ts` timestamp, and the server rejects stale/future subscriptions using the same 30-second window as HTTP actions. <!-- id:g9HwBwFE -->

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
  | {_: 'change'; key: `account/${string}`; value: {reason: string; agentId?: string; sessionId?: string}}
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

Account-wide notifications. The Agents list page uses this to refresh when agents/sessions/events change. <!-- id:4p7cKI91 -->

## `agents/<agentId>` <!-- id:Y8P8IKFA -->

Agent detail updates and related session changes. The agent detail page uses this key. <!-- id:9vTDX5vq -->

## `sessions/<sessionId>` <!-- id:ELCfheex -->

Session event stream. The session page uses this key and receives: <!-- id:NXHgLurt -->
  - replay of durable events after `afterSeq`; <!-- id:vefKgvP0 -->
  - future durable `append` events — every actor's, not just the agent's: a verb the user ran through `InvokeSessionTool` arrives on this stream as `tool_call`/`tool_result` events stamped `actor: 'user'`; <!-- id:L36itckc -->
  - session status `change` events; <!-- id:3riezm5W -->
  - live `appendPartial` events carrying assistant text deltas, cumulative run usage, and the current `AgentRunActivity` (`phase`, `toolName`, `toolCallId`, `detail`, and the `outputTail` of a long-running tool call). <!-- id:AWpS15pl -->

## `runs/<rootRunId>` <!-- id:qUHl4Dod -->

One subscription streams a whole run tree (the key is the ROOT run id; `root_run_id` is denormalized on every run row for this). On subscribe the server sends a snapshot — one `change` per run in the tree — followed by durable journal `append` replay (`afterSeq` applies per run). Live events: <!-- id:HlrThHks -->
  - `change` with a `RunInfo` whenever any run in the tree changes status/usage/plan; <!-- id:3RReb-lv -->
  - `append` with a workflow journal entry, tagged with the originating `runId`; <!-- id:XkkU9407 -->
  - `appendPartial` with ephemeral workflow progress (`ctx.progress`) and tool activity, tagged with `runId`. <!-- id:4xtACkHI -->

The pinned run card on the session page is durable-first: it reconstructs from `ListRuns` + `GetRunJournal` and uses this stream only for liveness. <!-- id:Iui6gCKg -->

# Authorization <!-- id:WrZAbvQ7 -->

`Service.verifySubscription()` verifies: <!-- id:Df5IOCWO -->
  1. signed envelope shape; <!-- id:JnnBW67S -->
  2. signed action timestamp is within 30 seconds of server local time; <!-- id:Dca-RSwH -->
  3. Ed25519 signature; <!-- id:bE9T2ugC -->
  4. signer authorization for account; <!-- id:ezvGnO9q -->
  5. requested key belongs to the account. <!-- id:8C2Q0c3R -->

Rules: <!-- id:VJd0eD_k -->
  - `account/<accountId>` must equal verified account ID. <!-- id:axsKmzfR -->
  - `agents/<agentId>` requires owner or accepted reader/writer access. <!-- id:GUmWMoXO -->
  - `sessions/<sessionId>` requires owner or accepted reader/writer access to its agent. <!-- id:c2GU3GL- -->
  - `runs/<rootRunId>` requires owner or accepted reader/writer access to its agent. <!-- id:JQdvUlVm -->
  - Accepted collaborators receive the agent's live service events under their own account subscription; pending and revoked collaborators do not. <!-- id:cMdZUdG1 -->
  - A socket may not switch accounts after a successful subscription. <!-- id:JAODdem0 -->

# Replay <!-- id:V2Zm4-wC -->

Only durable session events are replayed. Live partials are not persisted and cannot be replayed. <!-- id:Jy3_Xd4u -->

For `sessions/<id>` with `afterSeq`, server sends: <!-- id:pSK8r44j -->
  1. `subscribed`; <!-- id:DvtwIk6Y -->
  2. session `change`; <!-- id:mTWZ9qTP -->
  3. durable `append` events where `seq > afterSeq`. <!-- id:Hi-9bxpk -->

# Durable appends vs partial appends <!-- id:Wjl8ZQla -->

## `append` <!-- id:J139aPp4 -->

`append` is durable. It maps to a row in `session_events`. <!-- id:FdScUpRF -->

Desktop behavior: <!-- id:ofVmfTqC -->
  - inserts the event into the `GetSession` cache; <!-- id:GzSQQzFt -->
  - removes matching optimistic user events; <!-- id:RVwuDBnh -->
  - clears visible partial for that session because final durable data arrived; <!-- id:diuPSNYn -->
  - while that session is open, extracts `hm://` references from structured tool results and assistant messages and keeps them subscribed through the desktop sync service until the session closes. This runs only for the exact mounted `sessions/<id>` socket (a full session page or the selected Assistant-sidebar session), never account/agent sockets or background sessions. Comment references recursively subscribe to their target document, ensuring newly published comments and documents from a remote agent server are locally available before their links are opened. <!-- id:zNms67AN -->

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

Desktop keeps the partial visible on `done` and clears it only when a durable `append` arrives. The Pi-backed runtime emits a fresh partial stream for each assistant turn and appends that turn's durable assistant message at Pi `message_end`, before any following tool execution events. This lets streamed text before a tool call settle into the durable event list ahead of the durable `tool_call` row instead of waiting until the whole agent run ends. <!-- id:FPf42YK5 -->

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
  1. Confirm desktop receives `subscribed event`. <!-- id:55kyt-pO -->
  2. Confirm server logs `publish partial`. <!-- id:Oft3wYee -->
  3. Confirm server logs `send partial`, not `skip partial`. <!-- id:ktqE5NP1 -->
  4. Confirm desktop logs `partial event` and `partial state updated`. <!-- id:0KQE_u5d -->
  5. Confirm UI logs `rendering streaming assistant partial`. <!-- id:vtUFFYIB -->

# Known limitations <!-- id:bA1vFtbR -->

- Server-to-client events use JSON instead of CBOR. <!-- id:bNYv16Kh -->
- Events are not individually signed. <!-- id:DSPsyFrn -->
- Partial chunks are not durable and are not replayed. <!-- id:XbXehDbz -->
- No explicit unsubscribe message exists. <!-- id:852_Oe-H -->
- No heartbeat/ping protocol exists. <!-- id:xQB-n7mf -->
- No backpressure/subscription-limit handling exists. <!-- id:U8R9vXoS -->
- Desktop reconnect resubscribes but does not implement a full persistent cursor manager for every resource type. <!-- id:HUccfbAA -->

# Future work <!-- id:RGNIvPpy -->

See [Future projects](./agent-future-projects.md): WebSocket protocol v2, run records, stop/cancel controls, and metrics. <!-- id:kEebyX8V -->
