---
name: Security model
summary: The Agents security model centers on signed account-scoped actions, server-side owner/collaborator checks, encrypted/redacted secrets, signed WebSocket…
---
The Agents security model centers on signed account-scoped actions, server-side owner/collaborator checks, encrypted/redacted secrets, signed WebSocket subscriptions, and a model-facing tool surface whose authority is fixed at five verbs. <!-- id:DmipMeA2 -->

# Trust boundaries <!-- id:rNafV-CT -->

- Desktop app ↔ agents server. <!-- id:29Vx2kId -->
- Agents server ↔ model providers. <!-- id:bWnYZ3vp -->
- Agents server ↔ Seed Hypermedia/content servers. <!-- id:aVxHgfoN -->
- Agents server ↔ SQLite storage. <!-- id:MvH0stZj -->
- Desktop renderer ↔ desktop daemon signing API. <!-- id:zozDhJUY -->
- Agent runtime ↔ sandbox microVM (the only place model-written code runs). <!-- id:-X9dRIVd -->

# HTTP action authentication <!-- id:ydA7wq7B -->

Every HTTP action is a signed `SignedActionEnvelope`: <!-- id:wLZaBkwz -->

```ts <!-- id:PQ3bugHc -->
{
  type: 'AgentsAction', signer, sig, account, action
}
```

Server verifies the signature and authorizes the signer for the account. <!-- id:mJA0FdHP -->

A signer is authorized when: <!-- id:vI4I2YXO -->
  - `signer === account`; or <!-- id:MFXBbOw6 -->
  - `account_authorizations` has role `OWNER` or `AGENT` for `(account, signer)`. <!-- id:nwMz9Fv- -->

# WebSocket authentication <!-- id:bARrb-Xh -->

The socket receives no private data until it sends a signed `Subscribe` action. The server validates the subscription key belongs to the signed account. <!-- id:1j5E6yTg -->

A socket cannot switch accounts after a successful subscription. <!-- id:eXQ3pyxw -->

Server-to-client events are not individually signed. <!-- id:8RkjVN2M -->

# Agent collaboration authorization <!-- id:kaRoiUoq -->

An agent remains owned by `agents.account_id`. `agent_collaborators` adds explicit per-agent access for another signed Seed account, first as a pending invitation and then as an accepted `reader` or `writer` row: <!-- id:YMeQeTqE -->
  - pending invitees see only invitation metadata and cannot access agent contents; <!-- id:10nyaZKv -->
  - readers can inspect all agent-scoped state, including memory, tools, prompts, sessions, transcripts, attachments, and runs; <!-- id:Ieiu9hPu -->
  - writers can additionally mutate agent-scoped state and interact with sessions; <!-- id:luD8dSRz -->
  - only the owner can invite/revoke members or delete the agent; <!-- id:e9NanRok -->
  - two owner-set agent flags open the agent beyond membership: `public_read` makes every signed account a reader by agent id, and `public_chat` (only settable while `public_read` is on; cleared with it) promotes those public readers to `chatter` — they may create, message, attach to, and stop sessions, but every writer-level action (agent, memory, tool, and trigger edits; session rename/delete; `InvokeSessionTool`; run cancel/signal) is still refused. Public chat is the intended way to expose an agent to the world; `writer` is for people trusted to reshape it; <!-- id:llCkUBKt -->
  - provider, secret, OAuth, and signing-identity mutations remain scoped to the collaborator's own account. Optional `agentId` on provider/identity list actions exposes only the owner's redacted records needed to render/edit that shared agent. <!-- id:zN908Czj -->

Agent/session/run WebSocket subscriptions use the same access check. Service events are fanned out to every accepted collaborator's account subscription; revocation takes effect before subsequent requests or subscriptions. <!-- id:MP2yCS2d -->

# Account isolation <!-- id:M8_lGRzd -->

