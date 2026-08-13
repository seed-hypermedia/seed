# Tools

An agent's entire model-facing tool surface is **five verbs**: `read`, `write`, `call`, `delegate`, `plan`. Everything
else — searching, the web, code execution, an agent's own authored tools — is either an address form of a verb or a
**callable tool** dispatched through `call`. Tool calls and results are persisted as durable, actor-stamped session
events and rendered in the desktop log.

## The registry

The canonical registry lives at `agents/protocol/src/tool-registry.ts`. The Agents service executes from it and the
desktop renders from it, so a tool's prompt text, schemas, and chat bubble can never drift apart. It exports three
tables:

- `seedVerbRegistry` — the five verbs plus the hidden `return_result` mechanism. This is the **only** provider-facing
  toolset (`agents/protocol/src/tool-registry.ts:398`).
- `callableToolRegistry` — `search`, `web_search`, `navigate`, `execute`. These are never handed to the provider as
  tools by default; `call` dispatches them (`tool-registry.ts:613`).
- `seedToolRegistry` — both, merged, for renderers and validation lookups (`tool-registry.ts:630`).

Each entry owns the model-facing name, label, prompt description, JSON input schema, optional output schema, runtime
availability (`assistant` / `agent-service`), rendering metadata, and an optional `getReferencedUrls` extractor used to
sync hm:// resources a call touched. Server runtimes add only execution functions around registry entries; chat UIs pick
their bubble renderer from the same metadata.

`navigate` is marked `runtimes: ['assistant']`, so the agent service never offers it: `serviceCallableNames()`
(`agents/src/api-service.ts:285`) filters on `runtimes.includes('agent-service')`, leaving the service's callable set as
`search`, `web_search`, `execute`. Nothing on this branch runs the `assistant` runtime, so `navigate` is currently inert
— it is kept as the registry entry a desktop-side executor would bind to.

### Legacy names

`normalizeSeedToolName()` maps exactly one renamed callable: `execute_code` → `execute` (`tool-registry.ts:642`). Names
that were absorbed into verbs — `memory_*`, `web_read`, `ipfs_*`, `attachment_*`, `list_activity_feed`, the old spawn
tools, `update_plan`, `set_session_title` — have **no** alias on purpose. The verbs are always on, so those entries in a
stored `tools` array are simply inert.

## Tools are documents

Every tool an agent holds is a content-addressed document in its Space, stored per agent in the `tool_documents` table
(`agents/src/tool-documents.ts`). A document's CID is computed over its canonical DAG-CBOR encoding — the same encoding
the hypermedia network uses for blobs — so "what exactly can this agent run" is always answerable, and publishing a tool
to the network later means publishing bytes that already exist.

```ts
type ToolDocument = {
  name: string
  kind: 'builtin' | 'lambda'
  summary: string // one line, for the Space index and ~/tools listing
  description: string // full model-facing instructions
  input: JsonSchema
  output?: JsonSchema
  source?: string // lambda source
  runtime?: 'typescript' | 'python' // lambda language, default typescript
  binding?: string // builtin executor id, bound at boot
}
```

- **Builtins** are documents whose implementation is a runtime binding. `ensureBuiltinToolDocuments()` materializes and
  refreshes them per agent; rows are rewritten only when the registry contract changed (CID differs), so a forked
  builtin keeps its binding while its divergence from the shipped contract shows as a different CID
  (`tool-documents.ts:114`).
- **Lambdas** are authored by the agent: `write ~/tools/<name>` with JSON content. Validation
  (`saveLambdaToolDocument()`, `tool-documents.ts:188`): names match `/^[a-z][a-z0-9_-]{1,63}$/`, a builtin or verb name
  cannot be replaced, a description is required (≤ 16 KiB), source is required (≤ 256 KiB), and both schemas must pass
  `validateJsonSchemaShape`. `write ~/tools/<name>` with `{delete: true}` removes an authored tool; builtins refuse
  deletion and point at the agent's grants instead.

`ListAgentTools` (`api-service.ts:1656`) returns the owner's view of the same documents — name, kind, summary,
description, schemas, `source`, `runtime`, `cid`, `enabled`, and `granted` (whether the agent's grant set actually
offers it).

