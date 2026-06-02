# Pi SDK migration project

This project tracks replacing the custom model-provider loop in Seed Agents with the Pi SDK agentic loop from
`@mariozechner/pi-coding-agent`.

Status: the first implementation is in place. Seed now uses a Pi SDK-backed runner for `MessageSession`, with
OpenAI-compatible behavior covered by mocked streaming tests. Anthropic and Google are mapped through Pi but still need
real-provider smoke coverage.

## Goal

Seed Agents should keep its signed account-scoped API, SQLite durability, desktop session UI, and `read` Seed tool while
delegating the model interaction loop, provider adapters, tool orchestration, retries, compaction hooks, and streaming
model abstractions to Pi.

In short:

- Seed owns account auth, persistence, desktop UX, provider/secret records, and Seed-specific tools.
- Pi owns the agentic loop and model-provider execution.

## Current state

The agent server now uses Pi for the primary runtime path. `MessageSession` dispatches to `#runPiAgent()` in
`agents/src/api-service.ts`.

The previous runtime was implemented manually:

- `#messageSessionOnce()` appends the user message, sets session status to `streaming`, runs the model loop, appends the
  final assistant or error event, and updates status.
- `#runOpenAI()` loads the provider config/secret and runs an OpenAI-only loop.
- `#openAIChatStream()` calls `fetch()` directly against `/chat/completions`, parses SSE by hand, emits live partials,
  accumulates tool calls, and returns the assistant response.
- `#runTool()` dispatches only `read`.

The desktop and WebSocket protocol already have stable runtime-facing concepts that should be preserved:

- durable session events: user/assistant messages, tool calls, tool results, errors;
- non-durable `appendPartial` text deltas;
- session status changes;
- signed `MessageSession` idempotency.

## Pi research summary

Pi provides two relevant integration surfaces:

1. **SDK, preferred for this project** — import `@mariozechner/pi-coding-agent` in the Bun service and create an
   `AgentSession` directly.
2. **RPC mode, fallback option** — spawn `pi --mode rpc --no-session` and translate JSONL commands/events.

The SDK is preferable because it avoids subprocess management and exposes typed session events.

Important Pi SDK APIs from local docs:

- `createAgentSession()` creates one `AgentSession`.
- `AgentSession.prompt(text)` runs the agent until completion.
- `AgentSession.subscribe(listener)` streams events such as:
  - `message_update` with `assistantMessageEvent.type === 'text_delta'`;
  - `tool_execution_start`;
  - `tool_execution_update`;
  - `tool_execution_end`;
  - `message_end`;
  - `agent_end`.
- `SessionManager.inMemory()` avoids Pi session-file persistence.
- `SettingsManager.inMemory()` can disable or tune Pi behavior such as compaction/retry.
- `AuthStorage.setRuntimeApiKey(provider, key)` can inject credentials without writing them to disk.
- `ModelRegistry` and custom model config support OpenAI, Anthropic, Google, and other provider APIs.
- A custom `ResourceLoader` can replace Pi's default discovery so Seed Agents does not accidentally load local/global
  AGENTS files, extensions, skills, prompts, or coding tools.
- `defineTool()` can expose `read` as a Pi custom tool.

Relevant Pi docs read during research:

- Pi SDK:
  `/Users/ericvicenti/.local/share/mise/installs/node/22.2.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md`
- Pi sessions:
  `/Users/ericvicenti/.local/share/mise/installs/node/22.2.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/session.md`
- Pi RPC:
  `/Users/ericvicenti/.local/share/mise/installs/node/22.2.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md`
- Pi models:
  `/Users/ericvicenti/.local/share/mise/installs/node/22.2.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/models.md`
- Pi custom providers:
  `/Users/ericvicenti/.local/share/mise/installs/node/22.2.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/custom-provider.md`
- SDK examples:
  `/Users/ericvicenti/.local/share/mise/installs/node/22.2.0/lib/node_modules/@mariozechner/pi-coding-agent/examples/sdk/`

## Target architecture

```text
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

The Pi runner should be an adapter behind the existing Seed lifecycle. It should not force desktop protocol changes for
the first migration.

## Recommended migration shape

### Phase 0: dependency and runtime spike — implemented

Purpose: prove the SDK runs in the `agents/` Bun service without changing production behavior.

Work:

- add `@mariozechner/pi-coding-agent` as an `agents/package.json` dependency;
- verify transitive dependencies resolve under Bun;
- create a tiny test-only or scratch runner that uses:
  - `SessionManager.inMemory()`;
  - `SettingsManager.inMemory()`;
  - a no-discovery `ResourceLoader`;
  - no built-in coding tools;
  - one custom toy tool.

Done when:

- `cd agents && bun check && bun test` can import the SDK;
- no Pi auth files or session files are written during tests.

### Phase 1: internal Pi runner behind existing protocol — first implementation complete

Purpose: replace the manual OpenAI loop while preserving Seed API and UI behavior.

Work:

- introduce a private `#runPiAgent()` or small service-local runner;
- keep `#messageSessionOnce()` as the outer lifecycle owner;
- map Seed `ModelProviderConfig` to Pi model/provider configuration;
- decrypt Seed secrets and inject them as runtime-only Pi credentials;
- create a custom `ResourceLoader` whose system prompt is `definition.systemPrompt`;
- disable Pi resource discovery unless explicitly re-enabled later;
- expose only Seed-approved tools, initially `read`;
- translate Pi events:
  - text deltas -> `ServiceEvent.session-partial`;
  - tool start/end -> durable `tool_call` / `tool_result`;
  - final assistant message -> durable Seed assistant message;
  - errors -> throw so `#messageSessionOnce()` appends a durable error.

