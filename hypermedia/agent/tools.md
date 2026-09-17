---
name: Tools
summary: "The reference for everything an agent can do: the verbs handed to the model, the address forms they accept, the callable tools dispatched through call, and how tool events are recorded."
---
An agent's whole model-facing tool surface is **five verbs**, [`read`](./read.md), [`write`](./write.md), [`call`](./call.md), [`delegate`](./delegate.md), and [`plan`](./plan.md), plus two session verbs, `status` and `continue_session`. Everything else is either an address form of a verb or a **callable tool** dispatched through `call`. That covers search, the web, code execution, and the agent's own authored tools. Tool calls and results are stored as durable, actor-stamped session events in the [Log](./log.md) and rendered in the session log of the Seed app and the Seed web app. <!-- id:sdHo0UwP -->

# The registry <!-- id:-aLT2u3W -->

The canonical registry is `agents/protocol/src/tool-registry.ts`. The Agents service executes from it and the desktop renders from it, so a tool's prompt text, schemas, chat bubble, and HM-reference extraction cannot drift apart. It exports three tables: <!-- id:5JGudaAa -->
  - `seedVerbRegistry`: the five verbs, `status`, `continue_session`, and the hidden `return_result` mechanism. This is the **only** provider-facing toolset. A leaf run gets no `delegate`, a delegated child gets no `continue_session`, and only a typed child gets `return_result`. <!-- id:cpDWf5e4 -->
  - `callableToolRegistry`: `search`, `query`, `attributes`, `web_search`, `navigate`, `execute`. By default these are never handed to the provider as tools. `call` dispatches them (`callableToolRegistry`). <!-- id:Z3ye-2G4 -->
  - `seedToolRegistry`: both, merged, for renderers and validation lookups (`seedToolRegistry`). <!-- id:lnALDCIy -->

Each entry owns the model-facing name, label, prompt description, JSON input schema, optional output schema, runtime availability (`assistant` or `agent-service`), rendering metadata, and an optional `getReferencedUrls` extractor. The extractor lists the `hm://` resources a call touched so they can [sync](../protocol/network.md). Write results include [document](../protocol/documents.md) versions and [comment](../protocol/comments.md) and target URLs in this extraction. An open desktop session can then keep newly published content subscribed on its local node before the user follows the result link. Server runtimes only add execution functions around registry entries. Chat UIs pick their bubble renderer from the same metadata. <!-- id:Io_jNF7p -->

`navigate` is marked `runtimes: ['assistant']`, so the agent service never offers it. `serviceCallableNames()` (in `agents/src/api-service.ts`) filters on `runtimes.includes('agent-service')`, which leaves the service's callable set as `search`, `query`, `attributes`, `web_search`, `execute`. Nothing on this branch runs the `assistant` runtime, so `navigate` does nothing today. It stays as the registry entry a desktop-side executor would bind to. <!-- id:hZYGek_X -->

## Legacy names <!-- id:xGuoC4hF -->

`normalizeSeedToolName()` maps exactly one renamed callable: `execute_code` to `execute` (in `tool-registry.ts`). Names that were absorbed into verbs have **no** alias, on purpose: `memory_*`, `web_read`, `ipfs_*`, `attachment_*`, `list_activity_feed`, the old spawn tools, `update_plan`, `set_session_title`. The verbs are always on, so those entries in a stored `tools` array do nothing. <!-- id:CjHdoLy8 -->

# Tools are documents <!-- id:SM16VRI3 -->

Every tool an agent holds is a content-addressed [tool document](./tool-document.md) in its [Space](./space.md), stored per agent in the `tool_documents` table (`agents/src/tool-documents.ts`). A document's [CID](../protocol/blobs.md) is computed over its canonical DAG-CBOR encoding, the same encoding the hypermedia network uses for blobs. So you can always answer "what exactly can this agent run", and publishing a tool to the network later means publishing bytes that already exist. <!-- id:Tt3S2vFy -->

```ts <!-- id:uGnR-4qi -->
type ToolDocument = {
  name: string
  kind: 'builtin' | 'lambda' | 'mcp'
  summary: string // one line, for the Space index and ~/tools listing
  description: string // full model-facing instructions
  input: JsonSchema
  output?: JsonSchema
  source?: string // lambda source
  runtime?: 'typescript' | 'python' // lambda language, default typescript
  binding?: string // builtin executor id, bound at boot
  server?: string // mcp: the account MCP server the call is proxied to
  remoteName?: string // mcp: the tool's name on that server
}
```

<!-- id:P5VOO5bh -->
- **Builtins** are documents whose implementation is a runtime binding. `ensureBuiltinToolDocuments()` creates and refreshes them per agent. Rows are rewritten only when the registry contract changed (the CID differs). A forked builtin keeps its binding, and its divergence from the shipped contract shows as a different CID (`tool-documents.ts:114`). <!-- id:jx8HtVIW -->
- **Lambdas** are authored by the agent: `write ~/tools/<name>` with JSON content. Validation (`saveLambdaToolDocument()`, `tool-documents.ts:188`): names match `/^[a-z][a-z0-9_-]{1,63}$/`, a builtin or verb name cannot be replaced, a description is required (≤ 16 KiB), source is required (≤ 256 KiB), and both schemas must pass `validateJsonSchemaShape`. `write ~/tools/<name>` with `{delete: true}` removes an authored tool. Builtins refuse deletion and point at the agent's [grants](./grants.md) instead. <!-- id:CU6ilpW7 -->
- **MCP projections** are the tools of the remote [MCP servers](./mcp.md) an agent enables (`definition.mcpServers`). There is one document per tool, named `<server>__<tool>`, reconciled by `syncMcpToolDocuments()` from the server's cached discovery. They carry the remote description and input schema plus `server` and `remoteName`. They cannot be deleted or replaced by a lambda (disable the server instead), and calls to them are proxied to the server. See [`mcp.md`](./mcp.md). <!-- id:BcWPjduI -->

`ListAgentTools` returns the desktop's view of the same documents: name, kind, summary, description, schemas, `source`, `runtime`, `cid`, `enabled`, and `granted` (whether the agent's grant set actually offers it). Writers can also use `SaveAgentTool` and `DeleteAgentTool` from the Tools tab. The save action creates or updates every editable field and can rename an existing authored tool atomically. It refuses to overwrite another tool. Builtins stay read-only. <!-- id:EiFnJN0w -->

# The Space index <!-- id:OmLIl6Dh -->

Every system prompt carries a compact `<space>` block built by `buildSpaceIndex()`. It has: <!-- id:hv-y1xqA -->