## The Space index

Every system prompt carries a compact `<space>` block built by `buildSpaceIndex()` (`api-service.ts:5900`): one line per
enabled tool document (`- name — summary`, authored tools tagged `(authored)`), a one-line memory top-level summary, and
active trigger names. It is cached per `(account, agent, callable set)` and invalidated on memory or tool writes. Over
`SPACE_INDEX_BUDGET_BYTES` (2048) the per-tool lines collapse to a count, so the index stays honest but tiny.

The point is that the agent always knows what it _could_ expand without paying for every contract up front.

## Touch-expand and promotion

`call` never punishes a miss. Calling an unknown tool returns the `~/tools` listing; calling a known tool with input its
schema rejects returns **the tool's contract** as the result, plus the validation errors, so the retry succeeds
(`executeCallVerb`, `api-service.ts:7794`).

Once a tool's contract has entered the transcript — an agent `read` of `~/tools/<name>`, or any `call` by that name —
the tool is **promoted** to a first-class provider tool for the rest of the thread. Promotion is derived purely from
durable `tool_call` events (`expandedCallablesFromEvents()`, `api-service.ts:7221`), so resume, park, restart, and
compaction all reconstruct the same set. Events with actor `user` are skipped: a user's palette call must not silently
reshape the agent's active toolset.

Promotion is intersected with the agent's enabled callables before anything reaches Pi (`api-service.ts:4322`):

```ts
const expandedCallables = this.#expandedCallablesForSession(sessionId)
  .map(normalizeSeedToolName)
  .filter((name) => enabledCallables.includes(name))
```

This filter is load-bearing security, not tidiness: a hallucinated `call {tool: 'bash'}` durably stores that name, and
an unfiltered allowlist would hand `bash` to Pi, activating Pi's own host builtins outside the sandbox.

## Grants

Verbs are never grants — they are always on. Two things are granted per agent, both through `definition.tools`:

- **The callable set.** `enabledCallableTools()` (`api-service.ts:304`) intersects the service callables with
  `definition.tools` (normalized, unknown names ignored); an undefined `tools` array grants all of them. `execute` drops
  out silently when the host cannot run sandboxes, so the model never sees a tool that can only fail.
- **Publish.** `publishGrantEnabled()` (`api-service.ts:299`) is the pseudo-tool name `publish` in `definition.tools`.
  Legacy write-group names (`write`, `memory_publish_document`, `ipfs_write`, `attachment_to_ipfs`) still count, so a
  pre-verbs agent keeps exactly the publishing posture its owner configured; an undefined `tools` array publishes.
  Without it, `write` to `hm://` or `ipfs://` returns 403 (`api-service.ts:7454`, `api-service.ts:7499`). Memory writes
  are never gated.

Definition limits: at most 32 tool names, 128 bytes each, 4 KiB total (`api-service.ts:106`).

---

## `read`

One dispatcher over every address form (`executeReadVerb`, `api-service.ts:7250`).

```ts
type ReadInput = {
  address: string
  format?: 'markdown' | 'json'
  options?: Record<string, unknown>
}
```

| address           | behavior                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `~/memory/<path>` | file content, or a directory listing (`{entries: [{path, type, size}]}`) for a directory address       |
| `~/tools/<name>`  | one tool's full contract as markdown; `~/tools/` alone lists everything callable                       |
| `hm://…`          | a hypermedia document or comment, markdown by default                                                  |
| `ipfs://<cid>`    | fetches through the configured `/ipfs/` gateway into memory (default path `ipfs/<cid>`) and returns it |
| `https://…`       | resolved as hypermedia first, then read as a web page                                                  |
| `activity:`       | the activity feed via `ListEvents`, filtered by `options`                                              |
| `attachment:<id>` | a session-private attachment (images are returned as image content to vision models)                   |
| `thread:<id>`     | a conversation transcript (its last 200 events) rendered as markdown                                   |
| `run:<id>`        | a run's public record, plus `sourceText` for script runs                                               |

Unrecognized addresses fail with the supported list (`api-service.ts:7350`).

