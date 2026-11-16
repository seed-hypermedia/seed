---
name: Apps and Tools
summary: An app is a document typed hm://hyper.media/app whose card embeds list its tools, pages and triggers; apps are the only home for pages and tools. A tool is a child document with schemas and an index.ts that runs on the app's server.
---
An **app** is a [document](../protocol/documents.md) whose [metadata](../metadata.md) declares `type: hm://hyper.media/app`. Its children are its **tools**, its [custom HTML pages](./document-pages.md) and its [triggers](./triggers.md), and nothing else. Apps are the only home for pages and tools: there is no standalone page, and an agent has no private tools. An agent's document can host tools and pages the same way (apps and agents are converging into one concept). Every child lives directly under the app, one path segment down (`/apps/weather/forecast` under `/apps/weather`), and is listed by a card embed in the app's content. The embeds are the source of truth: which children belong to the app, and in what order. Sharing the app shares the list; a reader who can see the app can fork it like any document.

A **tool** is a document with `type: hm://hyper.media/tool`. Its metadata holds:

| Attribute | Value |
| --- | --- |
| `name` | the tool's name |
| `summary` | what it does |
| `inputSchema` | a published HM struct for its input, by `ipfs://` CID or the hm:// URL of a type document |
| `outputSchema` | optionally, a published HM struct for what it returns |
| `code` | `ipfs://<cid>` of a UnixFS folder whose `index.ts` default-exports the tool |

The code contract is one async function:

```ts
export default async function (input: Input, ctx: {app: string; publicConfig: object; privateConfig: object}): Promise<Output> {
  // ...
}
```

A writer of the app's space runs the app on an app server (its `appEnvironmentUrl`, or the one its space's site names), with the app's private config, which only that server holds. Then anyone can call its tools: every run is signed, executes the tool's latest code in a sandbox, and is recorded with who ran it and the tool version. An agent's tools run whenever the agent is mounted on its server, with no run step. The app's pages call its tools with `seed.app.call` and read its public config with `seed.app.context()` ([custom HTML pages](./document-pages.md)).

# What runs where

- A **tool** takes input and returns output, in a sandbox with internet access. It holds no signing key and cannot reach the Seed node of the server that runs it, so it neither publishes documents nor reads them: whoever calls it passes the records it needs. It has no language model either; judgment work (summarizing, classifying) needs a model API key in the app's private config, or belongs to an agent.
- A **page** runs in the viewer's browser and reads and writes Seed records as the viewer: `seed.directory`, `seed.resource`, and `seed.publishDocument(recordUrl, {name, metadata})` to create or edit a record.
- A **trigger** under an app calls one of its tools. Scheduled work that reads or writes the app's data (a daily digest) is an agent's trigger: the agent reads the records, calls the tools and publishes the result.

# Where an app's data lives

The app owns its data model: type documents at `<app>/types/<type>`, collections at `<app>/<collection>` with `childAttributesSchema` set to the type, and records as children of their collection. The app names each collection in `metadata.publicConfig` (`{"articles": "hm://…/reading-list/articles"}`), so its pages (`seed.app.context()`) and tools (`ctx.publicConfig`) find them without hard-coded addresses. These documents are not cards in the app; only tools, pages and triggers are.

# In the desktop app

An app opens as tabs instead of a text document, like an agent:

- **Home** shows the app's `homePage` (one of its own pages) running in place, or an overview with its tool and page counts.
- **Tools**, **Pages** and **Triggers** list the embedded children in order. Documents under the app that it does not list appear under **Not in this app**, with an **Add** button that lists them.
- **Settings** edits the name and description. **Delete App** in the options menu removes the app with its tools and pages.

A tool opens inside its app: the app's tabs stay above it with **Tools** selected, and the tool shows like an agent session, a header with a back button and its name, then one page with its description, input and output schemas (edited with the schema editor) and its `index.ts`. **Save** publishes every change as one new version; a code change publishes a new folder and points `code` at it. **Delete Tool** in the options menu removes it and takes it off its app's list.

**New → App** in a space's New menu creates an app. Inside an app, New offers **Tool** and **Trigger**: agents build pages for now. **Settings** runs the app (**Run App**: the server and the private config), edits its public config, and sets up its config fields. Tab URLs end in `/:app/tools`, `/:app/pages`, `/:app/triggers` and `/:app/settings`. A trigger calls one of the app's tools when something happens, while the app runs: see [triggers](./triggers.md).

# For agents

Agents read `~/tools/write/apps`. They write the app as an ordinary document with `metadata.type`, then each tool with `options.tool` naming a memory folder (with an `index.ts`) or one `.ts` file. The publisher checks that `index.ts` parses and default-exports, publishes the folder beside the change, sets `type` and `code`, and requires `inputSchema`. When a tool or page is created directly under an app or an agent, the publisher adds its card embed to the host in the same publish, and deleting it removes the embed. A tool anywhere else is refused, and `write ~/tools/<name>` (the old private tools) is refused too.

An app written directly under an agent's document is listed on the agent like its tools, pages and triggers, so it shows on the agent's Home. Reading a document as markdown prints each embed with the embedded content between `<!-- embed: URL; title: …; view: … -->` and `<!-- /embed: URL -->`; writing that markdown back turns each such range into the embed again, so a read-then-write keeps a document's embeds.

Agents read a tool's recorded calls with `read <tool>/:calls` and one call with `read <tool>/:call/<id>`, whenever they can read the tool: the same rule as the tool's page, where anyone who can read the tool sees its calls. Calls carry their inputs and outputs, so a tool that handles private data belongs in a private app.

Source: `frontend/packages/client/src/apps.ts` (types and embed rules), `apps/src/app-children.ts` and `apps/src/tool-code.ts` (publisher), `frontend/packages/ui/src/apps/` (views).