Account-owned tables include `account_id`: <!-- id:vuJdoDIn -->
  - model providers; <!-- id:ow4_NA2e -->
  - secrets; <!-- id:NqWP5nlU -->
  - agents; <!-- id:_2FG4Bi8 -->
  - agent collaborators (the invited account is also stored explicitly); <!-- id:Gr5aJlcs -->
  - sessions; <!-- id:SLr0c6ot -->
  - runs; <!-- id:ekFRPh6l -->
  - tool documents; <!-- id:NqEjnxJ6 -->
  - action idempotency; <!-- id:t-a5Y_Zu -->
  - authorizations. <!-- id:dAsoKOkW -->

Session events do not store account ID directly; the server verifies ownership through the parent session. <!-- id:IJJCyIF0 -->

# Agent isolation <!-- id:KunfZIHl -->

Agents of the same account do not read each other's state. The `thread:` address (reads and listings) and continuation `session_events` sources reach only the calling agent's own threads; memory and tools are per-agent by construction (`state_dir`). Until a deliberate inter-agent interaction model exists, agents communicate over public interfaces — documents and comments on the hypermedia network — never by inspecting one another's transcripts. <!-- id:NDvRam0b -->

# Secrets <!-- id:SgQVhqL8 -->

`SetSecret` accepts key bytes, encrypts them, and returns only redacted metadata. `CreateSigningIdentity` generates a server-side Ed25519 HM account key and stores the raw seed through the same encrypted secret path. `ListSigningIdentities` only returns redacted metadata for account-scoped secrets tagged with `kind: 'hm-account-key'`; the plaintext key material is never returned and cross-account keys are not visible. <!-- id:5DSi0bnT -->

Desktop refuses to send secrets to non-local plain HTTP servers (`isSafeAgentServerSecretTarget()`, `frontend/apps/desktop/src/agents-client.ts:127`). Remote servers must use HTTPS. <!-- id:SvO1iUID -->

Do not log: <!-- id:FIGniD9D -->
  - plaintext secrets; <!-- id:Y7oc2F-N -->
  - decrypted API keys; <!-- id:SicbMH2k -->
  - provider secret config; <!-- id:zsn7EW3q -->
  - signed request bodies; <!-- id:4wH09taa -->
  - full model prompts/responses; <!-- id:FRO5JSM5 -->
  - full session content; <!-- id:-een6yYS -->
  - large/sensitive tool outputs. <!-- id:JWRQKsaL -->

# Secret encryption limitations <!-- id:WxrCS2O2 -->

Current key storage: <!-- id:8JYFDmEq -->
  - AES-GCM key lives in `server_config` in the same SQLite DB. <!-- id:U2TsGJ3y -->

This prevents accidental API/log disclosure but does not protect against full DB compromise. <!-- id:hBhYb5Mg -->

Future production work should add: <!-- id:tdt3q72j -->
  - OS keychain or KMS-backed key storage; <!-- id:kpzu_rlM -->
  - key rotation; <!-- id:6ePVBiCv -->
  - secret versioning; <!-- id:pWm-cCIW -->
  - backup/restore guidance. <!-- id:VOKIVshv -->

# Provider endpoint safety <!-- id:LxjFNwif -->

Each provider type has a code-owned spec in `PROVIDER_SPECS` (`agents/src/api-service.ts`) with a fixed default base URL and an `allowCustomBaseUrl` flag. The base URL is resolved by `resolveProviderBaseUrl()`: <!-- id:A7x92_IY -->
  - **Pinned providers** (`openai`, `anthropic`, `google`, `openrouter`, `deepseek`, `groq`, `xai`): the spec default base URL always wins, and any stored `baseUrl` override is ignored. This keeps a stored API key from being redirected to an arbitrary host. <!-- id:Z7EuhaCE -->
  - **Self-hosted/custom providers** (`ollama`, `custom`): the user-supplied `baseUrl` is honored, because pointing at a local or private endpoint is the entire purpose. These accept requests without an API key. The base-URL value is set by the authenticated account owner through signed `SetModelProvider` actions, so the endpoint and any key it carries share a single trust owner. The desktop save flow still refuses to send an API key to a remote plain-HTTP **agent server**. Outbound SSRF to whatever a custom `baseUrl` names is accepted by design; tightening this (e.g. blocking link-local ranges for non-local custom endpoints) is future hardening. <!-- id:wI6Dm9fI -->

