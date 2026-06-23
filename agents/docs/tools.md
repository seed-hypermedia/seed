# Tools

Agent tools allow a model to request external work during a session. Tool calls and results are persisted as durable
session events and shown in the desktop chat log.

## Unified registry

The canonical tool registry lives at `agents/protocol/src/tool-registry.ts`. It is shared by the standalone Agents
service and the desktop local assistant. Each entry owns the model-facing name, label, prompt description, JSON input
schema, optional output schema slot, runtime availability, visibility/configurability flags, and chat-rendering
metadata. Server runtimes add only tool-specific execution functions around those registry entries, and chat UIs choose
their bubble renderer from the same registry metadata. Desktop-only actions such as `navigate` are marked for the local
assistant runtime and are not exposed by the agent service.

## Current tools

User-configurable tools:

```text
read
list_activity_feed
web_search
web_read
write
```

`read` is available by default for existing agents whose saved definition omits `tools`. Agents with an explicit `tools`
array can enable or disable user-configurable tools from the autosaving desktop Tools tab. The local desktop assistant
also uses the same `read` model-facing API; the old local `read` name is only a legacy chat history rendering alias.

Hidden runtime tool:

```text
set_session_title
```

`set_session_title` is always available to the model but is not stored in agent `tools`, shown in the desktop Tools tab,
or rendered as a durable tool call/result in chat. The system prompt tells the model to set a concise one-line title
when the conversation purpose becomes clear and to update it if that purpose changes.

Near-term project: augment `read` into the general SHM read/query path rather than ignoring it or replacing it blindly.
A future model-facing `query` alias may be added, but existing `read` behavior must remain compatible.

## Tool lifecycle

1. Server registers Seed-approved tools with the Pi SDK.
2. Pi calls the model with tool definitions.
3. Model returns assistant text and tool call deltas/final tool calls.
4. Pi emits assistant `message_end` before tool execution; the server appends any assistant text from that turn as a
   durable `message` event.
5. Pi emits tool execution events.
6. Server appends durable `tool_call` event for visible tools.
7. Server executes the Seed-owned tool implementation through Pi.
8. Server appends durable `tool_result` event for visible tools.
9. Pi sends result back to the model as a tool message.
10. Model continues until final assistant text is produced; each later assistant turn is also appended at `message_end`.

Hidden tools can perform server-side state changes without visible `tool_call`/`tool_result` events. Today this applies
only to `set_session_title`, whose state change is surfaced through normal session-change/account-change events.

On later turns, Seed reconstructs durable assistant text and consecutive `tool_call` events as a single Pi assistant
message before their matching `tool_result` messages. This keeps provider replay valid for APIs such as OpenAI chat
completions, which reject orphaned `tool` messages and expect multi-tool batches to remain grouped.

## Event shapes

Tool call:

```ts
{
  type: 'tool_call'
  id: string
  name: string
  input: unknown
}
```

Tool result:

```ts
{
  type: 'tool_result'
  toolCallId: string
  name: string
  output?: unknown
  error?: string
}
```

Tool failures should usually become `tool_result.error` so the model can respond gracefully.

## `set_session_title`

Input:

```ts
type SetSessionTitleInput = {
  title: string
}
```

The title is normalized with the same bounded session-title validation used by the public `UpdateSession` action. Agent
writes mark the row as agent-authored. If a user has manually edited the title through `UpdateSession`, the session row
is marked user-authored and later `set_session_title` calls are ignored so the manual title always wins.

## `list_activity_feed`

Input:

```ts
type ListActivityFeedInput = {
  pageSize?: number
  pageToken?: string
  trustedOnly?: boolean
  filterAuthors?: string[]
  filterEventType?: string[]
  filterResource?: string
}
```

`list_activity_feed` reads recent SHM activity from the gRPC-compatible `ActivityFeed/ListEvents` path. It is useful for
observing new or recent content without knowing exact document URLs. The desktop assistant executes it through the local
daemon gRPC client; the agent service executes it through the configured HM server `ListEvents` request scoped to the
signed agent account.

Supported filters mirror `ListEvents`:

