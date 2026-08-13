# Security model

The Agents security model centers on signed account-scoped actions, server-side ownership checks, encrypted/redacted
secrets, signed WebSocket subscriptions, and a model-facing tool surface whose authority is fixed at five verbs.

## Trust boundaries

- Desktop app ↔ agents server.
- Agents server ↔ model providers.
- Agents server ↔ Seed Hypermedia/content servers.
- Agents server ↔ SQLite storage.
- Desktop renderer ↔ desktop daemon signing API.
- Agent runtime ↔ sandbox microVM (the only place model-written code runs).

## HTTP action authentication

Every HTTP action is a signed `SignedActionEnvelope`:

```ts
{
  type: 'AgentsAction', signer, sig, account, action
}
```

Server verifies the signature and authorizes the signer for the account.

A signer is authorized when:

- `signer === account`; or
- `account_authorizations` has role `OWNER` or `AGENT` for `(account, signer)`.

## WebSocket authentication

The socket receives no private data until it sends a signed `Subscribe` action. The server validates the subscription
key belongs to the signed account.

A socket cannot switch accounts after a successful subscription.

Server-to-client events are not individually signed.

## Account isolation

Account-owned tables include `account_id`:

- model providers;
- secrets;
- agents;
- sessions;
- runs;
- tool documents;
- action idempotency;
- authorizations.

Session events do not store account ID directly; the server verifies ownership through the parent session.

## Secrets

`SetSecret` accepts key bytes, encrypts them, and returns only redacted metadata. `CreateSigningIdentity` generates a
server-side Ed25519 HM account key and stores the raw seed through the same encrypted secret path.
`ListSigningIdentities` only returns redacted metadata for account-scoped secrets tagged with `kind: 'hm-account-key'`;
the plaintext key material is never returned and cross-account keys are not visible.

Desktop refuses to send secrets to non-local plain HTTP servers (`isSafeAgentServerSecretTarget()`,
`frontend/apps/desktop/src/agents-client.ts:127`). Remote servers must use HTTPS.

Do not log:

- plaintext secrets;
- decrypted API keys;
- provider secret config;
- signed request bodies;
- full model prompts/responses;
- full session content;
- large/sensitive tool outputs.

## Secret encryption limitations

Current key storage:

- AES-GCM key lives in `server_config` in the same SQLite DB.

This prevents accidental API/log disclosure but does not protect against full DB compromise.

Future production work should add:

- OS keychain or KMS-backed key storage;
- key rotation;
- secret versioning;
- backup/restore guidance.

## Provider endpoint safety

Each provider type has a code-owned spec in `PROVIDER_SPECS` (`agents/src/api-service.ts`) with a fixed default base URL
and an `allowCustomBaseUrl` flag. The base URL is resolved by `resolveProviderBaseUrl()`:

- **Pinned providers** (`openai`, `anthropic`, `google`, `openrouter`, `deepseek`, `groq`, `xai`): the spec default base
  URL always wins, and any stored `baseUrl` override is ignored. This keeps a stored API key from being redirected to an
  arbitrary host.
- **Self-hosted/custom providers** (`ollama`, `custom`): the user-supplied `baseUrl` is honored, because pointing at a
  local or private endpoint is the entire purpose. These accept requests without an API key. The base-URL value is set
  by the authenticated account owner through signed `SetModelProvider` actions, so the endpoint and any key it carries
  share a single trust owner. The desktop save flow still refuses to send an API key to a remote plain-HTTP **agent
  server**. Outbound SSRF to whatever a custom `baseUrl` names is accepted by design; tightening this (e.g. blocking
  link-local ranges for non-local custom endpoints) is future hardening.

Subscription ("Sign in with ChatGPT") providers hold OAuth credentials rather than an API key: Pi re-resolves and
refreshes them per request through the persisted auth backend, and an expired or revoked sign-in fails the run with an
explicit re-auth message instead of a cryptic provider 401 (`api-service.ts:4262`). The flow is off unless the operator
opts in with `SEED_AGENTS_SUBSCRIPTION_AUTH`, because it needs a client that can catch the provider's localhost redirect
(`agents/src/config.ts:20`).

Adding a pinned provider type only requires a `PROVIDER_SPECS` entry; it inherits the pinned-URL policy automatically.

## The tool surface is the authority boundary

The model sees five verbs. Nothing widens that set except **promotion**, and promotion is bounded twice over
(`api-service.ts:4322`):

- promotion is derived only from durable `tool_call` events in this session's own transcript, so it survives restarts
  and cannot be smuggled in through live state;
