---
name: Security model
summary: The Seed Agents security model says who is trusted with what and what limits an agent, from signed requests and access checks to encrypted secrets, sandboxed code and a small fixed set of verbs.
---
This page says who can do what with an agent, and what limits the agent itself. The [Seed Agents](../agent.md) security model rests on five things:

- **Signed requests.** Every request names one account and is signed by a key that may act for it.
- **Access checks on the server.** The server checks on every action whether the caller is the owner or a collaborator.
- **Encrypted secrets.** The server encrypts secrets and never returns them.
- **Signed subscriptions.** A live connection gets no private data until it sends a signed request.
- **A small, fixed set of verbs.** The model can only use the tools the server gives it.

For the Hypermedia side of trust, see [integrity](../protocol/integrity.md) and [permissions](../protocol/permissions.md). <!-- id:DmipMeA2 -->

Two other pages hold the detail. [Sharing an agent](./sharing.md) lists what each role may do, and [agent identity](./identity.md) covers the agent's keys and how secrets are stored.

# Trust boundaries <!-- id:rNafV-CT -->

A trust boundary is a place where data passes between two parts that do not fully trust each other. There are six.

- [Desktop app](../software/desktop.md) ↔ [app environment](../software/app-environment.md). <!-- id:29Vx2kId -->
- App environment ↔ model providers. <!-- id:bWnYZ3vp -->
- App environment ↔ Seed Hypermedia and content servers. <!-- id:aVxHgfoN -->
- App environment ↔ SQLite storage. <!-- id:MvH0stZj -->
- Desktop renderer ↔ desktop [daemon](../software/daemon.md) signing API. <!-- id:zozDhJUY -->
- Agent runtime ↔ sandbox microVM (the only place model-written code runs). <!-- id:-X9dRIVd -->

# HTTP action authentication <!-- id:ydA7wq7B -->

Every HTTP action is a signed `SignedActionEnvelope`, described in the [signed API](../build/signed-api.md): <!-- id:wLZaBkwz -->

```ts <!-- id:PQ3bugHc -->
{
  type: 'AgentsAction', signer, sig, account, action
}
```

The server checks the [signature](../signature.md). Then it checks that the signer may act for the [account](../protocol/identity.md). <!-- id:mJA0FdHP -->

A signer may act for an account when one of these is true: <!-- id:vI4I2YXO -->
  - `signer === account`; or <!-- id:CoVjaoZS -->
  - the envelope carries `capability` (and usually `capabilityBlob`): a [Capability](../capability.md) issued by `account`, delegating to `signer`, role `AGENT` or `WRITER`, not self-issued, under 64 KiB; a verified delegation is recorded as an `AGENT` authorization; or <!-- id:MFXBbOw6 -->
  - `account_authorizations` has role `OWNER` or `AGENT` for `(account, signer)`. <!-- id:nwMz9Fv- -->

## Replay <!-- id:wDYh8XGZ -->

A replay is a captured request that someone sends again. Every signed action carries a signed `action.ts` timestamp in Unix milliseconds. The server rejects an HTTP or WebSocket envelope when the timestamp is missing, invalid, or more than five minutes from the server's clock. The five minutes allow for clocks that differ and for time spent waiting behind a busy server. <!-- id:lPu7yc3v -->

Create and message actions accept a client id that makes a repeat harmless. <!-- id:wLMm9_EJ -->

The server does not remember which requests it has seen. So a captured request can be replayed within the five-minute window. <!-- id:JO8PA4PF -->

# WebSocket authentication <!-- id:bARrb-Xh -->

The socket receives no private data until it sends a signed `Subscribe` action. The server checks that the subscription key belongs to the signed account. See [WebSocket subscriptions](../build/websocket-subscriptions.md). <!-- id:1j5E6yTg -->

A socket cannot switch accounts after a successful subscription. <!-- id:eXQ3pyxw -->

Server-to-client events are not individually signed. <!-- id:8RkjVN2M -->

