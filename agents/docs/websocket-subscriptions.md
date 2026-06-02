# WebSocket subscriptions

The Agents WebSocket API delivers live account, agent, and session updates after a signed subscription handshake.

Endpoint:

```text
/agents/ws
```

Local URL:

```text
ws://localhost:3050/agents/ws
```

Desktop URL helper: `getAgentWebSocketUrl()` in `frontend/apps/desktop/src/agents-client.ts`.

## Transport

Client → server:

- binary DAG-CBOR `SignedActionEnvelope` whose action is `Subscribe`.

Server → client:

- JSON string `AgentWSEvent` values.

Server-to-client events are not individually signed; authorization happens at subscription time on the socket.

## Subscribe action

```ts
type Subscribe = {
  _: 'Subscribe'
  key: `account/${string}` | `agents/${string}` | `sessions/${string}`
  afterSeq?: number
}
```

Desktop must omit `afterSeq` when absent. Do not sign `afterSeq: undefined`. `signAgentAction()` adds a signed `ts`
timestamp, and the server rejects stale/future subscriptions using the same 30-second window as HTTP actions.

## Server events

```ts
type AgentWSEvent =
  | {_: 'connected'; connectedAt: number}
  | {_: 'subscribed'; key: string; accountId: string}
  | {_: 'append'; key: `sessions/${string}`; event: SessionEvent}
  | {_: 'appendPartial'; key: `sessions/${string}`; partialId: string; patch: {textDelta?: string; done?: boolean}}
  | {_: 'change'; key: `sessions/${string}`; value: SessionInfo}
  | {_: 'change'; key: `agents/${string}`; value: AgentInfo}
  | {_: 'change'; key: `account/${string}`; value: {reason: string; agentId?: string; sessionId?: string}}
  | {_: 'error'; message: string}
```

## Subscription keys

### `account/<accountId>`

Account-wide notifications. The Agents list page uses this to refresh when agents/sessions/events change.

### `agents/<agentId>`

Agent detail updates and related session changes. The agent detail page uses this key.

### `sessions/<sessionId>`

Session event stream. The session page uses this key and receives:

- replay of durable events after `afterSeq`;
- future durable `append` events;
- session status `change` events;
- live assistant text `appendPartial` events.

## Authorization

`Service.verifySubscription()` verifies:

1. signed envelope shape;
2. signed action timestamp is within 30 seconds of server local time;
3. Ed25519 signature;
4. signer authorization for account;
5. requested key belongs to the account.

Rules:

- `account/<accountId>` must equal verified account ID.
- `agents/<agentId>` must be owned by verified account.
- `sessions/<sessionId>` must be owned by verified account.
- A socket may not switch accounts after a successful subscription.

## Replay

Only durable session events are replayed. Live partials are not persisted and cannot be replayed.

For `sessions/<id>` with `afterSeq`, server sends:

1. `subscribed`;
2. session `change`;
3. durable `append` events where `seq > afterSeq`.

## Durable appends vs partial appends

### `append`

`append` is durable. It maps to a row in `session_events`.

Desktop cache behavior:

- inserts the event into the `GetSession` cache;
- removes matching optimistic user events;
- clears visible partial for that session because final durable data arrived.

### `appendPartial`

`appendPartial` is non-durable. It represents in-progress assistant text.

Example:

```json
{
  "_": "appendPartial",
  "key": "sessions/abc",
  "partialId": "partial-uuid",
  "patch": {"textDelta": "hello"}
}
```

The server eventually sends:

```json
{
  "_": "appendPartial",
  "key": "sessions/abc",
  "partialId": "partial-uuid",
  "patch": {"done": true}
}
```

Desktop keeps the partial visible on `done` and clears it only when a durable `append` arrives. The Pi-backed runtime
emits a fresh partial stream for each assistant turn and appends that turn's durable assistant message at Pi
`message_end`, before any following tool execution events. This lets streamed text before a tool call settle into the
durable event list ahead of the durable `tool_call` row instead of waiting until the whole agent run ends.

## Streaming diagnostics

Server logs:

- `[agents/ws] open`
- `[agents/ws] subscribed`
- `[agents/ws] publish partial`
- `[agents/ws] send partial`
- `[agents/ws] skip partial; no subscription`
- `[agents/ws] close`

Desktop logs:

- `[agents/ws] connecting`
- `[agents/ws] open; signing subscribe`
- `[agents/ws] subscribe sent`
- `[agents/ws] subscribed event`
- `[agents/ws] partial event`
- `[agents/ws] partial state updated`
- `[agents/ws] partial marked done; keeping visible until durable append`
- `[agents/ws] ignored malformed message`

Troubleshooting sequence:

1. Confirm desktop receives `subscribed event`.
2. Confirm server logs `publish partial`.
3. Confirm server logs `send partial`, not `skip partial`.
4. Confirm desktop logs `partial event` and `partial state updated`.
5. Confirm UI logs `rendering streaming assistant partial`.

## Known limitations

- Server-to-client events use JSON instead of CBOR.
- Events are not individually signed.
- Partial chunks are not durable and are not replayed.
- No explicit unsubscribe message exists.
- No heartbeat/ping protocol exists.
- No backpressure/subscription-limit handling exists.
- Desktop reconnect resubscribes but does not implement a full persistent cursor manager for every resource type.

## Future work

See [Future projects](./future-projects.md): WebSocket protocol v2, run records, stop/cancel controls, and metrics.
