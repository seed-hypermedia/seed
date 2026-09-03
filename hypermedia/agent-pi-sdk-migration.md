---
name: Pi SDK migration project
summary: This project tracks replacing the custom model-provider loop in Seed Agents with the Pi SDK agentic loop from @mariozechner/pi-coding-agent.
---
<!-- id:ASM89C2A -->
> **STATUS (2026-08-13): the migration itself is complete history. A few hardening items remain.** <!-- id:jYQdeGAW -->

\> <!-- id:k3pIbY4s -->
  > Phases 0 and 1 are done and the old runtime is gone: `#runOpenAI()`, `#openAIChatStream()`, and the hand-written SSE <!-- id:nhWg1tCe -->
  > parser described under "Current state" no longer exist in `api-service.ts`. Every turn runs through `#runPiAgent()`. <!-- id:P__ev-Hj -->
  > Phase 2's provider mapping is in place for the whole registry (OpenAI, Anthropic, Google, OpenRouter, DeepSeek, Groq, <!-- id:KbzywubB -->
  > xAI, Ollama, Custom). Of Phase 3, cancellation through the session abort landed with `StopSession`/`CancelRun`, and <!-- id:Rjaawaa0 -->
  > reasoning level became a typed agent setting (`AgentDefinition.reasoningLevel`). <!-- id:DIoJmWKk -->

\> <!-- id:jGVfEUvb -->
  > **Still open:** real-provider smoke tests for Anthropic and Google (mocked coverage only); the <!-- id:WI5M28Kd -->
  > `provider.modelDefaults` typed-settings question; Pi context **compaction**, which is deliberately disabled <!-- id:tNFe8vU0 -->
  > (`SettingsManager.inMemory({compaction: {enabled: false}})`) — Seed's durable transcript is the record, and the <!-- id:f2rcmKBN -->
  > touch-expand pin set is derived from it precisely so that it would survive compaction when compaction arrives; and <!-- id:FYr2-4Jw -->
  > multi-turn tool-history regression coverage. <!-- id:qr2wxlEH -->

\> <!-- id:u8AiilXG -->
  > Sections below describing the pre-migration runtime are historical. <!-- id:Iv_xdpLx -->

This project tracks replacing the custom model-provider loop in Seed Agents with the Pi SDK agentic loop from `@mariozechner/pi-coding-agent`. <!-- id:GUWwm7AI -->

Status: the first implementation is in place. Seed now uses a Pi SDK-backed runner for `MessageSession`, with OpenAI-compatible behavior covered by mocked streaming tests. Anthropic and Google are mapped through Pi but still need real-provider smoke coverage. <!-- id:mvErgtNS -->

# Goal <!-- id:j2KSWGuF -->

Seed Agents should keep its signed account-scoped API, SQLite durability, desktop session UI, and `read` Seed tool while delegating the model interaction loop, provider adapters, tool orchestration, retries, compaction hooks, and streaming model abstractions to Pi. <!-- id:GJdyOmUU -->

In short: <!-- id:mAxHkZpr -->
  - Seed owns account auth, persistence, desktop UX, provider/secret records, and Seed-specific tools. <!-- id:6QmisrjZ -->
  - Pi owns the agentic loop and model-provider execution. <!-- id:9TkGxm49 -->

# Current state <!-- id:xHntg4TU -->

The agent server now uses Pi for the primary runtime path. `MessageSession` dispatches to `#runPiAgent()` in `agents/src/api-service.ts`. <!-- id:JHmfBkF5 -->

The previous runtime was implemented manually: <!-- id:3RUK6A3n -->
  - `#messageSessionOnce()` appends the user message, sets session status to `streaming`, runs the model loop, appends the final assistant or error event, and updates status. <!-- id:m3aCqDUo -->
  - `#runOpenAI()` loads the provider config/secret and runs an OpenAI-only loop. <!-- id:BDUFO78L -->
  - `#openAIChatStream()` calls `fetch()` directly against `/chat/completions`, parses SSE by hand, emits live partials, accumulates tool calls, and returns the assistant response. <!-- id:zMbfauJ1 -->
  - `#runTool()` dispatches only `read`. <!-- id:N0_OJS_v -->

The desktop and WebSocket protocol already have stable runtime-facing concepts that should be preserved: <!-- id:-MZutoyw -->
  - durable session events: user/assistant messages, tool calls, tool results, errors; <!-- id:AwGZED8r -->
  - non-durable `appendPartial` text deltas; <!-- id:YprzYP6H -->
  - session status changes; <!-- id:Ii5Efpcs -->
  - signed `MessageSession` idempotency. <!-- id:lSg1pHmJ -->