- `pageSize` limits the number of newest events returned; use small values such as 5-20 for exploration;
- `pageToken` continues from a previous `nextPageToken`;
- `trustedOnly` asks the daemon/server to apply trusted-source filtering;
- `filterAuthors` restricts events to one or more author account UIDs;
- `filterEventType` can include values such as `Ref`, `Comment`, `Capability`, `Contact`, `Profile`, `DagPB`,
  `comment/Embed`, `comment/Link`, `comment/Target`, `doc/Embed`, `doc/Link`, and `doc/Button`;
- `filterResource` restricts results to an HM resource, and daemon/server implementations may support prefix forms such
  as `hm://account/path*` for path-related activity.

The result includes a summary, loaded/resolved events where supported by the runtime, and `nextPageToken` for
pagination.

## Web research tools (`web_search`, `web_read`)

`web_search` and `web_read` give agents access to the public web. They are fully self-hosted and use no third-party API
keys. Implementation lives in `agents/src/web-tools.ts`; configuration lives in `agents/src/config.ts` under `web`
(`SEED_AGENTS_SEARXNG_URL`, `SEED_AGENTS_CRAWLER_URL`, `SEED_AGENTS_CRAWLER_TOKEN`). The config is threaded through
`Service` into the tool context, exactly like `hmServerUrl`.

These are distinct from the Hypermedia `search`/`read` tools: `search`/`read` operate on the Seed network, while
`web_search`/`web_read` operate on the public internet. Tool descriptions instruct the model to use the Seed tools for
`hm://` and Seed site URLs and the web tools for arbitrary internet pages.

### `web_search`

Input:

```ts
type WebSearchInput = {
  query: string
  count?: number // default 10, max 25
  category?: 'general' | 'news' | 'science' | 'it'
  time_range?: 'day' | 'week' | 'month' | 'year'
  language?: string // default 'en'
}
```

Backend: a self-hosted **SearXNG** instance queried at `GET /search?format=json`. SearXNG has no index of its own; it
federates public search engines. Because engines rate-limit datacenter IPs, the tool inspects `unresponsive_engines`
and, when the first query returns no results but engines were unavailable, retries once with a different engine set. The
result includes a `degraded` flag and `unavailableEngines` so the model knows when coverage was partial. `web_search`
throws (becomes `tool_result.error`) when no `searxngUrl` is configured.

Output: `{summary, query, results: [{title, url, snippet, engine}], degraded, unavailableEngines, markdown}`.

### `web_read`

Input:

```ts
type WebReadInput = {
  url: string // http(s) only
  query?: string // optional focus; enables BM25 filtering when browser rendering is used
}
```

`web_read` uses a tiered, cheapest-first reader chain and returns the first tier that yields substantial content
(`>= 200` characters):

1. **MediaWiki API** — when the URL looks like a wiki page (`/wiki/Title` or `?title=Title`), the host is probed once
   via `api.php?meta=siteinfo` (cached per host) and, if it is MediaWiki, the page is fetched as Parsoid HTML from the
   REST endpoint `{scriptpath}/rest.php/v1/page/{title}/html` and converted to markdown. No browser, highest quality for
   wikis.
2. **In-process static extraction** — a plain `fetch` of the URL, then Mozilla Readability (`@mozilla/readability` on a
   `linkedom` DOM) extracts the main article and Turndown converts it to markdown. Runs entirely inside the Bun process;
   no extra container. Readability throwing or returning thin content escalates to the next tier.
3. **Crawl4AI** — when configured (`SEED_AGENTS_CRAWLER_URL`), the URL is rendered by a self-hosted Crawl4AI headless
   browser via `POST /md` (Bearer `SEED_AGENTS_CRAWLER_TOKEN`). This is the reliability backstop for JS-heavy/SPA and
   anti-bot pages, and for hosts where Bun's `fetch` fails. One retry covers transient browser hiccups.

If the crawler is not configured, `web_read` relies on the MediaWiki and static tiers only. When every tier fails it
throws a clean error naming the tiers tried.

Output: `{summary, url, finalUrl, title, source: 'mediawiki' | 'static' | 'crawl4ai', truncated, success, markdown}`.
Markdown is bounded to 200 KiB (under the 256 KiB tool-result cap); oversized content is truncated on a byte boundary
with `truncated: true`.

