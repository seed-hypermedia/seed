---
name: Agents glossary
summary: Every Seed Agents term in one or two sentences, each linking to the page that defines it, grouped by the part of the runtime it belongs to.
---
The words the [Seed Agents](../agent.md) pages use, one line each, linked to the page that defines the term. The three nouns and the verbs come first, because every other term builds on them. Protocol terms such as [account](../protocol/identity.md), [capability](../protocol/permissions.md), and [comment](../protocol/comments.md) are in the site-wide [glossary](../glossary.md). <!-- id:J5uWk8bq -->

# The nouns <!-- id:hrvM4X14 -->

- [Space](./space.md): everything an agent has, as one addressable tree: `~/memory/`, `~/tools/`, `~/triggers/`, and `~/self`. <!-- id:rkg2yQnm -->
- [Log](./log.md): everything that happened in a session, an append-only sequence of events each stamped with an actor. <!-- id:ZfSTqZSb -->
- [Runs](./runs.md): everything that executes, one durable row per turn, child, and script, in a tree that doubles as the dispatch queue. <!-- id:iJxFlTPw -->
- [session](./session.md): one conversation with an agent. It owns a log and moves forward in turns.
- thread: another word for a [session](./session.md). It is the word the model sees, as in the address `thread:<id>`. <!-- id:hecPc4kk -->
- [turn](./session.md): one model run of a session, from a message or a wake to the reply; each turn is a run of kind `agent`. <!-- id:lq1dZVzF -->
- agent definition: the stored configuration of an agent (name, model, reasoning level, thoroughness, grants, MCP servers, signing keys), readable by the agent at `~/self`; see [Space](./space.md).

# The verbs <!-- id:pLKGhf72 -->

Five verbs and two session verbs are everything the model is handed as tools.

- [read](./read.md): one verb for every address, from memory files to [`hm://`](../protocol/urls.md) documents, web pages, the activity feed, and other threads. <!-- id:N0Br-NCA -->
- [write](./write.md): the mirror of read: memory, triggers, [IPFS](../protocol/files.md) uploads, and signed Hypermedia publishing under the publish grant. <!-- id:pafALDPR -->
- [call](./call.md): run a callable tool by name, or a tool resource by its hm:// URL; a wrong or missing input answers with the tool's contract. <!-- id:dtjwuv7C -->
- [delegate](./delegate.md): spawn a child run, either a model child given a brief or a script child given source. <!-- id:-Eilsft0 -->
- [plan](./plan.md): maintain the thread's visible checklist. <!-- id:8V3lpFrX -->
- `status`: a session verb. It sets the session's title and live description as they appear in session lists; see [tools](./tools.md) and [session](./session.md). <!-- id:JSUWF9TR -->
- `continue_session`: a session verb. It carries the conversation into a fresh successor session; see [session continuation](./session-continuation.md). <!-- id:lv_czFSi -->

# Tools <!-- id:kzH8G9Dm -->

- [tool document](./tool-document.md): the content-addressed [DAG-CBOR](../protocol/blobs.md) record of one tool an agent holds, with its CID as its version. It is a builtin binding or an MCP projection. <!-- id:w3W8a1ON -->
- [tool](../tool.md): a document that holds one function, listed by an app or an agent and called by its hm:// URL. A tool an agent makes is this, not a tool document.
- [contract](./contract.md): a tool's full model-facing spec, description plus input and output schemas, returned by `read ~/tools/<name>`. <!-- id:Ik7ZxEnK -->
- [Space index](./space-index.md): the compact `<space>` block sent with every turn's input, one line per tool plus the memory top level and active triggers. <!-- id:lByOWtHk -->
- [promotion](./promotion.md): once a tool's contract has entered the transcript, the tool becomes a provider tool for the rest of the thread. <!-- id:6WZZGldd -->
- [grants](./grants.md): the per-agent permissions: the callable set (`search`, `web_search`, `execute`, `browser`), the `publish` grant, and the enabled MCP servers. The verbs are never grants, and `query` and `attributes` are always on. <!-- id:E0X6U5sz -->
- [MCP server](./mcp.md): a remote Model Context Protocol server connected per account and enabled per agent, whose tools appear as `<server>__<tool>` documents. <!-- id:ciW00Bil -->
- touch-expand: what `call` does on a miss. The tool's contract comes back in place of an error, so the retry succeeds. Defined on [tools](./tools.md). <!-- id:sSKqNZZ0 -->
- [callable](./callables.md): a tool dispatched through `call`, as opposed to a verb handed to the model directly: `search`, `query`, `attributes`, `web_search`, `execute`, `browser`, or an MCP tool. `navigate` is registered for the assistant runtime only and is never offered by the server. <!-- id:OwZaNyRS -->

