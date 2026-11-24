---
name: App
summary: An app is a document typed hm://hyper.media/app that lists its tools, pages and triggers with card embeds, and that an app environment runs for everyone who uses it.
---
An **app** is a [document](./protocol/documents.md) that groups small programs into one thing people can share and run. For example, a reading-list app can hold a page that shows the saved articles, a tool that fetches an article's title from the web, and a trigger that calls that tool every hour.

The app's [metadata](./metadata.md) declares `type: hm://hyper.media/app`. An app has three kinds of child document:

- [Tools](./tool.md) are functions that run on a server.
- [Pages](./page.md) are HTML interfaces that run in the viewer's client.
- [Triggers](./trigger.md) are rules that call a tool when something happens.

This page says what an app is made of, what runs where, and where its data lives. To make one, follow [building an app](./build/building-an-app.md).

# What an app is made of

Every child lives directly under the app, one path segment down. For example, `/apps/weather/forecast` is a child of `/apps/weather`. The app lists each child with a [card embed](./block/embed-view.md) in its content.

The embeds are the source of truth:

- They say which children belong to the app, and in what order.
- A document under the app that the app does not list is not part of it.
- Any top-level embed of a direct child counts. Seed writes them as cards.
- Sharing the app shares the list.

The app's own metadata holds:

| Attribute | Value |
| --- | --- |
| `type` | `hm://hyper.media/app` |
| `name`, `summary` | the app's name and description |
| `homePage` | the [hm:// URL](./protocol/urls.md) of one of its own pages, shown when the app opens |
| `publicConfig` | settings every page and tool of the app can read, such as the addresses of its collections |
| `publicConfigSchema`, `privateConfigSchema` | the [schemas](./schema.md) of the public config and of the private config |
| `appEnvironmentUrl` | the [app environment](./software/app-environment.md) that runs the app. The New app dialog sets it to the server you pick. Without it, the app uses the one that the [site](./protocol/sites.md) of the app's [space](./protocol/spaces.md) advertises |

The private config itself is not in the document. Only the server that runs the app holds it. [Agents](./agent.md) have the same public and private config, kept the same way (see [host config](./build/signed-api-apps.md#host-config)).

# Running an app

A writer of the app's space runs the app on an [app environment](./software/app-environment.md) and gives it the private config. The server keeps that config encrypted. It checks the config against `privateConfigSchema` before each tool call.

An app runs only on the server it names. A server that the app does not name refuses to run it or its tools.

The server reads the app and its tools from its own node. That node may not hold a document yet, for example one published from a desktop or through another site. The server then looks for it on the network first. This can take up to 25 seconds.

While the app runs, anyone can call its tools, and its triggers fire. When the app stops, both stop.

# What runs where

- A **tool** takes input and returns output. It runs in a sandbox on the app's server, with internet access. It keeps state in the app's private memory on its server (`ctx.memory`), and with `ctx.seed` it reads public documents and publishes as the app, signed by a [signing key](./signing-key.md) attached in the app's private config, within what that key's [account](./protocol/identity.md) may write. It has no language model. Judgment work, such as summarizing or classifying, needs a model API key in the app's private config, or belongs to an [agent](./agent.md). See [tool](./tool.md).
- A **page** runs in the viewer's browser or desktop app. It reads and writes Seed records as the viewer, with `seed.directory`, `seed.resource`, and `seed.publishDocument(recordUrl, {name, metadata})` to create or edit a record. It calls the app's tools with `seed.app.call` and reads the public config with `seed.app.context()`. See [page](./page.md).
- A **trigger** under an app calls one of its tools. Scheduled work on the app's own data, such as writing this week's shopping list, is an app trigger whose tool reads the records and publishes the result as the app. Work that needs judgment is an agent's trigger. See [trigger](./trigger.md).

# Where an app's data lives

The app owns its data model:

- Type documents live at `<app>/types/<type>`.
- Collections live at `<app>/<collection>`, with `childAttributesSchema` set to the type.
- Records are children of their collection.

The app names each collection in `metadata.publicConfig`, for example `{"articles": "hm://…/reading-list/articles"}`. Its pages (`seed.app.context()`) and tools (`ctx.publicConfig`) then find the collections without hard-coded addresses. These documents are not cards in the app. Only tools, pages and triggers are.

# Apps and agents

An [agent](./agent.md) is a document too, typed `hm://hyper.media/agent`. It hosts children the same way an app does. A tool, page or trigger written directly under an agent's document is listed there by a card embed, and the same code reads the list. Three things differ:

- An agent's tools need no run step. They run whenever the agent is mounted on its server.
- An agent's trigger can start a session with the agent instead of calling a tool. An app's trigger must call a tool.
- An app written directly under an agent's document is listed on the agent like its tools, pages and triggers.

A tool or a trigger must live directly under an app or an agent. The server refuses one written anywhere else. A page can also stand alone as an ordinary document, without a host and without tools to call.

# See also

- [Tool](./tool.md), [Page](./page.md) and [Trigger](./trigger.md), the three kinds of child.
- [Agent](./agent.md), the other host of tools, pages and triggers.
- [Building an app](./build/building-an-app.md) for the steps in the [desktop app](./software/desktop.md) and for agents.
- [The app environment](./software/app-environment.md), the program that runs apps.
- [Custom pages](./build/custom-pages.md) for building an app's interface.