# Pi research summary <!-- id:jQz1YuIk -->

Pi provides two relevant integration surfaces: <!-- id:71DX6Cba -->
  1. **SDK, preferred for this project** — import `@mariozechner/pi-coding-agent` in the Bun service and create an `AgentSession` directly. <!-- id:Kenr8dpl -->
  2. **RPC mode, fallback option** — spawn `pi --mode rpc --no-session` and translate JSONL commands/events. <!-- id:BE8RCB2x -->

The SDK is preferable because it avoids subprocess management and exposes typed session events. <!-- id:iqp-qiNG -->

Important Pi SDK APIs from local docs: <!-- id:lUJjUEc1 -->
  - `createAgentSession()` creates one `AgentSession`. <!-- id:iQUQ8noN -->
  - `AgentSession.prompt(text)` runs the agent until completion. <!-- id:Y1kPmIHC -->
  - `AgentSession.subscribe(listener)` streams events such as: <!-- id:xNP7UR25 -->
    - `message_update` with `assistantMessageEvent.type === 'text_delta'`; <!-- id:A4U1e1Sv -->
    - `tool_execution_start`; <!-- id:u1bNg90I -->
    - `tool_execution_update`; <!-- id:kMkuWmsF -->
    - `tool_execution_end`; <!-- id:LFjj0gfR -->
    - `message_end`; <!-- id:FcQcu99F -->
    - `agent_end`. <!-- id:F24GzRq4 -->
  - `SessionManager.inMemory()` avoids Pi session-file persistence. <!-- id:hkIEEKYT -->
  - `SettingsManager.inMemory()` can disable or tune Pi behavior such as compaction/retry. <!-- id:USvi67hh -->
  - `AuthStorage.setRuntimeApiKey(provider, key)` can inject credentials without writing them to disk. <!-- id:ZBBxSfDm -->
  - `ModelRegistry` and custom model config support OpenAI, Anthropic, Google, and other provider APIs. <!-- id:9Wrrssfw -->
  - A custom `ResourceLoader` can replace Pi's default discovery so Seed Agents does not accidentally load local/global AGENTS files, extensions, skills, prompts, or coding tools. <!-- id:VCcCxuip -->
  - `defineTool()` can expose `read` as a Pi custom tool. <!-- id:dDK2_Zad -->

Relevant Pi docs read during research: <!-- id:Ndy8udTk -->
  - Pi SDK: `/Users/ericvicenti/.local/share/mise/installs/node/22.2.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md` <!-- id:TO2Kd19j -->
  - Pi sessions: `/Users/ericvicenti/.local/share/mise/installs/node/22.2.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/session.md` <!-- id:1HFZXYFA -->
  - Pi RPC: `/Users/ericvicenti/.local/share/mise/installs/node/22.2.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md` <!-- id:S51rBq2h -->
  - Pi models: `/Users/ericvicenti/.local/share/mise/installs/node/22.2.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/models.md` <!-- id:2Eg6CqB1 -->
  - Pi custom providers: `/Users/ericvicenti/.local/share/mise/installs/node/22.2.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/custom-provider.md` <!-- id:3beKzr6a -->
  - SDK examples: `/Users/ericvicenti/.local/share/mise/installs/node/22.2.0/lib/node_modules/@mariozechner/pi-coding-agent/examples/sdk/` <!-- id:TpAzGntB -->

# Target architecture <!-- id:fw_bAcAg -->

```text <!-- id:zf3fxzFo -->
Signed Seed MessageSession action
  -> Service.#messageSessionOnce()
    -> append durable Seed user message
    -> set Seed session status streaming
    -> Pi runner adapter
      -> create configured Pi AgentSession
      -> seed Pi context from durable Seed session events
      -> expose read as a Pi tool
      -> subscribe to Pi events
      -> call session.prompt(user text or latest turn)
      -> translate Pi stream/tool/final/error events to Seed events
    -> set Seed session status idle/error
```

The Pi runner should be an adapter behind the existing Seed lifecycle. It should not force desktop protocol changes for the first migration. <!-- id:t9qz_jH7 -->

# Recommended migration shape <!-- id:WFOioLZg -->

## Phase 0: dependency and runtime spike — implemented <!-- id:cV1d9O9G -->