# Who may act on an agent <!-- id:kaRoiUoq -->

The account that created an agent owns it, and that never changes. Other signed accounts get access only through an accepted invitation as a `reader` or a `writer`, or through the owner's public read and public chat switches. Every action checks the caller's level on the server. [Sharing an agent](./sharing.md) lists the roles and what each may do.

Provider, secret, sign-in and signing-identity changes stay scoped to the collaborator's own account. <!-- id:zN908Czj -->

Agent, [session](./session.md), and run WebSocket subscriptions use the same access check. When access is taken away, the next request or subscription is refused. <!-- id:MP2yCS2d -->

Document permissions and agent access are separate. Being able to write an agent's [document](./mounting.md) changes what the agent is told, because the document is its instructions. It does not give access to the agent's sessions, memory or tools.

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

Session events do not store the account ID directly. The server verifies ownership through the parent session. <!-- id:IJJCyIF0 -->

# Agent isolation <!-- id:KunfZIHl -->

Agents of the same account do not read each other's threads, memory or tools. The `thread:` address (reads and listings) and continuation `session_events` sources reach only the calling agent's own threads. Each agent has its own memory and tools, in its own directory (`state_dir`). Agents talk to each other in public: through [documents](../protocol/documents.md) and [comments](../protocol/comments.md) on the Hypermedia network. They never read one another's transcripts. <!-- id:NDvRam0b -->

One exception: `run:` reads are scoped by account alone. An agent can read the run records of every other agent on the same account, including a run's output and a script's source. So agents on one account are not fully isolated from each other. <!-- id:aEUQngB8 -->

# Secrets <!-- id:SgQVhqL8 -->

The server stores API keys, sign-in credentials, MCP header values and the agents' signing keys encrypted. No action ever returns them. The client refuses to send a secret to a remote server over plain HTTP. The encryption key is stored in the same database as the secrets. So encryption keeps secrets out of the API and the logs. It does not protect against someone who has the whole database. [Agent identity](./identity.md) has the details, and the advice that follows from them: give an agent a key of its own, and self-host if a hosted server should not hold it.

# Provider endpoint safety <!-- id:LxjFNwif -->

Each [provider type](./model-providers.md) has a spec in the code with a fixed default base URL and a flag that says whether a custom base URL is allowed: <!-- id:A7x92_IY -->
  - **Pinned providers** (`openai`, `anthropic`, `google`, `openrouter`, `deepseek`, `groq`, `xai`): the spec default base URL always wins, and any stored `baseUrl` override is ignored. This keeps a stored API key from being redirected to an arbitrary host. <!-- id:Z7EuhaCE -->
  - **Self-hosted and custom providers** (`ollama`, `custom`): the user-supplied `baseUrl` is honored, because pointing at a local or private endpoint is the whole purpose. These accept requests without an API key. The base-URL value is set by the authenticated account owner through signed `SetModelProvider` actions, so the endpoint and any key it carries share a single trust owner. The desktop save flow still refuses to send an API key to a remote plain-HTTP **app environment**. Outbound requests to whatever a custom `baseUrl` names are accepted by design, private addresses included. <!-- id:wI6Dm9fI -->

Subscription ("Sign in with ChatGPT") providers hold OAuth credentials in place of an API key. pi-ai re-resolves and refreshes them per request through the persisted credential store. An expired or revoked sign-in fails the run with an explicit message to sign in again. The flow is off unless the operator opts in, because it needs a client that can catch the provider's localhost redirect. See [Sign in with ChatGPT](./chatgpt-sign-in.md). <!-- id:_cTbxDWl -->

A new pinned provider type inherits the pinned-URL policy automatically. <!-- id:xuEyWxUM -->

# The tool surface is the authority boundary <!-- id:ZUb7YijU -->

