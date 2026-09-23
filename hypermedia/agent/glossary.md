---
name: Agents Glossary
summary: Every Seed Agents term in one or two sentences, each linking to the page that defines it, grouped by the part of the runtime it belongs to.
---
The words the [Seed Agents](../agent.md) pages use, one line each, linked to the page that defines the term. The three nouns and the verbs come first, because every other term builds on them. Protocol terms such as [account](../protocol/identity.md), [capability](../protocol/permissions.md), and [comment](../protocol/comments.md) are in the site-wide [glossary](../glossary.md). <!-- id:J5uWk8bq -->

# The three nouns <!-- id:hrvM4X14 -->

- [Space](./space.md): everything an agent has, as one addressable tree: `~/memory/`, `~/tools/`, `~/triggers/`, and `~/self`. <!-- id:rkg2yQnm -->
- [Log](./log.md): everything that happened in a thread, an append-only sequence of events each stamped with an actor. <!-- id:ZfSTqZSb -->
- [Runs](./runs.md): everything that executes, one durable row per turn, child, and script, in a tree that doubles as the dispatch queue. <!-- id:iJxFlTPw -->

# The verbs <!-- id:pLKGhf72 -->

- [read](./read.md): one verb for every address, from memory files to [`hm://`](../protocol/urls.md) documents, web pages, the activity feed, and other threads. <!-- id:N0Br-NCA -->
- [write](./write.md): the mirror of read: memory, authored tools, triggers, [IPFS](../protocol/files.md) uploads, and signed Hypermedia publishing under the publish grant. <!-- id:pafALDPR -->
- [call](./call.md): invoke a callable tool by name; a wrong or missing input answers with the tool's contract. <!-- id:dtjwuv7C -->
- [delegate](./delegate.md): spawn a child run, either a model child given a brief or a script child given source. <!-- id:-Eilsft0 -->
- [plan](./plan.md): maintain the thread's visible checklist. <!-- id:8V3lpFrX -->
- status: set the session's title and live description as they appear in session lists; see [tools](./tools.md). <!-- id:JSUWF9TR -->
- continue_session: carry the conversation into a fresh successor session; see [session continuation](./session-continuation.md)._ <!-- id:lv_czFSi -->

# Tools <!-- id:kzH8G9Dm -->

- [tool document](./tool-document.md): every tool is a content-addressed [DAG-CBOR](../protocol/blobs.md) document whose CID is its version: a builtin binding, an authored lambda, or an MCP projection. <!-- id:w3W8a1ON -->
- [contract](./contract.md): a tool's full model-facing spec, description plus input and output schemas, returned by `read ~/tools/<name>`. <!-- id:Ik7ZxEnK -->
- [Space index](./space-index.md): the compact `<space>` block in every system prompt, one line per tool plus the memory top level and active triggers. <!-- id:lByOWtHk -->
- [promotion](./promotion.md): once a tool's contract has entered the transcript, the tool becomes a provider tool for the rest of the thread. <!-- id:6WZZGldd -->
- [grants](./grants.md): the per-agent permissions: the callable set, the `publish` grant, and the enabled MCP servers; the verbs are never grants. <!-- id:E0X6U5sz -->
- [MCP server](./mcp.md): a remote Model Context Protocol server connected per account and enabled per agent, whose tools appear as `<server>__<tool>` documents. <!-- id:ciW00Bil -->
- touch-expand: what `call` does on a miss. The tool's contract comes back in place of an error, so the retry succeeds. Defined on [tools](./tools.md). <!-- id:sSKqNZZ0 -->
- callable: a tool dispatched through `call`, as opposed to a tool handed to the model directly: `search`, `query`, `attributes`, `web_search`, `navigate`, `execute`, an authored lambda, or an MCP tool; see [tools](./tools.md). <!-- id:OwZaNyRS -->

# Delegation and orchestration <!-- id:S6WLWBmx -->