Purpose: prove the SDK runs in the `agents/` Bun service without changing production behavior. <!-- id:nsw6ClGV -->

Work: <!-- id:xk1a10WW -->
  - add `@mariozechner/pi-coding-agent` as an `agents/package.json` dependency; <!-- id:RYqjb6_l -->
  - verify transitive dependencies resolve under Bun; <!-- id:vdxX4tND -->
  - create a tiny test-only or scratch runner that uses: <!-- id:_8xJCJC2 -->
    - `SessionManager.inMemory()`; <!-- id:d4ouu1G9 -->
    - `SettingsManager.inMemory()`; <!-- id:Nj-cQHtz -->
    - a no-discovery `ResourceLoader`; <!-- id:UjURkpYa -->
    - no built-in coding tools; <!-- id:oggZCpTi -->
    - one custom toy tool. <!-- id:S61AMCYa -->

Done when: <!-- id:mflS2kgP -->
  - `cd agents && bun check && bun test` can import the SDK; <!-- id:JIjBNgFZ -->
  - no Pi auth files or session files are written during tests. <!-- id:NapRJwM_ -->

## Phase 1: internal Pi runner behind existing protocol — first implementation complete <!-- id:aejZOpQm -->

Purpose: replace the manual OpenAI loop while preserving Seed API and UI behavior. <!-- id:dCWIGFZz -->

Work: <!-- id:7jumcPvu -->
  - introduce a private `#runPiAgent()` or small service-local runner; <!-- id:6XT-sRsd -->
  - keep `#messageSessionOnce()` as the outer lifecycle owner; <!-- id:xgXno2co -->
  - map Seed `ModelProviderConfig` to Pi model/provider configuration; <!-- id:9mwmkS2C -->
  - decrypt Seed secrets and inject them as runtime-only Pi credentials; <!-- id:Twm5jQ-X -->
  - create a custom `ResourceLoader` whose system prompt is `definition.systemPrompt`; <!-- id:vFVUHbMC -->
  - disable Pi resource discovery unless explicitly re-enabled later; <!-- id:pfMzEI8Y -->
  - expose only Seed-approved tools, initially `read`; <!-- id:kREa6GWB -->
  - translate Pi events: <!-- id:ge1A-7Yh -->
    - text deltas -> `ServiceEvent.session-partial`; <!-- id:LeU2Gjtk -->
    - tool start/end -> durable `tool_call` / `tool_result`; <!-- id:C0wUuo94 -->
    - final assistant message -> durable Seed assistant message; <!-- id:CX-ICqdT -->
    - errors -> throw so `#messageSessionOnce()` appends a durable error. <!-- id:z9MTrErl -->

Done when: <!-- id:rjk3TrQJ -->
  - OpenAI-compatible providers still work from desktop; <!-- id:AXvLJ6zO -->
  - existing streaming partial behavior remains unchanged; <!-- id:zK9KQb90 -->
  - `read` tool calls remain visible and durable; <!-- id:zRxwzbVh -->
  - existing sessions can continue without a DB migration. <!-- id:2P2CMUJp -->

## Phase 2: provider expansion through Pi — mapped, smoke testing needed <!-- id:50IfgGC2 -->

Purpose: use Pi's provider abstractions instead of implementing Anthropic and Google manually. <!-- id:xcy1fJ98 -->

Work: <!-- id:Wi1fK0ZR -->
  - map Seed provider type `anthropic` to Pi API `anthropic-messages`; <!-- id:Mzwg19by -->
  - map Seed provider type `google` to Pi API `google-generative-ai`; <!-- id:DvCAS2XZ -->
  - map Seed provider type `openai` to Pi API `openai-completions` or `openai-responses`; <!-- id:FbElfrLU -->
  - review the current `modelDefaults` payload-merge behavior across provider APIs; <!-- id:uaq9EqDl -->
  - add provider capability metadata/warnings in docs and, later, UI. <!-- id:TaliKIKJ -->

Done when: <!-- id:xJuyBw1d -->
  - Anthropic and Google sessions can run end-to-end; <!-- id:WxD8lPJk -->
  - unsupported provider errors become rare and intentional; <!-- id:hw1A1GzJ -->
  - docs no longer describe Anthropic/Google as configuration-only. <!-- id:eIADWHBH -->

## Phase 3: adopt Pi-native runtime features selectively <!-- id:EGvgNo4b -->

Purpose: benefit from Pi features without breaking Seed's product boundaries. <!-- id:VUwZVUMO -->

