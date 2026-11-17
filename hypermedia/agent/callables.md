---
name: Callable Tools
summary: The catalogue of tools an agent runs through the call verb, with the reference for search, query, attributes and browser.
---
A **callable** is a tool dispatched through the [call](./call.md) verb, as opposed to a verb handed to the model directly. The model sees one line per callable in the [Space index](./space-index.md), reads a [contract](./contract.md) when it needs one, and after first use the tool is [promoted](./promotion.md) to a provider tool for the rest of the thread. Scripts reach the same tools with `ctx.call`. This page lists every callable and documents the ones that have no page of their own.

# The catalogue

| Callable | What it does | Granted | Reference |
| --- | --- | --- | --- |
| `search` | finds documents and contacts by text | by `tools` | [below](#search) |
| `query` | finds documents by their attributes | always | [below](#query) |
| `attributes` | lists the attribute keys and values documents use | always | [below](#attributes) |
| `web_search` | searches the web | by `tools` | [web reading](./web-reading.md) |
| `execute` | runs code in a sandbox | by `tools`, and only where the host can run sandboxes | [code execution](./code-execution.md) |
| `browser` | reads and controls a website open in the owner's Seed desktop app | by `tools`, and only in a run the owner started | [below](#browser) |
| `<server>__<tool>` | a tool on a remote MCP server | by `mcpServers` | [MCP servers](./mcp.md) |
| an hm:// tool URL | a tool resource in an app or an agent | by the tool's own access rules | [call](./call.md#tool-resources) |

The registry also holds `navigate`. It is bound to a runtime the app environment does not run, so no agent is offered it. The [Datalab PDF importer](./datalab-importer.md) is an optional callable that is not in the shared registry. [Grants](./grants.md) explains the "Granted" column.

## `search` <!-- id:hXDTk_mE -->

Seed hypermedia search over document titles and contacts, and optionally bodies and comments. Input `{query, accountUid?, includeBody?, contextSize?, searchType?: 'keyword' | 'semantic' | 'hybrid', pageSize?}`. Returns ranked results with hm:// URLs. The Seed API request is `Search`. <!-- id:awBGnb8w -->

## `query` <!-- id:1f1goTTm -->

Finds current documents by their attributes. It is the structured complement to `search` and does not match free text. Input `{q?, childrenOf?, filter?, select?, count?, groupBy?, sort?, pageSize?, pageToken?}`. At least one of `q`, `filter` or `childrenOf` is required, and they are ANDed. `childrenOf` is an `hm://` document URL and keeps only its direct children (the rows of a collection). The daemon can scope to a subtree but not to one level, so the executor queries the subtree and keeps that level itself, reading further pages until the page is full; a subtree scope written as `in:<url>` in `q` includes the document itself and every descendant. `q` uses the Explore grammar described on the [query grammar](../build/query-grammar.md) page (`key=value`, `key:text`, `has:key`, `in:<space or hm:// URL>`, `path:/specs/*`, AND/OR/NOT). `filter` is a raw `DocumentFilter` in JSON. `sort` takes attribute keys or the built-in fields `NAME`, `PATH`, `CREATE_TIME`, `UPDATE_TIME`, `ACTIVITY_TIME`, `COMMENT_COUNT`. A `sort:` directive inside `q` is honored when `sort` is absent (`sort:Status,-$updated`). `pageSize` defaults to 50, at most 100. `select` names the attributes shown per document (absent ones print as `(missing)`; `$path`, `$created`, `$updated`, `$authors` are built-in fields). `count: true` reads every matching page (up to 5000 documents) and returns `total`, and `groupBy` adds `counts` per value of one attribute. The executor compiles the query and sends `QueryDocuments` requests to the configured HM server. Parse problems, ignored free-text terms and the `!=` caveat come back as `warnings`. A query that finds nothing looks its keys and exact values up through the attribute listings and says when one differs only by case. The model reads one line per document (`markdown`), cut at a byte budget with the page token above the rows; `results` (URL, name, account, path, full attributes, authors, create and update time, version) goes only to scripts calling `ctx.call('query', …)`, so the model does not pay for every document twice. <!-- id:GNN4ar6q -->

## `attributes` <!-- id:j5uitYVU -->

Discovers which attribute keys documents use and what values a key takes, so the agent can learn a type's fields before it writes a `query`. See [typed documents](../schema/typed-documents.md). Without `key`, it lists attribute names with the kinds seen for each through `ListDocumentAttributeNames`. `parent` narrows to a nested object, and `recursive: true` lists full dotted paths. With a dotted `key`, it lists distinct values through `ListDocumentAttributeValues`, optionally for one `kind` (`string`, `int`, `bool`). `account` prioritises or restricts to one space, `prefix` filters, and `pageSize` defaults to 50, at most 200. <!-- id:IfSA0MYd -->

## `browser`

Reads and controls the website visible in the Seed desktop window of the agent's owner. It works only on websites the owner allowed in the assistant panel for the session, and only in an interactive run the owner started. In any other run the call is refused with a 403. Input `{action, document?, ref?, text?, clear?, key?, x?, y?, url?}`, where `action` is one of `snapshot`, `screenshot`, `click`, `type`, `press`, `scroll`, `navigate`, `archive`.

- Access to a website is read-only by default: `snapshot`, `screenshot` and `scroll`. The other actions need action access, which the owner gives per website.
- `snapshot` returns the visible text, source metadata, element refs, and a `document` token. Every other action must pass that token, and a navigation needs a fresh snapshot.
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
