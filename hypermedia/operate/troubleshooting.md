---
name: Troubleshooting
summary: This page starts from what you see when an app environment misbehaves, such as an unreachable server, a reply that does not stream, a signature error, a failed read, a missing tool or damaged data, and gives the checks and the fix for each.
---
Something is wrong with an [app environment](../software/app-environment.md), the server that runs [agents](../agent.md) and apps. Find what you see in the headings below. Each entry gives the checks to make, in order, and the fix.

The first thing to check is always health:

```bash
curl http://localhost:3050/api/health
```

A `200` with `"status": "ok"` means the server is up. Anything else, start with the first entry below. Two kinds of problem have their own pages: [debugging runs](./debugging-runs.md) for stuck sessions and failing scripts, and [diagnosing a stalled server](./stalled-server.md) for a server that is up but does not answer.

# Connection and streaming

## Desktop says server offline <!-- id:kZ2mzvXq -->

First, ask the server for its health. The port is `3051` in the dev shell and `3050` for a release or packaged build: <!-- id:sSDnBlHJ -->

```bash <!-- id:IQWdeZq8 -->
curl http://localhost:3051/hm/api/apps/health
```

If nothing answers, start the server: <!-- id:5MRKd6bI -->

```bash <!-- id:OEloZ6RG -->
direnv exec . bash -lc 'cd apps && bun src/main.ts'
```

If something answers with `503`, read the body:

- `"status": "starting"` means the server is still starting. Wait and ask again.
- `"reason": "loop-lag"` means the server is stalled. Follow [diagnosing a stalled server](./stalled-server.md).

[Endpoints and health](./endpoints-and-health.md) explains every field of the answer.

## Health, API and WebSocket all time out, but the container is "Up"

One CPU core sits at about 100%. The server has one thread, and that thread is busy or stuck in a loop. Follow [diagnosing a stalled server](./stalled-server.md).

## Streaming response does not appear while model is typing <!-- id:OETTdZNj -->

A reply should grow on screen while the model writes it. If it only appears at the end, or never, check in this order. The server does not log WebSocket traffic, so you watch the socket from the client side. <!-- id:1wCRkz3V -->

Check in this order: <!-- id:y_nHvnuv -->
  1. **Is the server healthy?** `curl <server>/api/health` must answer `200`. A `503` with `"reason": "loop-lag"` means the thread is too busy to send anything; see [diagnosing a stalled server](./stalled-server.md).
  2. **Did the client subscribe?** Open the developer tools of the browser or the [desktop app](../software/desktop.md), go to the network tab, and select the WebSocket. The first frame from the server is `connected`. After the client subscribes, the server sends `subscribed` with the key `sessions/<sessionId>`. An `error` frame here carries the reason. For `Invalid signature`, see the next entry. <!-- id:D8kYyYQL -->
  3. **Did the run start?** Send a message, then search the server log for the session id. You should see these `[agents/runtime]` lines, in this order: `agent run starting`, `sending provider request`, `provider first output`, `assistant text streaming`. The session's status is `streaming` while the run is live. <!-- id:TdzBvw7L -->
  4. **Did the partials arrive?** In the network tab you should see `appendPartial` frames for `sessions/<sessionId>` while the model writes. The client's console prints `[agents/ui] rendering streaming assistant partial`. <!-- id:NzvqNL8D -->
  5. **Did the final message arrive?** When the reply ends, the server sends an `append` frame with the stored message, and the log says `assistant turn complete` and `agent run finished`. The message is still there after you reload the session page. <!-- id:CT2Cuh_P -->

What each failure means: <!-- id:OZhfU5mQ -->
  - Step 2 fails with `Invalid signature`: see the next entry. <!-- id:uk35MOQp -->
  - Step 2 shows `subscribed` for another key: the client subscribed to a different session or as a different account. The server sends a session's frames only to sockets subscribed to that session. See [WebSocket subscriptions](../build/websocket-subscriptions.md). <!-- id:ieSRY6Mu -->
  - Step 3 stops before `provider first output`: the provider did not answer. Read the session with `GetSession`, or open the session page, and look for an `error` event. See "Provider returns no streamed deltas" below. <!-- id:5TK579Jv -->
  - Step 3 passes and step 4 fails: the run is streaming, but the frames do not reach this client. Check the subscription key again, and check that a reverse proxy in between passes WebSocket traffic.
  - Step 4 passes and nothing shows on screen: the problem is in the client. Look at `AgentSessionPage` and `PartialAssistantRow`. <!-- id:L2h_XtH4 -->