- one line per enabled tool document (`- name — summary`). Authored tools are tagged `(authored)` and remote tools `(<server> MCP)`. An MCP server with more than six tools collapses to one `- <server>__* — N tools …` line.
- a one-line summary of top-level memory.
- a triggers line. It names active [triggers](./triggers.md) and advertises `read ~/triggers/` and `write ~/triggers/<name>` even when no triggers exist, so an agent asked "do this every morning" knows it can create the automation.

The index is cached per `(account, agent, callable set)` and invalidated on memory, tool, or trigger writes. Over `SPACE_INDEX_BUDGET_BYTES` (2048) the per-tool lines collapse to a count, so the index stays accurate and small.

The agent always knows what it _could_ expand, without paying for every contract up front. <!-- id:G7Mcolvq -->

# Touch-expand and promotion <!-- id:ywZR_0ng -->

`call` never punishes a miss. Calling an unknown tool returns the `~/tools` listing. Calling a known tool with input its schema rejects returns **the tool's contract** as the result, plus the validation errors, so the retry succeeds (`executeCallVerb`, `api-service.ts:7794`). <!-- id:edRIqz0f -->

Once a tool's contract has entered the transcript, through an agent `read` of `~/tools/<name>` or any `call` by that name, the tool is **promoted** to a real provider tool for the rest of the thread. See [promotion](./promotion.md). Promotion is derived only from durable `tool_call` events (`expandedCallablesFromEvents()`, `api-service.ts:7221`), so resume, park, restart, and compaction all rebuild the same set. Events with actor `user` are skipped: a user's palette call must not silently reshape the agent's active toolset. <!-- id:3AAxXIeD -->

Before anything reaches Pi (`#runPiAgent`), promotion is intersected with the agent's enabled callables plus its own enabled non-builtin documents (authored lambdas and MCP projections, re-derived from the definition at run start): <!-- id:D8DK4IAm -->

```ts <!-- id:4ZQwDiQa -->
const expandedCallables = this.#expandedCallablesForSession(sessionId)
  .map(normalizeSeedToolName)
  .filter((name) => enabledCallables.includes(name) || documentTools.has(name))
```

This filter is a security control. A hallucinated `call {tool: 'bash'}` durably stores that name. An unfiltered allowlist would hand `bash` to Pi and activate Pi's own host builtins outside the sandbox. A promoted document tool is defined from its own document (`toolMetadataFromDocument`): the contract the model read is the schema the provider now validates against, and its executor is the same `call` dispatch. <!-- id:cuCkX0YE -->

# Grants <!-- id:tPg5Z6sN -->

Verbs are never [grants](./grants.md). They are always on. Two things are granted per agent, both through `definition.tools`: <!-- id:dEtv6vHA -->
  - **The callable set.** `enabledCallableTools()` (`api-service.ts:304`) intersects the service callables with `definition.tools` (normalized, unknown names ignored). An undefined `tools` array grants all of them. `execute` drops out silently when the host cannot run sandboxes, so the model never sees a tool that can only fail. <!-- id:22xP_Z0w -->
  - **Publish.** `publishGrantEnabled()` (`api-service.ts:299`) checks for the pseudo-tool name `publish` in `definition.tools`. Legacy write-group names (`write`, `memory_publish_document`, `ipfs_write`, `attachment_to_ipfs`) still count, so a pre-verbs agent keeps exactly the publishing posture its owner configured. An undefined `tools` array publishes. Without the grant, `write` to `hm://` or `ipfs://` returns 403 (`api-service.ts:7454`, `api-service.ts:7499`). Memory writes are never gated. <!-- id:27po_PK5 -->

Definition limits: at most 32 tool names, 128 bytes each, 4 KiB total (`api-service.ts:106`). <!-- id:H43msgHh -->

\--- <!-- id:bPKp7ysy -->

# `read` <!-- id:xb8iHMvQ -->

One dispatcher over every address form (`executeReadVerb`, `api-service.ts:7250`). The [read](./read.md) term page has the short version. <!-- id:mxxv2pBa -->

```ts <!-- id:PDnabaBv -->
type ReadInput = {
  address: string
  format?: 'markdown' | 'json'
  options?: Record<string, unknown>
}
```

<!-- id:2xJtUD31 -->
| address <!-- col:KqyC_ilV --> | behavior <!-- col:-BlbGcpB --> <!-- id:f97jRb6n --> |
| --- | --- |
| `~/memory/<path>` | file content, or a directory listing (`{entries: [{path, type, size}]}`) for a directory address <!-- id:IwfQlJeT --> |
| `~/tools/<name>` | one tool's full contract as markdown; `~/tools/` alone lists everything callable <!-- id:I3a9jT1y --> |
| `~/triggers/<name>` | one trigger: source, prompt markdown, status, continuation, recent firings; `~/triggers/` lists all, with the write contract inline <!-- id:2NjyZeZI --> |
| `~/self` | the agent's own record: definition (name, model, provider, reasoning level, system prompt), grants, signing-key names, triggers, memory summary, session count, and guidance on what it can change itself <!-- id:1o9bX9Ks --> |
| `hm://…` | a hypermedia document or comment, markdown by default. `<doc>/:comments` is a document's whole discussion; `hm://<authorUid>/<tsid>` (or a bare `<authorUid>/<tsid>`) is one comment with its thread <!-- id:rOeKOv0T --> |
| `ipfs://<cid>` | fetches through the configured `/ipfs/` gateway into memory (default path `ipfs/<cid>`) and returns it <!-- id:bfGomPKX --> |
| `https://…` | resolved as hypermedia first, then read as a web page <!-- id:HX6_OXJS --> |
| `activity:` | the activity feed via `ListEvents`, filtered by `options` <!-- id:D2UTz01B --> |
| `attachment:<id>` | a session-private attachment (images are returned as image content to vision models) <!-- id:gvQpE8p4 --> |
| `thread:<id>` | a conversation transcript (its last 200 events) rendered as markdown <!-- id:u-oVOVw6 --> |
| `thread:` | lists THIS AGENT's conversations, newest first; `options.query` searches titles plus a bounded scan (4000 most recent events) of message text with snippets, `options.limit` caps at 100 <!-- id:v1d_FuXg --> |
| `run:<id>` | a run's public record, plus `sourceText` for script runs <!-- id:6irqDOBK --> |

Unrecognized addresses fail with the supported list (`api-service.ts:7350`). The `hm://` form follows [Hypermedia URLs](../protocol/urls.md), `ipfs://` follows [files](../protocol/files.md), and `activity:` reads the [ListEvents](../rpc/list-events.md) feed. An [attachment](./attachment.md) is private to its session. <!-- id:4eukeNwd -->