Subscription ("Sign in with ChatGPT") providers hold OAuth credentials rather than an API key: Pi re-resolves and refreshes them per request through the persisted auth backend, and an expired or revoked sign-in fails the run with an explicit re-auth message instead of a cryptic provider 401 (`api-service.ts:4262`). The flow is off unless the operator opts in with `SEED_AGENTS_SUBSCRIPTION_AUTH`, because it needs a client that can catch the provider's localhost redirect (`agents/src/config.ts:20`). <!-- id:_cTbxDWl -->

Adding a pinned provider type only requires a `PROVIDER_SPECS` entry; it inherits the pinned-URL policy automatically. <!-- id:xuEyWxUM -->

# The tool surface is the authority boundary <!-- id:ZUb7YijU -->

The model sees five verbs. Nothing widens that set except **promotion**, and promotion is bounded twice over (`api-service.ts:4322`): <!-- id:jh9t4A6y -->
  - promotion is derived only from durable `tool_call` events in this session's own transcript, so it survives restarts and cannot be smuggled in through live state; <!-- id:LdBc3z4t -->
  - the promoted list is intersected with `enabledCallableTools()` before it reaches Pi. This filter is the security control, not a tidiness pass: a hallucinated or injected `call {tool: 'bash'}` durably stores that name, and an unfiltered allowlist would hand `bash` to Pi and activate Pi's own host bash/edit builtins **outside** the sandbox. <!-- id:q2b0tftt -->

`noTools: 'builtin'` on the Pi session means Pi's own tool suite never loads in the first place; the only executable surface is the Seed-owned custom tools. <!-- id:RMyDqBZn -->

Events written by a user's own verb calls carry `actor: 'user'` and are explicitly skipped when computing promotion (`api-service.ts:7237`), so a user's palette activity never reshapes the agent's active toolset. <!-- id:ahkTiyN7 -->

# Grants <!-- id:u27bF0_B -->

Two things are granted per agent, both stored in `definition.tools`; the verbs themselves are never grants. <!-- id:c2iQDOLW -->
  - **The callable set** — which of `search`, `web_search`, `execute` the agent may dispatch. `execute` additionally drops out when the host cannot run sandboxes. <!-- id:svPa8AfP -->
  - **Publish** — the pseudo-tool `publish` (with legacy write-group names still honored). Without it, `write` to `hm://` or `ipfs://` returns 403 (`api-service.ts:7454`, `api-service.ts:7499`). Memory writes are never gated, which is the intended line: private files are the agent's workspace, signed public content is a disclosure. <!-- id:N5F17hzw -->

A delegate child's `tools` narrowing intersects against the parent's full callable set, so delegation can only ever reduce authority (`api-service.ts:2623`). <!-- id:6GNsOBus -->
  - **MCP servers** — `definition.mcpServers` names the account MCP servers an agent may call. Enabling a server is a grant on par with `execute`: its tools run with whatever the remote server can do. The projected `mcp` tool documents are a cache of this grant, never the grant itself — `executeMcpTool` re-checks `definition.mcpServers` before any call, so a stale document cannot reach a server the owner turned off. See [`mcp.md`](./agent-mcp.md). <!-- id:JAdshfOI -->

The promotion filter admits the enabled callable set **and** the agent's own enabled non-builtin documents (lambdas and MCP projections), re-derived from the definition at run start; a promoted document tool executes through the same `call` dispatch and the same checks as an explicit `call`. <!-- id:Cqpe6uA3 -->

# MCP server safety <!-- id:Vu4WkGXX -->

A connected MCP server is reached with account-configured URLs and headers from the agents host (`agents/src/mcp.ts`). Only `http(s)` remote transports exist; the service never spawns stdio processes. <!-- id:tBT0Wu3e -->