`thread:` and `run:` are scoped by **account**, not by agent (`readThreadAddress`, `api-service.ts:7167`;
`readRunAddress`, `api-service.ts:7206`). The verb's own description says "another conversation transcript of yours",
which is narrower than what the query enforces: one agent can read the transcripts and runs of every other agent on the
same account.

**Tool contracts.** A read of `~/tools/<name>` resolves verbs from the registry and everything else from the agent's
tool documents. A builtin the agent has not been granted reads as "no tool named …" plus the listing, so grants are not
discoverable by probing. `contractMarkdownForThisServer()` (`api-service.ts:7641`) narrows the `execute` contract to the
runtimes this server can actually run and says so — the contract a model reads is the one it can call.

**Web escalation.** An `https://` address is tried as hypermedia first. It falls through to the web reader only when the
resolver explicitly says not-hypermedia, or the resource 404s. Every other failure — transient daemon errors, too-large,
network — surfaces, so scraped page HTML is never silently substituted for a document's real content
(`api-service.ts:7332`).

**Web reading tiers.** `executeWebRead` (`agents/src/web-tools.ts:371`) runs a cheapest-first chain and returns the
first tier yielding ≥ 200 characters: (1) **MediaWiki API** for wiki-shaped URLs, probing the host once via
`api.php?meta=siteinfo` (cached per host) and fetching Parsoid HTML; (2) **in-process static extraction** — plain
`fetch`, Mozilla Readability on a `linkedom` DOM, Turndown to markdown; (3) **Crawl4AI** (`POST /md`, Bearer token) when
`SEED_AGENTS_CRAWLER_URL` is configured, the backstop for JS-heavy and anti-bot pages. `options.raw: true` skips the
chain entirely and returns the response body verbatim (text content types only). Markdown is bounded to 200 KiB,
truncated on a byte boundary.

**Hypermedia output.** Markdown output resolves Seed embeds before returning: inline `Embed` annotations render as
human-readable account/document labels, block `Embed` nodes inline the embedded markdown including block-fragment zooms.
Block-level links must quote an exact `<!-- id:BLOCK_ID -->` marker copied from a read result — the shared assistant
prompt states this, and re-reading after a write is required because block IDs may change.