`thread:` reads and listings are scoped to the **agent's own threads** (`readThreadAddress`, `threadsListing`). Agents do not read each other's state, whatever account they share. They communicate over public interfaces (documents, comments) until a deliberate inter-agent contract exists. `run:` stays account-scoped (`readRunAddress`). One agent can list, search, and read the transcripts and [runs](./runs.md) of every other agent on the same account. This is deliberate, so an agent asked "what did my research agent find yesterday?" can answer. See [security](./security.md). <!-- id:6bHJ78uL -->

**Tool contracts.** A read of `~/tools/<name>` resolves verbs from the registry and everything else from the agent's tool documents. A builtin the agent has not been granted reads as "no tool named …" plus the listing, so probing does not reveal grants. `contractMarkdownForThisServer()` (`api-service.ts:7641`) narrows the `execute` contract to the runtimes this server can actually run, and says so. The contract a model reads is the one it can call. <!-- id:gbtWPtH6 -->

**Web escalation.** An `https://` address is tried as hypermedia first. It falls through to the web reader only when the resolver says the URL is not hypermedia, or the resource 404s. Every other failure surfaces: transient daemon errors, too-large, network. Scraped page HTML never silently replaces a document's real content (`api-service.ts:7332`). <!-- id:V1SnC19P -->

**Web reading tiers.** `executeWebRead` (`agents/src/web-tools.ts:371`) runs a cheapest-first chain and returns the first tier that yields ≥ 200 characters: <!-- id:XauDXdGs -->

1. **MediaWiki API** for wiki-shaped URLs. It probes the host once via `api.php?meta=siteinfo` (cached per host) and fetches Parsoid HTML.
2. **In-process static extraction**: plain `fetch`, Mozilla Readability on a `linkedom` DOM, Turndown to markdown.
3. **Crawl4AI** (`POST /md`, Bearer token) when `SEED_AGENTS_CRAWLER_URL` is configured. This is the backstop for JS-heavy and anti-bot pages.

`options.raw: true` skips the chain and returns the response body verbatim (text content types only). Markdown is bounded to 200 KiB, truncated on a byte boundary.

**Hypermedia output.** Markdown output resolves Seed [embeds](../protocol/blocks.md) before returning. Inline `Embed` annotations render as readable account and document labels. Block `Embed` nodes inline the embedded markdown, including block-fragment zooms. Block-level links must quote an exact `<!-- id:BLOCK_ID -->` marker copied from a read result. The shared assistant prompt states this. The agent must re-read after a write, because block IDs may change. <!-- id:bmrXx1wm -->

**Comments.** A [comment](../protocol/comments.md) id is `<authorUid>/<tsid>`. Its canonical address is `hm://<authorUid>/<tsid>`, which the daemon's `Resource` request answers with a `comment` resource. The read result (`type: hypermedia_comment`) carries: <!-- id:51w039Nb -->

- the comment and its `target` document,
- `replyParent` and `threadRoot`,
- the `discussion` address,
- a ready `replyWith` write call,
- the whole `thread` it belongs to, loaded through `ListComments` on the target: the root plus every reply under that root, oldest first, capped at `MAX_THREAD_COMMENTS` keeping the root and the newest.

`<doc>/:comments` (aliases `:comment`, `:discussions`) reads the whole discussion grouped into threads (`type: hypermedia_discussion`).

Slightly wrong input is tolerated on purpose. An agent often composes a comment id glued onto a document (`hm://<docUid>/<author>/<tsid>`) from a target uid and a `replyParent` field. `commentIdInAddress()` recognizes it, reads it at its canonical address, and the result says so in `recovered`. The literal address is tried only when nothing is there. The same thread loader feeds the trigger prompt's `<trigger_thread>` block (`triggerThreadContext`). A mention inside a reply arrives with the thread around it, because the request almost always refers to something earlier ("make this your profile pic" under an image another agent posted).

**Address resolution.** Hypermedia reads go through the shared client resolver: `resolveIdWithClient()` from `frontend/packages/client/src/resource-read.ts`, given a `domainResolver` backed by the read-only Seed `GetDomain` request. There is no custom parsing. The resolver covers pasted clean web-domain URLs, `hm:` and `hm://` IDs, block fragments, and comment view URLs. `:profile` paths branch to the [profile](../profile.md) reader. `/:attributes` is stripped into an attributes-only read. `/:directory` branches to a Children `Query` listing of the id's child documents, trimmed to plain JSON-safe entries: id, path, name, summary, updateTime, childrenCount. <!-- id:Fkkm9Cj7 -->

Bare `hm://` addresses read from the service's configured HM server (`SEED_AGENTS_HM_SERVER_URL`, the local node in every desktop environment), exactly where `write` publishes. Explicit [gateway](../protocol/sites.md) and site URLs read from the URL's own origin. There is no cross-server fallback: a document the configured server does not have is a `not-found`, never a silent read from a public gateway. Every read-path request carries a 30s deadline, so a wedged server fails the tool call and does not hang the session's run. The result keeps both `requestedId` (what was asked for) and `id` (the canonical hm:// URL). The agent never shells out to `seed-cli`.

# `write` <!-- id:v941MPk4 -->

The mirror of `read` (`executeWriteVerb`, `api-service.ts:7357`). The [write](./write.md) term page has the short version. <!-- id:5vvn-Fqz -->

```ts <!-- id:1cFLuUeT -->
type WriteInput = {
  address: string
  content?: string
  options?: Record<string, unknown>
  dryRun?: boolean
}
```