Risks: <!-- id:m4T6j5YR -->
  - **SSRF / private-network access** — the same unmitigated posture as web reading: an owner can point a server record at any reachable address. Loopback is deliberately allowed (local MCP proxies are common in development). <!-- id:KT52H4iu -->
  - **Tool authority** — the remote server decides what its tools do. Model-driven calls carry model-authored arguments; a server that acts on the world (files, issues, payments) should be enabled only for agents whose prompts warrant it. <!-- id:pO_XpBfB -->
  - **Prompt injection** — tool results are untrusted text, exactly like fetched web pages. <!-- id:T9GTfukQ -->

Mitigations present: <!-- id:PtUHslMF -->
  - header values are encrypted account secrets, redacted from every response; the desktop refuses to send one to a non-HTTPS remote agent server; <!-- id:KtK34BUu -->
  - server names are slugs and tool names are sanitized to `[A-Za-z0-9_-]` and capped at 64 characters, so a remote name can never collide with a verb, shadow a builtin, or break a provider's tool-name rules; an authored lambda keeps its name against a remote tool of the same name; <!-- id:mLjHfMUi -->
  - input is validated against the projected contract before a call leaves the host; a miss returns the contract; <!-- id:TLAD4kkE -->
  - results are bounded (256 KiB text, 4 MiB per inline image) and server errors become `tool_result.error`; <!-- id:1_EpLlOF -->
  - connections are per run and closed with it; a call has a 120s timeout and a connect 20s; <!-- id:svG753_g -->
  - deleting a server scrubs it from every agent and deletes the header secrets it owns. <!-- id:DJvUELcZ -->

# Agent-managed triggers <!-- id:COfrFvPS -->

Agents manage their own triggers directly: `write ~/triggers/<name>` creates, edits, enables, disables, or deletes a trigger, and `enabled` is honored exactly as written (defaulting to true). This is a **deliberate product decision by the owner** (2026-08-19): "do this every morning" said in chat should just work, without a separate approval step in the desktop. <!-- id:6xYSwts8 -->

What that means for the threat model: a trigger is standing authority to act with nobody present, and an agent — which can be steered by a prompt injection in content it reads — can now grant that authority to itself. The draft→active consent design in `harness/m6-event-bus-design.md` proposed gating activation on a user gesture; that gate was built and then removed on the owner's direction. The remaining mitigations are visibility, not prevention: <!-- id:Vb4QmNhC -->
  - every trigger write is a durable, actor-stamped `tool_call`/`tool_result` pair on the session log; <!-- id:AcgbWlNJ -->
  - trigger writes emit `trigger-updated` account events, so the desktop Triggers tab reflects changes live; <!-- id:TqGo-Ffe -->
  - a trigger fires only what the agent could already do — its callable set and publish grant still bound the blast radius, and delegation still only narrows authority; <!-- id:95IODWlx -->
  - the firing-chain loop guard (`TRIGGER_CHAIN_MAX_HOPS`) still stops runaway trigger chains. <!-- id:arA2301Y -->

If consent is ever wanted back, the enforcement point is `writeTriggerAddress` and the history is in git. <!-- id:0RUoz3g_ -->

# Framing injection (`<user_action>`, `<plan_state>`) <!-- id:VRRmTIj5 -->

Two model-facing frames carry text the model or a fetched page authored, handed back inside tags whose syntax the model knows. Both rewrite every `<` as its unicode escape through `escapeActionFraming()` (`api-service.ts:9179`) — an escape that stays valid inside JSON and still renders as `<` to a human reader, but can never form a tag: <!-- id:0iHcYBOu -->
  - **`<user_action>` / `<user_action_result>`** — the user's own verb calls and their results, including fetched web content. Without escaping, a page containing `</user_action_result>` could close the frame and forge trusted user actions for everything after it. <!-- id:OdKHUfbu -->
  - **`<plan_state>`** — the live checklist injected fresh each turn. Step ids and labels are whatever the model last wrote, so a label carrying `</plan_state>` would otherwise turn the rest of the block into instructions nothing vouched for (`api-service.ts:409`). <!-- id:n36-MmI1 -->

