---
name: Troubleshooting
summary: "A symptom-first guide to app environment problems: an unreachable server, missing streams, signature errors, failed reads, missing tools and agents, and damaged data."
---
A diagnostic guide for the [app environment](../software/app-environment.md), organized by symptom. Each entry gives the checks and the fix, and links the page that explains the behaviour. Symptoms about runs (stuck sessions, parents that never resume, failing scripts) are in [debugging runs](./debugging-runs.md), and a server that is up but does not answer is in [diagnosing a stalled server](./stalled-server.md). [Operations](./operations.md) routes to everything else.

# Connection and streaming

## Desktop says server offline <!-- id:kZ2mzvXq -->

Check (`3051` in the dev shell, `3050` for a release or packaged build): <!-- id:sSDnBlHJ -->

```bash <!-- id:IQWdeZq8 -->
curl http://localhost:3051/agents/api/health
```

Start the server: <!-- id:5MRKd6bI -->

```bash <!-- id:OEloZ6RG -->
direnv exec . bash -lc 'cd apps && bun src/main.ts'
```

A `503` with `"status": "starting"` means the server is still booting, and a `503` with `"reason": "loop-lag"` means it is stalled; see [endpoints and health](./endpoints-and-health.md) and [diagnosing a stalled server](./stalled-server.md).

## Health, API and WebSocket all time out, but the container is "Up"

One core sits at about 100% CPU. The server's single thread is busy or stuck in a loop. Follow [diagnosing a stalled server](./stalled-server.md).

## Streaming response does not appear while model is typing <!-- id:OETTdZNj -->

Expected desktop log chain: <!-- id:1wCRkz3V -->

```text <!-- id:FMeT9vqJ -->
[agents/ws] subscribe sent
[agents/ws] subscribed event
[agents/ui] sending session message
[agents/ws] partial event
[agents/ws] partial state updated
[agents/ui] rendering streaming assistant partial
```

Expected server log chain: <!-- id:kS7VU6wp -->

```text <!-- id:it4yAeW3 -->
[agents/ws] publish partial
[agents/ws] send partial
```

In order: <!-- id:y_nHvnuv -->
  1. Desktop should show `[agents/ws] subscribed event` for `sessions/<sessionId>`. <!-- id:D8kYyYQL -->
  2. The session should be set to `streaming` after `MessageSession`. <!-- id:TdzBvw7L -->
  3. Server should then show `[agents/ws] publish partial` and `[agents/ws] send partial` when the harness commits streamed text. <!-- id:_ipbPc0H -->
  4. Desktop should show `[agents/ws] partial event` and `[agents/ui] rendering streaming assistant partial`. <!-- id:NzvqNL8D -->
  5. The final assistant message should appear as a durable event in the desktop session page after refresh. <!-- id:CT2Cuh_P -->

Text is published as the harness commits it, about every 100 ms. The partial lines log at `debug`; see [logs](./logs.md). <!-- id:WLPDhFNa -->

Diagnosis: <!-- id:OZhfU5mQ -->
  - If desktop shows `Invalid signature`, check `signAgentAction()` and make sure undefined fields are omitted before signing. <!-- id:uk35MOQp -->
  - If no partial publish appears, inspect the session (desktop session page or `GetSession`) for a durable error event from the provider path. <!-- id:5TK579Jv -->
  - If server logs `skip partial; no subscription`, the client subscribed too late, or to a different session or account. See [WebSocket subscriptions](../build/websocket-subscriptions.md). <!-- id:ieSRY6Mu -->
  - If desktop logs partial state updates but the UI does not render, inspect `AgentSessionPage` and `PartialAssistantRow`. <!-- id:L2h_XtH4 -->

## WebSocket subscribe returns `Invalid signature` <!-- id:1w_54waV -->

Likely causes: <!-- id:3kFIP4ug -->
  - desktop and server protocol mismatch; <!-- id:_A9gV4bK -->
  - the signed action contains values that encode differently before and after decode; <!-- id:wSv7HCO_ -->
  - explicit `undefined` fields were sent. <!-- id:cGvB3HF1 -->

The client's `signAgentAction()` (`frontend/packages/ui/src/agents/client.ts`) omits `undefined` fields recursively before signing, and `Subscribe` omits `afterSeq` when it is not provided, because an explicit `undefined` encodes differently on the sign and verify paths. The server side is `auth.verifyEnvelope()`. If the error appears: <!-- id:nS1GjGqf -->
  1. log the action shape before signing, without private content; <!-- id:bZIKsUfX -->
  2. check that the client and server agree on the protocol version (`X-Agents-Protocol`), since both import their types from `apps/protocol` (see the [signed API](../build/signed-api.md)); <!-- id:73KJw0uG -->
  3. check CBOR encoding behavior (see [blobs](../protocol/blobs.md) for DAG-CBOR); <!-- id:SNdy4U9O -->
  4. add a regression test. <!-- id:q4NRYIhg -->

## Provider returns no streamed deltas <!-- id:HRSlBUhE -->

The Seed server publishes text as the harness commits the response in flight. If no deltas appear: <!-- id:QfW4_j9O -->
  - inspect the session for a durable error event; <!-- id:wtb9LeW- -->
  - verify the [provider](../agent/model-providers.md) API key and model name; <!-- id:y5-42lTk -->
  - check whether the provider or backend supports streaming for the selected Pi API mapping; <!-- id:EdsIwMZ1 -->
  - add temporary local diagnostics around `#runPiAgent()` if needed, without logging secrets or full session content. <!-- id:JmPuF06O -->

## Desktop cannot save API key <!-- id:t9e1pRa1 -->

