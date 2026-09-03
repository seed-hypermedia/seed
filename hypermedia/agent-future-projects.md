---
name: Future projects
summary: This document collects larger projects that are referenced throughout the Agents docs. Use Roadmap for current priority order; use this file for project…
---
This document collects larger projects that are referenced throughout the Agents docs. Use [Roadmap](./agent-roadmap.md) for current priority order; use this file for project scope and implementation notes. Statuses last reconciled against the code on **2026-08-13**. <!-- id:lQzTk4mi -->

# Completed: Shared Agents protocol package <!-- id:4Vl1Ukzw -->

Status: completed. Protocol types now live in `agents/protocol` as the private package `@seed-hypermedia/agents-protocol`. <!-- id:UNNmnSs5 -->

Implemented: <!-- id:xcAbQAog -->
  - `agents/protocol/src/index.ts` exports the action, response, model, session, and WebSocket event types from one source; <!-- id:fSIaZ1WG -->
  - `agents/src/api.ts` re-exports the shared package so existing Bun service imports continue to work; <!-- id:4QG_ZOpi -->
  - `frontend/apps/desktop/src/agents-client.ts` imports protocol types from the shared package instead of maintaining a manual mirror; <!-- id:8odnUiL7 -->
  - desktop depends on the package through `file:../../../agents/protocol`, and the Bun service depends on it through `file:./protocol`; <!-- id:Xfw18PE6 -->
  - the desktop/server action and response unions are now compile-time aliases of the same shared exported types. <!-- id:L1uze2FM -->

# Completed: Pi SDK agentic-loop migration <!-- id:KyaoMKK4 -->

Status: complete. Every turn runs through `#runPiAgent()`; the manual `fetch()`/SSE/tool loop is gone from the code. Remaining work is provider hardening, tracked in the roadmap, not migration work. See [Pi SDK migration project](./agent-pi-sdk-migration.md). <!-- id:wPTghx-D -->

Problem: Seed Agents initially implemented the LLM loop manually with direct OpenAI-compatible `fetch()` calls, hand-written SSE parsing, and an OpenAI-specific tool loop. <!-- id:LzME1y0F -->

Scope: <!-- id:fQcn3xV- -->
  - use `@mariozechner/pi-coding-agent` as the model execution and tool orchestration layer; <!-- id:NRqqNl7S -->
  - keep Seed's signed API, account authorization, SQLite session events, desktop UX, provider/secret records, and `read` tool; <!-- id:3yzUh4vJ -->
  - map Seed provider records to Pi provider/model configuration; <!-- id:jpQjknSE -->
  - inject decrypted Seed secrets into Pi as runtime-only credentials; <!-- id:ZqgtDap6 -->
  - disable Pi default coding tools and resource discovery until Seed has explicit product/security controls; <!-- id:eDYPDyLe -->
  - translate Pi streaming/tool/final/error events back into Seed durable events and WebSocket partials; <!-- id:7PPjo8A_ -->
  - expand Anthropic and Google execution through Pi rather than building bespoke Seed provider loops. <!-- id:dcA5vCJh -->

Done when: <!-- id:01v3VSbQ -->
  - the manual OpenAI `fetch()`/SSE/tool loop is not the primary runtime path; <!-- id:DcD1lhsa -->
  - OpenAI-compatible sessions still work from desktop; <!-- id:HGV7ukaV -->
  - Anthropic and Google sessions work through Pi or are explicitly blocked with current docs; <!-- id:Ia11zWWm -->
  - `read` remains durable and visible; <!-- id:blsquscI -->
  - Seed secrets are not persisted into Pi auth files; <!-- id:wmtvy9wB -->
  - `cd agents && bun check && bun test` passes. <!-- id:XPN8j-oC -->

# Completed: Anthropic execution backend <!-- id:dDvXH4uJ -->

Status: folded into the Pi SDK migration and delivered through it — Anthropic is a mapped provider type executing through Pi. What remains is a real-provider smoke test, not a backend. <!-- id:qN0rX3sh -->