- the promoted list is intersected with `enabledCallableTools()` before it reaches Pi. This filter is the security
  control, not a tidiness pass: a hallucinated or injected `call {tool: 'bash'}` durably stores that name, and an
  unfiltered allowlist would hand `bash` to Pi and activate Pi's own host bash/edit builtins **outside** the sandbox.

`noTools: 'builtin'` on the Pi session means Pi's own tool suite never loads in the first place; the only executable
surface is the Seed-owned custom tools.

Events written by a user's own verb calls carry `actor: 'user'` and are explicitly skipped when computing promotion
(`api-service.ts:7237`), so a user's palette activity never reshapes the agent's active toolset.

## Grants

Two things are granted per agent, both stored in `definition.tools`; the verbs themselves are never grants.

- **The callable set** — which of `search`, `web_search`, `execute` the agent may dispatch. `execute` additionally drops
  out when the host cannot run sandboxes.
- **Publish** — the pseudo-tool `publish` (with legacy write-group names still honored). Without it, `write` to `hm://`
  or `ipfs://` returns 403 (`api-service.ts:7454`, `api-service.ts:7499`). Memory writes are never gated, which is the
  intended line: private files are the agent's workspace, signed public content is a disclosure.

A delegate child's `tools` narrowing intersects against the parent's full callable set, so delegation can only ever
reduce authority (`api-service.ts:2623`).

## Framing injection (`<user_action>`, `<plan_state>`)

Two model-facing frames carry text the model or a fetched page authored, handed back inside tags whose syntax the model
knows. Both rewrite every `<` as its unicode escape through `escapeActionFraming()` (`api-service.ts:9179`) — an escape
that stays valid inside JSON and still renders as `<` to a human reader, but can never form a tag:

- **`<user_action>` / `<user_action_result>`** — the user's own verb calls and their results, including fetched web
  content. Without escaping, a page containing `</user_action_result>` could close the frame and forge trusted user
  actions for everything after it.
- **`<plan_state>`** — the live checklist injected fresh each turn. Step ids and labels are whatever the model last
  wrote, so a label carrying `</plan_state>` would otherwise turn the rest of the block into instructions nothing
  vouched for (`api-service.ts:409`).

A related guard: an actor-less `tool_result` answering a user-actor `tool_call` (a synthetic written before the
synthesizer knew about actors) is dropped rather than replayed as an orphan provider tool result
(`api-service.ts:4868`).

`InvokeSessionTool` itself is bounded: only `read`, `write`, and `call` are accepted, it is rejected with 409 while the
session has a live run, and execution failures append to the log rather than being hidden (`api-service.ts:2345`).

## `read` safety

The `read` verb reaches memory, tool contracts, hypermedia, IPFS, the public web, the activity feed, attachments, other
threads, and run records.

`thread:` and `run:` reads are scoped by `account_id` alone (`api-service.ts:7167`, `api-service.ts:7206`), so an agent
can read the transcripts and run records of **every other agent on the same account** — including their tool inputs and
results. Within one owner's account that is arguably fine, and the model-facing description ("another conversation
transcript of yours") suggests it was meant to be per-agent. Decide which it is before agents on one account are treated
as isolated from each other.

Risks:

- SSRF/private-network access if the server runs in a sensitive network;
- model-driven reads of arbitrary web resources;
- large or sensitive tool outputs.

Mitigations present:

- address parsing rejects anything outside the supported forms;
- output size limit (256 KiB) on every tool result;
- durable, actor-stamped tool events for everything the agent and user do;
- hypermedia-first resolution for `https://` addresses that only falls through to the web reader on an explicit
  not-hypermedia marker or a 404, so scraped HTML is never silently substituted for document content;
- no CLI shellout.

Future mitigations:

- outbound allow/deny policy;
- private-network blocklist;
- audit log.

## Web reading safety

Reading `https://` addresses performs a server-side `fetch` (the static tier) and, when configured, has Crawl4AI fetch
the page in a real browser (`agents/src/web-tools.ts`). `web_search` is backed by self-hosted SearXNG. Neither carries a
third-party API key.

Risks:

- **SSRF / private-network access.** On a host with access to a private network or cloud metadata endpoint, a model
  could request internal addresses. This is currently **unmitigated** beyond `http(s)` scheme enforcement. Before
  exposing this on a sensitive network, add a private-network/metadata blocklist and an outbound allow/deny policy.
- Model-driven retrieval of arbitrary web content into the conversation is the primary prompt-injection surface: treat
  fetched page text as untrusted input, never as instructions.
- Crawl4AI executes a real browser; keep it on the internal network only, never published to the host or internet.

Mitigations present:

- `http`/`https` scheme enforcement and URL validation;
- bounded markdown output (200 KiB, truncated on a byte boundary);
- raw mode refuses non-text content types;
- the Crawl4AI shared token (`SEED_AGENTS_CRAWLER_TOKEN`) gates the crawler so only the agents service can use it;
- `web_search` is a granted callable, not an always-on verb, and throws a clean error when no SearXNG backend is
  configured;
- failures degrade to `tool_result.error` (or a `partial` flag for incomplete search coverage), never silent
  fabrication.

## Agent memory safety

Agent memory (`agents/src/agent-memory.ts`) exposes a real filesystem directory to model-controlled input, so path
handling is strict:

- every path is validated before use: string-only, no null bytes, no `..` segments, backslashes normalized, depth (16)
  and length (512 bytes) bounded, and the resolved absolute path re-verified to sit inside `<stateDir>/memory`;
- symlinks are refused as read/write targets and skipped in listings, so memory operations cannot follow a planted link
  out of the sandbox;
- ownership is checked through the agent row before any filesystem operation, so accounts cannot touch other accounts'
  memory;
- binary memory files are never sent to the model — a memory read returns metadata only for binary content — but their
  raw bytes are returned to the owning user over the signed API for preview/download;
- memory content is model-visible and user-visible by design; do not store secrets in agent memory;
- `write ipfs://` and `UploadAgentMemoryFileToIpfs` publish through the HM server, making the file publicly retrievable
  by CID; treat publishing as irreversible disclosure;
- session attachments (files dropped into the chat composer) are session-private: stored under
  `<stateDir>/session-attachments/<sessionId>/`, keyed by content SHA-256, capped at 100 MiB each, never auto-copied
  into cross-session memory or published, deleted with the session, and exposed to the model as metadata until it reads
  one by address.

**Memory has no size quota, and never has.** Earlier revisions of this document described a 1 MiB text write cap, a 100
MiB per-file cap, a 1 GiB per-agent total, and a 2000-entry limit. None of those exist in the code, at HEAD or in the
commit that introduced the memory filesystem (`8326a22e7`): `agent-memory.ts` bounds only path length and depth,
`downloadToMemory` explicitly allows downloads of any size and aborts only on a 60-second stall (`agent-memory.ts:290`),
and the sandbox mount is created with `mount.bind(memoryRoot)` and **no** `.quota()` call (`code-exec.ts:402`) even
though the builder supports one. Disk exhaustion by a runaway model write, download, or sandbox program is unbounded
today. The only enforced size limits nearby are per-attachment (100 MiB, `session-attachments.ts:26`) and
per-chunked-upload (2 GiB, `api-service.ts:158`).

## Code execution safety

`execute` and every authored lambda run model-written code, so isolation is delegated to hardware virtualization rather
than process sandboxing (`agents/src/code-exec.ts`):

- each execution runs in a fresh ephemeral microVM (embedded `microsandbox` runtime: libkrun on macOS/Linux, WHP on
  Windows) with the `restricted` in-guest security profile; the VM boundary — not seccomp or containers — is the
  isolation line;
- the only host filesystem exposure is the agent's own memory directory, bind-mounted at `/workspace`; code cannot see
  other agents' memory, the SQLite DB, or secrets;
- guest-created symlinks inside the memory directory cannot trick host-side reads: memory reads refuse symlinks and
  listings skip them;
- nothing is interpreted by a shell unless the runtime _is_ the shell — the sandbox takes an argv array, so model code
  containing quotes, newlines, or `$` needs no escaping (`code-exec.ts:470`);
- sandbox networking is on by default but constrained to a **non-local egress policy**
  (`NetworkPolicy.fromProfiles(['public'])`, with `nonLocal()` as the older-SDK dialect — `code-exec.ts:117`), so code
  reaches the public internet but not the host's private network or cloud-metadata endpoints. DNS is an explicit
  resolver set (`SEED_AGENTS_EXEC_DNS`), not the host's. `SEED_AGENTS_EXEC_ALLOW_NETWORK=false` removes the NIC
  entirely. On-by-default egress widens the exfiltration surface versus an offline sandbox — the isolation is the
  non-local policy plus the memory-only mount, not an air gap;
- CPU count, guest memory, per-exec timeout (clamped to ≤ 300s) and total sandbox lifetime (`timeout + 30s`) are capped
  server-side; stdout/stderr are bounded to 64 KiB each before reaching the model;
- a lambda's input is baked into its program as a double-`JSON.stringify` literal, so no call input can escape into code
  (`code-exec.ts:505`);