A related guard: an actor-less `tool_result` answering a user-actor `tool_call` (a synthetic written before the synthesizer knew about actors) is dropped rather than replayed as an orphan provider tool result (`api-service.ts:4868`). <!-- id:sy5R8JFG -->

`InvokeSessionTool` itself is bounded: only `read`, `write`, and `call` are accepted, it is rejected with 409 while the session has a live run, and execution failures append to the log rather than being hidden (`api-service.ts:2345`). <!-- id:yQRuxww- -->

# `read` safety <!-- id:tJvMcJBK -->

The `read` verb reaches memory, tool contracts, hypermedia, IPFS, the public web, the activity feed, attachments, other threads, and run records. <!-- id:w81Tx18M -->

`thread:` and `run:` reads are scoped by `account_id` alone, so an agent can read the transcripts and run records of **every other agent on the same account** — including their tool inputs and results. The bare `thread:` listing/search (`threadsListing`) deliberately follows the same account scope, and `read ~/self` exposes only what the account owner already configured (definition, grants, signing-key names — never secret material, never provider keys). Within one owner's account that is arguably fine; decide whether agents on one account should ever be isolated from each other before treating them as such. <!-- id:aEUQngB8 -->

Risks: <!-- id:JRXTM2Fl -->
  - SSRF/private-network access if the server runs in a sensitive network; <!-- id:4qrOt2kt -->
  - model-driven reads of arbitrary web resources; <!-- id:fp7BalHn -->
  - large or sensitive tool outputs. <!-- id:eKHOryyQ -->

Mitigations present: <!-- id:hk5kfymg -->
  - address parsing rejects anything outside the supported forms; <!-- id:-tFNxcq6 -->
  - output size limit (256 KiB) on every tool result; <!-- id:qkRlir6U -->
  - durable, actor-stamped tool events for everything the agent and user do; <!-- id:zreEIIiU -->
  - hypermedia-first resolution for `https://` addresses that only falls through to the web reader on an explicit not-hypermedia marker or a 404, so scraped HTML is never silently substituted for document content; <!-- id:hhWC_Z3Z -->
  - no CLI shellout. <!-- id:RTT7AbCG -->

Future mitigations: <!-- id:I9-vG9WC -->
  - outbound allow/deny policy; <!-- id:Ozpk4v3p -->
  - private-network blocklist; <!-- id:IMbSqJ-j -->
  - audit log. <!-- id:qh2aqPS3 -->

# Web reading safety <!-- id:2keSU_sJ -->

Reading `https://` addresses performs a server-side `fetch` (the static tier) and, when configured, has Crawl4AI fetch the page in a real browser (`agents/src/web-tools.ts`). `web_search` is backed by self-hosted SearXNG. Neither carries a third-party API key. <!-- id:jL4ctP0I -->

Risks: <!-- id:m87AsTyx -->
  - **SSRF / private-network access.** On a host with access to a private network or cloud metadata endpoint, a model could request internal addresses. This is currently **unmitigated** beyond `http(s)` scheme enforcement. Before exposing this on a sensitive network, add a private-network/metadata blocklist and an outbound allow/deny policy. <!-- id:VOFf1cSK -->
  - Model-driven retrieval of arbitrary web content into the conversation is the primary prompt-injection surface: treat fetched page text as untrusted input, never as instructions. <!-- id:2-6yKgCM -->
  - Crawl4AI executes a real browser; keep it on the internal network only, never published to the host or internet. <!-- id:OQSzQu3m -->

Mitigations present: <!-- id:bz47yFmI -->
  - `http`/`https` scheme enforcement and URL validation; <!-- id:eimGF8jE -->
  - bounded markdown output (200 KiB, truncated on a byte boundary); <!-- id:dDYgEB82 -->
  - raw mode refuses non-text content types; <!-- id:fsh-KI62 -->
  - the Crawl4AI shared token (`SEED_AGENTS_CRAWLER_TOKEN`) gates the crawler so only the agents service can use it; <!-- id:GHxiL2lw -->
  - `web_search` is a granted callable, not an always-on verb, and throws a clean error when no SearXNG backend is configured; <!-- id:rIwi_Gnj -->
  - failures degrade to `tool_result.error` (or a `partial` flag for incomplete search coverage), never silent fabrication. <!-- id:i1gzDqSt -->

