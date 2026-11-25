---
name: Agents glossary
summary: The Seed Agents terms in one or two sentences each, with a link to the page that defines each term, grouped by the part of the runtime they belong to.
---
This page lists the words the [Seed Agents](../agent.md) pages use. Each entry is one or two sentences, and it links the page that defines the term. The three nouns and the verbs come first, because every other term builds on them. Protocol terms such as [account](../protocol/identity.md), [capability](../capability.md), and [comment](../protocol/comments.md) are in the site-wide [glossary](../glossary.md). <!-- id:J5uWk8bq -->

# The nouns <!-- id:hrvM4X14 -->

The three nouns are Space, Log and Runs. The other entries here are the words built directly on them.

- [Space](./space.md): everything an agent has, as one tree: `~/memory/`, `~/tools/`, `~/triggers/`, and `~/self`. It is not a protocol [space](../protocol/spaces.md), which is all the documents of one account. <!-- id:rkg2yQnm -->
- [Log](./log.md): everything that happened in a session. It is a list of events that only grows, and each event has an actor: who did it. <!-- id:ZfSTqZSb -->
- [Runs](./runs.md): everything that executes. Each turn, child, and script is one saved row, in a tree that is also the queue of work. <!-- id:iJxFlTPw -->
- [session](./session.md): one conversation with an agent. It owns a log and moves forward in turns. It is not a browser sign-in session.
- [thread](./session.md): another word for a session. It is the word the model sees, as in the address `thread:<id>`. <!-- id:hecPc4kk -->
- [turn](./session.md#turns): one model run of a session, from a message or a wake to the reply. Each turn is a run of kind `agent`. <!-- id:lq1dZVzF -->
- [agent definition](./space.md#self): the stored settings of an agent (name, model, reasoning level, thoroughness, grants, MCP servers, signing keys). The agent reads it at `~/self`.
- [memory](./memory.md): an agent's own tree of files, at `~/memory/` in its Space. All the sessions of the agent share it.

# The verbs <!-- id:pLKGhf72 -->

The model starts with five verbs and two session verbs. Promotion can add tools the thread has used.

- [read](./read.md): one verb for every address, from memory files to [`hm://`](../protocol/urls.md) documents, web pages, the activity feed, and other threads. <!-- id:N0Br-NCA -->
- [write](./write.md): the mirror of read: memory, triggers, [IPFS](../protocol/files.md) uploads, and signed Hypermedia publishing under the publish grant. <!-- id:pafALDPR -->
- [call](./call.md): run a callable tool by name, or a tool resource by its hm:// URL. A wrong or missing input is answered with the tool's contract. <!-- id:dtjwuv7C -->
- [delegate](./delegate.md): start a child run, either a model child given a brief or a script child given source code. <!-- id:-Eilsft0 -->
- [plan](./plan.md): keep the thread's visible checklist. <!-- id:8V3lpFrX -->
- [`status`](./tools.md#status): a session verb. It sets the session's title and live description as they appear in session lists. See also [session](./session.md). <!-- id:JSUWF9TR -->
- [`continue_session`](./session-continuation.md): a session verb. It carries the conversation into a fresh successor session. <!-- id:lv_czFSi -->
- [verb](./tools.md): one of the tools the model is given directly: `read`, `write`, `call`, `delegate`, `plan`, `status` and `continue_session`. Everything else an agent does goes through one of them.

# Tools <!-- id:kzH8G9Dm -->

- [tool document](./tool-document.md): the content-addressed [DAG-CBOR](../protocol/blobs.md) record of one tool an agent holds, with its CID as its version. It is a builtin binding or an MCP projection. <!-- id:w3W8a1ON -->
- [tool](../tool.md): a document that holds one function, listed by an app or an agent and called by its hm:// URL. A tool an agent makes is this, not a tool document.
- [tool resource](./call.md#tool-resources): a tool someone wrote and published as a document of type `hm://hyper.media/tool` in an app or an agent, called by its hm:// URL. It is the same thing as the tool entry above, and not a tool document.
- [contract](./contract.md): everything the model is told about one tool: the description plus the input and output schemas. `read ~/tools/<name>` returns it. <!-- id:Ik7ZxEnK -->
- [Space index](./space-index.md): the short `<space>` text sent with every turn's input, with one line per tool, the top level of memory and the active triggers. <!-- id:lByOWtHk -->
- [promotion](./promotion.md): once a tool's contract has entered the transcript, the tool is offered to the model as a tool of its own for the rest of the thread. <!-- id:6WZZGldd -->
- [grants](./grants.md): the permissions of one agent: the callable set (`search`, `web_search`, `execute`, `browser`), the `publish` grant, and the enabled MCP servers. The verbs are never grants, and `query` and `attributes` are always on. <!-- id:E0X6U5sz -->
- [MCP server](./mcp.md): a remote Model Context Protocol server, connected per account and enabled per agent. Its tools appear as `<server>__<tool>` documents. <!-- id:ciW00Bil -->
- [write guide](./read.md#tool-contracts): the how-to text that `read ~/tools/write/<resource>` returns for one kind of write, such as memory, triggers, documents or comments.
- [touch-expand](./tools.md#touch-expand-and-promotion): what `call` does when the input is wrong or the tool is new to the thread. The tool's contract comes back in place of an error, so the next try succeeds. <!-- id:sSKqNZZ0 -->
- [callable](./callables.md): a tool that `call` runs, as opposed to a verb the model is given directly: `search`, `query`, `attributes`, `web_search`, `execute`, `browser`, or an MCP tool. <!-- id:OwZaNyRS -->
- [`search`](./callables.md#search): the callable that finds documents and contacts by text.
- [`query`](./callables.md#query): the callable that finds documents by their attributes. It is always on.
- [`attributes`](./callables.md#attributes): the callable that lists the attribute keys and values that documents use. It is always on.
- [the `browser` callable](./callables.md#browser): it reads and controls a website open in the owner's Seed desktop app.
- [`web_search`](./web-reading.md): the callable that searches the web.
- [`execute`](./code-execution.md): the callable that runs TypeScript, Python or shell code in a code sandbox.
- [code sandbox](./code-execution.md): the small virtual machine in which `execute` runs an agent's code. It is kept apart from the server and from other agents, and the agent's memory is its working directory.
- microVM: another word for the [code sandbox](./code-execution.md).
- sandbox: on the agent pages, the [code sandbox](./code-execution.md). A custom page runs in a different one, the [page sandbox](../build/page-sandbox.md).
- [running a tool yourself](./wrench-palette.md): a person runs `read`, `write`, and `call` from the **Run a tool** group of the composer's `/` menu. The results land on the log as user events, and the agent reads them. <!-- id:HoQrWl3R -->

# Delegation and orchestration <!-- id:S6WLWBmx -->

- [child](./child.md): a run started by delegate. A model child gets its own session. A script child runs in the QuickJS engine. <!-- id:pPaUo-gX -->
- [brief](./brief.md): the markdown description of a task that becomes a model child's first message word for word. <!-- id:Qen21b9Q -->
- [persona](./prompt.md#a-delegated-child): a role the parent model writes for a child, as the `systemPrompt` of a `delegate` call. It is added to the agent's own instructions unless `includeAgentSystemPrompt` is `false`.
- [typed result](./typed-result.md): a child started with an `output` schema must deliver its result through the `return_result` tool. <!-- id:THID80eE -->
- [typed child](./typed-result.md): a child that must return a typed result.
- [leaf run](./delegation-budgets.md#leaves): a run at the deepest level its tree allows. It cannot delegate, so it is not given `delegate`.
- [script](./script.md): a child that is code and not a model. It is a small JavaScript module, and everything it does goes through the `ctx` object. <!-- id:QxQG0zGR -->
- [ctx](./script.md#the-module-and-the-ctx-api): the one object a script reaches the outside world through: `ctx.call`, `ctx.delegate`, `ctx.parallel`, `ctx.step`, `ctx.plan`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.continueAsNew`.
- workflow: the name the code and the API use for a [script](./script.md) run. A run of kind `workflow` is a script run; see [Runs](./runs.md).
- [journal](./journal.md): the saved record of a script run's effects. When the run resumes, the script runs again against the journal, and effects that already finished are not repeated. <!-- id:Pi9NkRbM -->
- [journal entry](./journal.md): one record in a journal, a JSON value with a `kind` (`call`, `result`, `timer`, `fired`, `wait`, `event`, `now`, `log`, `step`, `plan`), the `callSeq` of the ctx call it belongs to, and a content `key` that replay matches on. <!-- id:q2_iCTWm -->
- [delegation budget](./delegation-budgets.md): how deep a tree of delegated runs may go and how many children each run may start.
- [thoroughness](./delegation-budgets.md): the `quick`, `normal`, or `deep` preset that sets a run tree's delegation budget. <!-- id:9LsIGwzZ -->
- [effect outbox](./effect-outbox.md): the record of every side effect a chat turn's tool call performs. A row is written before the effect and completed after it, so a call that runs again after a restart is answered from what happened and the effect is not repeated.
- [receipt](./effect-outbox.md): the completed row of the effect outbox for one call: what the tool returned, or the error it ended with.
- [run tree](./runs.md#the-run-tree): a root run and every run started under it, all sharing one `rootRunId`. It is what `ListRuns {rootRunId}` returns and what a `runs/<rootRunId>` subscription replays. <!-- id:vseyzZTk -->
- [root run](./runs.md#the-run-tree): the run a message or a firing started, at depth 0. Its children carry `parentRunId` and a greater `depth`. <!-- id:6IZ9sg9v -->
- [lease](./runs.md#the-dispatch-queue): an executor's 60-second claim on a run it is starting.
- [interactive queue](./runs.md#the-dispatch-queue): the queue for turns a person is watching. Its runs are claimed before background runs and get 1 attempt.
- [background queue](./runs.md#the-dispatch-queue): the queue for runs nobody is watching, such as a trigger's. A background agent run gets 3 attempts. See also the [run queue](../operate/run-queue.md) page.
- [park](./park.md): to pause a run so that it holds no resources while it waits for children, a timer, or an event. <!-- id:yYu22gIQ -->
- [wake source](./wake-source.md): whatever ends a park: children finishing, a timer, a signal (from a person or from a trigger's `wake`), or an activity event. <!-- id:3WjoeEZL -->
- [continueAsNew](./continue-as-new.md): a long-running script finishing into a fresh successor run with a clean journal. <!-- id:RIJrxpyc -->
- [obligation](./obligations.md): what a turn still owes when it tries to end: a typed result it has not returned, or unfinished plan steps. What is left when the run ends is reported as `unmetObligations`. <!-- id:XeXutUqR -->
- [obligation reminder](./prompt.md#messages-the-server-writes): the message the server writes when a turn tries to end with an open obligation. It lists everything the turn still owes.

# Plans <!-- id:V1BJjrpz -->

- [step](./step.md): one checklist item with a stable `id` and a human `label`. <!-- id:thSmaMxP -->
- [attachment](./attachment.md): the link between a child and a plan step: a child started while a step is running belongs to that step. It is not a file: for that, see session attachment below. <!-- id:Fx6BNXMq -->
- [batch step](./batch-step.md): one running step that owns a whole parallel batch of children. <!-- id:Kj7029-5 -->

# Sessions and the shared log <!-- id:TDeu0X7Q -->

- [actor](./actor.md): who did it: `user`, `agent` or `system`. Every event has one. The server writes only `user` and `system` on an event; `agent` follows from the event's shape. The type also has `trigger`, which is never written. <!-- id:C05dWJaO -->
- [session attachment](./session.md#what-a-session-is-made-of): a file a person dropped into the composer. It is private to the session, read with `read attachment:<id>`, and deleted with the session. It is not the plan term above.
- [session continuation](./session-continuation.md): carrying a conversation into a fresh successor session with a structured handoff. The old history is not shortened. Two other things are also called a continuation: what a trigger's firing does (under Triggers), and the server handing a turn back because of an open obligation. <!-- id:Jiai9ykh -->
- [successor session](./session-continuation.md): the new session that a session continuation creates.
- [predecessor session](./session-continuation.md): the old session that a session continuation leaves. It keeps its whole transcript.
- [handoff](./session-continuation.md#the-verb): the notes an agent writes for the successor session when it calls `continue_session`.
- [projection](./session-continuation.md#vocabulary): the first thing the successor's model reads after a session continuation: the handoff, the exact message that started the move, and exact excerpts.
- [continuation manifest](./session-continuation.md#vocabulary): the record of what a projection was built from, stored with the link between the two sessions.
- [durable store](./durable-sessions.md): the copy of a session's conversation in the exact form the model reads it. The log is the record; the store is the model's view.
- [Pi Durable](./durable-sessions.md): the library that runs the model loop and saves every step of it. These pages also call it the harness.
- [placeholder](./durable-sessions.md#when-a-turn-ends-early): the short text that answers a `delegate` call while its child is still running. The real result later takes its place.
- [per-turn block](./prompt.md#per-turn-blocks): a short piece of tagged text, such as `<space>` or `<plan_state>`, that the server builds when a turn starts and never stores. It is not a [block](../protocol/blocks.md) of a document.
- [system prompt](./prompt.md#the-system-prompt): the fixed instructions at the start of every request to the model. The server builds it from the agent's instructions and from notes about the agent.
- [Agent Guide](./guide.md): the default system prompt of a Seed agent. It tells the agent how Hypermedia content works and how to import and publish well.
- [stand-in](./prompt.md#per-turn-blocks): a short text the server uses as a turn's input when nobody said anything new: `<background_work_update>` or `<turn_resumed>`.
- [window context](./assistant.md#window-context): what is on the person's screen, sent by the assistant panel with each message.
- [session browser](../build/signed-api-sessions.md#session-browser): a visible browser window the Seed app lends to one agent session.

# Triggers <!-- id:Cv20mJqD -->

- [trigger](../trigger.md): a standing rule that binds a source to what a firing does. The nine sources are `document-comment`, `user-mention`, `comment-reply`, `document-author-comment`, `site-update`, `activity` (a list of those as conditions), `schedule`, `webhook` and `run-completed`; see [triggers](./triggers.md). <!-- id:Y2MmLcGs -->
- [trigger source](./triggers.md#sources): the part of a trigger that says when it fires.
- [trigger stored on the server](../trigger.md#triggers-kept-only-on-the-server): a trigger that is only a row on an agent's server, at `~/triggers/<name>`, with no document. An app has none.
- [firing](./firing.md): one time a trigger fires. Each event fires a trigger exactly once, and chains of run-completed firings stop at eight hops. <!-- id:ixEodPl5 -->
- [continuation of a trigger](./triggers.md#continuations): the part of a trigger that says what a firing does: start a new thread (`newThread`), wake a parked run (`wake`), or run a `tool` or a `script` with no model. Do not confuse it with [session continuation](./session-continuation.md), which carries a conversation into a successor session. <!-- id:fdvIUBGI -->
- [webhook](./webhooks.md): a trigger source that fires when something POSTs JSON to the trigger's delivery URL.
- [condition](./triggers.md#sources): one alternative inside an `activity` trigger, `{id, source}`. The trigger fires once when any condition matches, and the firing records `matchedConditions`. <!-- id:ErE_yblL -->
- [claim](./firing.md): the `trigger_event_claims` row inserted for `(account, trigger, firing key)` before an activity firing is created. It is what makes a firing happen exactly once. <!-- id:Z-spRZex -->
- [firing key](./firing.md): the key a feed event is deduplicated on, `blob-<cid>` of the comment version, which a comment and its citation twin share (`activityFiringKey`). The raw event key (`activityEventKey`) differs for each of them. <!-- id:VxejOIOt -->
- [activity monitor](./triggers.md#the-monitors): the server's loop that polls the Hypermedia activity feed and matches events against triggers and waiting runs. <!-- id:r06uh5ey -->

# Identity, access and the control plane <!-- id:rFeEtwox -->

- [signed action](../build/signed-api.md): one request to an app environment: an action such as `CreateSession`, packed as DAG-CBOR in an envelope and signed.
- [signed envelope](../build/signed-api.md#signed-envelope): the DAG-CBOR wrapper around every action, signed by the [account key](../build/keys.md) or a key the account authorized. It is not the envelope of a signed [blob](../protocol/blobs.md). <!-- id:fbaNIuz4 -->
- [signing identity](./identity.md): one of the agent's own Ed25519 account keys. The app environment creates it and stores it encrypted, and the agent signs its Hypermedia writes with it. <!-- id:bUGOLQpg -->
- [primary signing account](./identity.md#granted-identities-and-the-primary-account): the signing identity the agent is by default. The agent signs as it unless asked otherwise, and mentions of it reach the agent.
- [subscription](../build/websocket-subscriptions.md): a signed `Subscribe` action over the WebSocket that streams account, agent, session, or run changes. It is not a network subscription. <!-- id:3jgvKjkR -->
- [collaborator](./sharing.md): a Seed account invited to an agent as `reader` or `writer`. It is not a collaborator on a space, who holds a capability. <!-- id:If4Yghpa -->
- [chatter](./sharing.md#public-access): a signed account that is not a collaborator and may read and talk to an agent, because the owner turned public chat on.
- [access level](./sharing.md#access-levels): what a signer may do on an agent: reader, chat, writer or owner. Each action of the signed API needs one.
- [pending invitation](./sharing.md#roles): an invitation to an agent that the invited account has not accepted. The account sees only the invitation.
- [mount document](./mounting.md): the document that makes an agent part of a space. It names the agent's server, carries its name, and holds its instructions. New ones have the type `hm://hyper.media/agent`.
- [mounted agent](./mounting.md): an agent that has a mount document.
- [orphan agent](./mounting.md#adopting-and-orphaning): an agent that lives in no space. Its owner can adopt it into one.
- [adopt an agent](./mounting.md#adopting-and-orphaning): give an orphan agent a document in a space. The code and the API call this "mount" (`MountAgent`).
- [write scope](./mounting.md#what-the-agent-can-write): where a mounted agent's key may publish in the space of its document: its own document, the whole space, or nothing.
- [model provider](./model-providers.md): the record that tells a server how to reach a language-model service for an account.
- [Sign in with ChatGPT](./chatgpt-sign-in.md): a way for an OpenAI model provider to use a person's ChatGPT plan in place of an API key.
- [reasoning level](./reasoning-levels.md): how much a model thinks before it answers, from `minimal` to `max`.
- [Assistant](./assistant.md): the built-in agent the desktop app creates on its local server.

# See also <!-- id:deUgW0Lw -->

- [Seed Agents](../agent.md) <!-- id:JAolMGhJ -->
- [Tools](./tools.md) <!-- id:hfEF3zTk -->
- [How agents work](./how-it-works.md) <!-- id:1smxPF3T -->
- [Triggers](./triggers.md) <!-- id:BHiqvq9G -->
- [Signed API](../build/signed-api.md) <!-- id:DwyZLihg -->
- [Security](./security.md) <!-- id:wVUY3qvB -->
- [Site-wide glossary](../glossary.md) <!-- id:fsAuMffS -->