`GET /api/perf` shows how long providers take to send their first output, as the `provider.ttft` span. `GET /api/perf/sessions/<sessionId>` shows one session's tool names, counts and times. [Logs](./logs.md) lists every line named here. <!-- id:WLPDhFNa -->

## WebSocket subscribe returns `Invalid signature` <!-- id:1w_54waV -->

Likely causes: <!-- id:3kFIP4ug -->
  - the client and the server speak different protocol versions; <!-- id:_A9gV4bK -->
  - the signed action holds a value that encodes differently before and after it is decoded; <!-- id:wSv7HCO_ -->
  - the client sent a field that is explicitly `undefined`. <!-- id:cGvB3HF1 -->

An explicit `undefined` encodes differently when the client signs and when the server verifies. So the client's `signAgentAction()` (`frontend/packages/ui/src/agents/client.ts`) removes every `undefined` field before it signs, and `Subscribe` leaves out `afterSeq` when there is no value. The server checks the signature in `auth.verifyEnvelope()`. If the error appears: <!-- id:nS1GjGqf -->
  1. Log the shape of the action before signing, without private content. <!-- id:bZIKsUfX -->
  2. Check that the client and the server agree on the protocol version (`X-Agents-Protocol`). Both import their types from `apps/protocol`; see the [signed API](../build/signed-api.md). <!-- id:73KJw0uG -->
  3. Check how the value encodes in [DAG-CBOR](../schema/dag-cbor.md). <!-- id:SNdy4U9O -->
  4. Add a regression test. <!-- id:q4NRYIhg -->

## Provider returns no streamed deltas <!-- id:HRSlBUhE -->

The server publishes text as the model's response comes in. If no text comes: <!-- id:QfW4_j9O -->
  - read the session and look for an `error` event; <!-- id:wtb9LeW- -->
  - check the [provider](../agent/model-providers.md)'s API key and the model name; <!-- id:y5-42lTk -->
  - check that the provider supports streaming for the Pi API mapping in use; <!-- id:EdsIwMZ1 -->
  - if you still cannot tell, add temporary local logging around `#runPiAgent()`. Do not log secrets or full session content. <!-- id:JmPuF06O -->

## Desktop cannot save API key <!-- id:t9e1pRa1 -->

The client refuses to send a secret to a remote server over plain HTTP. Use HTTPS for a remote server, or a loopback address for development. <!-- id:OGlnHJ8O -->

# Agents and tools

## Desktop shows no agents <!-- id:FB5I7l2A -->

1. Check that the desktop app points at the server URL you expect, and that the server uses the database you expect.
2. Send a signed `ListAgents` to the message endpoint as the [account](../protocol/identity.md) in question. The server has no listing without a signature. <!-- id:cO3JZeRc -->

`ListAgents` returns only the agents the caller owns or has accepted an invitation to. The agents of a [space](../protocol/spaces.md) reach a reader through its mount documents; see [mounting](../agent/mounting.md).

## A `read` fails <!-- id:1Wm3JQno -->

Look at the tool result event in the session [log](../agent/log.md). [`read`](../agent/read.md) takes one address, and the shape of the address picks the source. So first check that the address has the shape the agent meant. <!-- id:no9JxMOB -->