## `write`

For document and ref commands, `input.path: "/"` is accepted as the account home document and is published as the
canonical empty HM path, so refs do not fail server validation for trailing slashes.

## `read`

Input:

```ts
type ReadHypermediaInput = {
  id: string
  server?: string
  dev?: boolean
  format?: 'markdown' | 'json'
}
```

Accepted IDs/URLs:

- `hm://...`
- `hm:...`
- `https://...`
- `http://...`
- exact block fragments such as `hm://.../path#BLOCK_ID`
- comment view URLs such as `hm://doc/path/:comments/UID/TSID`, `https://site/doc/:comments/UID/TSID`, and
  `?panel=comments/UID/TSID`

Model-facing block-link rule: before returning a block-level link, the model should call `read` for the target
resource/version and copy the exact `<!-- id:BLOCK_ID -->` marker from the markdown result. Seed document fragments are
not HTML heading anchors; models must not invent heading slugs, title slugs, or URL-safe text fragments. After `write`
creates, forks, copies, or edits a document, read the resulting document before returning links to changed blocks
because block IDs may differ from the source document.

## Shared URL and domain resolution

The tool uses shared internal SDK code:

- `frontend/packages/client/src/resource-read.ts` — `resolveIdWithClient()`, the unified read-target resolver used for
  document and comment inputs.
- `frontend/apps/cli/src/utils/resolve-id.ts` — CLI wrapper using the same helper.
- `frontend/packages/client/src/hm-resolver.ts` — lower-level web/HM resolution through `resolveId()` and
  `resolveHypermediaUrl()`.

The agent does not shell out to `seed-cli`.

Important project requirement: users commonly paste clean HM web-domain URLs such as `https://example.com/path`. Agent
tools must reuse the existing resolver workflow used elsewhere in the app:

1. detect Seed comment view URLs (`/:comments/UID/TSID`, legacy aliases, or `?panel=comments/UID/TSID`) and convert them
   to the canonical comment HM ID before document path resolution;
2. parse `hm://`/`hm:` IDs directly;
3. for web URLs, call `resolveHypermediaUrl(url, {domainResolver})` through `resolveId()`/`resolveIdWithClient()`;
4. try the domain resolver first so cached custom-domain mappings can produce an HM URL;
5. fall back to OPTIONS-header resolution when the domain resolver returns null or fails.

`resolveIdWithClient()` accepts and passes through `DomainResolverFn`. The agents Bun service provides a resolver with
the same shared interface, backed by Seed API `GetDomain` rather than desktop daemon `grpcClient`.

If the model supplies a canonical `hm://...` ID without `server`/`dev` after the user pasted a dev URL, `read` first
checks the default production server and then falls back to `https://dev.hyper.media` only when production returns
`not-found` or `error`. This keeps dev comment/document reads working even if the model strips the URL origin before
calling the tool.

## Output

Markdown output resolves Seed embeds before returning content to the model. Inline `Embed` annotations are rendered with
human-readable account/profile or document/comment labels. Block `Embed` nodes inline the embedded document or comment
markdown, including block-fragment zooms and a note when a specific version is referenced.

```ts
{
  type: 'hypermedia_document'
  requestedId: string
  id: string
  server: string
  format: 'markdown'
  dev?: true
  title?: string
  version?: string
  metadata?: Record<string, unknown>
  markdown: string
}
```

For web-domain inputs, `requestedId` should remain the pasted URL and `id` should be the resolved `hm://` URL so the
model and UI can show both the user's original reference and the canonical HM identity.

JSON output:

```ts
{
  type: 'hypermedia_document'
  requestedId: string
  id: string
  server: string
  format: 'json'
  resource: unknown
}
```

`id` is the resolved HM URL; `requestedId` is the model-supplied input.

## Size limit

`MAX_TOOL_RESULT_BYTES` is 256 KiB. Oversized rendered markdown fails with a tool error.

## Desktop rendering

Desktop session page renders:

- user and assistant messages through the shared assistant chat bubble renderer;
- assistant messages and live partials as markdown through `AssistantMessageParts`;
- paired `tool_call`/`tool_result` events through the shared tool-call bubbles;
- `read` results as read/document tool bubbles with document links and raw-debug access;
- errors as destructive text;
- unknown event payloads as JSON fallback.

## Security considerations

`read` may contact URLs supplied by the model. It follows CLI-compatible resolution behavior, including web URL
resolution via HTTP methods and Seed resource fetching.

Production improvements needed:

- outbound network policy;
- audit log;
- optional allow/deny lists;
- private-network read protection;
- runtime implementations for signing/publishing tools that use the per-agent selected uploaded HM account key.

## Planned general read/query shape

The preferred next step is to augment the existing read tool before adding more model-facing tools. The generalized path
may support an input like:

```ts
type ReadHypermediaOrQueryInput =
  | {id: string; server?: string; dev?: boolean; format?: 'markdown' | 'json'}
  | {
      key: ReadonlySeedRequestKey
      input?: unknown
      id?: string
      url?: string
      server?: string
      dev?: boolean
      format?: 'markdown' | 'json'
    }
```

Rules:

- `id`/`url` shortcuts should resolve pasted HM IDs and web-domain URLs through the shared resolver stack;
- read-only Seed client request keys can be supported (`Resource`, `Search`, `Query`, `ListComments`, `ListCitations`,
  and related GET requests);
- action/write keys (`PublishBlobs`, `PrepareDocumentChange`) must be rejected until there is an explicit write-tools
  permissions project;
- document/comment `Resource` reads should continue to return markdown by default.

## Signing and publishing tools

The autosaving desktop Tools tab now stores per-agent `signingKeys` secret names selected from account-scoped secrets
whose metadata has `kind: 'hm-account-key'`. The list response is redacted and account-filtered. If no agent accounts
exist, the tab opens a new-account panel that creates a server-side Ed25519 HM account key through
`CreateSigningIdentity`; the raw seed is encrypted as an account-scoped secret and never returned to the desktop.
Selected identities are passed to the agent with both profile names and public key IDs so users can refer to names while
`write` uses public key IDs. The initial model-facing write tool mirrors CLI-style commands for profiles, drafts,
documents, comments, capabilities, and contacts, and only uses keys selected on the agent.

`write` accepts both a structured `input` object and CLI-like command arguments at the tool-call root. The server folds
unknown root-level arguments into `input` before command validation, so calls such as
`{command: 'comment.create', signer, id: 'hm://...', text: '...'}` are equivalent to using
`input: {id: 'hm://...', text: '...'}`. For documents and drafts, `body` and `text` are accepted as `content` aliases,
and `title` is accepted as a `name` metadata alias. For `document.move`, `id`, `target`, and `targetId` are accepted as
source aliases, and `path` can be used instead of a full destination URL to move within the same account; `path: '/'`
moves the document to the account home/root. For comments, `body`, `content`, and `text` are accepted as body aliases.
For `comment.create` replies, `replyCommentId`, `replyComment`, `reply`, and `replyTo` are accepted as parent-comment
aliases. Trigger-created sessions add explicit model instructions to use `trigger_context.activity.comment.id` (or
`activity.commentId.id`) as `replyCommentId` when responding to a mention or comment activity so the published comment
is threaded instead of orphaned. If a reply parent is provided without a target document, the server derives the target
from the parent comment. Root-level `server` and `dev` are accepted only when they resolve to the configured agent HM
server; publishing always uses that configured server and never an arbitrary model-selected server.

## Adding new tools

Checklist:

1. Add or update the canonical entry in `agents/protocol/src/tool-registry.ts` with prompt metadata, JSON schema, and
   render metadata.
2. Add provider/runtime-specific execution around the registry entry; do not duplicate descriptions or schemas.
3. Validate model-supplied input at tool boundary.
4. Bound output size.
5. Append `tool_call` and `tool_result` events.
6. Add specialized chat rendering only when the registry render kind is insufficient.
7. Avoid logging sensitive input/output.
8. Add tests for success, tool failure, and provider continuation.
9. Update `tools.md`, `security.md`, `desktop-ui.md`, and `roadmap.md`.