# Delegation and orchestration <!-- id:S6WLWBmx -->

- [child](./child.md): a run spawned by delegate; a model child gets its own session, a script child runs in the QuickJS engine. <!-- id:pPaUo-gX -->
- [brief](./brief.md): the markdown task briefing that becomes a model child's first message word for word. <!-- id:Qen21b9Q -->
- [typed result](./typed-result.md): a child spawned with an `output` schema must deliver its result through the `return_result` tool. <!-- id:THID80eE -->
- [script and ctx](./script.md): a script child's world: `ctx.call`, `ctx.delegate`, `ctx.parallel`, `ctx.step`, `ctx.plan`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.continueAsNew`. <!-- id:QxQG0zGR -->
- [journal](./journal.md): a script run's durable effect record; resume replays the source against it and completed effects never re-execute. <!-- id:Pi9NkRbM -->
- [delegation budget](./delegation-budgets.md): how deep a tree of delegated runs may go and how many children each run may start.
- [effect outbox](./effect-outbox.md): the record of every side effect a chat turn's tool call performs, written before the effect and receipted after, so a call rerun after a restart is answered from what happened instead of repeating it.
- receipt: the settled row of the [effect outbox](./effect-outbox.md) for one call: what the tool returned, or the error it ended with.
- journal entry: one record in a [journal](./journal.md), a JSON value with a `kind` (`call`, `result`, `timer`, `fired`, `wait`, `event`, `now`, `log`, `step`, `plan`), the `callSeq` of the ctx call it belongs to, and a content `key` replay matches on. <!-- id:q2_iCTWm -->
- run tree: a root [run](./runs.md) and every run spawned under it, all sharing one `rootRunId`; what `ListRuns {rootRunId}` returns and a `runs/<rootRunId>` subscription replays. <!-- id:vseyzZTk -->
- root run: the run a message or a firing started, at depth 0; its children carry `parentRunId` and a greater `depth`. <!-- id:6IZ9sg9v -->
- [park and wait](./park.md): a run pausing without holding resources, for children, a timer, an event, or a budget pause. <!-- id:yYu22gIQ -->
- [wake source](./wake-source.md): whatever ends a park: children finishing, a timer, a signal, an activity event, or a person resuming. <!-- id:3WjoeEZL -->
- [continueAsNew](./continue-as-new.md): a long-running script finishing into a fresh successor run with a clean journal. <!-- id:RIJrxpyc -->
- [thoroughness](./delegation-budgets.md): the `quick`, `normal`, or `deep` preset that sets a run tree's depth and fan-out budget. <!-- id:9LsIGwzZ -->
- [obligation](./obligations.md): what a run owes when it ends, an undelivered typed result or unfinished plan steps, reported as `unmetObligations` and never silently written off. <!-- id:XeXutUqR -->

# Plans <!-- id:V1BJjrpz -->

- [step](./step.md): one checklist item with a stable `id` and a human `label`. <!-- id:thSmaMxP -->
- [attachment](./attachment.md): the join between a child and a plan step: a child spawned while a step is running belongs to that step. Not to be confused with a session attachment, below. <!-- id:Fx6BNXMq -->
- [batch step](./batch-step.md): one running step owning a whole parallel batch of children. <!-- id:Kj7029-5 -->

# Sessions and the shared log <!-- id:TDeu0X7Q -->

- [actor](./actor.md): who did it: `user`, `agent`, `system`, or `trigger`. Every event has one. Only `user` and `system` are stamped; `agent` is derived from the event's shape, and `trigger` is never written. <!-- id:C05dWJaO -->
- session attachment: a file a person dropped into the composer. It is private to the [session](./session.md), read with `read attachment:<id>`, and deleted with the session. Not the plan term above.
- [wrench palette](./wrench-palette.md): the tool button in the composer that lets a person run `read`, `write`, and `call` themselves, with results landing on the log as user events. <!-- id:HoQrWl3R -->
- [session continuation](./session-continuation.md): carrying a conversation into a fresh successor session with a structured handoff. The old history is not compacted. This is one of two meanings of "continuation"; the other is under Triggers. <!-- id:Jiai9ykh -->
- projection: the successor session's first context after a [session continuation](./session-continuation.md): the handoff, the exact initiating message, and exact excerpts.
- [durable store](./durable-sessions.md): the copy of a session's conversation in the exact form the model reads it. The log is the record; the store is the model's view.