The original standalone scope, kept for reference: <!-- id:5uzMwwXz -->
  - implement Anthropic Messages API runner; <!-- id:pIMpGiiW -->
  - map internal session history to Anthropic format; <!-- id:nmI49xWP -->
  - support streaming text deltas; <!-- id:raNHHTBH -->
  - support tool-use/tool-result round trips; <!-- id:hqNnU5wE -->
  - add endpoint trust policy; <!-- id:3g-AgFKC -->
  - add mocked tests. <!-- id:j4vi8cU7 -->

Done when: <!-- id:DCJMdqjX -->
  - an Anthropic provider can run a session end-to-end from desktop; <!-- id:JKNma7nL -->
  - streaming markdown behaves the same as OpenAI; <!-- id:OVOCLyw6 -->
  - `read` works through Anthropic tools. <!-- id:oj7-6Y-4 -->

# Completed: Google/Gemini execution backend <!-- id:w9-yN3SD -->

Status: folded into the Pi SDK migration and delivered through it. As with Anthropic, only real-provider smoke coverage is outstanding. <!-- id:0eo2BZvp -->

The original standalone scope, kept for reference: <!-- id:TKBwfkXG -->
  - implement Gemini runner; <!-- id:7UZyZhQY -->
  - map internal session history to Gemini content format; <!-- id:VOy-b5Ng -->
  - support streaming; <!-- id:010DnIZy -->
  - support function/tool calling; <!-- id:tSUhisq9 -->
  - add mocked tests and endpoint policy. <!-- id:lF_IH6Ha -->

Done when: <!-- id:-lqyDf3C -->
  - Google provider sessions work from desktop; <!-- id:Z1D6wJ4Y -->
  - tool events are durable and visible; <!-- id:Mu8U452Z -->
  - errors are persisted as session error events. <!-- id:-bLw5WIN -->

# Project: Agent triggers <!-- id:-s6aGYNB -->

Status: the scope below is shipped. What is open is the next shape — trigger **documents** with draft→active consent, designed in `docs/harness/m6-event-bus-design.md` and not built. See [Agent triggers plan](./agent-triggers-plan.md) for the shipped surface and its banner for what replaced what. <!-- id:TAYpzqIU -->

Delivered scope: <!-- id:usHYtdvU -->
  - agent-scoped triggers made of a prompt plus a source/filter, over five sources (schedule, document-comment, user-mention, site-update, run-completed); <!-- id:EQ5Db9nx -->
  - Triggers tab, New trigger dialog, editable detail page, breadcrumbs, trigger-created session list — except that a `run-completed` trigger can only be created through the API; <!-- id:utcqjjQt -->
  - HM activity feed monitoring with durable watermarks, per-trigger cooldowns, and exactly-once firing dedup; <!-- id:Gq-kA0QT -->
  - continuations beyond "start a thread": `wake` delivers a firing into a parked run, with an 8-hop chain loop guard. <!-- id:jAp6hZKH -->

Open scope: documents in `~/triggers/**`, activation consent, the `document-change` source, `appendTo`/`runPlan` continuations, the migration off `agent_triggers`, and the desktop editor. <!-- id:ZvqQKOKI -->

# Completed: Stop/cancel running sessions <!-- id:bTeGaHtn -->

Status: completed. `StopSession` aborts the live Pi turn and cancels every run rooted at the session including descendants; `CancelRun` cancels any run's subtree (queued runs never start, waiting runs never wake, executing runs abort via Pi abort / VM interrupt). The desktop has a stop button and a cancel control on the pinned run card. <!-- id:NWxooYv2 -->

Original scope: <!-- id:jaZWU2-Y -->
  - add `StopSession` or `CancelRun` action; <!-- id:ikYJO5_4 -->
  - track active run abort controllers; <!-- id:9_gyRgYI -->
  - interrupt provider request; <!-- id:rV90T9cF -->
  - append durable stopped/cancelled event; <!-- id:4vphk2kp -->
  - set status `stopped` or `idle` with stop metadata; <!-- id:xBSsf7xR -->
  - add desktop stop button; <!-- id:KUMHQXAs -->
  - broadcast live state. <!-- id:I2NA0Lwm -->