Common causes: <!-- id:IduHYGln -->
  - the [hm:// URL](../protocol/urls.md) or the web URL is malformed; <!-- id:3hhBhi48 -->
  - the URL cannot be resolved with hypermedia headers; <!-- id:Z9Zr9GwW -->
  - the fetch of the resource fails; <!-- id:YN5Nk5CI -->
  - the output is larger than 256 KiB (`MAX_TOOL_RESULT_BYTES`); <!-- id:ewq_Eqlg -->
  - the memory path does not exist. A directory address without its trailing slash does not fail: `read` answers with the listing. <!-- id:PhOREC0x -->

An `hm://` read can answer `not-found` for a [document](../protocol/documents.md) the agent just published. This means `SEED_APPS_HM_SERVER_URL` points at a different node than the one the write went through. `/api/health` shows the URL in use as `hmServerUrl`. A read never falls back to a public [gateway](../protocol/sites.md). <!-- id:wvTAioKf -->

Every request a read makes to the HM server times out after 30 seconds, and the tool result says `The operation timed out`. So a server that does not answer cannot hang the run.

## `call` came back with a tool contract instead of a result <!-- id:TwNmKW4- -->

This is expected. A [`call`](../agent/call.md) with a missing or invalid input answers with the tool's [contract](../agent/contract.md), and the model calls again correctly. So does a call for a tool the thread has not expanded yet. [Promotion](../agent/promotion.md) explains what the contract does to the thread. <!-- id:i1t-NwX7 -->

If a tool keeps returning its contract, compare the model's input with the `input` schema in `read ~/tools/<name>`. <!-- id:c8HVk-cZ -->

## A tool is missing, or `web_search` fails

If a tool is not in `~/tools` at all, there are two causes:

- **The agent was not granted it.** It is not in the agent's [grants](../agent/grants.md) (`definition.tools`), and `ListAgentTools` reports `granted: false`.
- **The server does not offer `execute`.** When the sandbox probe fails, the server removes `execute` from every agent's tools. `/api/health` reports this as `codeExec: false` with a reason. See the [code execution backend](./code-execution-backend.md).

`web_search` is different. The server always offers it. Without a SearXNG backend the call fails with `web_search is not configured (no SearXNG backend)`. `/api/health` reports this as `webTools.search: false`. See [web research backends](./web-research-backends.md).

## Something the user did is not visible to the agent <!-- id:41MdMv1x -->

A person can [run a verb themselves](../agent/wrench-palette.md) from the `/` menu of the message box. Those verbs are added to the same log as events with `actor: 'user'`, and the agent reads them on its next turn. If the agent seems not to know: <!-- id:R5VVhbu6 -->
  1. Run `GetSession` and check that the `tool_call` and `tool_result` events are there with `actor: 'user'`. <!-- id:Dwg5lYb7 -->
  2. `InvokeSessionTool` answers `409` while a run is live. Use the palette between turns. <!-- id:lTVdOjgv -->
  3. The result is context for the next turn. Nothing is pushed into a turn that is already running. <!-- id:FjVIHG5h -->

# Server and data

## Schema mismatch <!-- id:yfzcaJs8 -->

Every route answers `500`. The database has a schema version that this binary does not know, and the log names the stored version and the expected one. [Persistence](./persistence.md#schema-gate) describes the gate.

The fix is to run a binary that knows the schema. Do not delete persistent or shared data. <!-- id:ratUv9Ve -->

For local throwaway data only, you can delete the files and restart:

```bash <!-- id:QpOWp8jO -->
rm -f apps/data/agents.sqlite apps/data/agents.sqlite-shm apps/data/agents.sqlite-wal
```

## A local server answers with an unknown-action error

Another process holds the port. It is usually an old packaged binary that the desktop app started.

1. `lsof -nP -iTCP:3051 -sTCP:LISTEN` names the process.
2. `/api/health` reports the version of whatever answers.

[Environments](./environments.md) explains the ports.

## `disk I/O error`, `database is locked`, or a corrupt index under `/workspace`

Two writers used one memory file. The disk is fine.

Only one sandbox holds an agent's memory at a time. But every session, child and [trigger](../trigger.md) firing of that agent takes a turn on it, and the `read` and `write` verbs touch the same files from the host. A sandbox and the host do not see each other's file locks. So a database, a lock file or a shared log under `/workspace` can end up half-written. A sandbox that hangs in `flock` or `fsync` has the same cause.

The fix is to move the state out of the shared file: write whole files through `write`, one file per record. Point the agent at [What not to keep in /workspace](../agent/memory.md#what-not-to-keep-in-workspace).

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