`dryRun` is a flag on the call itself, so it sits at the top level and not in `options`. It is strict. A non-boolean value is a 400, never a silent real publish. It applies only to `hm://` writes: every command handler returns an echo of what would be published before `client.publish` is reached. Passing it on a memory, tools, or ipfs write is refused. <!-- id:ygGo2VPt -->
  - **`~/memory/<path>`**: writes `content` and creates parent directories. Writing an existing file replaces it whole. There is no append. `options.delete` removes a file or directory, `options.fromUrl` downloads a URL to the path, and `options.fromAttachment` saves a session attachment to it. <!-- id:X3Fn2IAS -->
  - **`~/tools/<name>`**: authors a tool. `content` is JSON `{description, input, output?, source, runtime?}` (or `options.tool` as an object). The name comes from the address. Non-JSON content fails with that exact shape as the message. `options.delete` deletes an authored tool. Both paths emit the memory-change event, so the desktop Tools tab updates live. <!-- id:gXx2r3N7 -->
  - **`~/triggers/<name>`**: creates or edits a [trigger](./trigger.md) (`writeTriggerAddress`). `content` is JSON `{source, prompt, enabled?, continuation?}` (or `options.trigger` as an object). The name comes from the address, and a name inside the content cannot retarget the write. Sources and continuations go through the same normalizers the signed CRUD actions use. `enabled` is honored as written and defaults to true, so the agent enables, disables, and retires its own automations directly. See the threat-model note in [security](./security.md). Names are not unique, so an ambiguous name is refused with the matching ids. Addressing by id works too. `options.delete` removes a trigger. Writes emit `trigger-updated` account events, so the desktop Triggers tab updates live. <!-- id:KRN56YOI -->
  - **`ipfs://`**: publishes `options.fromPath` (a memory file) or `options.fromAttachment`. It chunks the data into [UnixFS](../protocol/files.md) blocks with the shared client helper, sends those blocks through `PublishBlobs` on the typed HM API, and returns the root `ipfs://<cid>` URL. It does not depend on a server-specific `/ipfs/file-upload` route. `SEED_AGENTS_IPFS_SERVER_URL` only selects the gateway used by `read ipfs://…`, and defaults to the HM API origin. Requires the publish grant. Publishing makes the file publicly retrievable. <!-- id:xqte77_C -->
  - **`hm://<account>/<path>`**: publishes signed hypermedia. Requires the publish grant. <!-- id:gj2w4grI -->

Hypermedia writes map `options.action` onto the command envelope shared with the [CLI](../build/cli.md) (`api-service.ts:7528`): the default `document` becomes `document.create`, plus `update`, `comment` (with `target` and `replyTo`), `move` (`toPath`), `redirect` (`toUrl`), `delete`, and `fork` (`fromUrl`). The runtime builds and signs the [Change](../change.md) and [Ref](../ref.md). <!-- id:PbMNPSW8 -->

For `update`, the write address **is** the edit target. The envelope fills `input.edit` from it ("same address, new version"), so there is no separate option to name the target. An update with `content` replaces the whole document body. An update with no `content` at all changes only metadata and leaves the body untouched. It never diffs against an empty tree, which would delete every block.

Any dotted action passes through as a raw command: `draft.create`, `profile.update`, `contact.create`, `capability.grant`, and the rest, with the address filling account and path. Extra command fields go **only** in `options.input`, never as loose option keys. The command handlers accept aliases (`reply`, `commentId`, `name`, …), and a stray key that silently changes the operation is a real hazard.

An unrecognized loose option key is **refused with a 400 naming the key and the supported set**. It is never silently dropped. This is enforced per address form (`assertKnownWriteOptions`), because of a real failure: a model passed `{metadata}` before the envelope knew that key, the write "succeeded", and the document published without the metadata. The model's only option was to fake it in the body text. A model can read a loud refusal and correct itself. It cannot learn from a silent drop. Retired spellings get a migration hint in the refusal (`RETIRED_WRITE_OPTION_HINTS`): `title` points at `name` or `metadata.name`, and `dryRun` points at the top-level field. <!-- id:omwu1HQq -->

More write behavior: <!-- id:6PdHCPGt -->
  - The document model has no separate "title". The document's name **is** `metadata.name`, and `options.name` is shorthand for it. A markdown `#` heading is body content and does not set the name. <!-- id:vqOTxHM1 -->
  - `document.create` (and `draft.create`) **require a name**, from `options.name`, `metadata: {name}`, or content frontmatter (`name:`; the shared markdown parser also accepts `title:` as a backward-compat alias). A nameless create is refused. Nothing publishes as "Untitled" anymore. <!-- id:tqh88y7F -->
  - `options.metadata` (document and update, and dotted document-shaped commands) is an object of document [metadata](../metadata.md) attributes merged into the document's metadata: `{summary, icon, cover, …}` or custom keys. It merges over markdown frontmatter metadata, and `options.name` wins for `name`. <!-- id:pacPuZKE -->
  - `options.signer` picks the identity by `profileName` or `publicKey` from the agent's selected signing [keys](../build/keys.md). <!-- id:FwTGvj_C -->
  - `options.fromPath` on an `hm://` address publishes a memory markdown file (frontmatter plus resolved images) through the dedicated pipeline. Path `/` derives the document path from the file's frontmatter name. <!-- id:gZfg4J0I -->
  - `document.create` refuses a nested path whose parent is not already published. Top-level paths are always allowed. The server enforces this, including in `dryRun`. <!-- id:KlGDRPlO -->
  - Root-level `server` and `dev` are accepted only when they resolve to the configured agent HM server. Publishing always uses that server, never one the model picks (`api-service.ts:7953`). <!-- id:Dlh1Pqbd -->
  - `path: "/"` means the account [home document](../protocol/documents.md) and is published as the canonical empty HM path. <!-- id:zkDp34Z8 -->
  - [Tables](../block/table.md) round-trip through markdown as GFM tables carrying identity comments. The shared dialect is in `frontend/packages/client/src/markdown-to-blocks.ts` and `blocks-to-markdown.ts`. <!-- id:-ULSX1WW -->
    - A standalone `<!-- id:… -->` line before the table is the Table block.
    - `<!-- col:… -->` inside each header cell is the TableColumn identity. Column order and reorders follow these.
    - `<!-- id:… -->` inside each row's last cell is the TableRow identity. It sits in the cell so every line keeps the delimiter row's cell count, because strict GFM refuses tables whose header cell count disagrees. The parser still accepts the legacy placement after the final pipe.
    - Cell block ids never appear. On update, `rebindTableIdentities` re-derives each cell as (row id, column id) against the old document, so cell history and anchored comments survive edits. Columns whose comments were dropped still match by header text, then position.
    - Attributes markdown cannot express (column width, header column) carry over from the old blocks. Plain GFM tables with no comments create fresh tables.
    - `\|` escapes a pipe, and `<br>` is a newline inside a cell. A headerless HM table emits an all-empty header row and parses back headerless.
  - Hypermedia content is bounded at 256 KiB (`MAX_WRITE_CONTENT_BYTES`). `normalizeWriteContent()` (`api-service.ts:9072`) rejects oversized document and comment bodies, and publishing a memory file refuses the same ceiling (`api-service.ts:8861`). Memory writes themselves are unbounded. See the note in [security](./security.md). <!-- id:Ftyq2lzE -->

# `call` <!-- id:dSIpKStF -->

