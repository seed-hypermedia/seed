---
name: Trigger
summary: A trigger is a document typed hm://hyper.media/trigger, under an app or an agent, that says when to act and what to do, and the server that runs its host fires it.
---
A **trigger** is a rule that makes something happen when nobody asks for it. For example, a trigger can call a `fetch-news` tool every hour, or start a session with an agent each time someone mentions it in a [comment](./protocol/comments.md).

A trigger can fire on a schedule, when a comment or a mention appears, when a [webhook](./agent/webhooks.md) is delivered, or when a run finishes. It is a [document](./protocol/documents.md) whose [metadata](./metadata.md) declares `type: hm://hyper.media/trigger`. Like a [tool](./tool.md), it lives directly under an [app](./app.md) or an [agent](./agent.md), called its host. The host lists the trigger with a [card embed](./block/embed-view.md).

This page says what a trigger is and how the document relates to the server that fires it. An agent can also keep triggers that are not documents. They follow different rules, and the last section covers them. The exact shapes are in the [trigger reference](./agent/triggers.md).

# What a trigger is made of

| Attribute | Value |
| --- | --- |
| `type` | `hm://hyper.media/trigger` |
| `name` | the trigger's name |
| `summary` | what it is for |
| `source` | when it fires: activity conditions, a schedule, a webhook, or a run finishing, stored as nested attributes. See [sources](./agent/triggers.md) |
| `tool` | optionally the [hm:// URL](./protocol/urls.md) of one of its host's tools to call |
| `input` | optionally the input template for that tool, as nested attributes |
| `enabled` | `false` turns it off |
| `onFailure` | `session`: when an agent's tool trigger's call fails, start a session with the agent (see below) |
| `session` | for an agent's session trigger: `{systemPrompt?, includeAgentSystemPrompt?, tools?: {<tool>: true}}`, the session's own instructions and a narrower tool list |

The document's body is used too. For a trigger that starts an agent [session](./agent/session.md), the body is the session's first message. For an agent's tool trigger with `onFailure: session`, it is the message of the session that a failed call starts.

# What it does when it fires

Each time a trigger goes off is a [firing](./agent/firing.md). A firing does one of two things.

**Call a tool** of its host:

- `input` is a template. The server replaces the string values `"$event"` and `"$event.<path>"` with data from the event. A webhook's posted JSON is `"$event.payload"`.
- Without `input`, the tool gets the whole event.
- An app's trigger must call a tool.
- The server records the call like any other run of the tool, as made by the trigger's **author**. The author is the [account](./protocol/identity.md) that signed the trigger's latest version. The [space](./protocol/spaces.md) accepted that version, so the author is a writer of the host.
- The host's writers can read the call record, as for any call. See [tool](./tool.md).
- On an agent's trigger, `onFailure: session` starts a session with the agent when the call fails: the trigger's body is its message, with the failure attached, so the agent can find out what went wrong. An app has no agent, so an app's trigger cannot ask for one.
- A tool under an agent can also start the agent itself, when its code finds work (`ctx.agent.start`, see [tool](./tool.md#starting-the-agent)). A scheduled trigger that calls such a tool wakes the model only when there is something to do.

**Start a session** with an agent. Only an agent's trigger can do this. Leave out `tool`, and the trigger's body is the session's first message. `session` gives those sessions their own instructions (`systemPrompt`, added to the agent's own unless `includeAgentSystemPrompt` is `false`) and a narrower list of the agent's tools.

A trigger can only call a tool of its own host.

# The document and the server

The document is the trigger. The server that runs the trigger's host fires it. That server is the [app environment](./software/app-environment.md):

- An app's triggers fire while the app runs on its server.
- An agent's triggers fire while the agent is mounted on its server.

The server reads its hosts' trigger documents every minute. It also reads them at once when a client asks for a host's triggers, or when an agent on that server writes one.

For each document the server keeps one row in its trigger table. The row holds the source, the action and the document version it was read from. The server matches sources and records firings against that row. An app's trigger rows are kept under the account that ran the app.

The row is a copy that the server needs in order to work. You never edit a trigger there:

- To change a trigger, publish a new version of its document. The server's own trigger actions refuse a trigger that is a document, and name the document instead.
- A trigger stops firing when its card leaves its host or its document is deleted. This takes about a minute. If the trigger changed in the last 10 minutes, it can take up to 10 minutes. A delete that an agent on that server makes with its `write` verb stops the trigger at once.
- When an app stops, its triggers stop with it.
- An edit that makes a trigger invalid stops it, so an old version never keeps firing. The server reports the trigger with the reason.
- The server holds what must not be public: a webhook trigger's secret, and the history of firings.

`ListHostTriggers {hostId}` returns a host's triggers as its server holds them. Each one comes with its recent firings. The answer also lists the triggers the server could not use, with the reason. A writer of the host's space also gets each webhook trigger's secret. A firing of an app's trigger names the tool call it made. [The signed API for triggers](./build/signed-api-triggers.md) has the shapes.

# Triggers kept only on the server

An agent can also hold triggers that exist only as rows on its server, with no document. These pages call them triggers stored on the server. An app has none.

Such a trigger joins a **source** (what happens) to a **continuation** (what to do). It can do things a trigger document cannot: run a workflow [script](./agent/script.md), wake a [parked](./agent/park.md) run, call a builtin or MCP tool, or start a session with its own system prompt. The [trigger reference](./agent/triggers.md) lists every source and continuation. These triggers live at `~/triggers/<name>` in the agent's [Space](./agent/space.md), and the agent creates, edits, enables, and disables its own triggers there. <!-- id:hNo-TMWM -->

A trigger document can express two actions: call a tool of the host, and start a plain session. So the two forms relate like this:

- If a document can express a stored trigger, the server publishes it as a trigger document under the agent's document. The agent's primary account signs it. This needs the agent to have write access there, which you give from the agent's People tab. Until then the server keeps trying. The trigger keeps its id, webhook URL, firings and claims.
- If a document cannot express a trigger's action, the trigger stays on the server only. That is a workflow script, a wake, a call to a builtin or MCP tool, or a session with its own system prompt or narrowed tools.
- `~/triggers/` lists all of an agent's triggers, of both forms. It names the document of each trigger that has one.

Some rules differ between the two forms:

| Rule | Trigger document | Trigger stored on the server |
| --- | --- | --- |
| How you edit it | publish a new version of the document | write `~/triggers/<name>`, or use the [signed API](./build/signed-api.md) |
| Change to or from a webhook source | allowed; the server makes a new secret each time the source becomes a webhook | refused; make a new trigger |
| What happens when a tool call fails | the firing is recorded as failed | `onFailure` can start a session instead |

# See also

- [Trigger reference](./agent/triggers.md) for sources, continuations, the stored form, monitors and the actions that edit triggers.
- [Firing](./agent/firing.md) for how an activation is recorded exactly once.
- [Webhooks](./agent/webhooks.md) for delivering events from outside.
- [Building an app](./build/building-an-app.md) for making a trigger in the [desktop app](./software/desktop.md) or as an agent.
- [App](./app.md), [Tool](./tool.md) and [Agent](./agent.md).
- [Security](./agent/security.md) for what agent-managed triggers mean for the threat model.