- [child](./child.md): a run spawned by delegate; a model child gets its own session, a script child runs in the QuickJS engine. <!-- id:pPaUo-gX -->
- [brief](./brief.md): the markdown task briefing that becomes a model child's first message word for word. <!-- id:Qen21b9Q -->
- [typed result](./typed-result.md): a child spawned with an `output` schema must deliver its result through the `return_result` tool. <!-- id:THID80eE -->
- [script and ctx](./script.md): a script child's world: `ctx.call`, `ctx.delegate`, `ctx.parallel`, `ctx.step`, `ctx.plan`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.continueAsNew`. <!-- id:QxQG0zGR -->
- [journal](./journal.md): a script run's durable effect record; resume replays the source against it and completed effects never re-execute. <!-- id:Pi9NkRbM -->
- [park and wait](./park.md): a run pausing without holding resources, for children, a timer, an event, or a budget pause. <!-- id:yYu22gIQ -->
- [wake source](./wake-source.md): whatever ends a park: children finishing, a timer, a signal, an activity event, or a person resuming. <!-- id:3WjoeEZL -->
- [continueAsNew](./continue-as-new.md): a long-running script finishing into a fresh successor run with a clean journal. <!-- id:RIJrxpyc -->
- thoroughness: the `quick`, `normal`, or `deep` preset that sets a run tree's depth and fan-out budget; see [tools](./tools.md) and the [delegation budgets](./plans/delegation-budgets.md) proposal. <!-- id:9LsIGwzZ -->
- obligation: what a run owes when it ends, an undelivered typed result or unfinished plan steps, reported as `unmetObligations` and never silently written off; see [persistence](./persistence.md). <!-- id:XeXutUqR -->

# Plans <!-- id:V1BJjrpz -->

- [step](./step.md): one checklist item with a stable `id` and a human `label`. <!-- id:thSmaMxP -->
- [attachment](./attachment.md): a child spawned while a step is running belongs to that step. <!-- id:Fx6BNXMq -->
- [batch step](./batch-step.md): one running step owning a whole parallel batch of children. <!-- id:Kj7029-5 -->

# The symmetric log <!-- id:TDeu0X7Q -->

- [actor](./actor.md): who did it: `user`, `agent`, `system`, or `trigger`; every event carries one. <!-- id:C05dWJaO -->
- [wrench palette](./wrench-palette.md): the tool button in the composer that lets a person run `read`, `write`, and `call` themselves, with results landing on the log as user events. <!-- id:HoQrWl3R -->
- [session continuation](./session-continuation.md): carrying a conversation into a fresh successor session with a structured handoff. The old history is not compacted. <!-- id:Jiai9ykh -->

# Triggers <!-- id:Cv20mJqD -->

- [trigger](./trigger.md): standing configuration binding a source (schedule, comment, mention, [site](../protocol/sites.md) update, webhook, run completed) to a continuation. <!-- id:Y2MmLcGs -->
- [firing](./firing.md): one trigger activation, deduplicated exactly once, with run-completed chains loop-guarded at eight hops. <!-- id:ixEodPl5 -->
- continuation: what a firing does: start a new thread, wake a parked run, or run a tool or script with no model; see [triggers](./triggers.md). <!-- id:fdvIUBGI -->
- activity monitor: the server's poll loop over the Hypermedia activity feed that matches events against triggers and waiting runs; see [triggers](./triggers.md). <!-- id:r06uh5ey -->

# Control plane <!-- id:rFeEtwox -->

- signed envelope: the DAG-CBOR wrapper around every action, signed by the [account key](../build/keys.md) or a delegated key; see the [signed API](./signed-api.md). <!-- id:fbaNIuz4 -->
- signing identity: the agent's own Ed25519 account key, created on the agents server and given a [capability](../protocol/permissions.md) by the owner's account, which the agent signs its Hypermedia writes with; see [tools](./tools.md) and [security](./security.md). <!-- id:bUGOLQpg -->
- subscription: a signed `Subscribe` action over the WebSocket that streams account, agent, session, or run changes; see [WebSocket subscriptions](./websocket-subscriptions.md). <!-- id:3jgvKjkR -->
- collaborator: a Seed account invited to an agent as `reader` or `writer`; `publicRead` and `publicChat` open an agent to any signed account; see the [signed API](./signed-api.md). <!-- id:If4Yghpa -->

# See also <!-- id:deUgW0Lw -->

- [Seed Agents](../agent.md) <!-- id:JAolMGhJ -->
- [Tools](./tools.md) <!-- id:hfEF3zTk -->
- [System overview](./system-overview.md) <!-- id:1smxPF3T -->
- [Triggers](./triggers.md) <!-- id:BHiqvq9G -->
- [Signed API](./signed-api.md) <!-- id:DwyZLihg -->
- [Security](./security.md) <!-- id:wVUY3qvB -->
- [Site-wide glossary](../glossary.md) <!-- id:fsAuMffS -->
