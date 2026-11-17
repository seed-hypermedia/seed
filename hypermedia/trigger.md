---
name: Trigger
summary: A trigger is a document typed hm://hyper.media/trigger under an app or an agent that says when it fires and what it does, and the server that runs its host fires it.
---
A **trigger** makes something happen when nobody asked for it: on a schedule, when a comment or a mention appears, when a webhook is delivered, or when a run finishes. It is a [document](./protocol/documents.md) whose [metadata](./metadata.md) declares `type: hm://hyper.media/trigger`. Like a [tool](./tool.md), it lives directly under an [app](./app.md) or an [agent](./agent.md), and its host lists it with a card embed. This page says what a trigger is and how the document relates to the server that fires it. The exact shapes are in the [trigger reference](./agent/triggers.md).

# What a trigger is made of

| Attribute | Value |
| --- | --- |
| `type` | `hm://hyper.media/trigger` |
| `name` | the trigger's name |
| `summary` | what it is for |
| `source` | when it fires: activity conditions, a schedule, a webhook, or a run finishing, stored as nested attributes. See [sources](./agent/triggers.md) |
| `tool` | optionally the hm:// URL of one of its host's tools to call |
| `input` | optionally the input template for that tool, as nested attributes |
| `enabled` | `false` turns it off |

The document's body is used too: for a trigger that starts an agent session, the body is the session's first message.

# What it does when it fires

One activation of a trigger is a [firing](./agent/firing.md). A firing does one of two things:

- **Call a tool** of its host, with `input` as a template: string values `"$event"` and `"$event.<path>"` are replaced from the event (a webhook's posted JSON is `"$event.payload"`). Without `input`, the tool gets the event. An app's trigger must call a tool. The call is recorded like any other run of the tool, as made by the trigger's **author**: the account that signed the trigger's latest version, which its space accepted, so a writer of the app.
- **Start a session** with an agent (an agent's trigger only): leave out `tool`, and the trigger's body is the session's first message.

A trigger can only call a tool of its own host.

# The document and the server

The document is the trigger. The server that runs the trigger's host fires it: an app's triggers while the app runs on its server, an agent's while the agent is mounted on its server. Both are the [app environment](./software/app-environment.md).

That server reads its hosts' trigger documents every minute, and at once when a client asks for a host's triggers or an agent on it writes one. For each document it keeps one row in its trigger table, with the source, the action and the document version it was read from. Sources are matched and firings are recorded against that row. The row is a copy the server needs in order to work. It is never the place a trigger is edited:

- Changing a trigger means publishing a new version of its document. The server's own trigger actions refuse a trigger that is a document and name the document instead.
- A trigger whose card leaves its host, or whose document is deleted, stops firing. When an app stops, its triggers stop with it.
- An edit that makes a trigger invalid stops it, so an old version never keeps firing. The server reports the trigger with the reason.
- The server holds what must not be public: a webhook trigger's secret, and the history of firings.

`ListHostTriggers {hostId}` returns a host's triggers as its server holds them, each with its recent firings, and the triggers it could not use with the reason. A writer of the host's space also gets each webhook trigger's secret. A firing of an app's trigger names the tool call it made.

# Triggers kept only on the server

An agent can also hold triggers that exist only as rows on its server, with no document.

Such a trigger is standing configuration that binds a **source** to a **continuation**. The source is a [comment](./protocol/comments.md), a mention, a reply, a comment on a document the account wrote, a [site](./protocol/sites.md) update, an **activity** list of any of those as alternative conditions, a schedule, a webhook, or **run-completed**. The continuation is a new thread, a **wake** of a [parked](./agent/park.md) run, or a headless **tool** or **script** run. See [triggers](./agent/triggers.md). These triggers live at `~/triggers/<name>` in the [Space](./agent/space.md), and the agent creates, edits, enables, and disables its own triggers there. <!-- id:hNo-TMWM -->

A document can express two of those: calling a tool of the host, and starting a plain session. So the two forms relate like this:

- A server-only trigger that a document can express is published as a trigger document under its agent's document, signed by the agent's primary account, once the agent can write there (see the agent's People tab). The trigger keeps its id, webhook URL, firings and claims. Until then the server keeps trying.
- A trigger whose action a document cannot express stays on the server only: a workflow script, a wake, a call to a builtin or MCP tool, or a session with its own system prompt or narrowed tools.
- `~/triggers/` lists all of an agent's triggers, of both forms, and names the document of each one that has one.

An app has no server-only triggers.

# See also

- [Trigger reference](./agent/triggers.md) for sources, continuations, the stored form, monitors and the actions that edit triggers.
- [Firing](./agent/firing.md) for how an activation is recorded exactly once.
- [Webhooks](./agent/webhooks.md) for delivering events from outside.
- [Building an app](./build/building-an-app.md) for making a trigger in the desktop app or as an agent.
- [App](./app.md), [Tool](./tool.md) and [Agent](./agent.md).
- [Security](./agent/security.md) for what agent-managed triggers mean for the threat model.