# Agent memory safety <!-- id:lSwfN2YZ -->

Agent memory (`agents/src/agent-memory.ts`) exposes a real filesystem directory to model-controlled input, so path handling is strict: <!-- id:APChYsrg -->
  - every path is validated before use: string-only, no null bytes, no `..` segments, backslashes normalized, depth (16) and length (512 bytes) bounded, and the resolved absolute path re-verified to sit inside `<stateDir>/memory`; <!-- id:dC2437Id -->
  - symlinks are refused as read/write targets and skipped in listings, so memory operations cannot follow a planted link out of the sandbox; <!-- id:jjO2uEQq -->
  - ownership is checked through the agent row before any filesystem operation, so accounts cannot touch other accounts' memory; <!-- id:s6XqDvic -->
  - binary memory files are never sent to the model — a memory read returns metadata only for binary content — but their raw bytes are returned to the owning user over the signed API for preview/download; <!-- id:mVO90UmT -->
  - memory content is model-visible and user-visible by design; do not store secrets in agent memory; <!-- id:Gt-nn0ZR -->
  - `write ipfs://` and `UploadAgentMemoryFileToIpfs` chunk files as UnixFS and publish the blocks through the typed HM API, making the file publicly retrievable by CID; `SEED_AGENTS_IPFS_SERVER_URL` only selects the gateway for later reads, and publishing must still be treated as irreversible disclosure; <!-- id:BArm8mQq -->
  - session attachments (files dropped into the chat composer) are session-private: stored under `<stateDir>/session-attachments/<sessionId>/`, keyed by content SHA-256, capped at 100 MiB each, never auto-copied into cross-session memory or published, deleted with the session, and exposed to the model as metadata until it reads one by address. <!-- id:LnfnVLp1 -->

**Memory has no size quota, and never has.** Earlier revisions of this document described a 1 MiB text write cap, a 100 MiB per-file cap, a 1 GiB per-agent total, and a 2000-entry limit. None of those exist in the code, at HEAD or in the commit that introduced the memory filesystem (`8326a22e7`): `agent-memory.ts` bounds only path length and depth, `downloadToMemory` explicitly allows downloads of any size and aborts only on a 60-second stall (`agent-memory.ts:290`), and the sandbox mount is created with `mount.bind(memoryRoot)` and **no** `.quota()` call (`code-exec.ts:402`) even though the builder supports one. Disk exhaustion by a runaway model write, download, or sandbox program is unbounded today. The only enforced size limits nearby are per-attachment (100 MiB, `session-attachments.ts:26`) and per-chunked-upload (2 GiB, `api-service.ts:158`). <!-- id:C7MI47U4 -->

# Code execution safety <!-- id:mIs-6SHz -->