```ts <!-- id:EYgCtp5F -->
type CallInput = {tool: string; input?: object; description?: string}
```

`description` is optional intent for the user: one short line the chat row shows in place of the raw input. It is read from the durable `tool_call` event and never passed to the tool. Scripts have the same option as `ctx.call(tool, input, {description})`. It is optional because `search`, `web_search`, `read`, and `write` rows already name their subject, and MCP rows show the call's first short string argument. Only `execute`, whose input is opaque, requires a description in its own input. The [call](./call.md) term page has the short version. <!-- id:NMTvAc3j -->

Dispatch order in `executeCallVerb` (`api-service.ts:7794`): <!-- id:iTHt2YHO -->
  1. Resolve the name through `normalizeSeedToolName` and the registry. For `execute`, swap in the server-narrowed contract. <!-- id:CcdLUkqX -->
  2. If it is not a granted builtin, look for an enabled document of that name. A **lambda** runs in the sandbox (`executeLambdaTool`). An **MCP projection** is proxied to its server (`executeMcpTool`, see [`mcp.md`](./mcp.md)). <!-- id:SWV7WM4u -->
  3. Otherwise return the `~/tools` listing with a "no callable tool named …" summary. <!-- id:WixN3gx_ -->
  4. Validate `input` against the tool's schema. On failure, return the contract (touch-expand). <!-- id:euze5A7r -->
  5. Execute: `search` goes to `executeAgentServiceSearch`, `query` to `executeAgentServiceQuery`, `attributes` to `executeAgentServiceAttributes`, `web_search` to `executeWebSearch`, and `execute` to the sandbox. <!-- id:dlSy993f -->

Promoted callables are exposed as real provider tools that route back through the same function (`createAgentServicePiTools`, `api-service.ts:7869`). A promoted tool and a `call` of it behave identically: same validation, same narrowing, same executor. <!-- id:NFz3qyK1 -->

## `search` <!-- id:hXDTk_mE -->

Seed hypermedia search over document titles and contacts, and optionally bodies and comments. Input `{query, accountUid?, includeBody?, contextSize?, searchType?: 'keyword' | 'semantic' | 'hybrid', pageSize?}`. Returns ranked results with hm:// URLs. The daemon request is [Search](../rpc/search.md). <!-- id:awBGnb8w -->

## `query` <!-- id:1f1goTTm -->

Finds current documents by their attributes. It is the structured complement to `search` and does not match free text. Input `{q?, filter?, sort?, pageSize?, pageToken?}`. At least one of `q` or `filter` is required, and both are ANDed. `q` uses the Explore grammar described on the [query grammar](../build/query-grammar.md) page (`key=value`, `key:text`, `has:key`, `in:<space or hm:// URL>`, `path:/specs/*`, AND/OR/NOT). `filter` is a raw `DocumentFilter` in JSON. `sort` takes attribute keys or the built-in fields `NAME`, `PATH`, `CREATE_TIME`, `UPDATE_TIME`, `ACTIVITY_TIME`, `COMMENT_COUNT`. `pageSize` defaults to 25, at most 100. The executor compiles the query and sends one `QueryDocuments` request to the configured HM server. Each result carries its URL, name, account, path, full attributes, authors, update time, and version. <!-- id:GNN4ar6q -->

## `attributes` <!-- id:j5uitYVU -->

Discovers which attribute keys documents use and what values a key takes, so the agent can learn a type's fields before it writes a `query`. See [typed documents](../schema/typed-documents.md). Without `key`, it lists attribute names with the kinds seen for each through `ListDocumentAttributeNames`. `parent` narrows to a nested object, and `recursive: true` lists full dotted paths. With a dotted `key`, it lists distinct values through `ListDocumentAttributeValues`, optionally for one `kind` (`string`, `int`, `bool`). `account` prioritises or restricts to one space, `prefix` filters, and `pageSize` defaults to 50, at most 200. <!-- id:IfSA0MYd -->

## `web_search` <!-- id:yjViFSdL -->

Backed by a self-hosted **SearXNG** instance (`GET /search?format=json`), with no third-party API keys. SearXNG has no index of its own. It federates public engines. Engines rate-limit datacenter IPs, so `executeWebSearch` (`web-tools.ts:180`) inspects `unresponsive_engines`. When the first query returns nothing but engines were unavailable, it retries once against a fallback engine set. It throws (which becomes `tool_result.error`) when no `searxngUrl` is configured. <!-- id:1JGPaHGk -->

The implementation matches the registry contract exactly. `timeRange` goes in (forwarded to SearXNG as its own `time_range` query param). A `partial` boolean comes out when engines were unavailable, and the markdown names the affected engines. Both sides drifted once. The audit caught it, and `0d877e3a1` fixed it with a test pinning the round-trip. <!-- id:-QRwHtKL -->

## `execute` <!-- id:5dic_Cn3 -->

Runs TypeScript, Python, or shell code in a hardware-isolated microVM with the agent's memory bind-mounted at `/workspace`, which is also the working directory (`agents/src/code-exec.ts`). <!-- id:nU6Y8gV3 -->

```ts <!-- id:sz2X8H0e -->
type ExecuteInput = {
  description: string // required: one short line saying what the run is for, 3–120 chars
  runtime: 'ts' | 'python' | 'shell'
  code: string
  timeout_secs?: number // clamped to [1, 300]
}
```