The client refuses to send a secret to a remote server over plain HTTP. Use HTTPS for remote servers or local loopback for development. <!-- id:OGlnHJ8O -->

# Agents and tools

## Desktop shows no agents <!-- id:FB5I7l2A -->

Confirm the desktop points at the same server URL and database. The server has no unauthenticated listing. To check what an [account](../protocol/identity.md) owns, send a signed `ListAgents` to the message endpoint as that account. `ListAgents` returns only agents the caller owns or accepted an invitation to; the agents of a space reach a reader through its mount documents, see [mounting](../agent/mounting.md). <!-- id:cO3JZeRc -->

## A `read` fails <!-- id:1Wm3JQno -->

Check the tool result event in the session [log](../agent/log.md). [`read`](../agent/read.md) takes one address, and the address shape picks the source. So first check that the address has the shape the agent meant. <!-- id:no9JxMOB -->

Common causes: <!-- id:IduHYGln -->
  - malformed [HM URL](../protocol/urls.md) or web URL; <!-- id:3hhBhi48 -->
  - URL cannot be resolved with hypermedia headers; <!-- id:Z9Zr9GwW -->
  - resource fetch fails; <!-- id:YN5Nk5CI -->
  - output exceeds 256 KiB (`MAX_TOOL_RESULT_BYTES`); <!-- id:ewq_Eqlg -->
  - a memory path that does not exist. A directory address without its trailing slash does not fail: `read` answers with the listing. <!-- id:PhOREC0x -->

An `hm://` read can return `not-found` for a [document](../protocol/documents.md) the agent just published. That means the service's `SEED_APPS_HM_SERVER_URL` points at a different node than the one the write went through. Check `/api/health` for the URL in effect. Reads never fall back to a public [gateway](../protocol/sites.md). Every read-path HM request times out after 30s (`The operation timed out` in the tool result), so an unresponsive server does not hang the run. <!-- id:wvTAioKf -->

## `call` came back with a tool contract instead of a result <!-- id:TwNmKW4- -->

This is expected. A [`call`](../agent/call.md) with a missing or invalid input, or for a tool the thread has not expanded yet, answers with the tool's [contract](../agent/contract.md), and the model calls again correctly. [Promotion](../agent/promotion.md) explains what the contract does to the thread. <!-- id:i1t-NwX7 -->

If a tool keeps returning its contract, compare the model's input against the `input` schema in `read ~/tools/<name>`. If a tool is missing from `~/tools` entirely, there are two causes. It is not in the agent's [grants](../agent/grants.md) (`definition.tools`; `ListAgentTools` reports `granted: false`). Or the host withholds it: `execute` is dropped when the sandbox probe fails, and `/api/health` reports this as `codeExec: false` with a reason. <!-- id:c8HVk-cZ -->

## Something the user did is not visible to the agent <!-- id:41MdMv1x -->

Verbs the user runs through the [wrench palette](../agent/wrench-palette.md) append to the same log as `actor: 'user'` events. The agent reads them on its next turn. If the agent seems not to know: <!-- id:R5VVhbu6 -->
  1. Run `GetSession` and check that the `tool_call` and `tool_result` events are there with `actor: 'user'`. <!-- id:Dwg5lYb7 -->
  2. `InvokeSessionTool` returns `409` while a run is live. Use the palette between turns. <!-- id:lTVdOjgv -->
  3. The result is context for the NEXT turn. Nothing is pushed into a turn already in flight. <!-- id:FjVIHG5h -->

# Server and data

## Schema mismatch <!-- id:yfzcaJs8 -->

The database's schema version is one this binary does not know, and every route answers `500`; the log names the stored and the expected version. [Persistence](./persistence.md#schema-gate) describes the gate. For local throwaway data only, delete the files and restart:

```bash <!-- id:QpOWp8jO -->
rm -f apps/data/agents.sqlite apps/data/agents.sqlite-shm apps/data/agents.sqlite-wal
```

Do not do this for persistent or shared data. Run a binary that knows the schema instead. <!-- id:ratUv9Ve -->

## A local server answers with an unknown-action error

Another process holds the port, usually a stale packaged binary that the desktop app spawned. `lsof -nP -iTCP:3051 -sTCP:LISTEN` names it, and `/api/health` reports the version of whatever answers. [Environments](./environments.md) explains the ports.

## `disk I/O error`, `database is locked`, or a corrupt index under `/workspace`

Two writers collided on one memory file. The disk is fine. Several microVMs can mount the same memory directory at once (one per session, one per trigger firing, plus overflow VMs), and the host side `read` and `write` verbs touch the same files. Page caches and file locks are not coherent across them, so SQLite, lock files and shared append logs under `/workspace` get torn. A guest hung in `flock` or `fsync` has the same cause.

Move the state out of the shared file: whole-file writes through `write`, one file per record. Point the agent at [What not to keep in /workspace](../agent/memory.md#what-not-to-keep-in-workspace).

# See also <!-- id:l9QDdj-U -->

- [Debugging runs](./debugging-runs.md)
- [Diagnosing a stalled server](./stalled-server.md)
- [Logs](./logs.md)
- [Endpoints and health](./endpoints-and-health.md)
- [Operations](./operations.md) <!-- id:cSXHQ9JA -->
- [Persistence](./persistence.md) <!-- id:posBEpFv -->
- [Signed API](../build/signed-api.md) <!-- id:mO9rJX5n -->
- [WebSocket subscriptions](../build/websocket-subscriptions.md) <!-- id:SOq81JU3 -->
- [Tools](../agent/tools.md) <!-- id:sQACZoxn -->
- [Security](../agent/security.md) <!-- id:1nlofFyf -->
- [Agents glossary](../agent/glossary.md) <!-- id:ZqhVL-mE -->