`execute` and every authored lambda run model-written code, so isolation is delegated to hardware virtualization rather than process sandboxing (`agents/src/code-exec.ts`): <!-- id:VPSYqRA7 -->
  - each execution runs in a fresh ephemeral microVM (embedded `microsandbox` runtime: libkrun on macOS/Linux, WHP on Windows) with the `restricted` in-guest security profile; the VM boundary — not seccomp or containers — is the isolation line; <!-- id:YwAmk-Tb -->
  - the only host filesystem exposure is the agent's own memory directory, bind-mounted at `/workspace`; code cannot see other agents' memory, the SQLite DB, or secrets; <!-- id:ilw1LQ5e -->
  - guest-created symlinks inside the memory directory cannot trick host-side reads: memory reads refuse symlinks and listings skip them; <!-- id:-VQDLseP -->
  - nothing is interpreted by a shell unless the runtime _is_ the shell — the sandbox takes an argv array, so model code containing quotes, newlines, or `$` needs no escaping (`code-exec.ts:470`); <!-- id:oxwzfHCg -->
  - sandbox networking is on by default but constrained to a **non-local egress policy** (`NetworkPolicy.fromProfiles(['public'])`, with `nonLocal()` as the older-SDK dialect — `code-exec.ts:117`), so code reaches the public internet but not the host's private network or cloud-metadata endpoints. DNS is an explicit resolver set (`SEED_AGENTS_EXEC_DNS`), not the host's. `SEED_AGENTS_EXEC_ALLOW_NETWORK=false` removes the NIC entirely. On-by-default egress widens the exfiltration surface versus an offline sandbox — the isolation is the non-local policy plus the memory-only mount, not an air gap; <!-- id:rVcD6uqo -->
  - CPU count, guest memory, per-exec timeout (clamped to ≤ 300s) and total sandbox lifetime (`timeout + 30s`) are capped server-side; stdout/stderr are bounded to 64 KiB each before reaching the model; <!-- id:V1pbuaC_ -->
  - a lambda's input is baked into its program as a double-`JSON.stringify` literal, so no call input can escape into code (`code-exec.ts:505`); <!-- id:JI7bmi1s -->
  - an authored lambda rides on the **same grant** the `execute` tool needs (`api-service.ts:7696`). Without that check, writing a tool document would be a way around an owner who turned code execution off; <!-- id:5h1AAOPn -->
  - resource note: each concurrent execution boots a microVM with its configured guest memory; there is no per-account concurrency limit yet. <!-- id:pU1Hj4Fe -->

# Script (workflow) safety <!-- id:fcE-ASsj -->

Script children are untrusted, model-authored JavaScript. The posture is defense in depth (`agents/src/workflow-host.ts`): <!-- id:Mi-PBDI- -->
  - **Zero-ambient-authority realm**: each run gets a fresh QuickJS-WASM context with no `Date`, `Math.random`, timers, `fetch`, imports, or process access — a submission-time lint rejects those tokens up front, and the realm removes them at runtime. The only way to affect the world is the journaled `ctx` bridge. <!-- id:mvCxlsOc -->
  - **Every effect is validated, bounded, and journaled**: `ctx.call` is checked against the read/write verbs plus the agent's enabled callables (`api-service.ts:3801`) and the tool's input schema; results are size-bounded by the tool caps; the journal is a flight recorder — every external effect is enumerable after the fact via `GetRunJournal`. <!-- id:BNwxImA5 -->
  - **No new authority**: a script can do exactly what its agent could do call-by-call in chat, under the agent's own signing identities and configured HM server. The new dimension is scale, bounded by spawn depth (3), fan-out (10 children per run), the separate workflow concurrency pool, compute fuel between awaits, VM memory, and journal caps. <!-- id:lvFcXqNY -->
  - **Child outputs re-enter parents as data** (schema-validated when a typed result was declared), inside tool results — never as trusted instructions. A prompt-injected child can corrupt only its own return value. <!-- id:_9Lz0w7L -->
  - **Kill switch**: `CancelRun` on any root cascades to every descendant — queued runs never start, waiting runs never wake, live agent runs abort through Pi, live script VMs are interrupted. `StopSession` on the launching chat does the same for its whole tree. <!-- id:LvFiHHRo -->
  - **Accepted gaps**: no cost (dollar/token) budgets yet — wall-time, depth, fan-out, and concurrency caps are the blast-radius controls (live usage is persisted per run and visible to clients). And a `ctx.call` interrupted between execution and its journaled result **re-executes on resume** (at-least-once): fine for idempotent tools, but a `write` crashed at exactly that point could double-publish. Idempotency keys are the roadmap fix. <!-- id:4HiLThr0 -->

# Honest-record guarantees <!-- id:2PvmSscn -->