Risks: <!-- id:Nd8rqptk -->
  - concurrent run state must be explicit; <!-- id:22tuOGub -->
  - cancellation races with final provider events must be handled without sleeps. <!-- id:35wOWAWU -->

# Completed: Run records and richer runtime state <!-- id:vTLZmxt2 -->

Status: completed as the runs foundation of `workflows-v1-plan.md` — the `runs` table doubles as the dispatch queue, usage persists per turn with child rollup, session events carry no run linkage but sessions carry `run_id`, and `ListRuns`/`GetRun`/`GetRunJournal` plus `runs/<rootRunId>` subscriptions expose it live and after reconnect. <!-- id:8Qo322ET -->

Original scope: <!-- id:ch8AH584 -->
  - add `runs` table; <!-- id:cnGr6e-I -->
  - persist run status, provider, model, start/end times, token/usage metadata; <!-- id:7wHTu1jF -->
  - associate partials/tool events/final messages with run IDs; <!-- id:_rbuEuYn -->
  - expose run data to inspector UI; <!-- id:N7xhdPoL -->
  - support better recovery after desktop reconnect. <!-- id:dJ6_Kfmd -->

# Project: WebSocket protocol v2 <!-- id:XZLYhJ3R -->

Scope: <!-- id:i5U1-lRl -->
  - CBOR server-to-client events; <!-- id:bU24GBqN -->
  - heartbeat/ping; <!-- id:Stg2akOH -->
  - explicit unsubscribe; <!-- id:uSuj-BWh -->
  - subscription limits; <!-- id:G7U4Am1T -->
  - backpressure strategy; <!-- id:eQwyXvaC -->
  - better reconnect cursors; <!-- id:fsDzSbMH -->
  - optional short-lived subscription capability tokens; <!-- id:VZB5Dc-X -->
  - metrics. <!-- id:YvHHluyo -->

# Completed: Domain-aware SHM read/query tool <!-- id:2KYChs3D -->

Status: delivered. `resolveIdWithClient()` takes a `domainResolver`, and the agents service passes a `GetDomain`-backed one, so a pasted custom-domain URL resolves to its canonical `hm://` id before the read. The naming question resolved itself: there is no `query` alias — reading is the `read` verb over any address, and searching is the `search` callable. <!-- id:M4J1C-W- -->

Remaining from the original scope: exposing read-only Seed client request keys (`ListComments`, `ListCitations`, …) as a structured query surface was neither built nor rejected. <!-- id:2xBWFJTs -->

Original scope: <!-- id:dUz_oYvU -->
  - keep `read` as the compatibility base and decide later whether to expose a model-facing `query` alias; <!-- id:zThMWbfM -->
  - reuse the existing resolver stack in `@seed-hypermedia/client` (`resolveHypermediaUrl`, `resolveId`, and `resolveIdWithClient`) rather than adding agent-specific URL parsing; <!-- id:2dR_3prK -->
  - extend `frontend/packages/client/src/resource-read.ts` so `resolveIdWithClient()` accepts and forwards `DomainResolverFn` to `resolveId()`; <!-- id:iYlyQ16f -->
  - support pasted `hm://`, `hm:`, gateway URLs, and clean web URLs such as `https://example.com/path`; <!-- id:IPh7pQq4 -->
  - for web URLs, resolve through the existing workflow: cached/domain resolver first, then OPTIONS-header fallback; <!-- id:WrtgXhqX -->
  - add an agents-service domain resolver that implements the shared `DomainResolverFn` shape, likely backed by `createSeedClient(serverUrl).request('GetDomain', {domain, forceCheck: true})` because the Bun service does not have the desktop daemon `grpcClient`; <!-- id:ayML20nM -->
  - include both the user-supplied URL/ID and the resolved HM URL in tool output; <!-- id:OR3MKFBe -->
  - optionally generalize the tool input to support read-only Seed client request keys (`Resource`, `Search`, `Query`, `ListComments`, `ListCitations`, etc.) while explicitly rejecting write/action keys such as `PublishBlobs` and `PrepareDocumentChange`; <!-- id:_n5kFRQ4 -->
  - preserve markdown output for document/comment `Resource` reads and keep the existing tool-result size bound; <!-- id:lismsDIm -->
  - add tests for domain-resolver passthrough, domain URL resolution, OPTIONS fallback, action-key rejection, and durable tool call/result continuation. <!-- id:SXAFJe5R -->