**Address resolution.** Hypermedia reads go through the shared client resolver, not bespoke parsing:
`resolveIdWithClient()` from `frontend/packages/client/src/resource-read.ts`, given a `domainResolver` backed by the
read-only Seed `GetDomain` request (`api-service.ts:9319`). That covers pasted clean web-domain URLs, `hm:`/`hm://` IDs,
block fragments, and comment view URLs alike; `:profile` paths branch to the profile reader, and `/:attributes` is
stripped into an attributes-only read. When a bare `hm:` ID is not found on the default server and no `server`/`dev` was
given, the read falls back to `https://dev.hyper.media` once — so a dev URL still resolves after a model strips its
origin. The result keeps both `requestedId` (what was asked for) and `id` (the canonical hm:// URL). The agent never
shells out to `seed-cli`.

## `write`

The mirror of `read` (`executeWriteVerb`, `api-service.ts:7357`).

```ts
type WriteInput = {
  address: string
  content?: string
  options?: Record<string, unknown>
}
```

- **`~/memory/<path>`** — writes `content`, creating parent directories; writing an existing file replaces it whole
  (there is no append). `options.delete` removes a file or directory, `options.fromUrl` downloads a URL to the path,
  `options.fromAttachment` saves a session attachment to it.
- **`~/tools/<name>`** — authors a tool. `content` is JSON `{description, input, output?, source, runtime?}` (or
  `options.tool` as an object); the name comes from the address. Non-JSON content fails with that exact shape as the
  message. `options.delete` deletes an authored tool. Both paths emit the memory-change event, so the desktop Tools tab
  updates live.
- **`ipfs://`** — publishes `options.fromPath` (a memory file) or `options.fromAttachment` by chunking it into UnixFS
  blocks with the shared client helper and sending those blocks through `PublishBlobs` on the typed HM API; it returns
  the root `ipfs://<cid>` URL. This deliberately does not depend on a server-specific `/ipfs/file-upload` route.
  `SEED_AGENTS_IPFS_SERVER_URL` selects only the gateway used by `read ipfs://…`, defaulting to the HM API origin.
  Requires the publish grant. Publishing makes the file publicly retrievable.
- **`hm://<account>/<path>`** — publishes signed hypermedia. Requires the publish grant.

Hypermedia writes map `options.action` onto the CLI-parity command envelope (`api-service.ts:7528`): the default
`document` → `document.create`, plus `update`, `comment` (with `target`/`replyTo`), `move` (`toPath`), `redirect`
(`toUrl`), `delete`, and `fork` (`fromUrl`). Any dotted action passes through as a raw command — `draft.create`,
`profile.update`, `contact.create`, `capability.grant`, and the rest — with the address filling account/path. Extra
command fields ride **only** in `options.input`, never as loose option keys, because the command handlers accept aliases
(`reply`, `commentId`, `name`, …) and a stray key silently changing the operation is a real hazard.

Other write behavior worth knowing:

- `options.title` sets the visible document title; a markdown `#` heading is body content, not the title.
- `options.signer` picks the identity by `profileName` or `publicKey` from the agent's selected signing keys.
- `options.fromPath` on an `hm://` address publishes a memory markdown file (frontmatter + resolved images) through the
  dedicated pipeline; path `/` derives the document path from the file's frontmatter title.
- `document.create` refuses a nested path whose parent is not already published; top-level paths are always allowed.
  This is enforced server-side, including in `dryRun`.
- Root-level `server`/`dev` are accepted only when they resolve to the configured agent HM server. Publishing always
  uses that server, never an arbitrary model-selected one (`api-service.ts:7953`).
- `path: "/"` means the account home document and is published as the canonical empty HM path.
- Hypermedia content is bounded at 256 KiB (`MAX_WRITE_CONTENT_BYTES`): `normalizeWriteContent()`
  (`api-service.ts:9072`) rejects oversized document and comment bodies, and publishing a memory file refuses the same
  ceiling (`api-service.ts:8861`). Memory writes themselves are unbounded — see the note in `security.md`.

## `call`

```ts
type CallInput = {tool: string; input?: object}
```

Dispatch order in `executeCallVerb` (`api-service.ts:7794`):

1. Resolve the name through `normalizeSeedToolName` and the registry. For `execute`, swap in the server-narrowed
   contract.
2. If it is not a granted builtin, look for an enabled **lambda** document of that name and run it.
3. Otherwise return the `~/tools` listing with a "no callable tool named …" summary.
4. Validate `input` against the tool's schema; on failure return the contract (touch-expand).
5. Execute: `search` → `executeAgentServiceSearch`, `web_search` → `executeWebSearch`, `execute` → the sandbox.

Promoted callables are exposed as real provider tools that route back through the same function
(`createAgentServicePiTools`, `api-service.ts:7869`), so a promoted tool and a `call` of it behave identically — same
validation, same narrowing, same executor.

### `search`

Seed hypermedia search: document titles, contacts, optionally bodies and comments. Input
`{query, accountUid?, includeBody?, contextSize?, searchType?: 'keyword' | 'semantic' | 'hybrid', pageSize?}`. Returns
ranked results with hm:// URLs.

### `web_search`

Backed by a self-hosted **SearXNG** instance (`GET /search?format=json`), no third-party API keys. SearXNG has no index
of its own; it federates public engines. Because engines rate-limit datacenter IPs, `executeWebSearch`
(`web-tools.ts:180`) inspects `unresponsive_engines` and, when the first query returns nothing but engines were
unavailable, retries once against a fallback engine set. Throws (becomes `tool_result.error`) when no `searxngUrl` is
configured.

The implementation speaks the registry contract exactly: `timeRange` in (forwarded to SearXNG as its own `time_range`
query param) and a `partial` boolean out when engines were unavailable, with the affected engines named in the markdown.
(Both sides drifted once — the audit caught it, fixed in `0d877e3a1` with a test pinning the round-trip.)

### `execute`

Runs TypeScript, Python, or shell code in a hardware-isolated microVM with the agent's memory bind-mounted at
`/workspace`, which is also the working directory (`agents/src/code-exec.ts`).

```ts
type ExecuteInput = {
  runtime: 'ts' | 'python' | 'shell'
  code: string
  timeout_secs?: number // clamped to [1, 300]
}
```

- `ts` runs `bun -e`, `python` runs `python -c`, `shell` runs `/bin/sh -c`. Nothing goes through a shell unless the
  runtime _is_ the shell: the sandbox takes an argv array, so code with quotes, newlines, or `$` needs no escaping
  (`code-exec.ts:470`).
- **Two images.** The main rootfs is a Python image with no JavaScript runtime, so `ts` runs in its own image
  (`SEED_AGENTS_EXEC_TS_IMAGE`, default `oven/bun`). An operator can set it explicitly empty to withhold TypeScript; the
  runtime is then not offered at all rather than advertised and failing (`code-exec.ts:318`, `executeToolForRuntimes`).
- Each call gets a fresh **ephemeral** sandbox (`security: restricted`) with capped CPUs, memory, and lifetime
  (`timeout + 30s`). No state survives between calls, so the contract tells the model to persist results as files and to
  `pip install --target /workspace/pylibs <pkg>`.
- Networking is **on by default** with explicit DNS resolvers and a non-local egress policy
  (`NetworkPolicy.fromProfiles(['public'])`, falling back to `nonLocal()` for older staged SDKs — `code-exec.ts:117`).
- Output: `{summary, exitCode, success, stdout, stderr, truncated, durationMs, changedFiles}`. stdout and stderr are
  bounded at 64 KiB each; `changedFiles` is a before/after listing diff of memory. Live progress streams a ~2000-char
  output tail at most every 250 ms.
- The SDK loads lazily and `availability()` is memoized: hosts without virtualization run normally, and the tool is
  simply absent instead of failing (`code-exec.ts:328`, with codes `config-disabled`, `unsupported-platform`,
  `whp-disabled`, `kvm-missing`, `kvm-forbidden`, `runtime-error`).

### Authored (lambda) tools

A lambda runs its stored source in the same sandbox, with the call's validated input handed in and its return value
handed back (`executeLambdaTool`, `api-service.ts:7662`). The ABI (`tool-documents.ts:22`):

```ts
// runtime: 'typescript' — run with bun
export default async function (input: {city: string}) {
  return {tempC: await lookup(input.city)}
}
```

```python
# runtime: 'python'
def main(input):
    return {"tempC": lookup(input["city"])}
```

`buildLambdaProgram()` (`code-exec.ts:502`) wraps the source into a self-contained program with the input baked in as a
double-`JSON.stringify` literal, so no interpolation can escape into code. TypeScript is imported as a module from a
`data:` URL, keeping its natural `export default` shape and type annotations without touching the filesystem; Python
gets an epilogue that calls `main` and awaits it if it is a coroutine.

The return value travels on a marked stdout line (`LAMBDA_RESULT_PREFIX = '__SEED_TOOL_RESULT__'`) — a file would have
to live somewhere, and `/workspace` _is_ the agent's memory, so a result file would litter it and show up in
`changedFiles`. Everything unmarked comes back to the caller as `logs`, which keeps ordinary `print`/`console.log`
debugging working (`code-exec.ts:489`, `parseLambdaResult` at `code-exec.ts:543`).

Failures are thrown, not returned: a non-zero exit, no returned value, or a value the tool's own `output` schema rejects
is a broken tool, and the model that authored it is the one who can fix it. An input miss still returns the contract,
exactly like a builtin.

Two gates apply before a lambda runs: the server must actually offer that runtime, and the agent must hold the `execute`
grant — an authored tool is code in the sandbox, so writing one must not become a way around an owner who turned code
execution off (`api-service.ts:7684`, `api-service.ts:7696`).

## `delegate`

Spawns a child run. Two kinds of child, one verb (`api-service.ts:7889`).

**Model child** — pass `brief`, human-readable markdown that becomes the child conversation's first message
**verbatim**; the user reviews it as the child's full context. `prompt` gives an anonymous worker persona, `agentId`
runs one of the account's other agents (at most one of the two), `tools` narrows the child's set — intersected against
the parent's full callable set, not a stale minimal default (`api-service.ts:2623`). `output` declares a JSON schema for
a validated structured result, delivered through `return_result`; without it the result is `{text}`.
`normalizeSubSessionSpec()` (`api-service.ts:313`) accepts `input` as an alias for `brief` and reads a bare `prompt` as
the brief rather than bouncing the call, because models write the task into `prompt` often enough that a retry is worse
than a rescue.

**Script child** — pass `script`, a self-contained module `export default async function (input, ctx) {…}` run in an
in-process QuickJS-WASM realm (`agents/src/workflow-host.ts`). Everything external crosses through `ctx`:
`ctx.call(tool, input, {description})`, `ctx.delegate`, `ctx.parallel`, `ctx.sleep`, `ctx.waitForEvent`,
`ctx.continueAsNew`, `ctx.step`, `ctx.plan`, `ctx.now`, `ctx.log`, `ctx.progress`, `ctx.input`, `ctx.runId`. Scripts
hold the read and write verbs plus the agent's callable set (`api-service.ts:3801`); every effect is journaled, so
resume after a crash or a timer wake replays from the top with completed work never re-executing. Detached script
children are rejected outright — scripts are awaited.

**Parallelism.** Independent children must be spawned together: every `delegate` call in one reply runs at the same
time, and the turn then parks (cheaply, restart-proof) until all of them resolve, with each call receiving its own
result. `await: false` detaches — the child runs as this agent with the brief as its first message and returns nothing,
so `agentId`, `output`, and `tools` are rejected loudly rather than silently discarded (`api-service.ts:7909`).

Durable limits come from the run tree, so they survive restarts: spawn-chain depth 3 (`MAX_SESSION_SPAWN_DEPTH`, checked
at `api-service.ts:3438`), 10 awaited children per run and 10 detached starts per session
(`MAX_SESSION_SPAWNS_PER_SESSION`, `api-service.ts:3444` and `api-service.ts:2270`), and 3 `return_result` retries
(`MAX_RETURN_RESULT_RETRIES`).

## `plan`

Maintains the thread's visible checklist:
`{title?, steps: [{id, label, status: pending | running | done | failed | skipped}]}`. Calls replace the whole plan, are
stored on `sessions.plan_cbor`, and write **no transcript event** — the checklist is the card, not conversation.

That choice has a consequence the runtime handles explicitly. A model resuming after its children finished is blind to
the very list it published, so `planStateBlock()` (`api-service.ts:414`) rebuilds a `<plan_state>` block from session
state on **every turn** and injects it into the replay as the last user message. It is never stored: the transcript
keeps exactly one copy of the truth, and the log stays a record of what happened rather than of what the runtime
reminded the model about. Step ids and labels are model-authored text being handed back inside a frame whose syntax the
model knows, so both go through `escapeActionFraming()`.

**Runtime settlement.** When every run attached to a running step comes back `succeeded`,
`#settlePlanStepFromChildren()` (`api-service.ts:2727`) marks the step `done` with `resolvedBy: 'runtime'`. Only success
settles a step — what a failed child means is a judgment the model makes, and the continuation loop exists to make it
ask. `resolvedBy` can never be forged from model input: `normalizeRunPlan` reads only what the model may say, and
`#carryResolvedBy()` (`api-service.ts:2174`) carries the runtime's mark across later writes while the step stays done,
dropping it if the step is reopened or written off.

**Obligations.** A turn that ends still owing something does not simply end. `#openObligations()`
(`api-service.ts:2776`) collects one list — an undelivered typed result, unfinished plan steps — and the run hands the
turn back with every open obligation named at once, up to `MAX_RUN_CONTINUATIONS` (3) times (`#executeAgentRun`,
`api-service.ts:2607`). Steps left open while children are still working are not obligations (someone else is carrying
them), and `failed`/`skipped` are terminal — an agent that says it could not do something has kept the contract and must
never be nagged into pretending otherwise. When the budget is spent, the run leaves an actor-`system` notice saying
exactly what was left undone; a typed child that never delivered **fails**, an unfinished plan **succeeds owing it**.
Nothing is ever ticked off on the agent's behalf.

## `return_result`

Exposed only inside typed delegate children. Its declared parameters ARE the spawner's `output` schema, swapped in at
session start (`api-service.ts:7938`). The server validates the payload; failures return the error list to the child for
self-correction. Delivering the result ends the child's turn immediately — nothing else it might still owe is worth
another turn (`api-service.ts:2640`).

---

## The user holds the same verbs

`InvokeSessionTool` (`agents/protocol/src/index.ts:616`) runs `read`, `write`, or `call` **as the user** on the
session's shared log (`#invokeSessionTool`, `api-service.ts:2345`). The call and its result append as actor-`user`
events, so the agent reads them on its next turn exactly as it reads its own — the log is the interface, there is no
side channel.

- `delegate` and `plan` are rejected: delegation is a conversational ask, so the user messages the agent instead.
- The request is rejected with 409 while the session has a live run.
- Execution failures are themselves log entries (a failed attempt is context too) and come back in the response; only
  pre-execution validation rejects the request outright.
- On replay, user tool calls become `<user_action>` / `<user_action_result>` tagged user messages, not provider tool
  exchanges, since providers have no notion of a user-made tool call (`api-service.ts:4878`). The system prompt tells
  the agent these are shared ground truth it can build on without re-running them (`api-service.ts:4190`).

## Event shapes

```ts
{type: 'tool_call', id: string, name: string, input: unknown, actor?: SessionActor}
{type: 'tool_result', toolCallId: string, name: string, output?: unknown, error?: string,
 actor?: SessionActor, meta?: SessionEventMeta}
```

`SessionActor` is `'user' | 'agent' | 'system' | 'trigger'`; events written before the field existed derive their actor
from shape via `sessionEventActor()` (`agents/protocol/src/index.ts:952`). `SessionEventMeta` carries `model`,
`provider`, `usage`, and `durationMs` — provenance stamped once at append time, because none of it is recoverable after
the run is gone.

Tool failures should usually become `tool_result.error` so the model can respond gracefully.

## Tool lifecycle

1. The server registers the verbs (plus any promoted callables) with Pi, with `noTools: 'builtin'` so Pi's own host
   tools never load.
2. Pi calls the model; the model returns assistant text and tool calls.
3. Pi emits `message_end` before tool execution; the server appends the turn's assistant text as a durable `message`
   event with its `meta`.
4. The server appends a durable `tool_call` event, executes the Seed-owned implementation, and appends `tool_result`.
5. The model continues until final assistant text; each later assistant turn is appended at its own `message_end`.

On later turns the server reconstructs durable assistant text and consecutive `tool_call` events as a single Pi
assistant message before their matching `tool_result` messages, keeping provider replay valid for APIs such as OpenAI
chat completions, which reject orphaned `tool` messages and expect multi-tool batches grouped.

Parked `delegate` calls keep their durable `tool_call` deliberately unanswered until the child's finalizer appends the
real result; a post-park reconcile pass closes the race where a fast child finalizes before the parent's `waiting`
status commits.

## Size limit

`MAX_TOOL_RESULT_BYTES` is 256 KiB (`api-service.ts:148`). Oversized rendered markdown fails with a tool error; replayed
user-action payloads are truncated rather than dropped.

## Adding or changing a tool

1. Update the canonical entry in `agents/protocol/src/tool-registry.ts` — prompt metadata, JSON schema, render metadata
   — and remember the contract is what the model reads.
2. Add the runtime executor in `executeCallVerb` (callables) or the verb dispatcher (address forms); do not duplicate
   descriptions or schemas.
3. Validate model-supplied input at the boundary and return the contract on a miss rather than an error.
4. Bound output size.
5. Confirm the tool document CID changes as intended — a changed contract rewrites every agent's builtin row.
6. Decide the grant: is it in the callable set, or does it need publish?
7. Add tests for success, tool failure, and provider continuation.
8. Update `tools.md`, `security.md`, `desktop-ui.md`, and `roadmap.md`.