Candidates: <!-- id:TmxEIIjz -->
  - cancellation via `AgentSession.abort()` after Seed adds a signed stop/cancel action; <!-- id:WeQqlMSa -->
  - retry configuration through `SettingsManager`; <!-- id:srAKNNed -->
  - context compaction once Seed has run records or a clear persistence story; <!-- id:EOQXX9fN -->
  - Pi session files only if they can be stored under each Seed agent/session state directory without leaking account data; <!-- id:TQiLNAPq -->
  - Pi extensions/skills only if Seed adds explicit policy and UI controls. <!-- id:fOVNpeCO -->

# Provider config mapping proposal <!-- id:vsMhTF3e -->

Seed provider records currently store: <!-- id:7eBcDanJ -->

```ts <!-- id:zwJryPHC -->
type ModelProviderConfig = {
  type: string
  modelDefaults?: Record<string, unknown>
  secretRefs?: Record<string, string>
  baseUrl?: string
}
```

Initial mapping: <!-- id:nKfr7f-G -->

<!-- id:eIwqjGok -->
| Seed `type` <!-- col:8iO8scCj --> | Pi API <!-- col:1AKTVU9S --> | Notes <!-- col:ueE2xnTx --> <!-- id:W2daO55b --> |
| --- | --- | --- |
| `openai` | `openai-completions` | Closest equivalent to the current `/chat/completions` behavior. Consider `openai-responses` later. <!-- id:iawO9HF- --> |
| `anthropic` | `anthropic-messages` | Should unlock Anthropic execution without a custom Seed Anthropic runner. <!-- id:1x130R0v --> |
| `google` | `google-generative-ai` | Should unlock Gemini execution through Pi. <!-- id:CXnXaqLH --> |

Open questions: <!-- id:QSlFFhgc -->
  - Should Seed expose Pi API type directly for advanced/custom providers, or keep Seed's simpler `type` field? <!-- id:nK71HuYr -->
  - Should `baseUrl` trust policy remain Seed-owned, Pi-owned, or both? <!-- id:GGlODRFY -->
  - Should `modelDefaults` remain an advanced raw payload override, or should Seed replace it with explicit capability/settings fields? <!-- id:llJuoSM4 -->
  - How should Pi custom provider metadata be represented in Seed's signed API? <!-- id:loJv8cSw -->

# Tool mapping proposal <!-- id:riKRKmkz -->

`read` should stay Seed-owned and be registered as a Pi custom tool. <!-- id:tuMzEPkY -->

Current OpenAI tool schema should be converted to a Pi `defineTool()` definition with equivalent parameters: <!-- id:DwDe4nKE -->
  - `id: string` required; <!-- id:HtOn1QG_ -->
  - `server?: string`; <!-- id:78RDVolY -->
  - `dev?: boolean`; <!-- id:zya-hh8F -->
  - `format?: 'markdown' | 'json'`. <!-- id:cKCdBmhi -->

The tool implementation should reuse the existing `readHypermedia()` function and continue enforcing `MAX_TOOL_RESULT_BYTES`. <!-- id:JsASfHa_ -->

Do **not** enable Pi's default coding tools for Seed Agents unless a separate permissions project explicitly adds them. The current Seed product only expects `read` to be available. <!-- id:YMrvlgYD -->

# Event translation details <!-- id:jhX1RRnm -->

The first implementation should keep the existing Seed event surface: <!-- id:ibeovOp9 -->

<!-- id:y7W4E8ql -->
| Pi event <!-- col:kMYb2f9V --> | Seed translation <!-- col:IP1v8WLa --> <!-- id:HmAq3_Xo --> |
| --- | --- |
| `message_update` / `text_delta` | emit `session-partial` with `textDelta` <!-- id:sOeF7-YN --> |
| assistant `message_end` | append durable assistant `message` for that assistant turn <!-- id:fhzl-ibR --> |
| `tool_execution_start` | append durable `tool_call` once name and args are known <!-- id:HWiTsgUp --> |
| `tool_execution_end` success | append durable `tool_result` with `output` <!-- id:P2sL-mOq --> |
| `tool_execution_end` error | append durable `tool_result` with `error` <!-- id:L6kXzLf9 --> |
| `agent_end` | detect final run error/abort; do not duplicate message text <!-- id:op89_BAW --> |
| model/provider error | throw `APIError` or regular error for outer failure handling <!-- id:SrMip3fE --> |