# Triggers <!-- id:Cv20mJqD -->

- [trigger](../trigger.md): a standing rule that binds a source to what a firing does. The nine sources are `document-comment`, `user-mention`, `comment-reply`, `document-author-comment`, `site-update`, `activity` (a list of those as conditions), `schedule`, `webhook` and `run-completed`; see [triggers](./triggers.md). <!-- id:Y2MmLcGs -->
- [firing](./firing.md): one trigger activation, deduplicated exactly once, with run-completed chains loop-guarded at eight hops. <!-- id:ixEodPl5 -->
- continuation (of a trigger): what a firing does: start a new thread (`newThread`), wake a parked run (`wake`), or run a `tool` or a `script` with no model; see [triggers](./triggers.md). Not to be confused with [session continuation](./session-continuation.md), which carries a conversation into a successor session. <!-- id:fdvIUBGI -->
- [webhook](./webhooks.md): a trigger source that fires when something POSTs JSON to the trigger's delivery URL.
- condition: one alternative inside an `activity` trigger, `{id, source}`; the trigger fires once when any condition matches, and the firing records `matchedConditions`; see [triggers](./triggers.md). <!-- id:ErE_yblL -->
- claim: the `trigger_event_claims` row inserted for `(account, trigger, firing key)` before an activity firing is created, the admission authority that makes a firing exactly-once; see [triggers](./triggers.md). <!-- id:Z-spRZex -->
- firing key: the key a feed event dedupes on, `blob-<cid>` of the comment version, which a comment and its citation twin share (`activityFiringKey`); the raw event key (`activityEventKey`) differs per sibling. <!-- id:VxejOIOt -->
- activity monitor: the server's poll loop over the Hypermedia activity feed that matches events against triggers and waiting runs; see [triggers](./triggers.md). <!-- id:r06uh5ey -->

# Identity, access and the control plane <!-- id:rFeEtwox -->

- signed envelope: the DAG-CBOR wrapper around every action, signed by the [account key](../build/keys.md) or a delegated key; see the [signed API](../build/signed-api.md). <!-- id:fbaNIuz4 -->
- [signing identity](./identity.md): one of the agent's own Ed25519 account keys, created on the app environment and stored encrypted, which the agent signs its Hypermedia writes with. The primary one is the account the agent is. <!-- id:bUGOLQpg -->
- subscription: a signed `Subscribe` action over the WebSocket that streams account, agent, session, or run changes; see [WebSocket subscriptions](../build/websocket-subscriptions.md). <!-- id:3jgvKjkR -->
- [collaborator](./sharing.md): a Seed account invited to an agent as `reader` or `writer`. Public read and public chat open an agent to any signed account, as a reader or a chatter. <!-- id:If4Yghpa -->
- [mount document](./mounting.md): the document that makes an agent part of a space. It has the type `hm://hyper.media/agent`, names the agent's server, carries its name, and holds its instructions.
- [orphan agent](./mounting.md): an agent that lives in no space. Its owner can adopt it into one.
- [write scope](./mounting.md): where a mounted agent's key may publish in the space of its document: its own document, the whole space, or nothing.
- [model provider](./model-providers.md): the record that tells a server how to reach a language-model backend for an account.
- [reasoning level](./reasoning-levels.md): how much a model thinks before it answers, from `minimal` to `max`.
- [Assistant](./assistant.md): the built-in agent the desktop app creates on its local server.
- [window context](./assistant.md): what is on the person's screen, sent by the assistant panel with a first message.

# See also <!-- id:deUgW0Lw -->

- [Seed Agents](../agent.md) <!-- id:JAolMGhJ -->
- [Tools](./tools.md) <!-- id:hfEF3zTk -->
- [How agents work](./how-it-works.md) <!-- id:1smxPF3T -->
- [Triggers](./triggers.md) <!-- id:BHiqvq9G -->
- [Signed API](../build/signed-api.md) <!-- id:DwyZLihg -->
- [Security](./security.md) <!-- id:wVUY3qvB -->
- [Site-wide glossary](../glossary.md) <!-- id:fsAuMffS -->
