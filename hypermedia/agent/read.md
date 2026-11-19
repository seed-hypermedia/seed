---
name: Read
summary: The read verb takes one address and returns what is there, whether a memory file, a tool contract, a Hypermedia document, a web page, a conversation, or a run.
---
**read** is the verb an [agent](../agent.md) uses to look at something. The agent gives one address, and `read` returns what is there. For example, `read ~/memory/notes.md` returns a file, and `read hm://…` returns a [document](../protocol/documents.md) as markdown. <!-- id:mR05ODxo -->

`read` understands these addresses:

- `~/memory/…`, `~/tools/…`, `~/triggers/…` and `~/self`, in the agent's [Space](./space.md);
- [`hm://…`](../protocol/urls.md) documents and [`ipfs://…`](../protocol/files.md) files;
- `https://…` (or `http://…`) pages;
- `activity:`, `attachment:…`, `thread:…` and `run:…`.

This page is the reference for the verb: its input, every address form, and the rules for threads, tool contracts, Hypermedia addresses and long results. [Write](./write.md) is its mirror.

# Input

One function handles every address form (`executeReadVerb`, `api-service.ts`). <!-- id:mxxv2pBa -->

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
| `~/tools/<name>` | one tool's full contract as markdown; `~/tools/` alone lists the verbs and every [callable tool](./callables.md); `~/tools/write/<resource>` returns a **write guide** for memory, tools, triggers, ipfs, documents, pages, apps, comments, capabilities, [contacts](../protocol/contacts.md), profiles, or drafts (nested paths do not promote) <!-- id:I3a9jT1y --> |
| `~/triggers/<name>` | one [trigger](../trigger.md): source, prompt markdown, status, continuation, recent firings; `~/triggers/` lists all, with the write contract inline <!-- id:2NjyZeZI --> |
| `~/self` | the agent's own record: definition (name, model, provider, [reasoning level](./reasoning-levels.md), [system prompt](./prompt.md)), `delegation` ([thoroughness](./delegation-budgets.md), `maxDepth`, `maxChildren`), `grants` (`callableTools`, `publish`, `mcpServers`), signing-key names, triggers, memory summary, [session](./session.md) count, and guidance saying the definition is the owner's to edit, not the agent's <!-- id:1o9bX9Ks --> |
| `hm://…` | a Hypermedia document or [comment](../protocol/comments.md), markdown by default. `<doc>/:comments` is a document's whole discussion; `hm://<authorUid>/<tsid>` (or a bare `<authorUid>/<tsid>`) is one comment with its thread. A [typed document](../schema/typed-documents.md) comes with a `schema` block: the schema, how it was bound (`via`), `required` and `missing` keys, and `violations` <!-- id:rOeKOv0T --> |
| `hm://…/<tool>/:calls`, `hm://…/<tool>/:call/<id>`, `hm://…/<trigger>/:firings` | what this server recorded: a tool's recent calls, one call with its input and output, or a trigger's recent firings. Readable by whoever can read the tool or trigger |
| `ipfs://<cid>` | a file is fetched through the configured `/ipfs/` gateway into memory (default path `ipfs/<cid>`) and returned; a [DAG-CBOR](../schema/dag-cbor.md) object is decoded instead, with its `value`, `signature`, and schema `violations` (`options.schema` checks it against a schema) <!-- id:bfGomPKX --> |
| `https://…` (or `http://…`) | resolved as Hypermedia first, then read as a web page <!-- id:HX6_OXJS --> |
| `activity:` | the activity feed via `ListEvents`, filtered by `options` (`trustedOnly`, `pageSize` up to 50, and the feed's own filters) <!-- id:D2UTz01B --> |
| `attachment:<id>` | a session-private attachment (images are returned as image content to vision models) <!-- id:gvQpE8p4 --> |
| `thread:<id>` | a conversation transcript rendered as markdown: the last 200 events by default, `options.limit` up to 1000, or a range with `options.fromSeq` and `options.toSeq`, plus its continuation lineage <!-- id:u-oVOVw6 --> |
| `thread:` | lists THIS AGENT's conversations, newest first. `options.query` searches the titles and descriptions of the 400 most recent conversations, and the last 25 events of each of the 60 most recent ones, with a snippet. `options.limit` defaults to 25, at most 100 <!-- id:v1d_FuXg --> |
| `run:<id>` | a run's public record, plus `sourceText` for script runs <!-- id:6irqDOBK --> |

An address `read` does not know fails, and the error lists the supported forms (`api-service.ts`). The `hm://` form follows [Hypermedia URLs](../protocol/urls.md), `ipfs://` follows [files](../protocol/files.md), and `activity:` reads the `ListEvents` feed. A file attachment (`attachment:<id>`) is private to its session. <!-- id:4eukeNwd -->

# Threads and runs

An agent can read only **its own threads** (`readThreadAddress`, `threadsListing`). This is true for one thread and for the `thread:` listing. Agents do not read each other's state, even when they belong to the same [account](../protocol/identity.md). They talk through public things: documents and comments. <!-- id:6bHJ78uL -->

`run:` is wider. Given a run id, an agent can read the public record of any [run](./runs.md) on its account (`readRunAddress`).

A thread or run that used the owner's private browser data reads as a private stub, unless the reader has owner access. See [security](./security.md).

# Tool contracts

`read ~/tools/<name>` returns a tool's [contract](./contract.md): what the tool does and the input it takes. A verb's contract comes from the registry. Every other contract comes from the agent's [tool documents](./tool-document.md). <!-- id:gbtWPtH6 -->

- A built-in tool the agent is not granted reads as "no tool named …" plus the listing. So a read does not reveal which grants exist.
- The [`execute`](./code-execution.md) contract is narrowed to the languages this server can run, and says so (`contractMarkdownForThisServer()`, `api-service.ts`). The contract a model reads is the one it can call.
- A tool resource is not under `~/tools/`. Read its `hm://` address to see its input, output and code. `read ~/tools/hm://…` is refused with a message that says so.

A contract that enters the transcript this way [promotes](./promotion.md) the tool.

# Hypermedia addresses

A bare `hm://` address is read from the server the [app environment](../software/app-environment.md) is configured with, the same server `write` publishes to. If that server does not have the document, the read fails with `not-found`. It never falls back to a public gateway. <!-- id:IXwpItUm -->

- The configured server is `SEED_APPS_HM_SERVER_URL`. In every desktop environment it is the local node.
- A [gateway](../protocol/sites.md) or site URL is read from the URL's own origin.
- Every request on the read path has a 30 second deadline. A stuck server fails the tool call. It does not hang the session's run.
- An `hm://hyper.media/…` address names the [knowledge base](./guide.md). The server reads it from the account it is configured with (`SEED_APPS_DOCS_ACCOUNT` or `SEED_APPS_DOCS_ACCOUNT_FILE`).
- The result keeps both `requestedId` (what was asked for) and `id` (the canonical hm:// URL).
- The agent never runs `seed-cli` for a read.

The markdown that comes back is ready to read. Seed [embeds](../protocol/blocks.md) are resolved first: an inline `Embed` becomes a readable account or document label, and a block `Embed` is replaced by the embedded markdown, including a zoom on one block. <!-- id:bmrXx1wm -->

A link to one block must quote an exact `<!-- id:BLOCK_ID -->` marker copied from a read result. The shared assistant prompt says this. The agent must read again after a write, because block ids may change.

The address is parsed by the same code the apps use: `resolveIdWithClient()` from `frontend/packages/client/src/resource-read.ts`, with a `domainResolver` backed by the read-only Seed `GetDomain` request. It accepts pasted web URLs of Seed sites, `hm:` and `hm://` ids, block fragments, and comment view URLs. Three endings change what is read: <!-- id:Fkkm9Cj7 -->

- `:profile` reads the [profile](../profile.md).
- `/:attributes` reads only the document's attributes.
- `/:directory` lists the child documents of the address. Each entry is plain JSON: id, path, name, summary, attributes, updateTime, childrenCount.

In a directory listing, each markdown row carries the child's attributes. The listing also names the `query` call (`childrenOf`) that filters, sorts or counts the children. The model reads the rows a page at a time. Only scripts receive the `documents` records, because both together were larger than the model's result limit and cut the listing off.

A Hypermedia read takes one option, `offset`. Any other option, or `format: "json"` on a directory, comes back named in `notes`. So an option is never dropped in silence.

Comment addresses, `<doc>/:comments` and what a comment read returns are on [comments and mentions](./comments-and-mentions.md).

# Web addresses

An `https://` address is tried as Hypermedia first. It is read as a web page only when it is not Hypermedia. The order of readers and the `raw` option are on [web reading](./web-reading.md).

# Paged reads

A long text result comes back one page at a time. So the model's `read` never reaches the 32 KiB cut described under [size limits](./tools.md#size-limits).

`paginateReadResult()` (`api-service.ts`) does this where the verb is defined:

- It looks at the result's text field: `markdown`, `content`, `transcript` or `text`.
- If the text is longer than one page (`READ_PAGE_BYTES`, 24 KiB), the result carries one page. The page starts at `options.offset` (a character offset, default 0) and is cut at a line break.
- The result also carries `page: {field, offset, end, total, nextOffset}`.
- Read the same address with `options.offset: nextOffset` to get the next page. The last page has no `nextOffset`.
- A page shrinks until the whole serialized result fits under `MAX_MODEL_TOOL_RESULT_BYTES`.
- The session event stores the paged result.

Workflow scripts (`ctx.call('read', …)`) are not paged. They receive the whole result.

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
