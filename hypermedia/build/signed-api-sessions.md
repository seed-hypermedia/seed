---
name: "Signed API: sessions and runs"
summary: The signed API actions for sessions, messages, user-run verbs, the session browser, runs, and the Subscribe action.
---
These are the actions of the [signed API](./signed-api.md) that work with [sessions](../agent/log.md) and [runs](../agent/runs.md): create and list sessions, send a message, run a verb as the user, stop and retry, inspect and control runs, and subscribe to live updates. The envelope, the endpoint, errors, [access levels](./signed-api.md#access-levels) and idempotency are on the [signed API](./signed-api.md) page.

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

Creates an `idle` session. Requires chat access: owner, writer, or a chatter on a `publicChat` agent; readers get 403. <!-- id:SmvTBbqB -->

Idempotent when `clientRequestId` is supplied. <!-- id:T5Yb-Vc0 -->

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

Lists the signed account's sessions newest-first across every agent on the server, or a single agent's sessions when `agentId` is set. Response: <!-- id:ntqH1GN6 -->

```ts <!-- id:uV3Pdvxz -->
{
  _: 'ListSessionsResponse'
  sessions: SessionInfo[]
  agents: AgentInfo[]
  nextCursor?: {updatedBefore: number; idBefore: string}
}
```

`agents` contains only the agents referenced by `sessions`, so a client rendering a session list across agents can label each row without a `GetAgent` per session. <!-- id:b1mOqhdT -->

`limit` defaults to 50 and is clamped to 200. <!-- id:l9a-a7RP -->

Pagination is keyset on the composite `(updatedAt, id)`. Sessions often share an `updatedAt` millisecond, because one trigger firing over a batch of activity events creates several at once. A timestamp-only cursor would silently drop every tied row past a page boundary. Pass `nextCursor` back verbatim as `cursor`. When it is absent, the list is exhausted. <!-- id:eSwNTsbV -->

Child sessions (spawned by [`delegate`](../agent/delegate.md), a script's `ctx.delegate`, or an agent starting a session) are **included by default**: an absent `includeChildren` returns every session. Pass `includeChildren: false` to get top-level rows only. Parents carry `childSessionCount`. Fetch the children of one parent with `parentSessionId`, which ignores `includeChildren`. <!-- id:oLkAiW5x -->

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

Updates editable session metadata for an account-owned session. The server trims and bounds the title, marks the title as user-authored, updates `updatedAt`, emits `session-change`, and fans out an account change with reason `session-updated`. A title saved this way is marked `title_source = 'user'`, which the server's automatic session titling refuses to overwrite. <!-- id:1AIBMSfj -->

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

Deletes an account-owned session and its durable events. Every live run rooted at the session is canceled first, **including descendants** (spawned sub-sessions and workflows). A parked parent is never stranded `waiting` because its session disappeared, and no executor streams into deleted rows. Run history survives, detached (`runs.session_id` nulled). Child sessions promote to top level (`parent_session_id` nulled). A creating trigger firing is kept but detached. The server emits an account change with reason `session-deleted`. <!-- id:9nrPnwl9 -->

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

Returns session metadata, durable events with `seq > afterSeq` if provided (or a page ending before `beforeSeq`, with `hasMoreBefore`), `systemPromptMarkdown`, the current markdown system prompt that would be used to continue the session, `triggerContext` when a trigger started the session, and `contextWindow`. An oversized event arrives with a `truncated` marker; `GetSessionEvent {sessionId, seq}` returns the whole event. <!-- id:AbyNtRFS -->

## `GetSessionEvent`

```ts
{_: 'GetSessionEvent'; sessionId: string; seq: number}
  → {_: 'GetSessionEventResponse'; event: SessionEvent}
```

Returns one durable event whole, never truncated. Requires reader access.

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
}
```

`context` parts carry ambient client state. The desktop sidebar sends the current window (open [document](../protocol/documents.md), view, focused [block](../protocol/blocks.md)) so "this document" resolves for the model. All context lines in a request collapse onto its first user message as `contextLines`. They reach the model appended to that message inside a `<window_context>` block, and never appear in the transcript `content`. At least one `text` part is required. <!-- id:ANF-JVop -->

`attachment` parts reference files already staged with `UploadSessionAttachment` (or a committed chunked upload). They are session-private [attachments](../agent/attachment.md). They live with the session, the agent reaches them through `read attachment:<id>`, and they are deleted with the session. <!-- id:wmDG8nTx -->

Flow: <!-- id:yODE0MM7 -->
  1. Verify that the signed account has chat access to the session's agent (owner, writer, or chatter). <!-- id:hNR1Yvfr -->
  2. Append the durable user message immediately, with `content` and `rawMarkdown`, optional rich `blocks`, and `meta.accountId` plus the exact cryptographic `meta.signerId` from the verified envelope. <!-- id:34Huc5Bs -->
  3. Enqueue a durable run for that message. <!-- id:RvJ6zK-m -->
  4. Claim it inline when no other turn owns the session. Otherwise leave it queued behind the current turn. <!-- id:i6rKWsUz -->
  5. Run the model loop with one model turn at a time per session. <!-- id:8J9gYKnV -->
  6. Emit live partials over WebSocket. <!-- id:lKQtSEkZ -->
  7. Append tool events and the final assistant or error event. <!-- id:VrTZxokq -->
  8. Start the next queued collaborator turn, if any. <!-- id:vtBpOjB9 -->

So several writers may submit to one session at once. Their messages are saved and broadcast in append order, and nobody gets a `409` while the agent is streaming. Model turns stay serialized. A queued turn gets an in-memory handoff that names the exact message events that arrived during the preceding response. Later assistant events from that preceding turn are then not mistaken for answers to the newly queued messages. <!-- id:B6IH4P5t -->

Each turn is a durable [run](../agent/runs.md). `MessageSessionResponse.assistantEventId` is an **empty string** when the request returned before a final assistant event existed. That happens for concurrent and background enqueues (including triggers and agent-started sessions), and for turns that parked on children spawned with `delegate`. The rest of the turn streams over WebSocket. <!-- id:12QoX7ZX -->

Idempotent through `clientMessageId` (a `text` part may carry its own `clientMessageId` too). The response also carries `continuedToSessionId` when the turn ended by `continue_session`, so the client can follow the conversation into its successor. <!-- id:0xWuAdF5 -->

## `InvokeSessionTool` <!-- id:OttXxoDi -->

Request: <!-- id:CglXQoKo -->

```ts <!-- id:TSz13bD4 -->
{
  _: 'InvokeSessionTool'
  sessionId: string
  verb: 'read' | 'write' | 'call'
  input: unknown
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

Runs one verb **as the user** against the session's shared [Log](../agent/log.md). The log is a shared workspace. The same `read`, `write`, and `call` implementations the agent uses execute here. Both the call and its result append as durable events stamped `actor: 'user'`, so the agent reads them on its next turn as ground truth. There is no side channel. The desktop composer's [wrench palette](../agent/wrench-palette.md) sends this action. <!-- id:FYxYqayk -->

Only those three verbs are accepted. `delegate` and `plan` cannot be invoked by the user, on purpose. Delegation is a conversational ask, and any path that reaches session-spawning from a user verb rejects with "Delegation is a conversational ask; message the agent instead". <!-- id:LgrMffAe -->

Execution failures are log entries too, because the user's failed attempt is context. They come back in `error`, with no HTTP error. Only pre-execution problems reject the request outright: an unknown verb (400), an unowned session (404), and a session with a live run (409, "The agent is working in this thread right now"). <!-- id:0cIP9m_n -->

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

Stops the in-flight Pi agent turn for the signed account and session when one is active, and cancels every live run rooted at the session **including descendants** (delegated model children and script children). `stopped` is `false` when the session is already idle. <!-- id:7M-SU2I2 -->

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

Re-runs a session whose latest run failed, without appending a new user message. The turn re-enters from the durable transcript, and error events are not replayed to the provider. Rejected when a run is live or the latest run did not fail. `assistantEventId` is an empty string when the retried turn parked (the rest streams over WebSocket), exactly like `MessageSession`. <!-- id:ED1LMrQz -->

# Session browser

```ts
{_: 'ConnectSessionBrowser'; sessionId: string; connectionId: string}
{_: 'PollSessionBrowser'; sessionId: string; connectionId: string}
{_: 'ResolveSessionBrowser'; sessionId: string; connectionId: string; requestId: string; output?: Record<string, unknown>; error?: string}
{_: 'DisconnectSessionBrowser'; sessionId: string; connectionId: string}
  → {_: 'SessionBrowserResponse'; request?: {id: string; command: BrowserCommand}}
```

These four actions let the desktop app lend a visible browser window to a session. `ConnectSessionBrowser` attaches the window until it disconnects or its lease expires. `PollSessionBrowser` waits for the next command, and an empty response is a lease heartbeat. `ResolveSessionBrowser` completes one command with its output or an error. `DisconnectSessionBrowser` revokes the connection and fails any outstanding commands. All four need the owner of the session's agent. `BrowserCommand` is in `apps/protocol/src/browser.ts`.

# Runs

## `GetRun` <!-- id:Jj_eiypN -->

`{_: 'GetRun', runId}` → `{_: 'GetRunResponse', run: RunInfo}`. 404 when the run does not belong to the account, or when its agent has been deleted (`runs.agent_id` is NULL): such detached run history stays in the database but is not reachable through `GetRun`, `ListRuns {rootRunId}`, `GetRunJournal`, or a `runs/` subscription. <!-- id:9wrExQSN -->

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

One selector is required; when several are given, `rootRunId` wins over `sessionId` over `agentId`, and none at all is a 400. Response: `{_: 'ListRunsResponse', runs: RunInfo[]}`. <!-- id:eHggxzXS -->

## `CancelRun` <!-- id:9aUU90Sl -->

`{_: 'CancelRun', runId}` → `{_: 'CancelRunResponse', runId, canceled}`. Cancels the run and every non-terminal descendant: queued runs never start, waiting runs never wake, executing runs are aborted (Pi abort for agent runs, VM interrupt for script runs). `canceled` is `false` when everything was already terminal. <!-- id:fv9P1IT2 -->

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

Delivers a named signal to a run parked on `ctx.waitForEvent`, and wakes it with the payload. A person or another system uses this to answer a workflow that waits for something the activity feed cannot express: an approval, a webhook, a human decision. The run card's **Answer** button sends the run's `RunWaitInfo.answerWith` signal. Signalling a run that is not listening for this signal is not an error. `delivered` is `false`. See [wake source](../agent/wake-source.md). A trigger with a `wake` continuation rides this same delivery path. <!-- id:0pKr7fmV -->

## `GetRunJournal` <!-- id:Gpszao3B -->

`{_: 'GetRunJournal', runId, afterSeq?}` → `{_: 'GetRunJournalResponse', runId, entries}`. It returns a script (workflow) run's durable [journal](../agent/journal.md) entries (`{runId, seq, entry, createdAt}`). It is empty for agent runs, and replayable with `afterSeq` like session events. <!-- id:YfIYxv-k -->

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

Accepted only over the socket at `/hm/api/apps/ws`. See [WebSocket subscriptions](./websocket-subscriptions.md). <!-- id:Ibn2PhkU -->

# See also

- [Signed API](./signed-api.md)
- [WebSocket subscriptions](./websocket-subscriptions.md)
- [Memory and uploads](./signed-api-memory.md) for attachments
- [Runs](../agent/runs.md)
- [Log](../agent/log.md)