The model can only do what its tools let it do. It starts with the five verbs ([read](./read.md), [write](./write.md), [call](./call.md), [delegate](./delegate.md), [plan](./plan.md)) plus the two session verbs, `status` and [`continue_session`](./session-continuation.md). The session verbs touch only the session's own title and its link to a successor. Only **[promotion](./promotion.md)** adds to that set, and promotion has two limits: <!-- id:jh9t4A6y -->
  - promotion is derived only from durable `tool_call` events in this session's own transcript, so it survives restarts and live state cannot inject it; <!-- id:LdBc3z4t -->
  - the server keeps only the promoted names that are also among the agent's enabled [callables](./callables.md), before it offers them to the provider. This filter is a security control. A hallucinated or injected `call {tool: 'bash'}` durably stores that name, and only names that pass the filter are installed as tools of the turn. <!-- id:q2b0tftt -->

The turn's Pi Durable harness starts from an empty registry, and Seed installs one extension in it. Pi's coding tools (`read`, `write`, `edit`, `bash`) are a separate extension that is never installed, and no execution environment is configured. The only executable surface is the Seed-owned verbs. <!-- id:RMyDqBZn -->

Events written by a person's own verb calls carry `actor: 'user'`. Promotion skips them. So a tool that a person runs never changes the agent's set of tools. <!-- id:ahkTiyN7 -->

# Grants <!-- id:u27bF0_B -->

