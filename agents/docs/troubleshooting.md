# Troubleshooting

This document is a quick diagnostic guide. More operational detail is in [Operations](./operations.md).

## Streaming response does not appear while model is typing

Expected desktop log chain:

```text
[agents/ws] subscribe sent
[agents/ws] subscribed event
[agents/ui] sending session message
[agents/ws] partial event
[agents/ws] partial state updated
[agents/ui] rendering streaming assistant partial
```

Expected server log chain:

```text
[agents/ws] publish partial
[agents/ws] send partial
```

Model execution now goes through Pi SDK events, so the previous `[agents/openai]` manual-stream logs are not expected on
the primary path.

Diagnosis:

- If desktop shows `Invalid signature`, check `signAgentAction()` and make sure undefined fields are omitted before
  signing.
- If no partial publish appears, inspect the session in `/agents` for a durable error event from the Pi/provider path.
- If server logs `skip partial; no subscription`, desktop is not subscribed to the target session/account.
- If desktop logs partial state updates but UI does not render, inspect `AgentSessionPage` and `PartialAssistantRow`.

## WebSocket subscribe returns `Invalid signature`

Known fixed cause:

- signing an action object with `afterSeq: undefined` encoded differently across sign/verify paths.

Current mitigation:

- `signAgentAction()` recursively omits undefined fields;
- `Subscribe` omits `afterSeq` when not provided.

If it happens again:

1. log the action shape before signing without private content;
2. compare desktop `agents-client.ts` protocol mirror with `agents/src/api.ts`;
3. check CBOR encoding behavior;
4. add a regression test.

## Provider returns no streamed deltas

The Seed server receives text deltas from Pi SDK `message_update` events. If no deltas appear:

- inspect `/agents` for a durable error event;
- verify the provider API key and model name;
- check whether the provider/backend supports streaming for the selected Pi API mapping;
- add temporary local diagnostics around `#runPiAgent()` if needed, without logging secrets or full session content.

## Tool read fails

Check tool result event in session log or `/agents` inspector.

Common causes:

- malformed HM/web URL;
- URL cannot be resolved with hypermedia headers;
- resource fetch fails;
- output exceeds 256 KiB.

## Desktop cannot save API key

Remote plain HTTP servers are rejected for secret submission. Use HTTPS or local loopback.

## Session stuck in `streaming`

No stop action exists yet. Current options:

- wait for provider/network timeout/error;
- restart local service for local debugging;
- inspect DB/session events to understand last state.

Future fix: implement StopSession/CancelRun.

## Server unresponsive but process alive (100% CPU)

Symptom: health/API/WebSocket all time out, the container stays "Up", and CPU sits at ~100% on one core. Bun runs JS on
a single thread, so any synchronous infinite loop wedges the entire server (HTTP, WS, triggers) while the process looks
healthy from outside.

Fast diagnosis:

- `docker stats` — one core pegged with flat network I/O suggests a JS busy loop, not load;
- `docker logs -t --tail 50` — find the last event before logs went silent; look for a `tool call start` with no
  matching `tool call end`;
- `strace -p <pid> -c` on the host — repeated reads of `/proc/self/statm` plus `futex`/`sched_yield` are GC allocation
  checks inside a spinning JIT loop;
- full tool inputs are persisted in `session_events` (DAG-CBOR in `event_cbor`) even when the log line is truncated —
  decode them and replay the input against the suspect code path locally.

One past cause (fixed 2026-07): `parseMarkdown` in `@seed-hypermedia/client` looped forever on an indented ATX heading
(`  ### Foo`) because the heading branch matched the raw line while the paragraph collector excluded the trimmed line,
so the tokenizer never advanced. Agent-generated `document.create`/`comment.create` markdown hit this within minutes of
every restart. The tokenizer now guarantees forward progress each iteration.

## Built-in inspector is empty

Check:

```bash
curl http://localhost:3050/agents/api/status
```

If agents exist in desktop but not inspector, confirm desktop is pointing at the same server URL/database.

## Schema mismatch

For local data only:

```bash
rm -f agents/data/agents.sqlite agents/data/agents.sqlite-shm agents/data/agents.sqlite-wal
```

Restart the server.
