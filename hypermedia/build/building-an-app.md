---
name: Building an App
summary: The steps to make an app, a tool, a page and a trigger, in the Seed desktop app and as an agent, and how to run the app and read what it did.
---
This page is the workflow for building an [app](../app.md): the app document first, then its [tools](../tool.md), its [pages](../page.md) and its [triggers](../trigger.md), then running it. Read the four concept pages first. The steps come in two forms, because there are two builders: a person in the Seed desktop app, and an [agent](../agent.md) using its `write` verb. An agent's own document hosts tools, pages and triggers the same way, so every step about children applies there too.

# The order to work in

1. Create the app.
2. Set up its data: type documents, collections, and their addresses in the app's public config. See [where an app's data lives](../app.md).
3. Add tools for what must run on a server: calls to outside services, anything that needs a secret from the private config.
4. Add pages for the interface. Pages read and write the app's records as the viewer and call its tools.
5. Run the app on an app environment, with its private config.
6. Add triggers for what should happen on its own.

# In the desktop app

## Create and open an app

**New → App** in a space's New menu creates an app. An app opens as tabs instead of a text document, like an agent:

- **Home** shows the app's `homePage` (one of its own pages) running in place, or an overview with its tool and page counts.
- **Tools**, **Pages** and **Triggers** list the embedded children in order. Documents under the app that it does not list appear under **Not in this app**, with an **Add** button that lists them.
- **Settings** edits the name and description. **Delete App** in the options menu removes the app with its tools and pages.

Tab URLs end in `/:app/tools`, `/:app/pages`, `/:app/triggers` and `/:app/settings`.

## Add a tool

Inside an app, New offers **Tool** and **Trigger**. Pages are built by agents.

A tool opens inside its app: the app's tabs stay above it with **Tools** selected, and the tool shows like an agent session, a header with a back button and its name, then one page with its description, input and output schemas (edited with the schema editor) and its `index.ts`. **Save** publishes every change as one new version; a code change publishes a new folder and points `code` at it. **Delete Tool** in the options menu removes it and takes it off its app's list.

## Run the app

**Settings** runs the app (**Run App**: the server and the private config), edits its public config, and sets up its config fields. The server is picked from a list that starts on the one the space's site advertises. A new one is added by its host name, such as `hyper.media`, and each is asked first whether it will run this app for you.

## Add a trigger

Apps get a **Triggers** tab beside Tools and Pages, and agents list their trigger documents on their Triggers tab. **New → Trigger** in an app's toolbar (or the create-trigger button on an agent) asks for a name and summary, like a new tool, then creates the trigger (an hourly schedule, on) and opens it. It does nothing until it says what to do: a tool to call, or for an agent a session message.

A trigger opens inside its host and shows:

- when it fires, in the source editor;
- what it does: call a tool, with its input as JSON, or for an agent start a session with a message;
- an on/off switch, with whether it is active on its server;
- **Run now** for a schedule trigger: it fires once, as its schedule would, for writers (`RunTriggerNow`);
- the webhook URL for a [webhook](../agent/webhooks.md);
- its firings. A firing opens the tool call or the session it started.

**Save** publishes every change as one new version. A trigger under an app fires only while the app runs.

# For agents

Agents read `~/tools/write/apps` for apps and tools, `~/tools/write/pages` for pages and `~/tools/write/triggers` for triggers. Everything is published with the [`write` verb](../agent/write.md).

## Write the app and its tools

Agents write the app as an ordinary document with `metadata.type`, then each tool with `options.tool` naming a memory folder (with an `index.ts`) or one `.ts` file. The publisher checks that `index.ts` parses and default-exports, publishes the folder beside the change, sets `type` and `code`, and requires `inputSchema`.

When a tool, page or trigger is created directly under an app or an agent, the publisher adds its card embed to the host in the same publish, and deleting it removes the embed. A tool or a trigger anywhere else is refused, and so is `write ~/tools/<name>`: an agent's tools are documents, not entries in `~/tools/`.

An app written directly under an agent's document is listed on the agent like its tools, pages and triggers, so it shows on the agent's Home.

## Write a page

An agent writes the HTML under its memory and then writes a document with `options.page` naming that folder. [Custom HTML pages](./custom-pages.md) has the workflow: data first, then the interface, then the checks.

## Write a trigger

Agents publish triggers with the write verb's `options.trigger` (`{source, tool?, input?, enabled?}`): the publisher stores the source and input, sets the type and lists the trigger in its host. An update changes only what it names (`{enabled: false}` turns a trigger off, `{tool: null}` makes an agent's trigger start a session again). If the trigger cannot fire, the write result says why.

`~/triggers/<name>` is for the triggers a document cannot express: a workflow script, a wake, a call to a builtin or MCP tool. See [triggers kept only on the server](../trigger.md). An agent's prompt lists its own trigger documents beside its tools, and `~/triggers/` lists all its triggers with their firings, naming each trigger's document.

## Keep a host's embeds when editing it

Reading a document as markdown prints each embed with the embedded content between `<!-- embed: URL; title: …; view: … -->` and `<!-- /embed: URL -->`. Writing that markdown back turns each such range into the embed again, so a read-then-write keeps a document's embeds, and with them the list of an app's children.

# Reading what happened

- `read <tool>/:calls` lists a tool's recorded calls and `read <tool>/:call/<id>` shows one, with input and output.
- `read <trigger>/:firings` shows a trigger's recent firings.

Both work in apps and agents alike, for anyone who can read that tool or trigger: the same rule as their pages in the desktop app. Calls carry their inputs and outputs, so a tool that handles private data belongs in a private app.

# Where the code is

`frontend/packages/client/src/apps.ts` (types, embed rules, `triggerDocumentOps`), `apps/src/app-children.ts` and `apps/src/tool-code.ts` (publisher), `apps/src/app-running.ts` (running apps and calling tools), `apps/src/trigger-documents.ts` (reading a host's triggers), `frontend/packages/ui/src/apps/` (views).

# See also

- [App](../app.md), [Tool](../tool.md), [Page](../page.md) and [Trigger](../trigger.md), the concepts.
- [Custom HTML pages](./custom-pages.md), [the page SDK](./page-sdk.md) and [the page sandbox](./page-sandbox.md) for the interface.
- [Trigger reference](../agent/triggers.md) for sources and their shapes.
- [The app environment](../software/app-environment.md), which runs the app.
- [Signed API](./signed-api.md) for the actions clients use to run apps and call tools.
