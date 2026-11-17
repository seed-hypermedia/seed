---
name: Tools
summary: "The hub for everything an agent can do: the verbs handed to the model, the registry behind them, how a callable tool is found and promoted, how tool calls are recorded, and where each verb is documented."
---
An agent's whole model-facing tool surface is **five verbs**, [`read`](./read.md), [`write`](./write.md), [`call`](./call.md), [`delegate`](./delegate.md), and [`plan`](./plan.md), plus two session verbs, `status` and `continue_session`. Everything else is either an address form of a verb or a **callable tool** dispatched through `call`. That covers search, the web, code execution, and MCP tools. An agent's own tools are not private: they are **tool resources** in an app or in the agent's document, called by their hm:// URL (see [call](./call.md)). Tool calls and results are stored as durable, actor-stamped session events in the [Log](./log.md) and rendered in the session log of the Seed app and the Seed web app. <!-- id:sdHo0UwP -->

This page is the hub. It explains how the tool surface works as a system. Each verb and mechanism has its own page.

# The verbs and their pages

- [read](./read.md): address forms, their options, thread and run scope, paged results.
- [write](./write.md): the targets, the actions and options of a Hypermedia write, and what is refused.
- [call](./call.md): the input, the dispatch order, and tool resources called by hm:// URL.
- [delegate](./delegate.md): model, script, parallel and detached children.
- [plan](./plan.md): the checklist and how the runtime settles steps.
- `status` is described [below](#status). `continue_session` is on [session continuation](./session-continuation.md).

The mechanisms behind them:

- [Callable tools](./callables.md): what `call` can run, with `search`, `query`, `attributes` and `browser` in full.
- [Code execution](./code-execution.md): the `execute` callable and its sandbox.
- [Web reading](./web-reading.md): how `read https://…` and `web_search` reach the web.
- [Comments and mentions](./comments-and-mentions.md): comment threads, and the mention form that notifies.
- [Markdown tables](./markdown-tables.md): the table dialect that keeps row and column identity.
- [Memory](./memory.md): the agent's files, and what is unsafe to keep in `/workspace`.
- [Tool document](./tool-document.md) and [contract](./contract.md): how a tool is stored and advertised.
- [Grants](./grants.md): what narrows the callable set, and who may publish.
- [MCP servers](./mcp.md): remote tools projected into `~/tools/`.
- [Brief](./brief.md), [child](./child.md), [typed result](./typed-result.md), [delegation budgets](./delegation-budgets.md): the parts of a delegation.
- [Script](./script.md), [journal](./journal.md), [continueAsNew](./continue-as-new.md): script children.
- [Step](./step.md), [batch step](./batch-step.md), [attachment](./attachment.md), [obligations](./obligations.md): the parts of a plan.
- [Wrench palette](./wrench-palette.md): a person runs the same verbs on the shared log.

# The registry <!-- id:-aLT2u3W -->

The canonical registry is `apps/protocol/src/tool-registry.ts`. The App environment executes from it and the desktop renders from it, so a tool's prompt text, schemas, chat bubble, and HM-reference extraction cannot drift apart. It exports three tables: <!-- id:5JGudaAa -->
  - `seedVerbRegistry`: the five verbs, `status`, `continue_session`, and the hidden `return_result` mechanism. This is the **only** provider-facing toolset. A leaf run gets no `delegate`, a delegated child gets no `continue_session`, and only a typed child gets `return_result`. <!-- id:cpDWf5e4 -->
  - `callableToolRegistry`: `search`, `query`, `attributes`, `web_search`, `navigate`, `execute`, `browser`. By default these are never handed to the provider as tools. `call` dispatches them (`callableToolRegistry`). <!-- id:Z3ye-2G4 -->
  - `seedToolRegistry`: both, merged, for renderers and validation lookups (`seedToolRegistry`). <!-- id:lnALDCIy -->

Each entry owns the model-facing name, label, prompt description, JSON input schema, optional output schema, runtime availability (`assistant` or `agent-service`), rendering metadata, and an optional `getReferencedUrls` extractor. The extractor lists the `hm://` resources a call touched so they can [sync](../protocol/network.md). Write results include [document](../protocol/documents.md) versions and [comment](../protocol/comments.md) and target URLs in this extraction. An open desktop session can then keep newly published content subscribed on its local node before the user follows the result link. Server runtimes only add execution functions around registry entries. Chat UIs pick their bubble renderer from the same metadata. <!-- id:Io_jNF7p -->

`navigate` is marked `runtimes: ['assistant']`, and the app environment runs only the `agent-service` runtime, so it never offers `navigate`. `serviceCallableNames()` (in `apps/src/api-service.ts`) filters on `runtimes.includes('agent-service')`, which leaves the service's callable set as `search`, `query`, `attributes`, `web_search`, `execute`, `browser`. An agent's `tools` array narrows that set, except for `query` and `attributes`: they are always callable (`ALWAYS_ON_CALLABLES`), because they only read what the always-on `read` verb already reaches and agent settings offer no toggle for them. [Callable tools](./callables.md) describes each one, and [grants](./grants.md) says how the set is narrowed. <!-- id:hZYGek_X -->

# Touch-expand and promotion <!-- id:ywZR_0ng -->

`call` never punishes a miss. Calling an unknown tool returns the `~/tools` listing. Calling a known tool with input its schema rejects returns **the tool's contract** as the result, plus the validation errors, so the retry succeeds (`executeCallVerb`, `api-service.ts`). <!-- id:edRIqz0f -->

Once a tool's contract has entered the transcript, through an agent `read` of `~/tools/<name>` or any `call` by that name, the tool is **promoted** to a real provider tool for the rest of the thread. See [promotion](./promotion.md). Promotion is derived only from durable `tool_call` events (`expandedCallablesFromEvents()`, `api-service.ts`), so resume, park, restart, and compaction all rebuild the same set. Events with actor `user` are skipped: a user's palette call must not silently reshape the agent's active toolset. <!-- id:3AAxXIeD -->

Before anything is offered to the provider (`#runPiAgent`), promotion is intersected with the agent's enabled callables plus its own enabled MCP projections (re-derived from the definition at run start): <!-- id:D8DK4IAm -->

```ts <!-- id:4ZQwDiQa -->
const expandedCallables = this.#expandedCallablesForSession(sessionId)
  .map(normalizeSeedToolName)
  .filter((name) => enabledCallables.includes(name) || documentTools.has(name))
```

This filter is a security control. A hallucinated `call {tool: 'bash'}` durably stores that name, and only names that pass this filter are ever installed as tools of the turn. Nothing else can run: the turn's harness holds Seed's verbs and no host tools. A promoted document tool is defined from its own document (`toolMetadataFromDocument`): the contract the model read is the schema the provider now validates against, and its executor is the same `call` dispatch. <!-- id:cuCkX0YE -->

# `status` <!-- id:mbUuxFT_ -->

Sets the session's agent-maintained `title` and `description`: `{title?, description?}`, passing only the fields that change. The title names what the whole session is about and is set once, early. The description is the live status. The agent updates it at milestones and once more when the work finishes. Each turn shows the current values in a `<session_status>` block, so a call is always a change and never a restatement. A title the user typed is never overwritten. The call is hidden in the log, like `plan`. <!-- id:wNgr5l4d -->

# Tool lifecycle <!-- id:96sl4tD5 -->

<!-- id:T5dSr29_ -->
1. The server installs the verbs (plus any promoted callables) as the only tools of the turn's [Pi Durable](./durable-sessions.md) harness. <!-- id:xsFatZeE -->
2. The harness calls the model. The model returns assistant text and tool calls. <!-- id:yQNautgz -->
3. The harness commits the response as one entry before any tool runs. The server projects it into the log: the assistant text as a durable `message` event with its `meta`, then one `tool_call` event per call. <!-- id:mUpcgNp_ -->
4. Each call runs as its own checkpointed task that executes the Seed-owned implementation. Its committed result is projected as `tool_result`. <!-- id:TjGqsaDS -->
5. The model continues until final assistant text. Each later response is projected the same way when its entry is committed. <!-- id:SsXCJthS -->

On later turns the model reads those same entries from the session's durable conversation. When the conversation has to be rebuilt from the log, the server replays assistant text and consecutive `tool_call` events as a single assistant message, placed before their matching `tool_result` messages. This keeps provider replay valid for APIs such as OpenAI chat completions, which reject orphaned `tool` messages and expect multi-tool batches grouped. <!-- id:TyneiaQU -->

Parked `delegate` calls keep their durable `tool_call` unanswered on purpose, until the child's finalizer appends the real result. In the durable conversation the call holds a placeholder result until then, and the real result replaces it through a context edit. A post-park reconcile pass closes the race where a fast child finalizes before the parent's `waiting` status commits. <!-- id:9Dtuf-4o -->

# Event shapes <!-- id:OTsBgC0e -->

```ts <!-- id:pyaCekfO -->
{type: 'tool_call', id: string, name: string, input: unknown, actor?: SessionActor}
{type: 'tool_result', toolCallId: string, name: string, output?: unknown, error?: string,
 actor?: SessionActor, meta?: SessionEventMeta}
```

`SessionActor` is `'user' | 'agent' | 'system' | 'trigger'`. Only `user` and `system` are ever stamped; an event with no `actor` derives it from its shape via `sessionEventActor()` (an assistant message or tool call is `agent`, a message is `user`), and a trigger-started message therefore reads as `user`. `trigger` is declared and never written. `SessionEventMeta` carries `model`, `provider`, `usage`, and `durationMs`. This provenance is stamped once at append time, because none of it can be recovered after the run is gone. See [actor](./actor.md). <!-- id:hksYR3Hb -->

Tool failures should usually become `tool_result.error`, so the model can respond to them. <!-- id:NpXTgZQ2 -->

# Size limits <!-- id:TX-32IwL -->

There are two ceilings, for two purposes: <!-- id:kJKoobvp -->
  - `MAX_TOOL_RESULT_BYTES` (256 KiB, `api-service.ts`) bounds what a tool may produce durably. Rendered document and comment markdown is truncated on a byte boundary at this cap before it enters the session event log. <!-- id:YNMk7akJ -->
  - `MAX_MODEL_TOOL_RESULT_BYTES` (32 KiB, `api-service.ts`) bounds what any single tool result adds to the provider context. `boundModelToolResultText()` cuts the serialized result on a UTF-8 character boundary. It appends a notice that tells the model the result was truncated and that it must work in bounded pieces (narrower reads, or saving the source into a memory file and processing it with `execute`), and must not retry the same call. The cut happens at the single tool-definition choke point (`defineSeedPiTool`) for live calls, including `piContent` text parts (image parts have their own inline cap). It happens again on transcript replay (assistant tool results, orphan results, and user-action payloads), so a resumed session sees the same bounded transcript the live session saw. <!-- id:8ZWEBIvj -->

Durable session events and the desktop UI keep the tool's full output. Only the model-facing text is cut. <!-- id:CT2cC3O1 -->

Long `read` results come back in pages before they reach the second cut. See [paged reads](./read.md#paged-reads).

# See also <!-- id:oCLMZYfZ -->

- [Seed Agents](../agent.md) <!-- id:TrgD5bzh -->
- [How agents work](./how-it-works.md)
- [Triggers](./triggers.md) <!-- id:F1npZzOs -->
- [Security](./security.md) <!-- id:1gpCge_Z -->
- [Session continuation](./session-continuation.md) <!-- id:5SxLzsxa -->
- [Using Seed from your own agent](../build/agents.md) <!-- id:L73dL6H1 -->