Assistant text is persisted at each Pi assistant `message_end`, not only after the whole run finishes. This keeps text that precedes a tool call ahead of the corresponding durable `tool_call` event, and text produced after a tool result is persisted before any later tool call. The live partial uses a fresh `partialId` for each assistant turn; the durable assistant append clears the visible partial for that turn. When reconstructing history for later turns, consecutive durable assistant text/tool-call events are coalesced back into a single Pi assistant message until the first `tool_result`, preserving multi-tool assistant turns for OpenAI-style replay. <!-- id:uDFL8d1a -->

Questions to verify in Pi SDK types/source before coding: <!-- id:ra4c_j6_ -->
  - whether `tool_execution_start` always includes parsed args; <!-- id:GluD2J2Q -->
  - whether a tool call can stream args before parsed args are complete; <!-- id:YcoE5zvX -->
  - whether `tool_execution_end.result.content` should be stored as raw Pi content, text, or structured `details`; <!-- id:sSzbpgSp -->
  - which final event is the safest source of complete assistant text; <!-- id:299E6CYC -->
  - how aborted runs are reported. <!-- id:ZAT6Ls0a -->

# Historical context strategy <!-- id:IS3cgMDf -->

The migration must avoid losing conversation context or duplicating the newest user message. <!-- id:V5JOGSbq -->

Options: <!-- id:8av8Gv0S -->
  1. **Seed Pi state directly from durable Seed events.** Build Pi `AgentMessage` history from `session_events` and then ask Pi to continue from the latest user message. <!-- id:N0JAH_8d -->
  2. **Let Pi own per-session history going forward.** Store Pi session state under Seed session state directories and only mirror important events to Seed SQLite. <!-- id:c8r7hPe_ -->
  3. **Hybrid cutover.** Convert old Seed events into Pi history once, then persist Pi history for future turns. <!-- id:433228h5 -->

Recommended first step: option 1, because it keeps Seed SQLite as the source of truth and avoids a migration. <!-- id:cQknHyjv -->

Caveat: the old manual OpenAI loop did not fully reconstruct historical tool results. The Pi path now reconstructs paired tool-call/tool-result history from durable Seed events, and regression coverage includes a follow-up turn after a `read` tool call. <!-- id:o5Vf0yjV -->

# Security and product boundaries <!-- id:49jUyAiL -->

The migration should preserve current security properties: <!-- id:cA4mC-2b -->
  - Seed secrets remain encrypted in SQLite and are decrypted only in memory. <!-- id:hAiGK_L4 -->
  - Pi auth/session files should not persist Seed API keys by default. <!-- id:CPEulSwk -->
  - Provider responses and signed request bodies must not be logged. <!-- id:iNje2Wcg -->
  - Seed account authorization remains outside Pi. <!-- id:peqwu9dX -->
  - Pi default resource discovery should be disabled initially to avoid hidden AGENTS.md, skill, extension, or prompt influence. <!-- id:GQFf-uvy -->
  - Pi coding tools should be disabled initially to avoid granting filesystem or shell access. <!-- id:KKlMS_CX -->
  - Outbound URL policy for `read` remains an unresolved future hardening item. <!-- id:3QuKgafl -->

# Test plan <!-- id:jJ-j6c4J -->

Replace brittle wire-format tests with behavior tests where possible. <!-- id:nZY_YEB9 -->

Core service tests: <!-- id:kPCK-MRf -->
  - user message persists before model execution; <!-- id:jyH8ymWM -->
  - text deltas emit `session-partial` events; <!-- id:vp3T8ApS -->
  - final assistant message persists as a durable event; <!-- id:BIgLXGDw -->
  - session status returns to `idle` on success; <!-- id:ITD_qH47 -->
  - model/provider failure appends durable error and sets status `error`; <!-- id:sG6LhMfp -->
  - `read` tool call and result are durable; <!-- id:WGsyfDz_ -->
  - no provider secret appears in API responses or logs; <!-- id:sY7hwl52 -->
  - unsupported/misconfigured provider gives a clear persisted error. <!-- id:KdY_vU7v -->

Provider tests: <!-- id:1Y3HcCdp -->
  - OpenAI-compatible provider works through Pi; <!-- id:_sLH3Yqz -->
  - Anthropic provider mapping works through Pi; <!-- id:UBmXn1MV -->
  - Google provider mapping works through Pi; <!-- id:bhhEnJkX -->
  - custom `baseUrl` policy is enforced. <!-- id:ZT36Bmho -->