- an authored lambda rides on the **same grant** the `execute` tool needs (`api-service.ts:7696`). Without that check,
  writing a tool document would be a way around an owner who turned code execution off;
- resource note: each concurrent execution boots a microVM with its configured guest memory; there is no per-account
  concurrency limit yet.

## Script (workflow) safety

Script children are untrusted, model-authored JavaScript. The posture is defense in depth
(`agents/src/workflow-host.ts`):

- **Zero-ambient-authority realm**: each run gets a fresh QuickJS-WASM context with no `Date`, `Math.random`, timers,
  `fetch`, imports, or process access — a submission-time lint rejects those tokens up front, and the realm removes them
  at runtime. The only way to affect the world is the journaled `ctx` bridge.
- **Every effect is validated, bounded, and journaled**: `ctx.call` is checked against the read/write verbs plus the
  agent's enabled callables (`api-service.ts:3801`) and the tool's input schema; results are size-bounded by the tool
  caps; the journal is a flight recorder — every external effect is enumerable after the fact via `GetRunJournal`.
- **No new authority**: a script can do exactly what its agent could do call-by-call in chat, under the agent's own
  signing identities and configured HM server. The new dimension is scale, bounded by spawn depth (3), fan-out (10
  children per run), the separate workflow concurrency pool, compute fuel between awaits, VM memory, and journal caps.
- **Child outputs re-enter parents as data** (schema-validated when a typed result was declared), inside tool results —
  never as trusted instructions. A prompt-injected child can corrupt only its own return value.
- **Kill switch**: `CancelRun` on any root cascades to every descendant — queued runs never start, waiting runs never
  wake, live agent runs abort through Pi, live script VMs are interrupted. `StopSession` on the launching chat does the
  same for its whole tree.
- **Accepted gaps**: no cost (dollar/token) budgets yet — wall-time, depth, fan-out, and concurrency caps are the
  blast-radius controls (live usage is persisted per run and visible to clients). And a `ctx.call` interrupted between
  execution and its journaled result **re-executes on resume** (at-least-once): fine for idempotent tools, but a `write`
  crashed at exactly that point could double-publish. Idempotency keys are the roadmap fix.

## Honest-record guarantees

Several behaviors exist so the log cannot quietly disagree with reality, which is a security property as much as a
product one:

- the runtime settles a plan step only on evidence — every attached child `succeeded` — and never derives anything from
  failure (`api-service.ts:2723`);
- `resolvedBy: 'runtime'` cannot be forged from model input and is carried across rewrites only while the step stays
  done (`api-service.ts:2174`);
- a run that exhausts its continuations leaves an actor-`system` notice naming exactly what was left open, and nothing
  is ticked off on the agent's behalf (`api-service.ts:2659`);
- a typed child that never delivered **fails**, because its parent is blocked on a result that is never coming.

## Replay protection status

Implemented:

- idempotency for create/message actions with client IDs;
- every signed action carries a signed `action.ts` Unix epoch millisecond timestamp;
- HTTP and WebSocket envelopes are rejected when `action.ts` is missing, invalid, or more than 30 seconds from server
  local time (`MAX_ACTION_CLOCK_SKEW_MS`, `agents/src/auth.ts:5`).

Not implemented:

- nonce caching, so a captured request can still be replayed within the 30-second timestamp window.

Nonce caching remains a high-priority hardening project.

## Logging security

Recent diagnostic logs are designed to include:

- account/agent/session/run IDs;
- partial IDs;
- event counts;
- byte lengths;
- status codes;
- content types;
- durations;
- active tool names and model/provider identity.

They should not include secret values or full message content. Keep future logs at this level unless doing explicit
local-only debugging.

## Security checklist for new work

For every new action:

1. Verify signature.
2. Verify signer authorization.
3. Normalize inputs at the boundary.
4. Scope DB queries by account ownership.
5. Redact sensitive data.
6. Add unauthorized/cross-account tests.
7. Decide idempotency/replay semantics.
8. Decide WebSocket fanout policy.
9. Update docs.

For every new tool or address form:

1. Add or update the canonical registry entry in `agents/protocol/src/tool-registry.ts` so prompt metadata, input
   schema, and rendering metadata are reviewed together.
2. Decide the grant: callable set, publish, or ungated.
3. Validate inputs at the runtime boundary and return the contract on a miss.
4. Bound output size.
5. If it can be promoted, confirm the promotion filter still holds.
6. If model-authored text re-enters the prompt inside a frame, escape it.
7. Avoid sensitive logs.
8. Add tests for missing credentials and provider/tool errors.
9. Update `security.md`, `model-providers.md`, or `tools.md`.
