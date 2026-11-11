---
name: Apps and Tools
summary: An app is a document typed hm://hyper.media/app whose card embeds list its tools and pages. A tool is a child document with an input schema, an output schema and an index.ts. Nothing runs tools yet.
---
An **app** is a [document](../protocol/documents.md) whose [metadata](../metadata.md) declares `type: hm://hyper.media/app`. Its children are its **tools** and its [custom HTML pages](./document-pages.md), and nothing else for now. Every child lives directly under the app, one path segment down (`/apps/weather/forecast` under `/apps/weather`), and is listed by a card embed in the app's content. The embeds are the source of truth: which children belong to the app, and in what order. Sharing the app shares the list; a reader who can see the app can fork it like any document.

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
export default async function (input: Input): Promise<Output> {
  // ...
}
```

Nothing runs app tools yet. Launching an app on a server and calling its tools is the work of the [Seed App Environment](hm://z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno/projects/seed-app-environment).

# In the desktop app

An app opens as tabs instead of a text document, like an agent:

- **Home** shows the app's `homePage` (one of its own pages) running in place, or an overview with its tool and page counts.
- **Tools** and **Pages** list the embedded children in order. Documents under the app that it does not list appear under **Not in this app**, with an **Add** button that lists them.
- **Settings** edits the name, description and home page, and deletes the app (its tools and pages stay).

A tool opens on a **Tool** tab with its schemas and its `index.ts` in a text area, saved with **Save**, and a **Settings** tab that edits its name, description and both schemas with the schema editor, or deletes it. Every save publishes a new version of the document right away; a code save publishes a new folder and points `code` at it.

**New → App** in a space's New menu creates an app. Inside an app, New offers only **Tool**: agents build pages for now. Tab URLs end in `/:app/tools`, `/:app/pages` and `/:app/settings`.

# For agents

Agents read `~/tools/write/apps`. They write the app as an ordinary document with `metadata.type`, then each tool with `options.tool` naming a memory folder (with an `index.ts`) or one `.ts` file. The publisher checks that `index.ts` parses and default-exports, publishes the folder beside the change, sets `type` and `code`, and requires `inputSchema`. When a tool or page is created directly under an app, the publisher adds its card embed to the app in the same publish, and deleting it removes the embed. A tool anywhere else is refused.

Source: `frontend/packages/client/src/apps.ts` (types and embed rules), `agents/src/app-children.ts` and `agents/src/tool-code.ts` (publisher), `frontend/packages/ui/src/apps/` (views).