<!-- id:EM9I864U -->
- **`description` is required**, and it is what the user reads. Agents use `execute` constantly, and a row that says "Ran python code (exit 0, 812ms)" tells the user nothing. The contract demands the intent in one line ("Count words across the notes folder"). A call without one gets the contract back, like any other miss. The desktop row shows the description live while the sandbox runs, and afterwards as the summary. The summary leads with it and appends only what matters: a non-zero exit, or memory files touched. Runtime and duration stay in the expanded details. <!-- id:WtamqiDC -->
- `ts` runs `bun -e`, `python` runs `python -c`, `shell` runs `/bin/sh -c`. Nothing goes through a shell unless the runtime _is_ the shell. The sandbox takes an argv array, so code with quotes, newlines, or `$` needs no escaping (`code-exec.ts:470`). <!-- id:fSq8wN3B -->
- **Two images.** The main rootfs is a Python image with no JavaScript runtime, so `ts` runs in its own image (`SEED_AGENTS_EXEC_TS_IMAGE`, default `oven/bun`). An operator can set it explicitly empty to withhold TypeScript. The runtime is then not offered at all, so it is never advertised and then fails (`code-exec.ts:318`, `executeToolForRuntimes`). <!-- id:ICMlkC26 -->
- Each call gets a fresh **ephemeral** sandbox (`security: restricted`) with capped CPUs, memory, and lifetime (`timeout + 30s`). No state survives between calls, so the contract tells the model to save results as files and to `pip install --target /workspace/pylibs <pkg>`. <!-- id:iYhNTgqU -->
- Networking is **on by default**, with explicit DNS resolvers and a non-local egress policy (`NetworkPolicy.fromProfiles(['public'])`, falling back to `nonLocal()` for older staged SDKs, `code-exec.ts:117`). <!-- id:V5Dky7AY -->
- Output: `{summary, exitCode, success, stdout, stderr, truncated, durationMs, changedFiles}`. stdout and stderr are bounded at 64 KiB each. `changedFiles` is a before/after listing diff of memory. Live progress streams a \~2000-char output tail at most every 250 ms. <!-- id:Zr_CQ4Uz -->
- The SDK loads lazily and `availability()` is memoized. Hosts without virtualization run normally, and the tool is absent there instead of failing (`code-exec.ts:328`, with codes `config-disabled`, `unsupported-platform`, `whp-disabled`, `kvm-missing`, `kvm-forbidden`, `runtime-error`). <!-- id:nzXZhUiw -->

## Authored (lambda) tools <!-- id:tzwll2x7 -->

A lambda runs its stored source in the same sandbox. The call's validated input goes in and its return value comes back (`executeLambdaTool`, `api-service.ts:7662`). The ABI (`tool-documents.ts:22`): <!-- id:8p-mQ8J7 -->

```ts <!-- id:i6bvXwNl -->
// runtime: 'typescript' — run with bun
export default async function (input: {city: string}) {
  return {tempC: await lookup(input.city)}
}
```

```python <!-- id:OGOpC1qL -->
# runtime: 'python'
def main(input):
    return {"tempC": lookup(input["city"])}
```

`buildLambdaProgram()` (`code-exec.ts:502`) wraps the source into a self-contained program with the input baked in as a double-`JSON.stringify` literal, so no interpolation can escape into code. TypeScript is imported as a module from a `data:` URL. It keeps its natural `export default` shape and type annotations and never touches the filesystem. Python gets an epilogue that calls `main` and awaits it if it is a coroutine. <!-- id:f-bHTuGv -->

The return value travels on a marked stdout line (`LAMBDA_RESULT_PREFIX = '__SEED_TOOL_RESULT__'`). A result file would have to live somewhere, and `/workspace` _is_ the agent's memory, so the file would litter memory and show up in `changedFiles`. Everything unmarked comes back to the caller as `logs`, so ordinary `print` and `console.log` debugging still works (`code-exec.ts:489`, `parseLambdaResult` at `code-exec.ts:543`). <!-- id:9lADD45R -->

Failures are thrown. A non-zero exit, no returned value, or a value the tool's own `output` schema rejects means the tool is broken, and the model that authored it is the one who can fix it. An input miss still returns the contract, exactly like a builtin. <!-- id:P_MNxRje -->

Two gates apply before a lambda runs. The server must actually offer that runtime, and the agent must hold the `execute` grant. An authored tool is code in the sandbox, so writing one must not get around an owner who turned code execution off (`api-service.ts:7684`, `api-service.ts:7696`). <!-- id:aisa2jmo -->

# `delegate` <!-- id:9vaS9oaE -->

Spawns a [child](./child.md) run. There are two kinds of child and one verb (`api-service.ts:7889`). The [delegate](./delegate.md) term page has the short version. <!-- id:ApEK039O -->

**Model child.** Pass `brief`: human-readable markdown that becomes the child conversation's first message **verbatim**. The user reviews it as the child's full context. See [brief](./brief.md). <!-- id:n7YXckLv -->

- `prompt` gives an anonymous worker persona.
- `tools` narrows the child's set. It is intersected against the parent's full callable set, not a stale minimal default (`api-service.ts:2623`).
- `model` runs the child on one of the agent's enabled models ("provider/model", or a bare model id when unambiguous). `resolveDelegateModelRef()` resolves it at spawn time against `enabledModels` plus the active pair, then stores it as the child session's model override. The user's quick-switch uses the same mechanism, so run resolution and every client surface agree on what ran.
- `model` and `reasoningLevel` travel together (`normalizeDelegateModelChoice()`). A `model` without a `reasoningLevel` (`off` or one of the levels) is refused, with no default. A level without a model is refused too. Omitting both inherits the agent's configured model and level. This stops a child from silently running the agent's model with reasoning off: an override stores the level explicitly, and an absent level on an override means off.
- Agents with more than one enabled model get system-prompt guidance to route cheap mechanical subtasks to cheaper models and hard reasoning to the strongest.

A child always runs as the delegating agent. Direct agent-to-agent delegation (`agentId`) was removed on purpose. A transcript that an agent's collaborators or the public can read must never leak the account's other agents or carry their briefs and results. Cross-agent collaboration happens through Seed content (documents and comments), where the [capability](../protocol/permissions.md) system governs access. A stray `agentId` is refused loudly at both the spec and dispatch layers. <!-- id:EaXmZDVV -->

`output` declares a JSON schema for a validated [typed result](./typed-result.md), delivered through `return_result`. Without it the result is `{text}`. `normalizeSubSessionSpec()` (`api-service.ts:313`) accepts `input` as an alias for `brief`, and reads a bare `prompt` as the brief instead of bouncing the call. Models write the task into `prompt` often enough that a retry is worse than a rescue. <!-- id:_j0ELcwy -->

