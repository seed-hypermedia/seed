---
name: "Signed API: sessions and runs"
summary: This page lists the signed API actions for sessions, messages, verbs run by the user, the session browser, runs, and the Subscribe action.
---
These actions of the [signed API](./signed-api.md) work with [sessions](../agent/session.md) and [runs](../agent/runs.md). A session is one conversation with an [agent](../agent.md). A run is one piece of work the server does for it. With these actions you create and list sessions, send a message, run a verb as the user, stop and retry, look at and control runs, and subscribe to live updates. The [signed API](./signed-api.md) page covers what every action shares: the endpoint, the envelope, errors, [access levels](./signed-api.md#access-levels) and idempotency.

# Sessions

## `CreateSession` <!-- id:N87txKiA -->

Request: <!-- id:_jZCrYXr -->

```ts <!-- id:AHVfu61k -->
{
  _: 'CreateSession'
  agentId: string
  title?: string
  modelOverride?: SessionModelOverride
  thoroughness?: Thoroughness
  clientRequestId?: string
}
```

Creates an `idle` session. You need chat access: owner, writer, or a chatter on a `publicChat` agent. A reader gets 403. Response: `{_: 'CreateSessionResponse'; sessionId: string}`. <!-- id:SmvTBbqB -->

With a `clientRequestId`, the action is [idempotent](./signed-api.md#idempotency). <!-- id:T5Yb-Vc0 -->

## `ListSessions` <!-- id:7NiHz9QA -->

Request: <!-- id:zPLgZqk2 -->

```ts <!-- id:keSJI_nU -->
{
  _: 'ListSessions'
  agentId?: string
  limit?: number
  cursor?: {updatedBefore: number; idBefore: string}
  parentSessionId?: string
  includeChildren?: boolean
  excludeTriggered?: boolean // leave out sessions a trigger started
}
```

Lists the sessions of the signing [account](../protocol/identity.md), newest first, across every agent on the server. With `agentId`, it lists the sessions of that one agent. Response: <!-- id:ntqH1GN6 -->

```ts <!-- id:uV3Pdvxz -->
{
  _: 'ListSessionsResponse'
  sessions: SessionInfo[]
  agents: AgentInfo[]
  nextCursor?: {updatedBefore: number; idBefore: string}
}
```

`agents` holds only the agents that the listed sessions belong to. A client can then label each row without one `GetAgent` per session. <!-- id:b1mOqhdT -->

`limit` is 50 by default and at most 200. <!-- id:l9a-a7RP -->

To get the next page, send `nextCursor` back unchanged as `cursor`. When the response has no `nextCursor`, there are no more sessions. The cursor holds both `updatedAt` and `id` because sessions often share one `updatedAt` millisecond: one [trigger](../trigger.md) firing can create several at once. A cursor with only the time would skip some of them. <!-- id:eSwNTsbV -->

A child session is one started by [`delegate`](../agent/delegate.md), by a script's `ctx.delegate`, or by an agent that starts a session. Child sessions are **included by default**: without `includeChildren` you get every session. Send `includeChildren: false` to get only top-level sessions. A parent carries `childSessionCount`. To get the children of one parent, send `parentSessionId`; it ignores `includeChildren`. <!-- id:oLkAiW5x -->

## `UpdateSession` <!-- id:9vin5_GJ -->

Request: <!-- id:eVAU-w3G -->

```ts <!-- id:4Qr4qC3b -->
{
  _: 'UpdateSession'
  sessionId: string
  title?: string
  modelOverride?: SessionModelOverride | null
  thoroughness?: Thoroughness | null
}
```

Changes the title, the model override or the thoroughness of a session. The server trims the title and limits its length, updates `updatedAt`, and sends `session-change` and an account change with reason `session-updated`. A title saved this way is marked as written by the user (`title_source = 'user'`), and the server's automatic titles never replace it. <!-- id:1AIBMSfj -->

Response: <!-- id:erqwMMRA -->

```ts <!-- id:SxvkOfIC -->
{
  _: 'UpdateSessionResponse'
  session: SessionInfo
}
```

## `DeleteSession` <!-- id:1waSBAm- -->

Request: <!-- id:lTgSOZRY -->

```ts <!-- id:nCIlEviZ -->
{
  _: 'DeleteSession'
  sessionId: string
}
```

Deletes a session and its stored events. The server first cancels every live run that started from the session, **including the runs below them** (sub-sessions and workflows), so no run is left waiting for a session that is gone. The history of runs stays, but no longer points at the session (`runs.session_id` is set to null). Child sessions become top-level sessions (`parent_session_id` is set to null). If a trigger firing created the session, the firing is kept without the link. The server sends an account change with reason `session-deleted`. <!-- id:9nrPnwl9 -->

Response: <!-- id:NBRFJ4zC -->

```ts <!-- id:mdtT26nF -->
{
  _: 'DeleteSessionResponse'
  sessionId: string
  agentId: string
}
```

## `GetSession` <!-- id:3MOfBWTH -->

Request: <!-- id:oHMeIP3k -->

```ts <!-- id:y3T9Vra- -->
{
  _: 'GetSession'
  sessionId: string
  afterSeq?: number
  beforeSeq?: number // page backwards from here
  limit?: number
}
```

Response: `{_: 'GetSessionResponse'; session; events; systemPromptMarkdown; triggerContext?; hasMoreBefore?; contextWindow?}`. <!-- id:AbyNtRFS -->

- `events` are the stored events of the session's [Log](../agent/log.md). With `afterSeq` you get the events with `seq > afterSeq`. With `beforeSeq` you get a page that ends before it.
- `limit` returns the last `limit` events of the range you asked for. When older ones were left out, `hasMoreBefore` is true and you page back with `beforeSeq`.
- `systemPromptMarkdown` is the agent's system prompt followed by the [Space index](../agent/space-index.md), which is what the model is told on each turn.
- `triggerContext` is present when a trigger started the session.
- An event that is too large arrives with a `truncated` marker. `GetSessionEvent {sessionId, seq}` returns the whole event.

## `GetSessionEvent`

```ts
{_: 'GetSessionEvent'; sessionId: string; seq: number}
  → {_: 'GetSessionEventResponse'; event: SessionEvent}
```

Returns one stored event whole, never truncated. Needs reader access.

## `MessageSession` <!-- id:TKV37DpX -->

Request: <!-- id:05bA7uU0 -->

```ts <!-- id:j-_MMU73 -->
{
  _: 'MessageSession'
  sessionId: string
  content: Array<
    | {type: 'text'; text: string; blocks?: AgentMessageBlock[]}
    | {type: 'context'; lines: string[]}
    | {type: 'attachment'; id: string}
  >
  clientMessageId?: string
  timezone?: string // the sender's IANA time zone, such as 'Europe/Madrid'
}
```

Response: `{_: 'MessageSessionResponse'; sessionId: string; assistantEventId: string; continuedToSessionId?: string}`.

A `context` part tells the model what the sender is looking at. The sidebar of the [Seed app](../software/desktop.md) sends the open [document](../protocol/documents.md), the view and the focused [block](../protocol/blocks.md), so the model knows what "this document" means. The server joins all context lines of a request onto its first user message as `contextLines`. The model gets them after that message, inside a `<window_context>` block. They never appear in the `content` of the conversation. At least one `text` part with some text in it is required. A message can name at most 16 attachments and carry at most 64 context lines. <!-- id:ANF-JVop -->

An `attachment` part names a file you already uploaded with `UploadSessionAttachment` or a committed chunked upload. An id that is not in the session returns 404. [Attachments](../agent/attachment.md) are private to the session. The agent reads one with `read attachment:<id>`, and they are deleted with the session. <!-- id:wmDG8nTx -->

What the server does: <!-- id:yODE0MM7 -->
  1. Verify that the signed account has chat access to the session's agent (owner, writer, or chatter). <!-- id:hNR1Yvfr -->
  2. Append the durable user message immediately, with `content` and `rawMarkdown`, optional rich `blocks`, and `meta.accountId` plus the exact cryptographic `meta.signerId` from the verified envelope. <!-- id:34Huc5Bs -->
  3. Enqueue a durable run for that message. <!-- id:RvJ6zK-m -->
  4. Claim it inline when no other turn owns the session. Otherwise leave it queued behind the current turn. <!-- id:i6rKWsUz -->
  5. Run the model loop with one model turn at a time per session. <!-- id:8J9gYKnV -->
  6. Emit live partials over WebSocket. <!-- id:lKQtSEkZ -->
  7. Append tool events and the final assistant or error event. <!-- id:VrTZxokq -->
  8. Start the next queued collaborator turn, if any. <!-- id:vtBpOjB9 -->

So several people may write to one session at the same time. Their messages are saved and sent out in the order they arrive, and nobody gets a `409` because the agent is busy. There are two cases that do return `409`: a verb you started with `InvokeSessionTool` is still running in this session, or you reused a `clientMessageId` with a different message. The agent still answers one turn at a time. A message that arrives while the agent is answering waits, and the next turn is told exactly which messages are new, so an earlier answer is never taken as the reply to them. <!-- id:B6IH4P5t -->

Each turn is a stored [run](../agent/runs.md). `assistantEventId` is an **empty string** when the request returned before the agent's final answer existed. This happens when the message waits behind another turn or runs in the background (triggers and sessions started by an agent do this), and when the turn is waiting for children started with `delegate`. The rest of the turn arrives over the [WebSocket](./websocket-subscriptions.md). <!-- id:12QoX7ZX -->

With a `clientMessageId`, the action is idempotent. A `text` part may carry its own `clientMessageId` too. The response carries `continuedToSessionId` when the turn ended with `continue_session`, so the client can follow the conversation into the next session. <!-- id:0xWuAdF5 -->

## `InvokeSessionTool` <!-- id:OttXxoDi -->

Request: <!-- id:CglXQoKo -->

```ts <!-- id:TSz13bD4 -->
{
  _: 'InvokeSessionTool'
  sessionId: string
  verb: 'read' | 'write' | 'call'
  input: unknown
  continueAgent?: boolean // default true; false saves the result and does not start an agent turn
}
```

Response: <!-- id:sySpl5Ga -->

```ts <!-- id:hB1fnM4l -->
{
  _: 'InvokeSessionToolResponse'
  sessionId: string
  resultEventId: string // durable event id of the appended tool_result
  output?: unknown
  error?: string
}
```

Runs one verb **as the user** in the session. The user and the agent share the session's [Log](../agent/log.md), and this action runs the same `read`, `write` and `call` code the agent uses. The server stores the call and its result as events marked `actor: 'user'`, so the agent reads them as facts on its next turn. The Seed app sends this action when a person [runs a tool themselves](../agent/wrench-palette.md) from the `/` menu of the message box. <!-- id:FYxYqayk -->

By default the agent takes a turn right after your verb, just as it would after a message. Send `continueAgent: false` if you only want the result saved in the log. The agent's turn runs in the background, and the response comes back as soon as the verb has finished.

The server accepts only those three verbs. The user cannot run `delegate` or `plan`. To delegate, ask the agent in a message: a user verb that would start a session is refused with "Delegation is a conversational ask; message the agent instead". <!-- id:LgrMffAe -->

A verb that fails while it runs is stored in the log too, because the agent should know what the user tried. The failure comes back in `error`, and the HTTP status is still a success. The request itself is refused only for a problem before the verb runs: an unknown verb (400), a session you may not use (404), or a session with a live run (409, "The agent is working in this thread right now"). <!-- id:0cIP9m_n -->

## `StopSession` <!-- id:bdR9aKBf -->

Request: <!-- id:rf66gPpx -->

```ts <!-- id:4u2Dyxwd -->
{
  _: 'StopSession'
  sessionId: string
}
```

Response: <!-- id:iUaJWmmb -->

```ts <!-- id:Rv-DmzB4 -->
{
  _: 'StopSessionResponse'
  sessionId: string
  stopped: boolean
}
```

Stops the agent turn that is running for this session, if there is one, and cancels every live run that started from the session, **including the runs below them** (children started by `delegate` and script children). `stopped` is `false` when the session was already idle. <!-- id:7M-SU2I2 -->

## `RetrySession` <!-- id:NFpBJSjD -->

Request: <!-- id:4zGSJo4i -->

```ts <!-- id:M7QY9xx8 -->
{
  _: 'RetrySession'
  sessionId: string
}
```

Response: <!-- id:t2CbzisF -->

```ts <!-- id:GuF6qLKn -->
{
  _: 'RetrySessionResponse'
  sessionId: string
  assistantEventId: string
}
```

Runs again a session whose latest run failed, without adding a new user message. The turn starts from the stored conversation, and the model is not sent the error events. It returns `409` when a run is live and `400` when the latest run did not fail. If the retried turn fails again, this request returns that error. `assistantEventId` is an empty string when the retried turn is waiting, as with `MessageSession`; the rest arrives over the WebSocket. <!-- id:ED1LMrQz -->

# Session browser

```ts
{_: 'ConnectSessionBrowser'; sessionId: string; connectionId: string}
{_: 'PollSessionBrowser'; sessionId: string; connectionId: string}
{_: 'ResolveSessionBrowser'; sessionId: string; connectionId: string; requestId: string; output?: Record<string, unknown>; error?: string}
{_: 'DisconnectSessionBrowser'; sessionId: string; connectionId: string}
  → {_: 'SessionBrowserResponse'; request?: {id: string; command: BrowserCommand}}
```

These four actions let the Seed app lend a visible browser window to a session, so the agent can use it.

- `ConnectSessionBrowser` attaches the window. It stays attached until it disconnects or stops polling.
- `PollSessionBrowser` waits up to 20 seconds for the next command. An empty response means there was none; polling again keeps the window attached.
- `ResolveSessionBrowser` answers one command with its output or an error.
- `DisconnectSessionBrowser` ends the connection and fails any commands still waiting.

Only the owner of the session's agent can send them. The browser works only on an agent that is not publicly readable. If public read is on, these actions fail, and turning public read on disconnects any browser. Every failure here is a `400`. `BrowserCommand` is in `apps/protocol/src/browser.ts`.

# Runs

## `GetRun` <!-- id:Jj_eiypN -->

`{_: 'GetRun', runId}` → `{_: 'GetRunResponse', run: RunInfo}`. The answer is 404 when you may not read the run, or when its agent was deleted (`runs.agent_id` is NULL). The history of such a run stays in the database, but `GetRun`, `ListRuns {rootRunId}`, `GetRunJournal` and a `runs/` subscription cannot reach it. <!-- id:9wrExQSN -->

## `ListRuns` <!-- id:vPQfRrOv -->

```ts <!-- id:UrWMTPX_ -->
{
  _: 'ListRuns'
  rootRunId?: string // the whole tree of one root, oldest first (tree rendering)
  sessionId?: string // root runs referencing a session, newest first
  agentId?: string // runs of one agent, newest first
  status?: RunStatus
  limit?: number // default 50, clamped to 200
}
```

You must send one of `rootRunId`, `sessionId` or `agentId`. When you send several, `rootRunId` wins over `sessionId`, which wins over `agentId`. With none, the answer is 400. Response: `{_: 'ListRunsResponse', runs: RunInfo[]}`. <!-- id:eHggxzXS -->

## `CancelRun` <!-- id:9aUU90Sl -->

`{_: 'CancelRun', runId}` → `{_: 'CancelRunResponse', runId, canceled}`. Cancels the run and every run below it that has not finished: queued runs never start, waiting runs never wake, and executing runs are aborted (the model call is stopped for agent runs, the VM is interrupted for script runs). `canceled` is `false` when every run had already finished. <!-- id:fv9P1IT2 -->

## `SignalRun` <!-- id:mr25qIWh -->

```ts <!-- id:rM0ixYPG -->
{
  _: 'SignalRun'
  runId: string
  signal: string // a wait with no criteria accepts any name
  payload?: unknown // must be JSON-serializable
}
```

Response: `{_: 'SignalRunResponse', runId, delivered}`. <!-- id:qIWUpNgB -->

Sends a named signal to a run that waits on `ctx.waitForEvent`, and wakes it with the payload. A person or another system uses it to answer a [script](../agent/script.md) that waits for something no document activity can express: an approval, a webhook, a decision. The **Answer** button on a run card sends the run's `RunWaitInfo.answerWith` signal. If the run is not waiting for this signal, that is not an error: `delivered` is `false`. A run that paused because it used up its budget is waiting for permission, not for data. Any signal resumes it. A trigger with a `wake` continuation uses the same delivery. See [wake source](../agent/wake-source.md). <!-- id:0pKr7fmV -->

## `GetRunJournal` <!-- id:Gpszao3B -->

`{_: 'GetRunJournal', runId, afterSeq?}` → `{_: 'GetRunJournalResponse', runId, entries}`. It returns the stored [journal](../agent/journal.md) entries of a script run (`{runId, seq, entry, createdAt}`). For an agent run the list is empty. Send `afterSeq` to get only the entries after that number, as with session events. <!-- id:YfIYxv-k -->

# Subscribe

## `Subscribe` <!-- id:H8dAcKct -->

Request: <!-- id:9rEtnIIc -->

```ts <!-- id:I6YTsRwb -->
{
  _: 'Subscribe'
  key: `account/${string}` | `agents/${string}` | `sessions/${string}` | `runs/${string}`
  afterSeq?: number
}
```

Accepted only over the WebSocket, never over HTTP (HTTP answers `400`). The socket paths are in [WebSocket subscriptions](./websocket-subscriptions.md). <!-- id:Ibn2PhkU -->

# See also

- [Signed API](./signed-api.md)
- [WebSocket subscriptions](./websocket-subscriptions.md)
- [Memory and uploads](./signed-api-memory.md) for attachments
- [Runs](../agent/runs.md)
- [Log](../agent/log.md)