Done when: <!-- id:5K62FO33 -->
  - asking an agent to read a pasted HM web-domain URL resolves to the correct HM ID without duplicating resolver logic; <!-- id:McuJWnKn -->
  - existing `read` calls still work; <!-- id:gkjEP8Q- -->
  - docs clearly state whether `query` is an alias/new default or future naming cleanup. <!-- id:6_TYUFcM -->

# Mostly completed: Shared rich tool-call rendering coverage <!-- id:EkIhUa3N -->

Status: the adapter is covered — `agent-session-rows.test.ts` exercises durable `tool_call`/`tool_result` pairing, actor attribution, and obligation notices, alongside `run-card` and `assistant-message-rendering` tests. What is not specifically covered is the fallback rendering path for unknown tools. <!-- id:sVxME5Ko -->

Original scope: <!-- id:OIpja9Qi -->
  - add desktop tests or focused smoke coverage for pairing durable `tool_call` and `tool_result` events by call ID; <!-- id:vU1hv2I6 -->
  - cover pending calls with the shared running/spinner state; <!-- id:K1CBp51D -->
  - cover read-specific bubbles for `read` and any future `query` alias, including requested URL, resolved HM URL, resource type, format, and raw-debug access; <!-- id:_zfrbtCE -->
  - preserve fallback generic rendering coverage for unknown tools/events. <!-- id:mj3DvZf3 -->

Done when: <!-- id:7rLB74bD -->
  - tests protect the shared renderer and Agents adapter behavior; <!-- id:i0Ht30YQ -->
  - assistant sidebar rendering remains unchanged. <!-- id:_DgZRuOt -->

# Mostly completed: Tool registry and permissions <!-- id:vJMx4C6r -->

Status: the registry and the permission model shipped, in a different shape than this scope imagined. Tools are content-addressed documents in each agent's `~/tools/`; the five verbs are always on and are never grants; what a grant covers is the **callable set** (search / web search / execute) and **publish** (signed public writing), both exposed as desktop toggles. <!-- id:Df2U2vmF -->

