---
name: App
summary: An app is a document typed hm://hyper.media/app whose card embeds list its tools, pages and triggers, and which an app environment runs for everyone who uses it.
---
An **app** is a [document](./protocol/documents.md) whose [metadata](./metadata.md) declares `type: hm://hyper.media/app`. It groups three kinds of child document into one thing people can share and run: [tools](./tool.md) (functions that run on a server), [pages](./page.md) (HTML interfaces that run in the viewer's client) and [triggers](./trigger.md) (rules that call a tool when something happens). This page says what an app is made of, what runs where, and where its data lives. To make one, follow [building an app](./build/building-an-app.md).

# What an app is made of

Every child lives directly under the app, one path segment down (`/apps/weather/forecast` under `/apps/weather`), and is listed by a card embed in the app's content. The embeds are the source of truth: they say which children belong to the app, and in what order. A document under the app that it does not list is not part of it. Sharing the app shares the list, and a reader who can see the app can fork it like any document.

The app's own metadata holds:

| Attribute | Value |
| --- | --- |
| `type` | `hm://hyper.media/app` |
| `name`, `summary` | the app's name and description |
| `homePage` | the hm:// URL of one of its own pages, shown when the app opens |
| `publicConfig` | settings every page and tool of the app can read, such as the addresses of its collections |
| `publicConfigSchema`, `privateConfigSchema` | the [schemas](./schema.md) of the public config and of the private config |
| `appEnvironmentUrl` | the [app environment](./software/app-environment.md) that runs the app; without it, the one the site of the app's space advertises |

The private config itself is not in the document. Only the server that runs the app holds it.

# Running an app

A writer of the app's space runs the app on an [app environment](./software/app-environment.md) and gives it the private config. The server keeps that config encrypted and checks it against `privateConfigSchema` before each tool call. An app runs only on the server it names: a server that the app does not name refuses to run it or its tools.

The server reads the app and its tools from its own node. A document that node does not hold yet (published from a desktop, or through another site) is looked for on the network first, which can take a few seconds.

While the app runs, anyone can call its tools and its triggers fire. When the app stops, both stop.

# What runs where

- A **tool** takes input and returns output, in a sandbox on the app's server, with internet access. It holds no signing key and cannot reach the Seed node of the server that runs it, so it neither publishes documents nor reads them: whoever calls it passes the records it needs. It has no language model either. Judgment work (summarizing, classifying) needs a model API key in the app's private config, or belongs to an [agent](./agent.md). See [tool](./tool.md).
- A **page** runs in the viewer's browser or desktop app and reads and writes Seed records as the viewer: `seed.directory`, `seed.resource`, and `seed.publishDocument(recordUrl, {name, metadata})` to create or edit a record. It calls the app's tools with `seed.app.call` and reads the public config with `seed.app.context()`. See [page](./page.md).
- A **trigger** under an app calls one of its tools. Scheduled work that reads or writes the app's data (a daily digest) is an agent's trigger: the agent reads the records, calls the tools and publishes the result. See [trigger](./trigger.md).

# Where an app's data lives

The app owns its data model: type documents at `<app>/types/<type>`, collections at `<app>/<collection>` with `childAttributesSchema` set to the type, and records as children of their collection. The app names each collection in `metadata.publicConfig` (`{"articles": "hm://…/reading-list/articles"}`), so its pages (`seed.app.context()`) and tools (`ctx.publicConfig`) find them without hard-coded addresses. These documents are not cards in the app; only tools, pages and triggers are.

# Apps and agents

An [agent](./agent.md) is a document too, typed `hm://hyper.media/agent`, and it hosts children the same way an app does. A tool, page or trigger written directly under an agent's document is listed there by a card embed, and the same code reads the list. Three things differ:

- An agent's tools need no run step. They run whenever the agent is mounted on its server.
- An agent's trigger can start a session with the agent instead of calling a tool. An app's trigger must call a tool.
- An app written directly under an agent's document is listed on the agent like its tools, pages and triggers.

A tool or a trigger must live directly under an app or an agent; one written anywhere else is refused. A page can also stand alone as an ordinary document, without a host and without tools to call.

# See also

- [Tool](./tool.md), [Page](./page.md) and [Trigger](./trigger.md), the three kinds of child.
- [Agent](./agent.md), the other host of tools, pages and triggers.
- [Building an app](./build/building-an-app.md) for the steps in the desktop app and for agents.
- [The app environment](./software/app-environment.md), the program that runs apps.
- [Custom pages](./build/custom-pages.md) for building an app's interface.