**Script child.** Pass `script`, a self-contained module `export default async function (input, ctx) {…}` run in an in-process QuickJS-WASM realm (`agents/src/workflow-host.ts`). See [script](./script.md). Everything external crosses through `ctx`: `ctx.call(tool, input, {description})`, `ctx.delegate`, `ctx.parallel`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.continueAsNew`, `ctx.step`, `ctx.plan`, `ctx.now`, `ctx.log`, `ctx.progress`, `ctx.input`, `ctx.runId`. Scripts hold the read and write verbs plus the agent's callable set (`api-service.ts:3801`), including enabled authored lambda tools created earlier in the same parent turn. Every effect goes into the [journal](./journal.md), so resume after a crash or a timer wake replays from the top and completed work never re-executes. Detached script children are rejected outright. Scripts are always awaited. <!-- id:pnR_U13Y -->

**Parallelism.** Spawn independent children together. Every `delegate` call in one reply runs at the same time. The turn then [parks](./park.md) (cheaply, and restart-proof) until all of them resolve, and each call receives its own result. `await: false` detaches: the child runs with the brief as its first message and returns nothing. `output` and `tools` are then rejected loudly, never silently discarded (`api-service.ts:7909`). `model` is still honored, resolved against the agent's enabled models. <!-- id:2N0kICDu -->

**Budget.** Depth and fan-out are a per-tree budget, set per run. Every root run (a user's turn, a trigger firing, a continuation successor, a retry) is created with `budget.maxDepth` and `budget.maxChildren`. The values come from the session's `thoroughness` override, or else from the agent definition. Every child copies its parent's budget, so a whole tree follows one setting even if the user changes it mid-run. The presets (`THOROUGHNESS_PRESETS` in `agents-protocol/delegation.ts`) are quick (depth 1, 4 children per run), normal (3, 10), and deep (5, 16). `normal` is the default. Depth counts model children only. A script child does not count (`#delegationDepth`), so root, script, worker, sub-worker is depth 2, and the tree the user sees matches what the limit counts. <!-- id:OzDe9cN0 -->

**Leaves.** A run at the budget's depth is a leaf. It gets **no delegate verb at all** and no spawn handlers (`#delegationStatus`, `canDelegate`), and its system prompt says so ("You are a leaf worker…"). It never gets a verb whose every call is refused and costs a turn. <!-- id:44rasYwX -->

Every non-leaf turn's prompt states its depth, how many children it may still start, and whether its children could delegate further. A parent whose children will be leaves is told to give them self-contained briefs (`delegationPrompt()`). A resolved child's `tool_result` also carries `delegation: {depth, maxDepth, childCouldDelegate, parentChildrenRemaining, parentMaxChildren}`. The parent's count there is the live one, since its system prompt was built when the run started. `~/self` shows the agent's preset and limits.

When a run uses its last slot, `childrenExhaustedMessage()` tells it to finish alone now, and how to pack the next long list: several items per brief, or one script child whose children draw on their own budget. The one remaining fixed limit is 3 `return_result` retries (`MAX_RETURN_RESULT_RETRIES`).

**Choosing thoroughness.** A person picks the preset where they pick the model: the agent's Settings tab, the Create Agent dialog, and the model badge on a session. That includes the assistant panel's draft chat, whose choice goes with `CreateSession`. A session's change applies from its next root run, because running trees keep the budget they copied. The run queue also knows a wall-clock budget, `maxWallMs`. It parks a run with the `budget-pause` wait reason until a person resumes it with `SignalRun`. As of September 2026 nothing outside tests sets it. The [delegation budgets](./plans/delegation-budgets.md) plan proposes pause cards, tree-wide budgets, and token budgets on top of this. <!-- id:gd7-bOM2 -->

# `plan` <!-- id:zu6_3lwq -->

Maintains the thread's visible checklist: `{title?, steps: [{id, label, status: pending | running | done | failed | skipped}]}`. Each call replaces the whole plan. The plan is stored on `sessions.plan_cbor` and writes **no transcript event**, because the checklist is a card and not part of the conversation. The server stamps the owning run id. When every [step](./step.md) settles, it copies that snapshot onto the run, so the completed plan stays in transcript history even after a later turn replaces the session's mutable plan. The [plan](./plan.md) term page has the short version. <!-- id:rWxol_cq -->

The runtime handles one consequence of this directly. A model resuming after its children finished cannot see the list it published. So `planStateBlock()` (`api-service.ts:414`) rebuilds a `<plan_state>` block from session state on **every turn** and injects it into the replay as the last user message. It is never stored. The transcript keeps exactly one copy of the truth, and the log records what happened, never what the runtime reminded the model about. Step ids and labels are model-authored text handed back inside a frame whose syntax the model knows, so both go through `escapeActionFraming()`. <!-- id:6gIaYQei -->

**Runtime settlement.** When every run attached to a running step comes back `succeeded`, `#settlePlanStepFromChildren()` (`api-service.ts:2727`) marks the step `done` with `resolvedBy: 'runtime'`. Only success settles a step. What a failed child means is a judgment the model makes, and the continuation loop exists to make it ask. Model input can never forge `resolvedBy`. `normalizeRunPlan` reads only what the model may say, and `#carryResolvedBy()` (`api-service.ts:2174`) carries the runtime's mark across later writes while the step stays done. It drops the mark if the step is reopened or written off. <!-- id:mCLG-mEC -->

**Obligations.** A turn that ends still owing something does not just end. `#openObligations()` (`api-service.ts:2776`) collects one list: an undelivered typed result, and unfinished plan steps. The run hands the turn back with every open obligation named at once, up to `MAX_RUN_CONTINUATIONS` (3) times (`#executeAgentRun`, `api-service.ts:2607`). <!-- id:ou9pyPWe -->

Steps left open while children are still working are not obligations, because someone else is carrying them. `failed` and `skipped` are terminal. An agent that says it could not do something has kept the contract, and the runtime never nags it into pretending otherwise. When the budget is spent, the run leaves an actor-`system` notice that says exactly what was left undone. A typed child that never delivered **fails**. An unfinished plan **succeeds owing it**. Nothing is ever ticked off on the agent's behalf.

# `status` <!-- id:mbUuxFT_ -->

Sets the session's agent-maintained `title` and `description`: `{title?, description?}`, passing only the fields that change. The title names what the whole session is about and is set once, early. The description is the live status. The agent updates it at milestones and once more when the work finishes. Each turn shows the current values in a `<session_status>` block, so a call is always a change and never a restatement. A title the user typed is never overwritten. The call is hidden in the log, like `plan`. <!-- id:wNgr5l4d -->

# `return_result` <!-- id:yPsyH8z2 -->

Exposed only inside typed delegate children. Its declared parameters ARE the spawner's `output` schema, swapped in at session start (`api-service.ts:7938`). The server validates the payload, and failures return the error list to the child so it can correct itself. Delivering the result ends the child's turn immediately. Nothing else it might still owe is worth another turn (`api-service.ts:2640`). <!-- id:Ng94MMwb -->

\--- <!-- id:lLYxV_df -->

# `continue_session` <!-- id:YHR-90vs -->

Carries the conversation into a fresh **successor** session and ends the turn. The successor's run answers the user. Input: `{reason, title, description, handoff: {purpose, currentRequest, establishedFacts?, decisions?, openQuestions?, nextActions?, cautions?}, sources?, transfer?: {plan}}`. `title` and `description` are required. The predecessor names the successor exactly as the `status` verb would (`title_source = 'agent'`). <!-- id:Tu7wr6n5 -->

