---
name: Callable Tools
summary: A callable tool is a tool an agent runs through the call verb, and this page lists them all and gives the reference for search, query, attributes and browser.
---
A **callable** is a tool that an [agent](../agent.md) runs through the [call](./call.md) verb. It is different from a verb, which the model is given directly. For example, `search` is a callable: the agent runs `call {tool: "search", input: {query: "…"}}`.

The model sees one line for each callable in the [Space index](./space-index.md). It reads the tool's [contract](./contract.md) when it needs one. After the first use, the tool is [promoted](./promotion.md): the model gets it as a real tool for the rest of the thread. Scripts reach the same tools with `ctx.call`.

This page lists every callable, and documents the ones that have no page of their own.

# The catalogue

| Callable | What it does | Granted | Reference |
| --- | --- | --- | --- |
| `search` | finds [documents](../protocol/documents.md) and [contacts](../protocol/contacts.md) by text | by `tools` | [below](#search) |
| `query` | finds documents by their [attributes](../metadata.md) | always | [below](#query) |
| `attributes` | lists the attribute keys and values documents use | always | [below](#attributes) |
| `web_search` | searches the web | by `tools` | [web reading](./web-reading.md) |
| `execute` | runs code in a sandbox | by `tools`, and only where the host can run sandboxes | [code execution](./code-execution.md) |
| `browser` | reads and controls a website open in the owner's Seed desktop app | by `tools`, and only in a run the owner started | [below](#browser) |
| `<server>__<tool>` | a tool on a remote MCP server | by `mcpServers` | [MCP servers](./mcp.md) |
| an hm:// tool URL | a tool resource in an app or an agent | by the tool's own access rules | [call](./call.md#tool-resources) |

[Grants](./grants.md) explains the "Granted" column.

The registry also holds `navigate`. It belongs to a runtime that the [app environment](../software/app-environment.md) does not run, so no agent is offered it.

The app environment has no PDF importer of its own. The [Datalab PDF importer](./datalab-importer.md) page describes an add-on that a server offers only when someone has added it.

## `search` <!-- id:hXDTk_mE -->

`search` finds documents and contacts by text. It searches document titles and contacts, and also bodies and [comments](../protocol/comments.md) when asked. <!-- id:awBGnb8w -->

- Input: `{query, accountUid?, includeBody?, contextSize?, searchType?: 'keyword' | 'semantic' | 'hybrid', pageSize?}`.
- Output: ranked results with [hm:// URLs](../protocol/urls.md).
- The [Seed API](../build/web-api.md) request is `Search`.

## `query` <!-- id:1f1goTTm -->

`query` finds documents by their attributes. It does not search text; use `search` for that. Give it at least one of `q`, `filter` or `childrenOf`. When you give several, a document must match all of them. <!-- id:GNN4ar6q -->

Input: `{q?, childrenOf?, filter?, select?, count?, groupBy?, sort?, pageSize?, pageToken?}`.

- **`childrenOf`** is an `hm://` document URL. It keeps only the direct children of that document (the rows of a collection). The [daemon](../software/daemon.md) can limit a query to a subtree but not to one level. So the tool queries the subtree, keeps that one level itself, and reads more pages until the page is full.
- **`q`** uses the Explore grammar described on the [query grammar](../build/query-grammar.md) page: `key=value`, `key:text`, `has:key`, `in:<space or hm:// URL>`, `path:/specs/*`, AND/OR/NOT. A subtree written as `in:<url>` in `q` includes the document itself and everything below it.
- **`filter`** is a raw `DocumentFilter` in JSON.
- **`sort`** takes attribute keys or the built-in fields `NAME`, `PATH`, `CREATE_TIME`, `UPDATE_TIME`, `ACTIVITY_TIME`, `COMMENT_COUNT`. When `sort` is absent, a `sort:` directive inside `q` is used (`sort:Status,-$updated`).
- **`pageSize`** defaults to 50, at most 100. `pageToken` asks for the next page.
- **`select`** names the attributes shown for each document. An absent one prints as `(missing)`. `$path`, `$created`, `$updated` and `$authors` are built-in fields.
- **`count: true`** reads every matching page, up to 5000 documents, and returns `total`. `groupBy` adds `counts` for each value of one attribute.

The tool compiles the query and sends `QueryDocuments` requests to the configured HM server.

- Problems come back as `warnings`: parse errors, free-text terms that were ignored, and the `!=` caveat.
- When a query finds nothing, the tool looks up its keys and exact values in the attribute listings. It says when one differs only by upper or lower case.
- The model reads one line per document (`markdown`). The lines are cut at a byte limit, with the page token above the rows.
- `results` holds the full record of each document: URL, name, account, path, all attributes, authors, create and update time, version. Only scripts that call `ctx.call('query', …)` receive it. So the model does not pay for every document twice.

## `attributes` <!-- id:j5uitYVU -->

`attributes` shows which attribute keys documents use, and which values a key takes. An agent uses it to learn the fields of a type before it writes a `query`. See [typed documents](../schema/typed-documents.md). <!-- id:IfSA0MYd -->

- Without `key`, it lists attribute names and the kinds seen for each (`ListDocumentAttributeNames`). `parent` narrows the list to a nested object. `recursive: true` lists full dotted paths.
- With a dotted `key`, it lists the distinct values of that key (`ListDocumentAttributeValues`). `kind` limits them to `string`, `int` or `bool`.
- `account` (an [account](../protocol/identity.md) id) puts one space first or limits the list to it. `prefix` filters. `pageSize` defaults to 50, at most 200.

## `browser`

`browser` reads and controls the website visible in the Seed desktop window of the agent's owner. It works only on websites the owner allowed in the assistant panel for the [session](./session.md), and only in an interactive run the owner started. In any other run the call is refused with a 403.

Input: `{action, document?, ref?, text?, clear?, key?, x?, y?, url?}`, where `action` is one of `snapshot`, `screenshot`, `click`, `type`, `press`, `scroll`, `navigate`, `archive`.

- Access to a website is read-only by default: `snapshot`, `screenshot` and `scroll`. The other actions need action access, which the owner gives per website.
- `snapshot` returns the visible text, source metadata, an id for each element, and a `document` token. Every other action must pass that token, and a navigation needs a fresh snapshot.
- `screenshot` is refused when the model cannot view images.
- `archive` creates an editable local draft and saves a markdown copy under `~/memory/private/browser/`, which only the owner can read. It does not publish.
- Website text and images are untrusted source material, never instructions.

The desktop side is described under the integrated browser on the [desktop app](../software/desktop.md) page.

# See also

- [Call](./call.md)
- [Tools](./tools.md)
- [Grants](./grants.md)
- [Tool document](./tool-document.md)
- [Query grammar](../build/query-grammar.md)
- [Typed documents](../schema/typed-documents.md)