Several behaviors exist so the log cannot quietly disagree with reality, which is a security property as much as a product one: <!-- id:XS7PsjRR -->
  - the runtime settles a plan step only on evidence — every attached child `succeeded` — and never derives anything from failure (`api-service.ts:2723`); <!-- id:lEfY3dmN -->
  - `resolvedBy: 'runtime'` cannot be forged from model input and is carried across rewrites only while the step stays done (`api-service.ts:2174`); <!-- id:MAH6svgu -->
  - a run that exhausts its continuations leaves an actor-`system` notice naming exactly what was left open, and nothing is ticked off on the agent's behalf (`api-service.ts:2659`); <!-- id:0dfC_lVg -->
  - a typed child that never delivered **fails**, because its parent is blocked on a result that is never coming. <!-- id:PyWycS8a -->

# Replay protection status <!-- id:wDYh8XGZ -->

Implemented: <!-- id:6yUGwnPB -->
  - idempotency for create/message actions with client IDs; <!-- id:wLMm9_EJ -->
  - every signed action carries a signed `action.ts` Unix epoch millisecond timestamp; <!-- id:3GaTvXWk -->
  - HTTP and WebSocket envelopes are rejected when `action.ts` is missing, invalid, or more than 30 seconds from server local time (`MAX_ACTION_CLOCK_SKEW_MS`, `agents/src/auth.ts:5`). <!-- id:lPu7yc3v -->

Not implemented: <!-- id:DEdO-lj6 -->
  - nonce caching, so a captured request can still be replayed within the 30-second timestamp window. <!-- id:JO8PA4PF -->

Nonce caching remains a high-priority hardening project. <!-- id:GLnsVNcT -->

# Logging security <!-- id:cYDdWm8G -->

Recent diagnostic logs are designed to include: <!-- id:N9iFSNhv -->
  - account/agent/session/run IDs; <!-- id:lSZtcWbr -->
  - partial IDs; <!-- id:EDqiNMQ9 -->
  - event counts; <!-- id:NI3689NN -->
  - byte lengths; <!-- id:RzLh-bB8 -->
  - status codes; <!-- id:ZZiEbDV1 -->
  - content types; <!-- id:7Aaju-DC -->
  - durations; <!-- id:pFehaUNh -->
  - active tool names and model/provider identity. <!-- id:zhMld6PQ -->

They should not include secret values or full message content. Keep future logs at this level unless doing explicit local-only debugging. <!-- id:foTMnASr -->

# Security checklist for new work <!-- id:APBpnSzh -->

For every new action: <!-- id:axAWn385 -->
  1. Verify signature. <!-- id:7faLpQy_ -->
  2. Verify signer authorization. <!-- id:dRwdiRcR -->
  3. Normalize inputs at the boundary. <!-- id:27CsEQc_ -->
  4. Scope DB queries by account ownership. <!-- id:NhmrAlp7 -->
  5. Redact sensitive data. <!-- id:UwLTwcN8 -->
  6. Add unauthorized/cross-account tests, including reader-vs-writer and pending-vs-accepted behavior for agent-scoped actions. <!-- id:jG6YnMUV -->
  7. Decide idempotency/replay semantics. <!-- id:VqnyHsSW -->
  8. Decide WebSocket fanout policy. <!-- id:6RJAfdo7 -->
  9. Update docs. <!-- id:3sTUI4X9 -->

For every new tool or address form: <!-- id:CwIdOyUb -->
  1. Add or update the canonical registry entry in `agents/protocol/src/tool-registry.ts` so prompt metadata, input schema, and rendering metadata are reviewed together. <!-- id:QKpeyRPQ -->
  2. Decide the grant: callable set, publish, or ungated. <!-- id:YbrvNPlW -->
  3. Validate inputs at the runtime boundary and return the contract on a miss. <!-- id:6-8VGr0S -->
  4. Bound output size. <!-- id:A6KLJ63H -->
  5. If it can be promoted, confirm the promotion filter still holds. <!-- id:hjF1aWK3 -->
  6. If model-authored text re-enters the prompt inside a frame, escape it. <!-- id:0KW3vaxq -->
  7. Avoid sensitive logs. <!-- id:hCefS6od -->
  8. Add tests for missing credentials and provider/tool errors. <!-- id:DT_jTHUr -->
  9. Update `security.md`, `model-providers.md`, or `tools.md`. <!-- id:6LSu7e5m -->