The verb is available to a foreground conversation with a live run. It is never available to a delegated child (typed or not) or a script. It is idempotent on the tool call id. The predecessor's transcript is untouched. The successor opens with a runtime-generated projection (lineage, the handoff, cited and recent excerpts), followed by the initiating user message copied verbatim. Each turn where the verb is available also carries a `<context_usage>` block. Full account: [`session-continuation.md`](./session-continuation.md).

# The user holds the same verbs <!-- id:dwr2ygva -->

`InvokeSessionTool` (`agents/protocol/src/index.ts:616`) runs `read`, `write`, or `call` **as the user** on the session's shared log (`#invokeSessionTool`, `api-service.ts:2345`). The call and its result append as actor-`user` events, so the agent reads them on its next turn exactly as it reads its own. The log is the interface. There is no side channel. In the app this is the [wrench palette](./wrench-palette.md). <!-- id:yY41iY_5 -->
  - `delegate` and `plan` are rejected. Delegation is a conversational ask, so the user messages the agent instead. <!-- id:GGnI4jWM -->
  - The request is rejected with 409 while the session has a live run. <!-- id:Pyr3dfgV -->
  - Execution failures are log entries too (a failed attempt is context) and come back in the response. Only pre-execution validation rejects the request outright. <!-- id:HXdtpBjo -->
  - On replay, user tool calls become `<user_action>` and `<user_action_result>` tagged user messages. Providers have no notion of a user-made tool call, so these are not sent as provider tool exchanges (`api-service.ts:4878`). The system prompt tells the agent these are shared ground truth it can build on without re-running them (`api-service.ts:4190`). <!-- id:lj8l9b0x -->

# Event shapes <!-- id:OTsBgC0e -->

```ts <!-- id:pyaCekfO -->
{type: 'tool_call', id: string, name: string, input: unknown, actor?: SessionActor}
{type: 'tool_result', toolCallId: string, name: string, output?: unknown, error?: string,
 actor?: SessionActor, meta?: SessionEventMeta}
```

`SessionActor` is `'user' | 'agent' | 'system' | 'trigger'`. Events written before the field existed derive their actor from their shape via `sessionEventActor()` (`agents/protocol/src/index.ts:952`). `SessionEventMeta` carries `model`, `provider`, `usage`, and `durationMs`. This provenance is stamped once at append time, because none of it can be recovered after the run is gone. See [actor](./actor.md). <!-- id:hksYR3Hb -->

Tool failures should usually become `tool_result.error`, so the model can respond to them. <!-- id:NpXTgZQ2 -->

# Tool lifecycle <!-- id:96sl4tD5 -->

<!-- id:T5dSr29_ -->
1. The server registers the verbs (plus any promoted callables) with Pi, with `noTools: 'builtin'` so Pi's own host tools never load. <!-- id:xsFatZeE -->
2. Pi calls the model. The model returns assistant text and tool calls. <!-- id:yQNautgz -->
3. Pi emits `message_end` before tool execution. The server appends the turn's assistant text as a durable `message` event with its `meta`. <!-- id:mUpcgNp_ -->
4. The server appends a durable `tool_call` event, executes the Seed-owned implementation, and appends `tool_result`. <!-- id:TjGqsaDS -->
5. The model continues until final assistant text. Each later assistant turn is appended at its own `message_end`. <!-- id:SsXCJthS -->

On later turns the server rebuilds durable assistant text and consecutive `tool_call` events as a single Pi assistant message, placed before their matching `tool_result` messages. This keeps provider replay valid for APIs such as OpenAI chat completions, which reject orphaned `tool` messages and expect multi-tool batches grouped. <!-- id:TyneiaQU -->

Parked `delegate` calls keep their durable `tool_call` unanswered on purpose, until the child's finalizer appends the real result. A post-park reconcile pass closes the race where a fast child finalizes before the parent's `waiting` status commits. <!-- id:9Dtuf-4o -->

# Size limits <!-- id:TX-32IwL -->

There are two ceilings, for two purposes: <!-- id:kJKoobvp -->
  - `MAX_TOOL_RESULT_BYTES` (256 KiB, `api-service.ts:150`) bounds what a tool may produce durably. Rendered document and comment markdown is truncated on a byte boundary at this cap before it enters the session event log. <!-- id:YNMk7akJ -->
  - `MAX_MODEL_TOOL_RESULT_BYTES` (8 KiB, `api-service.ts:157`) bounds what any single tool result adds to the provider context. `boundModelToolResultText()` cuts the serialized result on a UTF-8 character boundary. It appends a notice that tells the model the result was truncated and that it must work in bounded pieces (narrower reads, or saving the source into a memory file and processing it with `execute`), and must not retry the same call. The cut happens at the single tool-definition choke point (`defineSeedPiTool`) for live calls, including `piContent` text parts (image parts have their own inline cap). It happens again on transcript replay (assistant tool results, orphan results, and user-action payloads), so a resumed session sees the same bounded transcript the live session saw. <!-- id:8ZWEBIvj -->

Durable session events and the desktop UI keep the tool's full output. Only the model-facing text is cut. <!-- id:CT2cC3O1 -->

# Adding or changing a tool <!-- id:uKwdCMoS -->

1. Update the canonical entry in `agents/protocol/src/tool-registry.ts`: prompt metadata, JSON schema, render metadata. The contract is what the model reads. <!-- id:1szaBnqq -->
2. Add the runtime executor in `executeCallVerb` (callables) or the verb dispatcher (address forms). Do not duplicate descriptions or schemas. <!-- id:KYMu7zib -->
3. Validate model-supplied input at the boundary. On a miss, return the contract, not an error. <!-- id:sSNEFpY5 -->
4. Bound output size. <!-- id:9XX-XBuu -->
5. Confirm the tool document CID changes as intended. A changed contract rewrites every agent's builtin row. <!-- id:SgIkaDDA -->
6. Decide the grant: is it in the callable set, or does it need publish? <!-- id:iyVvFrmL -->
7. Add tests for success, tool failure, and provider continuation. <!-- id:UW1RpNvJ -->
8. Update `tools.md`, `security.md`, `desktop-ui.md`, and `roadmap.md`. <!-- id:tBAUc28m -->

# See also

- [Seed Agents](../agent.md)
- [Grants](./grants.md)
- [Tool document](./tool-document.md)
- [MCP servers](./mcp.md)
- [Triggers](./triggers.md)
- [Security](./security.md)
- [Session continuation](./session-continuation.md)
- [Building agents on Seed](../build/agents.md)