Done when:

- OpenAI-compatible providers still work from desktop;
- existing streaming partial behavior remains unchanged;
- `read` tool calls remain visible and durable;
- existing sessions can continue without a DB migration.

### Phase 2: provider expansion through Pi — mapped, smoke testing needed

Purpose: use Pi's provider abstractions instead of implementing Anthropic and Google manually.

Work:

- map Seed provider type `anthropic` to Pi API `anthropic-messages`;
- map Seed provider type `google` to Pi API `google-generative-ai`;
- map Seed provider type `openai` to Pi API `openai-completions` or `openai-responses`;
- review the current `modelDefaults` payload-merge behavior across provider APIs;
- add provider capability metadata/warnings in docs and, later, UI.

Done when:

- Anthropic and Google sessions can run end-to-end;
- unsupported provider errors become rare and intentional;
- docs no longer describe Anthropic/Google as configuration-only.

### Phase 3: adopt Pi-native runtime features selectively

Purpose: benefit from Pi features without breaking Seed's product boundaries.

Candidates:

- cancellation via `AgentSession.abort()` after Seed adds a signed stop/cancel action;
- retry configuration through `SettingsManager`;
- context compaction once Seed has run records or a clear persistence story;
- Pi session files only if they can be stored under each Seed agent/session state directory without leaking account
  data;
- Pi extensions/skills only if Seed adds explicit policy and UI controls.

## Provider config mapping proposal

Seed provider records currently store:

```ts
type ModelProviderConfig = {
  type: string
  modelDefaults?: Record<string, unknown>
  secretRefs?: Record<string, string>
  baseUrl?: string
}
```

Initial mapping:

| Seed `type` | Pi API                 | Notes                                                                                              |
| ----------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `openai`    | `openai-completions`   | Closest equivalent to the current `/chat/completions` behavior. Consider `openai-responses` later. |
| `anthropic` | `anthropic-messages`   | Should unlock Anthropic execution without a custom Seed Anthropic runner.                          |
| `google`    | `google-generative-ai` | Should unlock Gemini execution through Pi.                                                         |

Open questions:

- Should Seed expose Pi API type directly for advanced/custom providers, or keep Seed's simpler `type` field?
- Should `baseUrl` trust policy remain Seed-owned, Pi-owned, or both?
- Should `modelDefaults` remain an advanced raw payload override, or should Seed replace it with explicit
  capability/settings fields?
- How should Pi custom provider metadata be represented in Seed's signed API?

## Tool mapping proposal

`read` should stay Seed-owned and be registered as a Pi custom tool.

Current OpenAI tool schema should be converted to a Pi `defineTool()` definition with equivalent parameters:

- `id: string` required;
- `server?: string`;
- `dev?: boolean`;
- `format?: 'markdown' | 'json'`.

The tool implementation should reuse the existing `readHypermedia()` function and continue enforcing
`MAX_TOOL_RESULT_BYTES`.

Do **not** enable Pi's default coding tools for Seed Agents unless a separate permissions project explicitly adds them.
The current Seed product only expects `read` to be available.

## Event translation details

The first implementation should keep the existing Seed event surface:

| Pi event                        | Seed translation                                             |
| ------------------------------- | ------------------------------------------------------------ |
| `message_update` / `text_delta` | emit `session-partial` with `textDelta`                      |
| assistant `message_end`         | append durable assistant `message` for that assistant turn   |
| `tool_execution_start`          | append durable `tool_call` once name and args are known      |
| `tool_execution_end` success    | append durable `tool_result` with `output`                   |
| `tool_execution_end` error      | append durable `tool_result` with `error`                    |
| `agent_end`                     | detect final run error/abort; do not duplicate message text  |
| model/provider error            | throw `APIError` or regular error for outer failure handling |

Assistant text is persisted at each Pi assistant `message_end`, not only after the whole run finishes. This keeps text
that precedes a tool call ahead of the corresponding durable `tool_call` event, and text produced after a tool result is
persisted before any later tool call. The live partial uses a fresh `partialId` for each assistant turn; the durable
assistant append clears the visible partial for that turn. When reconstructing history for later turns, consecutive
durable assistant text/tool-call events are coalesced back into a single Pi assistant message until the first
`tool_result`, preserving multi-tool assistant turns for OpenAI-style replay.

Questions to verify in Pi SDK types/source before coding:

- whether `tool_execution_start` always includes parsed args;
- whether a tool call can stream args before parsed args are complete;
- whether `tool_execution_end.result.content` should be stored as raw Pi content, text, or structured `details`;
- which final event is the safest source of complete assistant text;
- how aborted runs are reported.

## Historical context strategy

The migration must avoid losing conversation context or duplicating the newest user message.

Options:

1. **Seed Pi state directly from durable Seed events.** Build Pi `AgentMessage` history from `session_events` and then
   ask Pi to continue from the latest user message.
2. **Let Pi own per-session history going forward.** Store Pi session state under Seed session state directories and
   only mirror important events to Seed SQLite.
3. **Hybrid cutover.** Convert old Seed events into Pi history once, then persist Pi history for future turns.

Recommended first step: option 1, because it keeps Seed SQLite as the source of truth and avoids a migration.

Caveat: the old manual OpenAI loop did not fully reconstruct historical tool results. The Pi path now reconstructs
paired tool-call/tool-result history from durable Seed events, and regression coverage includes a follow-up turn after a
`read` tool call.

## Security and product boundaries

The migration should preserve current security properties:

- Seed secrets remain encrypted in SQLite and are decrypted only in memory.
- Pi auth/session files should not persist Seed API keys by default.
- Provider responses and signed request bodies must not be logged.
- Seed account authorization remains outside Pi.
- Pi default resource discovery should be disabled initially to avoid hidden AGENTS.md, skill, extension, or prompt
  influence.
- Pi coding tools should be disabled initially to avoid granting filesystem or shell access.
- Outbound URL policy for `read` remains an unresolved future hardening item.

## Test plan

Replace brittle wire-format tests with behavior tests where possible.

Core service tests:

- user message persists before model execution;
- text deltas emit `session-partial` events;
- final assistant message persists as a durable event;
- session status returns to `idle` on success;
- model/provider failure appends durable error and sets status `error`;
- `read` tool call and result are durable;
- no provider secret appears in API responses or logs;
- unsupported/misconfigured provider gives a clear persisted error.

Provider tests:

- OpenAI-compatible provider works through Pi;
- Anthropic provider mapping works through Pi;
- Google provider mapping works through Pi;
- custom `baseUrl` policy is enforced.

Regression commands:

```bash
direnv exec . bash -lc 'cd agents && bun check'
direnv exec . bash -lc 'cd agents && bun test'
```

Manual smoke after implementation:

1. Start the agents server.
2. Start desktop.
3. Configure OpenAI provider.
4. Create an agent and session.
5. Send a message and confirm streaming markdown.
6. Ask for a `read` tool read and confirm tool call/result events.
7. Repeat for Anthropic and Google to validate the current Pi mappings.

## Risks

- **Bun compatibility:** Pi is a Node package and may rely on Node behaviors that need verification in Bun.
- **Secret persistence:** Pi's default auth storage writes `auth.json`; Seed must avoid persisting decrypted account
  secrets outside SQLite.
- **Tool expansion:** Pi's defaults include coding tools. Accidentally enabling them would be a major product/security
  behavior change.
- **Resource discovery leakage:** default Pi discovery can load local/global instructions, skills, prompts, and
  extensions. Use full-control/no-discovery setup first.
- **Event mismatch:** Pi tool and message events may not map one-to-one onto Seed durable event shapes.
- **Duplicate persistence:** Pi sessions plus Seed SQLite can diverge unless one source of truth is chosen.
- **Provider setting mismatch:** Seed `modelDefaults` are merged into Pi payloads, but this is an advanced override and
  may not have identical semantics across provider APIs.
- **Desktop assumptions:** the UI currently expects a single streaming text partial. Pi thinking blocks or multi-part
  content should be hidden or deliberately modeled before exposing them.

## Deferred decisions

- Whether Seed should expose Pi's model/provider API type directly.
- Whether to persist Pi session JSONL files for debugging/replay.
- Whether to expose Pi thinking content in the desktop UI.
- Whether to support Pi extensions/skills as configurable Seed agent capabilities.
- Whether to replace Seed's session event model with a richer Pi-compatible run/message model.
- Whether to use Pi RPC mode for process isolation if SDK-in-Bun has issues.

## Definition of done for this project

Completed so far:

- The manual `fetch()` / SSE / tool-loop implementation is no longer the primary runtime path.
- Seed Agents use Pi SDK for model execution and tool orchestration.
- The signed HTTP API and desktop WebSocket protocol remain stable.
- OpenAI-compatible execution has mocked streaming/tool/error test coverage.
- `read` remains available and durable as before.
- Secrets remain encrypted at rest and are injected into Pi through in-memory/runtime-only auth.

Remaining before the project is fully done:

- Real-provider smoke coverage for OpenAI, Anthropic, and Google.
- Review whether `provider.modelDefaults` should remain an advanced payload override or become typed settings.
- Add focused multi-turn tool-history coverage.
- Keep `cd agents && bun check && bun test` passing.
- Keep Agents docs aligned with runtime behavior.