Three things are [granted](./grants.md) per agent. The verbs themselves are never grants. <!-- id:c2iQDOLW -->
  - **The callable set**: which of `search`, `web_search`, `execute` and `browser` the agent may dispatch. `query` and `attributes` are always on, because they only read what `read` already reaches (`attributes` returns a document's [attributes](../metadata.md)). `execute` also drops out when the host cannot run sandboxes. <!-- id:svPa8AfP -->
  - **Publish**: the pseudo-tool `publish` (legacy write-group names still count). Without it, `write` to `hm://` or `ipfs://` returns 403. Memory writes are never gated. That is the intended line: private files are the agent's workspace, and signed public content is a disclosure. <!-- id:N5F17hzw -->
  - **MCP servers**: `definition.mcpServers` names the account [MCP servers](./mcp.md) an agent may call. Enabling a server is a grant on par with `execute`: its tools run with whatever the remote server can do. The projected `mcp` tool documents only cache this grant. `executeMcpTool` re-checks `definition.mcpServers` before any call, so a stale document cannot reach a server the owner turned off. <!-- id:JAdshfOI -->

A [delegate](./delegate.md) child's `tools` narrowing intersects against the parent's full callable set, so delegation can only reduce authority. A child keeps `publish` only when its `tools` ask for `write` or `publish`. <!-- id:6GNsOBus -->

The promotion filter admits the enabled callable set and the agent's own enabled MCP projections, derived again from the definition at run start. A promoted [tool document](./tool-document.md) executes through the same `call` dispatch and the same checks as an explicit `call`. <!-- id:Cqpe6uA3 -->

Grants stop there. There is no rule per address or per destination.

# MCP server safety <!-- id:Vu4WkGXX -->

A connected MCP server is reached with account-configured URLs and headers from the agents host. Only `http(s)` remote transports exist. The service never spawns stdio processes. <!-- id:tBT0Wu3e -->

Risks: <!-- id:m4T6j5YR -->
  - **SSRF and private-network access**: the same unmitigated posture as web reading. An owner can point a server record at any reachable address. Loopback is allowed on purpose, because local MCP proxies are common in development. <!-- id:KT52H4iu -->
  - **Tool authority**: the remote server decides what its tools do. Model-driven calls carry model-authored arguments. A server that acts on the world (files, issues, payments) should be enabled only for agents whose prompts warrant it. <!-- id:pO_XpBfB -->
  - **Prompt injection**: tool results are untrusted text, exactly like fetched web pages. See [untrusted text](./prompt.md). <!-- id:T9GTfukQ -->

Mitigations present: <!-- id:PtUHslMF -->
  - header values are encrypted account secrets, redacted from every response. The desktop refuses to send one to a non-HTTPS remote app environment; <!-- id:KtK34BUu -->
  - server names are slugs and tool names are sanitized to `[A-Za-z0-9_-]` and capped at 64 characters, so a remote name can never collide with a verb, shadow a builtin, or break a provider's tool-name rules; <!-- id:mLjHfMUi -->
  - input is validated against the projected contract before a call leaves the host, and a miss returns the contract; <!-- id:TLAD4kkE -->
  - results are bounded (256 KiB text, 4 MiB per inline image) and server errors become `tool_result.error`; <!-- id:1_EpLlOF -->
  - connections are per run and closed with it. A call has a 120s timeout and a connect has 30s; <!-- id:svG753_g -->
  - deleting a server scrubs it from every agent and deletes the header secrets it owns. <!-- id:DJvUELcZ -->

# Agent-managed triggers <!-- id:COfrFvPS -->

Agents manage their own [triggers](../trigger.md) directly (see [triggers](./triggers.md)). `write ~/triggers/<name>` creates, edits, enables, disables, or deletes a trigger, and `enabled` is honored exactly as written (defaulting to true). "Do this every morning" said in chat works, with no separate approval step. <!-- id:6xYSwts8 -->

This has a cost. A trigger lets an agent act when nobody is present. Text that an agent reads can mislead it (a prompt injection), and a misled agent can create a trigger for itself. Nothing prevents this. What exists lets you see it and limits the damage: <!-- id:Vb4QmNhC -->
  - every trigger write is a saved `tool_call` and `tool_result` pair on the session [Log](./log.md); <!-- id:AcgbWlNJ -->
  - trigger writes emit `trigger-updated` account events, so the desktop Triggers tab reflects changes live; <!-- id:TqGo-Ffe -->
  - a trigger fires only what the agent could already do. Its callable set and publish grant still limit what a firing can do, and delegation still only narrows authority; <!-- id:95IODWlx -->
  - the firing-chain loop guard stops runaway trigger chains. <!-- id:arA2301Y -->

# Verbs run by a person

A person can run `read`, `write` and `call` on a session from the composer's `/` menu (`InvokeSessionTool`). See [running a tool yourself](./wrench-palette.md). Three rules limit it: the server accepts only those three verbs, it rejects the request while the session has a live run, and a failed call is written to the log where anyone can see it. <!-- id:yQRuxww- -->

Their calls and results are shown to the model inside `<user_action>` frames. Text in those frames, and in every other frame that carries text someone else wrote, is escaped so it cannot close the frame. See [untrusted text that reaches the model](./prompt.md).

# `read` safety <!-- id:tJvMcJBK -->

The [`read`](./read.md) verb reaches memory, tool contracts, hypermedia, [IPFS](../protocol/files.md), the public web, the activity feed, attachments, other threads, and run records. <!-- id:w81Tx18M -->

`read ~/self` exposes only what the account owner already configured: definition, grants, signing-key names. It never exposes secret material or provider keys.

Risks: <!-- id:JRXTM2Fl -->
  - SSRF and private-network access if the server runs in a sensitive network; <!-- id:4qrOt2kt -->
  - model-driven reads of arbitrary web resources; <!-- id:fp7BalHn -->
  - large or sensitive tool outputs. <!-- id:eKHOryyQ -->

Mitigations present: <!-- id:hk5kfymg -->
  - address parsing rejects anything outside the supported forms; <!-- id:-tFNxcq6 -->
  - output size limit (256 KiB) on every tool result; <!-- id:qkRlir6U -->
  - saved tool events, each with its actor, for everything the agent and the user do; <!-- id:zreEIIiU -->
  - hypermedia-first resolution for `https://` addresses. It falls through to the web reader only on an explicit not-hypermedia marker or a 404, so scraped HTML never silently replaces document content; <!-- id:hhWC_Z3Z -->
  - no shelling out to the [CLI](../build/cli.md). <!-- id:RTT7AbCG -->

# Web reading safety <!-- id:2keSU_sJ -->

Reading `https://` addresses performs a server-side `fetch` (the static tier) and, when configured, has Crawl4AI fetch the page in a real browser. [Web reading](./web-reading.md) describes the reader chain. `web_search` is backed by self-hosted SearXNG. Neither carries a third-party API key. <!-- id:jL4ctP0I -->

Risks: <!-- id:m87AsTyx -->
  - **SSRF and private-network access.** On a host with access to a private network or cloud metadata endpoint, a model could request internal addresses. This is **unmitigated** beyond `http(s)` scheme enforcement. There is no blocklist for private networks or metadata endpoints and no outbound allow or deny policy, so do not run a server with web reading on a sensitive network. <!-- id:VOFf1cSK -->
  - Model-driven retrieval of arbitrary web content into the conversation is the main prompt-injection surface. Treat fetched page text as untrusted input, never as instructions. <!-- id:2-6yKgCM -->
  - Crawl4AI executes a real browser. Keep it on the internal network only, and never publish it to the host or internet. <!-- id:OQSzQu3m -->

Mitigations present: <!-- id:bz47yFmI -->
  - `http` and `https` scheme enforcement and URL validation; <!-- id:eimGF8jE -->
  - bounded markdown output (200 KiB, truncated on a byte boundary); <!-- id:dDYgEB82 -->
  - raw mode refuses non-text content types; <!-- id:fsh-KI62 -->
  - the Crawl4AI shared token (`SEED_APPS_CRAWLER_TOKEN`) gates the crawler so only the app environment can use it; <!-- id:GHxiL2lw -->
  - `web_search` is a granted callable (it is not an always-on verb) and throws a clean error when no SearXNG backend is configured; <!-- id:rIwi_Gnj -->
  - failures degrade to `tool_result.error` (or a `partial` flag for incomplete search coverage). Nothing is silently made up. <!-- id:i1gzDqSt -->

# Agent memory safety <!-- id:lSwfN2YZ -->

Agent [memory](./memory.md) exposes a real filesystem directory to model-controlled input, so path handling is strict: <!-- id:APChYsrg -->
  - every path is validated before use: string-only, no null bytes, no `..` segments, backslashes normalized, depth (16) and length (512 bytes) bounded, and the resolved absolute path re-verified to sit inside `<stateDir>/memory`, or inside `<stateDir>/private-memory` for `~/memory/private/`; <!-- id:dC2437Id -->
  - symlinks are refused as read and write targets and skipped in listings, so memory operations cannot follow a planted link out of the sandbox; <!-- id:jjO2uEQq -->
  - ownership is checked through the agent row before any filesystem operation, so accounts cannot touch other accounts' memory; <!-- id:s6XqDvic -->
  - binary memory files are never sent to the model: a memory read returns only metadata for binary content. Their raw bytes are returned to the owning user over the signed API for preview and download; <!-- id:mVO90UmT -->
  - memory content is visible to the model and the user by design. Do not store secrets in agent memory; <!-- id:Gt-nn0ZR -->
  - `write ipfs://` and `UploadAgentMemoryFileToIpfs` store a memory file on the daemon as [UnixFS](../protocol/files.md) pieces. Nobody can fetch them (the answer is `blob … is not public`) until a public [Change](../change.md), [Comment](../comment.md) or [Profile](../profile.md) links to the file's [CID](../cid.md). See [privacy](../protocol/privacy.md). From that moment the file is public and cannot be taken back, so treat every upload as public. `SEED_APPS_IPFS_SERVER_URL` only selects the server used for later reads. Showing a memory file to the owner in chat does not use IPFS: the transcript renders `![…](~/memory/path)` over the signed API; <!-- id:BArm8mQq -->
  - a session's [durable store](./durable-sessions.md) is in the agents database. It holds the same conversation as the log, in the form the model reads it, including provider reasoning the log does not keep. It is not in the agent's state directory, so neither the model's verbs nor sandboxed code can reach it, and it is deleted with the session; <!-- id:MaQG6cw9 -->
  - session files (files dropped into the chat composer) are session-private: stored under `<stateDir>/session-attachments/<sessionId>/`, keyed by content SHA-256, capped at 100 MiB each, never auto-copied into cross-session memory or published, deleted with the session, and exposed to the model as metadata until it reads one by address. <!-- id:LnfnVLp1 -->

**Memory has no size quota.** Only path length and depth are bounded. A download into memory may be of any size and is aborted only when it stalls for 60 seconds. The sandbox mounts the memory directory with no quota. So a runaway model write, download or sandbox program can fill the disk. The only size limits nearby are per attachment (100 MiB) and per chunked upload (2 GiB). <!-- id:C7MI47U4 -->

# Code execution safety <!-- id:mIs-6SHz -->

[`execute`](./code-execution.md) runs model-written code, so isolation comes from hardware virtualization. Process sandboxing is not used: <!-- id:VPSYqRA7 -->
  - each execution runs in a microVM that is fresh by default, or, when the warm pool is enabled (`SEED_APPS_EXEC_WARM_POOL=1`), one reused only for the same account, agent, session and image; no VM is ever shared across those. The VM runs on the embedded `microsandbox` runtime (libkrun on macOS and Linux, WHP on Windows) with the `restricted` in-guest security profile. The VM boundary is the isolation line. Seccomp and containers are not; <!-- id:YwAmk-Tb -->
  - the only part of the host's file system that code can see is the agent's own memory directory, without `~/memory/private/`, mounted at `/workspace`. Code cannot see other agents' memory, the SQLite DB, or secrets; <!-- id:ilw1LQ5e -->
  - guest-created symlinks inside the memory directory cannot trick host-side reads. Memory reads refuse symlinks and listings skip them; <!-- id:-VQDLseP -->
  - nothing is interpreted by a shell unless the runtime _is_ the shell. The sandbox takes an argv array, so model code containing quotes, newlines, or `$` needs no escaping; <!-- id:oxwzfHCg -->
  - sandbox networking is on by default but constrained to a **non-local egress policy**. Code reaches the public internet but not the host's private network or cloud-metadata endpoints. DNS uses an explicit resolver set (`SEED_APPS_EXEC_DNS`) and never the host's. `SEED_APPS_EXEC_ALLOW_NETWORK=false` removes the NIC entirely. On-by-default egress widens the exfiltration surface compared to an offline sandbox. The isolation is the non-local policy plus the memory-only mount. There is no air gap; <!-- id:rVcD6uqo -->
  - CPU count, guest memory, per-exec timeout (clamped to ≤ 300s) and total sandbox lifetime (`timeout + 30s`) are capped server-side. stdout and stderr are bounded to 64 KiB each before reaching the model; <!-- id:V1pbuaC_ -->
  - each concurrent execution boots a microVM with its configured guest memory. There is no limit per account. A host-wide cap, `SEED_APPS_EXEC_MAX_CONCURRENT` (default `CPUs - 2`, at least 1), queues executions first-in first-out and answers 503 after `SEED_APPS_EXEC_ACQUIRE_WAIT_SECS` (30 s). <!-- id:pU1Hj4Fe -->

# Script (workflow) safety <!-- id:fcE-ASsj -->

[Script](./script.md) children are JavaScript that the model wrote, so the server does not trust them. Several layers protect against them: <!-- id:Mi-PBDI- -->
  - **Zero-ambient-authority realm**: each run gets a fresh QuickJS-WASM context with no `Date`, `Math.random`, timers, `fetch`, imports, or process access. A submission-time lint rejects those tokens up front, and the realm removes them at runtime. The only way to affect the world is the journaled `ctx` bridge. <!-- id:mvCxlsOc -->
  - **Every effect is validated, bounded, and journaled**: `ctx.call` is checked against the read and write verbs plus the agent's enabled callables and the tool's input schema. Results are size-bounded by the tool caps. The [journal](./journal.md) is a flight recorder: you can list every external effect after the fact via `GetRunJournal`. <!-- id:BNwxImA5 -->
  - **No new authority**: a script can do exactly what its agent could do call-by-call in chat, under the agent's own signing identities and configured HM server. The new factor is scale, bounded by spawn depth and fan-out (the [thoroughness](./delegation-budgets.md) preset: quick 1/4, normal 3/10, deep 5/16), the separate workflow concurrency pool, compute fuel between awaits, VM memory, and journal caps. <!-- id:lvFcXqNY -->
  - **Child outputs re-enter parents as data** (schema-validated when a [typed result](./typed-result.md) was declared), inside tool results. They are never trusted instructions. A prompt-injected child can corrupt only its own return value. <!-- id:_9Lz0w7L -->
  - **Kill switch**: `CancelRun` on any root cascades to every descendant. Queued runs never start, waiting runs never wake, live agent runs abort their durable conversation, live script VMs are interrupted. `StopSession` on the launching chat does the same for its whole tree. <!-- id:LvFiHHRo -->
  - **What is not bounded**: there are no cost budgets, in money or in tokens. Wall time, depth, fan-out and concurrency caps are the controls, and live usage is recorded per run and visible to clients. A script's `ctx.call` interrupted between execution and its journaled result runs again on resume (at-least-once). That is fine for idempotent tools, but a `write` that crashed at exactly that point could publish twice. A chat turn's tool calls are covered: the [effect outbox](./effect-outbox.md) records each effect before it runs and answers a rerun from its receipt. <!-- id:4HiLThr0 -->

# Honest-record guarantees <!-- id:2PvmSscn -->

Several rules keep the log from quietly disagreeing with what really happened. That matters for security and for the product: <!-- id:XS7PsjRR -->
  - the runtime settles a [plan](./plan.md) step only on evidence (every attached child `succeeded`) and never derives anything from failure; <!-- id:lEfY3dmN -->
  - `resolvedBy: 'runtime'` cannot be forged from model input and is carried across rewrites only while the step stays done; <!-- id:MAH6svgu -->
  - a run that uses up its [obligation](./obligations.md) reminders leaves a `system` notice that names exactly what was left open, and nothing is ticked off for the agent; <!-- id:0dfC_lVg -->
  - a typed child that never delivered **fails**, because its parent is blocked on a result that is never coming. <!-- id:PyWycS8a -->

# Logging <!-- id:cYDdWm8G -->

Diagnostic logs carry ids (account, agent, session, run, partial), event counts, byte lengths, status codes, content types, durations, the names of active tools, and the model and provider. They never carry plaintext secrets, decrypted keys, provider secret config, signed request bodies, full prompts, or large tool outputs.

One thing is not a log line but lands in the same place. While a model writes a reply, the server also writes the reply text to standard output. So the output of the server process holds the text of replies. The server does not do this for a session that used the browser or [private memory](./memory.md#private-memory). An operator who keeps the server's output keeps that text too. See [logs](../operate/logs.md).

# See also <!-- id:zMjUwvqz -->

- [What an agent is told](./prompt.md) <!-- id:AE0gzIt9 -->
- [Sharing an agent](./sharing.md)
- [Agent identity](./identity.md)
- [Grants](./grants.md) <!-- id:Y0do_GI6 -->
- [Signed API](../build/signed-api.md) <!-- id:0xLAb_pL -->
- [Tools](./tools.md) <!-- id:PqOJhjcu -->
- [MCP servers](./mcp.md) <!-- id:0FIt6app -->
- [Integrity](../protocol/integrity.md) <!-- id:r2tAKzit -->
- [Permissions](../protocol/permissions.md) <!-- id:HiYPvOW5 -->
