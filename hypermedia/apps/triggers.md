---
name: Triggers
summary: A trigger is a document typed hm://hyper.media/trigger under an app or an agent, listed by a card embed like a tool. It says when it fires and what it does, and the server that runs its host fires it.
---
A **trigger** is a [document](../protocol/documents.md) whose [metadata](../metadata.md) declares `type: hm://hyper.media/trigger`. Like a [tool](./apps-and-tools.md), it lives directly under an **app** or an **agent** and its host lists it with a card embed. Apps and agents get triggers the same way, from the same code, because the two are converging into one concept.

Its metadata says when it fires and what it does:

| Attribute | Value |
| --- | --- |
| `name` | the trigger's name |
| `summary` | what it is for |
| `source` | `ipfs://<cid>` of a DAG-CBOR trigger source: activity conditions, a schedule, a webhook, or a run finishing. See [triggers](../app-environment/triggers.md) for the shapes |
| `tool` | optionally the hm:// URL of one of its host's tools to call |
| `input` | optionally `ipfs://<cid>` of a DAG-CBOR input template for that tool |
| `enabled` | `false` turns it off |

When it fires it does one of two things:

- **Call a tool** of its host, with `input` as a template: string values `"$event"` and `"$event.<path>"` are replaced from the event (a webhook's posted JSON is `"$event.payload"`). Without `input`, the tool gets the event. An app's trigger must call a tool. The call is recorded like any other run of the tool, as made by the trigger's **author**: the account that signed the trigger's latest version, which its space accepted, so a writer of the app.
- **Start a session** with an agent (an agent's trigger only): leave out `tool`, and the trigger's body is the session's first message.

# Where triggers fire

The server that runs a trigger's host fires it: an app's triggers while the app runs on its server (see [apps and tools](./apps-and-tools.md)), an agent's while the agent is mounted on its server. That server reads its hosts' trigger documents every minute, and at once when the desktop app asks for a host's triggers after saving one, and keeps them in the same trigger engine every source and firing already ran on. A trigger whose card leaves its host stops firing. When an app stops, its triggers stop with it.

The server never edits a trigger: the document is the trigger. Changing one means publishing a new version of it. The server's own trigger actions refuse document triggers and name the document instead.

`ListHostTriggers {hostId}` returns a host's triggers as its server holds them, each with its recent firings, and the triggers it could not use with the reason. A writer of the host's space also gets each webhook trigger's secret. A firing of an app's trigger names the tool call it made.

# Triggers stored on the server

Agents had triggers before triggers were documents, stored only on their server. Each one is published as a trigger document under its agent's document, signed by the agent's primary account, once the agent can write there (see the agent's People tab). The trigger keeps its id, webhook URL, firings and claims. A trigger whose action has no document form yet (a workflow script, a wake, a built-in tool) stays stored on the server for now.

# In the desktop app

Apps get a **Triggers** tab beside Tools and Pages, and agents list their trigger documents on their Triggers tab. **New → Trigger** in an app's toolbar (or the create-trigger button on an agent) asks for a name and summary, like a new tool, then creates the trigger (an hourly schedule, on) and opens it. It does nothing until it says what to do: a tool to call, or for an agent a session message. A trigger opens inside its host: when it fires (the same source editor as before), what it does (call a tool, with its input as JSON, or for an agent start a session with a message), an on/off switch with whether it is active on its server, the webhook URL for a webhook, and its firings. A firing opens the tool call or the session it started. **Save** publishes every change as one new version.

# For agents

Agents publish triggers with the write verb's `options.trigger` (`{source, tool?, input?, enabled?}`): the publisher stores the source and input, sets the type and lists the trigger in its host. See the Triggers section of `~/tools/write/apps`. An agent's prompt lists its own triggers beside its tools.

Source: `frontend/packages/client/src/apps.ts` (`triggerDocumentOps`, `triggerDocumentRefs`), `apps/src/trigger-documents.ts` (reading a host's triggers), `apps/src/api-service.ts` (`syncTriggerDocuments`, `migrateStoredTriggersToDocuments`, `#fireAppTrigger`), `frontend/packages/ui/src/apps/trigger-view.tsx`.
