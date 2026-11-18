---
name: Tools
summary: "An agent does everything through five verbs (read, write, call, delegate and plan), and this hub explains how those verbs work together and where each one is documented."
---
An agent has five verbs: [`read`](./read.md), [`write`](./write.md), [`call`](./call.md), [`delegate`](./delegate.md) and [`plan`](./plan.md). It also has two small verbs for the [session](./session.md) itself, `status` and `continue_session`. Everything else an agent can do is reached through one of these. Search, the web, code and MCP tools are **callable tools**: the agent runs them with `call`. A tool that an agent makes is a document in an app or in the agent's own document, and it is called by its [hm:// URL](../protocol/urls.md). Every tool call and its result is saved in the session [log](./log.md), which the [Seed app](../software/desktop.md) and the [Seed web app](../software/web.md) show. <!-- id:sdHo0UwP -->

For example, to search the network an agent runs `call` with `{tool: "search", input: {query: "…"}}`. To read the result it found, it runs `read` with the document's address.

This page is the hub. It explains how the verbs work as one system. Each verb and each mechanism has its own page.

# The verbs and their pages

- [read](./read.md): every address an agent can read, the options, and how long results are paged.
- [write](./write.md): where an agent can write, the actions and options, and what the server refuses.
- [call](./call.md): the input, the order of lookup, and tools called by their hm:// URL.
- [delegate](./delegate.md): giving work to a child run, as a model or as a script.
- [plan](./plan.md): the checklist a person sees, and how the runtime settles its steps.
- `status` is described [below](#status). `continue_session` is on [session continuation](./session-continuation.md).

The mechanisms behind them:

- [Callable tools](./callables.md): what `call` can run, with `search`, `query`, `attributes` and `browser` in full. The `attributes` tool lists the [attributes](../metadata.md) that documents carry.
- [Code execution](./code-execution.md): the `execute` callable and its sandbox.
- [Web reading](./web-reading.md): how `read https://…` and `web_search` reach the web.
- [Comments and mentions](./comments-and-mentions.md): comment threads, and the mention form that notifies.
- [Markdown tables](./markdown-tables.md): the table format that keeps the identity of rows and columns.
- [Memory](./memory.md): the agent's files, and what is unsafe to keep in `/workspace`.
- [Tool document](./tool-document.md) and [contract](./contract.md): how a tool is stored and described to the model.
- [Grants](./grants.md): what narrows the set of callable tools, and who may publish.
- [MCP servers](./mcp.md): remote tools listed under `~/tools/`.
- [Brief](./brief.md), [child](./child.md), [typed result](./typed-result.md), [delegation budgets](./delegation-budgets.md): the parts of a delegation.
- [Script](./script.md), [journal](./journal.md), [continueAsNew](./continue-as-new.md): script children.
- [Step](./step.md), [batch step](./batch-step.md), [attachment](./attachment.md), [obligations](./obligations.md): the parts of a plan.
- [Running a tool yourself](./wrench-palette.md): a person runs the same verbs on the shared log.

# The registry <!-- id:-aLT2u3W -->

One file lists every verb and every built-in callable tool: `apps/protocol/src/tool-registry.ts`. The [app environment](../software/app-environment.md) (the server that runs agents) executes from it, and the Seed app draws tool calls from it. So a tool's prompt text, its schemas and its chat bubble always agree. The file exports three tables: <!-- id:5JGudaAa -->
  - `seedVerbRegistry`: the five verbs, `status`, `continue_session`, and the hidden `return_result` mechanism. These are the **only** tools the [model provider](./model-providers.md) is given. A leaf run gets no `delegate`, a delegated child gets no `continue_session`, and only a typed child gets `return_result`. <!-- id:cpDWf5e4 -->
  - `callableToolRegistry`: `search`, `query`, `attributes`, `web_search`, `navigate`, `execute`, `browser`. By default the provider is not given these as tools. The agent reaches them through `call`. <!-- id:Z3ye-2G4 -->
  - `seedToolRegistry`: both tables merged, for code that draws tool calls or looks up a schema. <!-- id:lnALDCIy -->

Each entry holds:

- the name the model uses, a label, and the description the model reads;
- a JSON input schema and an optional output schema;
- where the tool can run (`assistant` or `agent-service`);
- how the chat draws the call;
- an optional `getReferencedUrls` function.

`getReferencedUrls` lists the `hm://` resources a call touched, so the Seed app can [sync](../protocol/network.md) them. For a write, the list includes the new [document](../protocol/documents.md) version and the [comment](../protocol/comments.md) and target URLs. An open desktop session then keeps the new content on its local node before the user follows the result link. The server only adds the functions that run each entry. The chat picks how to draw a call from the same entry. <!-- id:Io_jNF7p -->

`navigate` is marked `runtimes: ['assistant']`. The app environment runs only the `agent-service` runtime, so it never offers `navigate`. `serviceCallableNames()` (in `apps/src/api-service.ts`) keeps the entries whose `runtimes` include `agent-service`. That leaves `search`, `query`, `attributes`, `web_search`, `execute` and `browser`.

An agent's `tools` array narrows that set, with two exceptions. `query` and `attributes` are always callable (`ALWAYS_ON_CALLABLES`). They only read what the always-on `read` verb already reaches, and agent settings have no switch for them. [Callable tools](./callables.md) describes each tool, and [grants](./grants.md) says how the set is narrowed. <!-- id:hZYGek_X -->

# Touch-expand and promotion <!-- id:ywZR_0ng -->

**Touch-expand** means that a wrong call answers with the tool's description, so the model's next try succeeds. `call` never punishes a miss. A call to an unknown tool returns the `~/tools` listing. A call to a known tool with wrong input returns **the tool's contract** and the validation errors, so the next try succeeds (`executeCallVerb`, `api-service.ts`). <!-- id:edRIqz0f -->

A tool's contract enters the transcript when the agent reads `~/tools/<name>` or calls the tool by that name. From then on the tool is **promoted**: the model gets it as a real provider tool for the rest of the thread. See [promotion](./promotion.md).

The server works out promotion only from saved `tool_call` events (`expandedCallablesFromEvents()`, `api-service.ts`). So a resume, a park, a restart or a compaction all rebuild the same set. Events with actor `user` are skipped. A tool that a person ran must not change the agent's toolset without the agent knowing. <!-- id:3AAxXIeD -->

Before the provider is offered anything (`#runPiAgent`), the server keeps only the promoted names that are also allowed. Allowed means the agent's enabled callables plus its own enabled MCP tools, worked out again from the definition when the run starts: <!-- id:D8DK4IAm -->

```ts <!-- id:4ZQwDiQa -->
const expandedCallables = this.#expandedCallablesForSession(sessionId)
  .map(normalizeSeedToolName)
  .filter((name) => enabledCallables.includes(name) || documentTools.has(name))
```

This filter is a security control. If a model invents `call {tool: 'bash'}`, that name is saved in the log. But only names that pass this filter become tools of the turn. Nothing else can run: the turn holds Seed's verbs and no host tools.

A promoted MCP tool is defined from its own [tool document](./tool-document.md) (`toolMetadataFromDocument`). The contract the model read is the schema the provider checks against, and the tool still runs through the same `call` code. <!-- id:cuCkX0YE -->

# `status` <!-- id:mbUuxFT_ -->

`status` sets the session's `title` and `description`. Its input is `{title?, description?}`, and the agent passes only the fields that change. <!-- id:wNgr5l4d -->

- The title says what the whole session is about. The agent sets it once, early.
- The description is the live status. The agent updates it at milestones, and once more when the work finishes.
- Each turn shows the current values in a `<session_status>` tag. So a call is always a change and never a repeat.
- A title the user typed is never overwritten.
- The call is hidden in the log, like `plan`.

# Tool lifecycle <!-- id:96sl4tD5 -->

A turn runs like this:

<!-- id:T5dSr29_ -->
1. The server installs the verbs, plus any promoted callables, as the only tools of the turn's [Pi Durable](./durable-sessions.md) harness. <!-- id:xsFatZeE -->
2. The harness calls the model. The model returns assistant text and tool calls. <!-- id:yQNautgz -->
3. The harness saves the response as one entry before any tool runs. The server copies it into the log: the assistant text as a `message` event with its `meta`, then one `tool_call` event per call. <!-- id:mUpcgNp_ -->
4. Each call runs as its own checkpointed task, which runs Seed's own code for the tool. Its saved result is copied into the log as `tool_result`. <!-- id:TjGqsaDS -->
5. The model continues until it gives final assistant text. Each later response is copied into the log the same way when its entry is saved. <!-- id:SsXCJthS -->

On later turns the model reads those same entries from the session's saved conversation. Sometimes the server must rebuild the conversation from the log. Then it replays assistant text and the `tool_call` events that follow it as one assistant message, placed before their matching `tool_result` messages. Some provider APIs, such as OpenAI chat completions, refuse a `tool` message with no call before it, and expect the calls of one batch grouped together. <!-- id:TyneiaQU -->

While a child is working, the parent's `delegate` call has no result in the log yet. The result is added when the child finishes. Until then, the saved conversation holds a placeholder result for the call, and the real result replaces it later. A fast child can finish before the parent's `waiting` status is saved. A check that runs after the parent [parks](./park.md) catches that case. <!-- id:9Dtuf-4o -->

# Event shapes <!-- id:OTsBgC0e -->

```ts <!-- id:pyaCekfO -->
{type: 'tool_call', id: string, name: string, input: unknown, actor?: SessionActor}
{type: 'tool_result', toolCallId: string, name: string, output?: unknown, error?: string,
 actor?: SessionActor, meta?: SessionEventMeta}
```

`SessionActor` is `'user' | 'agent' | 'system' | 'trigger'`. It says who made the event. See [actor](./actor.md). <!-- id:hksYR3Hb -->

- Only `user` and `system` are ever written on an event.
- An event with no `actor` gets one from its shape (`sessionEventActor()`): a message with role `user` is `user`, an `error` event is `system`, and everything else is `agent`. So a message that a [trigger](../trigger.md) started reads as `user`.
- `trigger` is declared and never written.
- `SessionEventMeta` carries who sent a user event (`accountId`, `signerId`) and what produced an agent event (`model`, `provider`, the [reasoning level](./reasoning-levels.md), `usage`, `durationMs`).
- The server writes this once, when it appends the event. None of it can be recovered after the run is gone.

A tool failure should usually become `tool_result.error`, so the model can respond to it. <!-- id:NpXTgZQ2 -->

# Size limits <!-- id:TX-32IwL -->

There are two limits, for two purposes: <!-- id:kJKoobvp -->
  - `MAX_TOOL_RESULT_BYTES` (256 KiB, `api-service.ts`) limits what a tool may produce for the log. Document and comment markdown is cut on a byte boundary at this size before it enters the session log. <!-- id:YNMk7akJ -->
  - `MAX_MODEL_TOOL_RESULT_BYTES` (32 KiB, `api-service.ts`) limits what one tool result adds to the model's context. `boundModelToolResultText()` cuts the result text on a UTF-8 character boundary and adds a notice. The notice tells the model that the result was cut, that it must work in smaller pieces, and that it must not retry the same call. Smaller pieces means narrower reads, or saving the source to a memory file and processing it with `execute`. <!-- id:8ZWEBIvj -->

The 32 KiB cut happens in one place for live calls (`defineSeedPiTool`), including `piContent` text parts. Image parts have their own cap. The same cut happens again when the server replays a transcript: assistant tool results, results with no call, and user-action payloads. So a resumed session sees the same transcript the live session saw.

The session log keeps more than the model sees, but not everything. A stored string longer than `SEED_APPS_TOOL_OUTPUT_STORE_LIMIT_KIB` (128 by default) keeps its start and a marker. See [database retention](../operate/database-retention.md). <!-- id:CT2cC3O1 -->

A long `read` result comes back in pages before it reaches the 32 KiB cut. See [paged reads](./read.md#paged-reads).

# See also <!-- id:oCLMZYfZ -->

- [Seed Agents](../agent.md) <!-- id:TrgD5bzh -->
- [How agents work](./how-it-works.md)
- [Triggers](./triggers.md) <!-- id:F1npZzOs -->
- [Security](./security.md) <!-- id:1gpCge_Z -->
- [Session continuation](./session-continuation.md) <!-- id:5SxLzsxa -->
- [Using Seed from your own agent](../build/agents.md) <!-- id:L73dL6H1 -->
