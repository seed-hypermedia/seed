---
name: Building an App
summary: This page gives the steps to make an app, a tool, a page and a trigger, in the Seed desktop app and as an agent, and shows how to run the app and read what it did.
---
This page shows how to build an [app](../app.md), step by step. You make the app [document](../protocol/documents.md) first, then its [tools](../tool.md), its [pages](../page.md) and its [triggers](../trigger.md), and then you run it. Read those four pages first.

The steps come in two forms, because there are two builders: a person in the [Seed desktop app](../software/desktop.md), and an [agent](../agent.md) using its `write` verb. An agent's own document hosts tools, pages and triggers the same way, so every step about children applies there too.

One warning before you start: **tool call records are not private**. The server records every tool call with its input and output, and anyone who can reach the server can read the records. Never pass secrets as tool input. See "Reading what happened" below.

# The order to work in

1. Create the app.
2. Set up its data: type documents, collections, and their addresses in the app's public config. See [where an app's data lives](../app.md#where-an-apps-data-lives).
3. Add tools for what must run on a server: calls to outside services, and anything that needs a secret from the private config.
4. Add pages for the interface. Pages read and write the app's records as the viewer and call its tools.
5. Run the app on an [app environment](../software/app-environment.md), with its private config.
6. Add triggers for what should happen on its own.

# In the desktop app

## Create and open an app

Open the New menu of a [space](../protocol/spaces.md) and choose **New → App**. The menu shows only where you can create documents. The **New app** dialog asks for a name, a description and the server that will run the app. Then it creates the app. It writes the server into the app's `appEnvironmentUrl`. You can change the server later in **Settings**.

An app opens as tabs instead of a text document, like an agent:

- **Home** shows the app's `homePage` (one of its own pages) running in place. Without a home page, it shows an overview with the app's tool, page and trigger counts and whether the app is running.
- **Tools**, **Pages** and **Triggers** list the embedded children in order. Documents under the app that it does not list appear under **Not in this app**. Each has an **Add** button that lists it.
- **Settings** edits the name and description. **Delete App** in the options menu deletes the app document.

Tab URLs end in `/:app/tools`, `/:app/pages`, `/:app/triggers` and `/:app/settings`.

## Add a tool

Inside an app, New offers **Tool** and **Trigger**. Pages are built by agents.

A tool opens inside its app. The app's tabs stay above it, with **Tools** selected. The tool has a header with a back button and its name, then one page with three parts:

- **Description** says what the tool does.
- **Run** has a form built from the input schema, a **Run** button, the result, and a **Runs** list of the recorded calls.
- **Definition** is folded until you open it. It holds the input schema and the output schema, edited with the schema editor, and `index.ts`.

Changes stay in a draft, which saves itself. While there is a draft, the header says "Unpublished changes: publish or discard them in the top bar." **Publish** in the top bar publishes the changes as one new version, and **Discard Changes** drops them. A code change publishes a new folder and points `code` at it. **Delete Tool** in the options menu removes the tool and takes it off its app's list.

## Run the app

**Settings** does three things: it runs the app, edits its public config, and sets up its config fields.

**Run App** asks for the server and the private config. You pick the server from a list. The list starts on the server that the space's [site](../protocol/sites.md) advertises. You can add a server by its host name, such as `hyper.media`. Seed asks each server first whether it will run this app for you.

## Add a trigger

This section is about trigger documents. An app has a **Triggers** tab beside Tools and Pages. A mounted agent lists its trigger documents on its own Triggers tab. Below them, under **On the server**, the agent's tab lists any triggers stored only on the server. Those open in a different view, which the [trigger reference](../agent/triggers.md) describes.

**New → Trigger** in an app's toolbar, or the create-trigger button on an agent, asks for a name and summary, like a new tool. It then creates the trigger as an hourly schedule, turned on, and opens it. The trigger does nothing until it says what to do: a tool to call, or for an agent a session message.

A trigger document opens inside its host and shows:

- its summary;
- a status row with the on/off switch, which also says whether the trigger is active on its server;
- **Run now**, for a schedule trigger and for people who can edit it. It fires the trigger once, as its schedule would (`RunTriggerNow`);
- **When**: when it fires, in the source editor;
- **Then**: what it does. **Call a tool**, with its input as JSON, or for an agent **Start a session** with a message;
- the webhook URL, for a [webhook](../agent/webhooks.md) trigger;
- **Firings**. A firing opens the tool call or the session it started.

Changes stay in a draft, which saves itself. **Publish** in the top bar publishes them as one new version, and **Discard Changes** drops them. Nothing reaches the server until you publish. A trigger under an app fires only while the app runs.

# For agents

An agent has three guides: `~/tools/write/apps` for apps and tools, `~/tools/write/pages` for pages and `~/tools/write/triggers` for triggers. The agent publishes everything with the [`write` verb](../agent/write.md).

## Write the app and its tools

An agent writes the app as an ordinary document with `metadata.type`. Then it writes each tool with `options.tool`, which names a memory folder (with an `index.ts`) or one TypeScript or JavaScript file. The publisher does four things:

- It checks that `index.ts` parses and has a default export.
- It publishes the folder beside the change.
- It sets `type` and `code`.
- It requires `inputSchema`.

When an agent creates a tool, page or trigger directly under an app or an agent, the publisher adds its [card embed](../block/embed-view.md) to the host in the same publish. Deleting the child removes the embed. The publisher refuses a tool or a trigger anywhere else. It also refuses `write ~/tools/<name>`: an agent's tools are documents, not entries in `~/tools/`.

An app written directly under an agent's document is listed on the agent like its tools, pages and triggers, so it shows on the agent's Home.

## Run the app

An agent runs an app by writing the app's address with `options: {action: "run", privateConfig: {…}}`. It stops the app with `options: {action: "stop"}`.

- The app must name the agent's server in `metadata.appEnvironmentUrl` first.
- The agent's signer must be able to write the app's space.
- Running again updates the private config fields it names and keeps the others.

## Write a page

An agent writes the HTML under its memory. Then it writes a document with `options.page` naming that folder. [Custom HTML pages](./custom-pages.md) has the workflow: data first, then the interface, then the checks.

## Write a trigger

An agent publishes a trigger document with the write verb's `options.trigger` (`{source, tool?, input?, enabled?}`). The publisher stores the source and input, sets the type and lists the trigger in its host. A trigger document has no `onFailure`: a failed tool call is recorded on the firing.

An update changes only what it names:

- `{enabled: false}` turns a trigger off.
- `{tool: null}` makes an agent's trigger start a session again.

If the trigger cannot fire, the write result says why.

`~/triggers/<name>` is for triggers stored on the server. Use it only for what a document cannot express: a workflow script, a wake, a call to a builtin or MCP tool. See [triggers kept only on the server](../trigger.md#triggers-kept-only-on-the-server). An agent's prompt lists its own trigger documents beside its tools. `~/triggers/` lists all its triggers, of both forms, with their firings, and names each trigger's document.

## Keep a host's embeds when editing it

Reading a document as markdown prints each embed as its own line, `<hm://…> <!-- id:X type:Embed attrs:{"view":"Card"} -->`, followed by the embedded content between `<!-- resolved: … -->` and `<!-- /resolved -->`. Writing that markdown back keeps the embed and skips the content shown under it. So an agent that reads a document and then writes it keeps the document's embeds, and with them the list of an app's children. Markdown in the earlier form, with the content between `<!-- embed: URL; … -->` and `<!-- /embed: URL -->`, is still read as the embed.

# Reading what happened

An agent reads the records with its `read` verb:

- `read <tool>/:calls` lists a tool's recorded calls, and `read <tool>/:call/<id>` shows one, with input and output.
- `read <trigger>/:firings` shows a trigger's recent firings.

Both work in apps and agents alike. In the desktop app, the same records are the **Runs** list on a tool and the **Firings** list on a trigger.

**Call records are not private.** Each record holds the full input and output of the call. Who can read them depends on the route:

| Route | Check |
| --- | --- |
| the agent verbs above | the server reads the tool or trigger document first, through its own node |
| the [signed API](./signed-api.md) (`ListAppToolCalls`, `GetAppToolCall`) | none; any signed [account](../protocol/identity.md) that knows the tool's id or the call id |
| plain HTTP (`GET /hm/api/apps/<space>/<app>/<tool>`) | none; no signature at all, for a running app |

So follow these rules:

- Never pass a secret as tool input, and never return private data as tool output.
- Put the secrets a tool needs in the app's private config. The tool reads them from `ctx.privateConfig`.
- A tool that publishes needs a key: give the app a [signing key](../signing-key.md) field in its private config schema, attach a key under **Settings > Signing keys**, and use **Add access** to let that key write the collections it fills. Anyone who can edit the app can act as its keys, so grant only what the tools write.
- A webhook body or a trigger event that becomes tool input is recorded too.
- Making the app's document private does not hide its call records.

# Where the code is

`frontend/packages/client/src/apps.ts` (types, embed rules, `triggerDocumentOps`), `apps/src/app-children.ts` and `apps/src/tool-code.ts` (publisher), `apps/src/app-running.ts` (running apps and calling tools), `apps/src/trigger-documents.ts` (reading a host's triggers), `frontend/packages/ui/src/apps/` (views).

# See also

- [App](../app.md), [Tool](../tool.md), [Page](../page.md) and [Trigger](../trigger.md), the concepts.
- [Custom HTML pages](./custom-pages.md), [the page SDK](./page-sdk.md) and [the page sandbox](./page-sandbox.md) for the interface.
- [Trigger reference](../agent/triggers.md) for sources and their shapes.
- [The app environment](../software/app-environment.md), which runs the app.
- [The signed API for apps](./signed-api-apps.md) for the actions clients use to run apps and call tools.