Regression commands: <!-- id:y2f_XoDq -->

```bash <!-- id:rKjVRAEm -->
direnv exec . bash -lc 'cd agents && bun check'
direnv exec . bash -lc 'cd agents && bun test'
```

Manual smoke after implementation: <!-- id:HfI6Q16P -->
  1. Start the agents server. <!-- id:aSlcPZ_z -->
  2. Start desktop. <!-- id:1GF67Pkd -->
  3. Configure OpenAI provider. <!-- id:N3nfqlKR -->
  4. Create an agent and session. <!-- id:cm3ZC5AG -->
  5. Send a message and confirm streaming markdown. <!-- id:AEL3i2cy -->
  6. Ask for a `read` tool read and confirm tool call/result events. <!-- id:p6_qfVMV -->
  7. Repeat for Anthropic and Google to validate the current Pi mappings. <!-- id:VhpJcUzZ -->

# Risks <!-- id:g5yoVHcG -->

- **Bun compatibility:** Pi is a Node package and may rely on Node behaviors that need verification in Bun. <!-- id:FfMXjkxW -->
- **Secret persistence:** Pi's default auth storage writes `auth.json`; Seed must avoid persisting decrypted account secrets outside SQLite. <!-- id:rAnYtW3h -->
- **Tool expansion:** Pi's defaults include coding tools. Accidentally enabling them would be a major product/security behavior change. <!-- id:p5pwwgeW -->
- **Resource discovery leakage:** default Pi discovery can load local/global instructions, skills, prompts, and extensions. Use full-control/no-discovery setup first. <!-- id:zgUJyQ5G -->
- **Event mismatch:** Pi tool and message events may not map one-to-one onto Seed durable event shapes. <!-- id:lY3tZa_t -->
- **Duplicate persistence:** Pi sessions plus Seed SQLite can diverge unless one source of truth is chosen. <!-- id:vigkEMxH -->
- **Provider setting mismatch:** Seed `modelDefaults` are merged into Pi payloads, but this is an advanced override and may not have identical semantics across provider APIs. <!-- id:pYm-IYRV -->
- **Desktop assumptions:** the UI currently expects a single streaming text partial. Pi thinking blocks or multi-part content should be hidden or deliberately modeled before exposing them. <!-- id:oX29Qwk9 -->

# Deferred decisions <!-- id:HCCgr0kf -->

- Whether Seed should expose Pi's model/provider API type directly. <!-- id:q4pSynTn -->
- Whether to persist Pi session JSONL files for debugging/replay. <!-- id:GHs1VFUW -->
- Whether to expose Pi thinking content in the desktop UI. <!-- id:EmYhKI_j -->
- Whether to support Pi extensions/skills as configurable Seed agent capabilities. <!-- id:3rBX-iKe -->
- Whether to replace Seed's session event model with a richer Pi-compatible run/message model. <!-- id:xQTFTdTc -->
- Whether to use Pi RPC mode for process isolation if SDK-in-Bun has issues. <!-- id:h5UWbZa8 -->

# Definition of done for this project <!-- id:slvQkSkA -->

Completed so far: <!-- id:qJOxfB4L -->
  - The manual `fetch()` / SSE / tool-loop implementation is no longer the primary runtime path. <!-- id:hUQOZDVo -->
  - Seed Agents use Pi SDK for model execution and tool orchestration. <!-- id:t0XI7K6l -->
  - The signed HTTP API and desktop WebSocket protocol remain stable. <!-- id:xidMGhLg -->
  - OpenAI-compatible execution has mocked streaming/tool/error test coverage. <!-- id:bkKZCDe0 -->
  - `read` remains available and durable as before. <!-- id:UDHfkqvr -->
  - Secrets remain encrypted at rest and are injected into Pi through in-memory/runtime-only auth. <!-- id:1E_FSSRw -->

Remaining before the project is fully done: <!-- id:cUTVKPvc -->
  - Real-provider smoke coverage for OpenAI, Anthropic, and Google. <!-- id:ceC5RDFb -->
  - Review whether `provider.modelDefaults` should remain an advanced payload override or become typed settings. <!-- id:dyXptHIk -->
  - Add focused multi-turn tool-history coverage. <!-- id:219Ll8pU -->
  - Keep `cd agents && bun check && bun test` passing. <!-- id:lY_VqoEr -->
  - Keep Agents docs aligned with runtime behavior. <!-- id:HZ0qzau6 -->
