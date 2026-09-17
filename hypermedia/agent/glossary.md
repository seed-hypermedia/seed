---
name: Agents Glossary
summary: Every Seed Agents term in one or two sentences, each linking to the page that defines it, grouped by the part of the runtime it belongs to.
---
The words the Seed Agents pages use, one line each, linking to the page where the term is defined. The three nouns and the verbs come first because every other term is built on them. Protocol terms such as account, capability, and comment are in the site-wide [glossary](../glossary.md).

# The three nouns

- [Space](./space.md): everything an agent has, as one addressable tree: `~/memory/`, `~/tools/`, `~/triggers/`, and `~/self`.
- [Log](./log.md): everything that happened in a thread, an append-only sequence of events each stamped with an actor.
- [Runs](./runs.md): everything that executes, one durable row per turn, child, and script, in a tree that doubles as the dispatch queue.

# The verbs

- [read](./read.md): one verb over every address, from memory files to `hm://` documents, web pages, the activity feed, and other threads.
- [write](./write.md): the mirror of read: memory, authored tools, triggers, IPFS uploads, and signed Hypermedia publishing under the publish grant.
- [call](./call.md): invoke a callable tool by name; a wrong or missing input answers with the tool's contract.
- [delegate](./delegate.md): spawn a child run, either a model child given a brief or a script child given source.
- [plan](./plan.md): maintain the thread's visible checklist.
- status: set the session's title and live description as they appear in session lists; see [tools](./tools.md).
- continue_session: carry the conversation into a fresh successor session; see [session continuation](./session-continuation.md).

# Tools

- [tool document](./tool-document.md): every tool is a content-addressed DAG-CBOR document whose CID is its version: a builtin binding, an authored lambda, or an MCP projection.
- [contract](./contract.md): a tool's full model-facing spec, description plus input and output schemas, returned by `read ~/tools/<name>`.
- [Space index](./space-index.md): the compact `<space>` block in every system prompt, one line per tool plus the memory top level and active triggers.
- [promotion](./promotion.md): once a tool's contract has entered the transcript, the tool becomes a first-class provider tool for the rest of the thread.
- [grants](./grants.md): the per-agent permissions: the callable set, the `publish` grant, and the enabled MCP servers; the verbs are never grants.
- [MCP server](./mcp.md): a remote Model Context Protocol server connected per account and enabled per agent, whose tools appear as `<server>__<tool>` documents.
- touch-expand: the behaviour of `call` on a miss: instead of an error, the tool's contract comes back so the retry succeeds; defined on [tools](./tools.md).
- callable: a tool dispatched through `call` rather than handed to the model directly: `search`, `query`, `attributes`, `web_search`, `navigate`, `execute`, an authored lambda, or an MCP tool; see [tools](./tools.md).

# Delegation and orchestration

- [child](./child.md): a run spawned by delegate; a model child gets its own session, a script child runs in the QuickJS engine.
- [brief](./brief.md): the markdown task briefing that becomes a model child's first message verbatim.
- [typed result](./typed-result.md): a child spawned with an `output` schema must deliver its result through the `return_result` tool.
- [script and ctx](./script.md): a script child's world: `ctx.call`, `ctx.delegate`, `ctx.parallel`, `ctx.step`, `ctx.plan`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.continueAsNew`.
- [journal](./journal.md): a script run's durable effect record; resume replays the source against it and completed effects never re-execute.
- [park and wait](./park.md): a run pausing without holding resources, for children, a timer, an event, or a budget pause.
- [wake source](./wake-source.md): whatever ends a park: children finishing, a timer, a signal, an activity event, or a person resuming.
- [continueAsNew](./continue-as-new.md): a long-running script finishing into a fresh successor run with a clean journal.
- thoroughness: the `quick`, `normal`, or `deep` preset that sets a run tree's depth and fan-out budget; see [tools](./tools.md) and the [delegation budgets](./plans/delegation-budgets.md) proposal.
- obligation: what a run owes when it ends, an undelivered typed result or unfinished plan steps, reported as `unmetObligations` rather than silently written off; see [persistence](./persistence.md).

# Plans

- [step](./step.md): one checklist item with a stable `id` and a human `label`.
- [attachment](./attachment.md): a child spawned while a step is running belongs to that step.
- [batch step](./batch-step.md): one running step owning a whole parallel batch of children.

# The symmetric log

- [actor](./actor.md): who did it: `user`, `agent`, `system`, or `trigger`; every event carries one.
- [wrench palette](./wrench-palette.md): the tool button in the composer that lets a person run `read`, `write`, and `call` themselves, with results landing on the log as user events.
- [session continuation](./session-continuation.md): carrying a conversation into a fresh successor session with a structured handoff instead of compacting its history.

# Triggers

- [trigger](./trigger.md): standing configuration binding a source (schedule, comment, mention, site update, webhook, run completed) to a continuation.
- [firing](./firing.md): one trigger activation, deduplicated exactly once, with run-completed chains loop-guarded at eight hops.
- continuation: what a firing does: start a new thread, wake a parked run, or run a tool or script with no model; see [triggers](./triggers.md).
- activity monitor: the server's poll loop over the Hypermedia activity feed that matches events against triggers and waiting runs; see [triggers](./triggers.md).

# Control plane

- signed envelope: the DAG-CBOR wrapper around every action, signed by the account key or a delegated key; see the [signed API](./signed-api.md).
- signing identity: the agent's own Ed25519 account key, created on the agents server and delegated to by the owner's account, which the agent signs its Hypermedia writes with; see [tools](./tools.md) and [security](./security.md).
- subscription: a signed `Subscribe` action over the WebSocket that streams account, agent, session, or run changes; see [WebSocket subscriptions](./websocket-subscriptions.md).
- collaborator: a Seed account invited to an agent as `reader` or `writer`; `publicRead` and `publicChat` open an agent to any signed account; see the [signed API](./signed-api.md).