Still open: an account- or deployment-level tool policy above the per-agent one, an audit log for tool use, and an outbound URL policy (see the roadmap's security list). <!-- id:GUMG_yK- -->

# Project: Production secret management <!-- id:KsnAQvLc -->

Scope: <!-- id:U0IlGvMs -->
  - OS keychain or KMS-backed encryption key; <!-- id:hbJnZOD5 -->
  - key rotation; <!-- id:NQgLIgBU -->
  - secret versions; <!-- id:aw6tPI5K -->
  - delete/rotate secret API; <!-- id:9JNXGKKH -->
  - backup/restore semantics; <!-- id:MRkWc9SN -->
  - deployment docs. <!-- id:jsWzd6gs -->

# Project: Replay protection for all actions <!-- id:SmHvU2a8 -->

Current status: signed actions now include `action.ts`, and the server rejects timestamps outside a 30-second local-time window. <!-- id:1Jid5tnn -->

Remaining scope: <!-- id:ifMptZsA -->
  - maintain bounded nonce cache by account/signer; <!-- id:35Duw2fz -->
  - reject duplicate nonces inside the timestamp window; <!-- id:YUvtFD75 -->
  - preserve idempotency semantics for retryable writes; <!-- id:ZY-brOtm -->
  - add tests for duplicate replay rejection. <!-- id:JlPV_Q_U -->

# Project: Provider management UX <!-- id:CFMz_EeN -->

Scope: <!-- id:eha5YB6X -->
  - delete provider; <!-- id:ZSnXCOkN -->
  - rotate API key; <!-- id:l9_etsZt -->
  - provider test button; <!-- id:wEVil3if -->
  - display last used/error status; <!-- id:1_V5Bo8X -->
  - warn when provider type is configured but execution unsupported; <!-- id:EiUGFNzc -->
  - model presets/capability metadata. <!-- id:MbDfGheD -->

# Project: Rich tool result rendering <!-- id:Fwco_CXa -->

Status: partly delivered by registry-driven rendering — each tool declares its label, primary argument, resource argument, summary path, and detail rows, so a `read` row already links its `hm://` address and expands to its content, with raw payloads behind the info dialog. Not delivered: document previews rendered as documents rather than as text, and showing the requested URL beside the resolved one. <!-- id:r5Syz-tY -->

Remaining scope: <!-- id:MMgkTFZY -->
  - render `read` results as collapsible document previews; <!-- id:hziGb0pX -->
  - show requested URL and resolved HM ID clearly; <!-- id:ohHxZR29 -->
  - open/copy resolved URL; <!-- id:Wry_xAih -->
  - show markdown excerpts. <!-- id:EtXrG2tF -->

# Project: Delegated signer registration <!-- id:AaYoOcIM -->

Problem: `verifyEnvelope` authorizes a signer that is either the account itself or holds an `AGENT`/`OWNER` row in `account_authorizations` — but no protocol action writes that table; only tests call `setLocalAuthorization`. So every real client must sign with the account key, which is exactly what a web device cannot do. <!-- id:SC9VFwbc -->

Scope: <!-- id:i08tgBfN -->
  - an action that registers a delegated signer for an account, and one that revokes it; <!-- id:air-qsu1 -->
  - decide what evidence authorizes the registration (an HM capability blob is the obvious candidate) and where the capability string on the row comes from; <!-- id:L5mMSr2A -->
  - surface the authorized signers so a user can see and revoke devices acting for their account; <!-- id:u7xDi8OX -->
  - tests covering authorized, unauthorized, and revoked signers across the action paths. <!-- id:Sg9wxUrI -->

Done when: a web device holding its own key can run an agent session for an account it was granted, and revoking the grant stops it. <!-- id:XCNDWOmm -->

# Project: Agent templates and tool-aware creation <!-- id:XTMK4oLQ -->

Scope: <!-- id:7EePGV6R -->
  - prompt templates; <!-- id:ze__B-9d -->
  - model defaults per provider; <!-- id:H-gs-tZJ -->
  - tool selection; <!-- id:xK8c0-0n -->
  - advanced settings; <!-- id:2tLa1Qyb -->
  - validation against provider capabilities; <!-- id:AyROJE0t -->
  - import/export agent definitions. <!-- id:tFlQg6SK -->

# Project: Server deployment guide <!-- id:Co8oNkqo -->

Scope: <!-- id:noMIWTyO -->
  - TLS/reverse proxy guidance; <!-- id:kL6sDZYk -->
  - systemd/launchd examples; <!-- id:f1d1IxHd -->
  - DB backup/restore; <!-- id:Vt0ESnq9 -->
  - secret key management; <!-- id:z2wMZb6s -->
  - log redaction policy; <!-- id:geEC0Mip -->
  - remote desktop connection instructions. <!-- id:vAgHPfjy -->

# Project: Testing expansion <!-- id:Pqm7_RdN -->

Status: cancellation is covered (`runs.test.ts`, `run-time.test.ts` drive real runs through the real queue), and the service suite runs a real Bun server. The WebSocket, desktop-hook, dialog, and SSE-parser items below are still open. <!-- id:x2u2SyDe -->

Scope: <!-- id:f7TVlxk0 -->
  - end-to-end WebSocket tests with real Bun server; <!-- id:vPIX1Cr3 -->
  - desktop hook tests for `appendPartial` and malformed messages; <!-- id:xE6vD36M -->
  - provider dialog tests; <!-- id:LnH2RH4t -->
  - create-agent dialog tests; <!-- id:OZ5iftm2 -->
  - OpenAI SSE CRLF parser regression tests; <!-- id:Fo-OuvkV -->
  - cancellation tests once implemented; <!-- id:8BXX_845 -->
  - multi-client live update tests. <!-- id:szOiK5TX -->
