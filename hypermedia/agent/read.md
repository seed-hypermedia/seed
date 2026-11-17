---
name: Read
summary: The read verb takes one address and returns what is there, whether a memory file, a tool contract, a Hypermedia document, a web page, a conversation, or a run.
---
**read** is one verb for any address. It reads `~/memory/…`, `~/tools/…`, `~/triggers/…`, and `~/self` in the agent's [Space](./space.md). It also reads [`hm://…`](../protocol/urls.md) documents, [`ipfs://…`](../protocol/files.md) files, `https://…` pages, `activity:`, `attachment:…`, `thread:…` (bare `thread:` lists and searches the agent's own conversations), and `run:…`. <!-- id:mR05ODxo -->

This page is the reference for the verb: its input, every address form, and the rules for threads, tool contracts, Hypermedia addresses and long results. [Write](./write.md) is its mirror.

# Input

One dispatcher over every address form (`executeReadVerb`, `api-service.ts`). <!-- id:mxxv2pBa -->

```ts <!-- id:PDnabaBv -->
type ReadInput = {
  address: string
  format?: 'markdown' | 'json'
  options?: Record<string, unknown>
}
```

# Address forms <!-- id:xb8iHMvQ -->

<!-- id:2xJtUD31 -->
| address <!-- col:KqyC_ilV --> | behavior <!-- col:-BlbGcpB --> <!-- id:f97jRb6n --> |
| --- | --- |
| `~/memory/<path>` | file content, or a directory listing (`{entries: [{path, type, size}]}`) for a directory address <!-- id:IwfQlJeT --> |
| `~/tools/<name>` | one tool's full contract as markdown; `~/tools/` alone lists the verbs and everything callable; `~/tools/write/<resource>` returns a **write guide** for memory, tools, triggers, ipfs, documents, comments, capabilities, contacts, or profiles (nested paths do not promote) <!-- id:I3a9jT1y --> |
| `~/triggers/<name>` | one trigger: source, prompt markdown, status, continuation, recent firings; `~/triggers/` lists all, with the write contract inline <!-- id:2NjyZeZI --> |
| `~/self` | the agent's own record: definition (name, model, provider, reasoning level, system prompt), `delegation` (thoroughness, `maxDepth`, `maxChildren`), `grants` (`callableTools`, `publish`, `mcpServers`), signing-key names, triggers, memory summary, session count, and guidance saying the definition is the owner's to edit, not the agent's <!-- id:1o9bX9Ks --> |
| `hm://…` | a hypermedia document or comment, markdown by default. `<doc>/:comments` is a document's whole discussion; `hm://<authorUid>/<tsid>` (or a bare `<authorUid>/<tsid>`) is one comment with its thread. A [typed document](../schema/typed-documents.md) comes with a `schema` block: the schema, how it was bound (`via`), `required` and `missing` keys, and `violations` <!-- id:rOeKOv0T --> |
| `ipfs://<cid>` | a file is fetched through the configured `/ipfs/` gateway into memory (default path `ipfs/<cid>`) and returned; a DAG-CBOR object is decoded instead, with its `value`, `signature`, and schema `violations` (`options.schema` checks it against a schema) <!-- id:bfGomPKX --> |
| `https://…` | resolved as hypermedia first, then read as a web page <!-- id:HX6_OXJS --> |
| `activity:` | the activity feed via `ListEvents`, filtered by `options` (`trustedOnly`, `pageSize` up to 50, and the feed's own filters) <!-- id:D2UTz01B --> |
| `attachment:<id>` | a session-private attachment (images are returned as image content to vision models) <!-- id:gvQpE8p4 --> |
| `thread:<id>` | a conversation transcript rendered as markdown: the last 200 events by default, `options.limit` up to 1000, or a range with `options.fromSeq` and `options.toSeq`, plus its continuation lineage <!-- id:u-oVOVw6 --> |
| `thread:` | lists THIS AGENT's conversations, newest first; `options.query` searches titles plus a bounded scan (4000 most recent events) of message text with snippets, `options.limit` caps at 100 <!-- id:v1d_FuXg --> |
| `run:<id>` | a run's public record, plus `sourceText` for script runs <!-- id:6irqDOBK --> |

Unrecognized addresses fail with the supported list (`api-service.ts`). The `hm://` form follows [Hypermedia URLs](../protocol/urls.md), `ipfs://` follows [files](../protocol/files.md), and `activity:` reads the `ListEvents` feed. A file attachment (`attachment:<id>`) is private to its session. <!-- id:4eukeNwd -->

# Threads and runs

`thread:` reads and listings are scoped to the **agent's own threads** (`readThreadAddress`, `threadsListing`). Agents do not read each other's state, whatever account they share. They communicate over public interfaces (documents, comments). `run:` is account-scoped (`readRunAddress`): given a run id, an agent can read the public record of any [run](./runs.md) on its account. A thread or run that used the owner's private browser data reads as a private stub unless the reader has owner access. See [security](./security.md). <!-- id:6bHJ78uL -->

# Tool contracts

A read of `~/tools/<name>` resolves verbs from the registry and everything else from the agent's tool documents. A builtin the agent has not been granted reads as "no tool named …" plus the listing, so probing does not reveal grants. `contractMarkdownForThisServer()` (`api-service.ts`) narrows the `execute` contract to the runtimes this server can actually run, and says so. The contract a model reads is the one it can call. <!-- id:gbtWPtH6 -->

A [contract](./contract.md) that enters the transcript this way [promotes](./promotion.md) the tool.

# Hypermedia addresses

Markdown output resolves Seed [embeds](../protocol/blocks.md) before returning. Inline `Embed` annotations render as readable account and document labels. Block `Embed` nodes inline the embedded markdown, including block-fragment zooms. Block-level links must quote an exact `<!-- id:BLOCK_ID -->` marker copied from a read result. The shared assistant prompt states this. The agent must re-read after a write, because block IDs may change. <!-- id:bmrXx1wm -->

Hypermedia reads go through the shared client resolver: `resolveIdWithClient()` from `frontend/packages/client/src/resource-read.ts`, given a `domainResolver` backed by the read-only Seed `GetDomain` request. There is no custom parsing. The resolver covers pasted clean web-domain URLs, `hm:` and `hm://` IDs, block fragments, and comment view URLs. `:profile` paths branch to the [profile](../profile.md) reader. `/:attributes` is stripped into an attributes-only read. `/:directory` branches to a Children `Query` listing of the id's child documents, trimmed to plain JSON-safe entries: id, path, name, summary, attributes, updateTime, childrenCount. Each markdown row carries the child's attributes, and the listing names the `query` call (`childrenOf`) that filters, sorts or counts them. The model reads the rows a page at a time; the `documents` records go only to scripts, because sent together they outgrew the model's result ceiling and cut the listing off. A hypermedia read takes one option, `offset`: any other option, or `format: "json"` on a directory, comes back named in `notes` so it is never dropped in silence. <!-- id:Fkkm9Cj7 -->

Bare `hm://` addresses read from the service's configured HM server (`SEED_APPS_HM_SERVER_URL`, the local node in every desktop environment), exactly where `write` publishes. Explicit [gateway](../protocol/sites.md) and site URLs read from the URL's own origin. There is no cross-server fallback: a document the configured server does not have is a `not-found`, never a silent read from a public gateway. Every read-path request carries a 30s deadline, so a wedged server fails the tool call and does not hang the session's run. An `hm://hyper.media/…` address names the [knowledge base](./guide.md) and reads from the account the server is configured with (`SEED_APPS_DOCS_ACCOUNT` or `SEED_APPS_DOCS_ACCOUNT_FILE`). The result keeps both `requestedId` (what was asked for) and `id` (the canonical hm:// URL). The agent never shells out to `seed-cli`. <!-- id:IXwpItUm -->

Comment addresses, `<doc>/:comments` and what a comment read returns are on [comments and mentions](./comments-and-mentions.md).

# Web addresses

An `https://` address is tried as Hypermedia first and read as a web page only when it is not Hypermedia. The order of readers and the `raw` option are on [web reading](./web-reading.md).

# Paged reads

The model's `read` never reaches the 32 KiB model-facing cut described under [size limits](./tools.md#size-limits) for long text. `paginateReadResult()` (`api-service.ts`) wraps the verb at its tool definition: when the result's text field (`markdown`, `content`, `transcript` or `text`) is longer than one page (`READ_PAGE_BYTES`, 24 KiB), the result carries the page that starts at `options.offset` (a character offset, default 0), cut at a line break, and `page: {field, offset, end, total, nextOffset}`. Reading the same address with `options.offset: nextOffset` returns the next page; the last page has no `nextOffset`. A page shrinks until the whole serialized result fits under `MAX_MODEL_TOOL_RESULT_BYTES`. A paged result is what the session event stores. Workflow scripts (`ctx.call('read', …)`) are not paged and receive the whole result.

# See also <!-- id:ZYMvIUyi -->

- [Write](./write.md) <!-- id:1b0kfFc2 -->
- [Call](./call.md) <!-- id:snUI8SJ4 -->
- [Space](./space.md) <!-- id:OHNf8bRL -->
- [Tools](./tools.md) <!-- id:5H7sfoVh -->
- [Memory](./memory.md)
- [Comments and mentions](./comments-and-mentions.md)
- [Web reading](./web-reading.md)
- [Security: read safety](./security.md) <!-- id:B6ALKlUv -->
- [Hypermedia URLs](../protocol/urls.md) <!-- id:-ibxKOAq -->
