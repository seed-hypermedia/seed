# Model providers

Model providers are account-scoped records that tell the agent server how to call an LLM backend. Provider secrets are
stored separately and encrypted.

## Provider record

Stored in `model_providers.config_cbor`:

```ts
type ModelProviderConfig = {
  type: string
  modelDefaults?: Record<string, unknown>
  secretRefs?: Record<string, string>
  baseUrl?: string
}
```

Typical OpenAI provider:

```ts
{
  type: 'openai',
  secretRefs: {apiKey: 'openai-api-key'},
  modelDefaults: {temperature: 0.2}
}
```

## API actions

- `ListModelProviders` — returns redacted provider metadata.
- `ListProviderModels` — decrypts the provider API key server-side and queries the provider's model-list endpoint.
- `SetModelProvider` — upserts provider config.
- `SetSecret` — encrypts/upserts secret value.

Returned provider shape:

```ts
type RedactedModelProvider = {
  id: string
  name: string
  type: string
  hasSecrets: boolean
  createdAt: number
  updatedAt: number
}
```

No provider API returns plaintext secrets. `ListProviderModels` returns only `{id, name}` model metadata. It calls:

- OpenAI: `GET /models` with `Authorization: Bearer ...`;
- Anthropic: `GET /v1/models` with `x-api-key` and `anthropic-version`;
- Google: `GET /models?key=...` and filters for `generateContent` models.

## Desktop provider UI

The desktop **Model providers** dialog can save records for:

- OpenAI (`openai`)
- Anthropic (`anthropic`)
- Google (`google`)

Save flow:

1. validate selected account/server;
2. reject API-key submission to non-local plain HTTP server;
3. send signed `SetSecret` with key bytes;
4. send signed `SetModelProvider` referencing the secret name;
5. invalidate provider/agent queries.

## Execution support status

Model execution now goes through the Pi SDK (`@mariozechner/pi-coding-agent`) in `#runPiAgent()` in
`agents/src/api-service.ts`. Seed still owns signed actions, SQLite session durability, encrypted provider secrets, live
WebSocket events, and the `read` tool. Pi owns the model-provider request/streaming loop and tool orchestration.

### OpenAI-compatible providers — completed through Pi

Seed maps provider type `openai` to Pi API `openai-completions`.

Capabilities:

- Pi OpenAI-compatible chat-completions streaming;
- text-delta WebSocket partials translated from Pi `message_update` events;
- durable assistant messages appended at each Pi assistant `message_end` so text before/after tool calls keeps event
  order;
- Pi tool-call orchestration;
- `read` registered as a Seed-owned Pi custom tool;
- trusted custom OpenAI `baseUrl` check retained by Seed.

Default endpoint:

```text
https://api.openai.com/v1
```

Pi calls the provider-specific chat-completions endpoint underneath this base URL. Custom OpenAI `baseUrl` is currently
accepted only when `isTrustedOpenAIBaseUrl()` allows it.

### Anthropic providers — mapped through Pi

Seed maps provider type `anthropic` to Pi API `anthropic-messages` and default base URL `https://api.anthropic.com`.

Desktop can save Anthropic provider records and API keys. Runtime execution is wired through Pi, but needs real-provider
manual smoke coverage before being called production-complete.

### Google providers — mapped through Pi

Seed maps provider type `google` to Pi API `google-generative-ai` and default base URL
`https://generativelanguage.googleapis.com/v1beta`.

Desktop can save Google provider records and API keys. Runtime execution is wired through Pi, but needs real-provider
manual smoke coverage before being called production-complete.

## Pi request behavior

The service creates a per-run in-memory Pi session with:

- `AuthStorage.inMemory()` plus runtime-only API-key injection from encrypted Seed secrets;
- `ModelRegistry.inMemory()` plus a per-run provider/model registration;
- `SessionManager.inMemory()` so Pi does not persist separate session JSONL files;
- `SettingsManager.inMemory()` with compaction disabled for the initial integration;
- a no-discovery `ResourceLoader` whose system prompt is the Seed agent definition prompt converted from stored blocks
  to markdown, plus dynamic runtime instructions;
- an explicit tool allowlist containing only `read`.

`provider.modelDefaults` is merged into Pi provider payloads immediately before request dispatch. Defaults override Pi's
generated payload fields if keys collide, so treat this as an advanced escape hatch and prefer explicit typed settings
for future product UI.

## Message context

Pi receives:

1. system prompt from the Seed agent definition, stored as blocks and converted to markdown immediately before the run;
2. durable Seed user/assistant session messages converted to Pi messages;
3. durable Seed `tool_call` events reconstructed as Pi assistant tool-call messages;
4. durable Seed `tool_result` events converted to Pi tool-result messages;
5. the current user message already appended by Seed before Pi continuation begins.

Historical durable tool events are reconstructed as paired assistant tool-call/tool-result messages so later turns
replay valid provider history instead of sending orphaned tool-result messages.

## Streaming diagnostics

The previous `[agents/openai] ...` diagnostics belonged to the manual OpenAI fetch loop. The Pi-backed path currently
relies on behavior tests and existing WebSocket/session event inspection. Add Seed-level Pi runtime diagnostics before
production deployment if real-provider troubleshooting needs more visibility.

## Adding or changing provider execution

Checklist:

1. Keep provider config generic unless schema must change.
2. Map Seed provider type to a Pi API/provider configuration.
3. Preserve session lifecycle and WebSocket partials.
4. Map Pi assistant/tool events into ordered internal `message`/`tool_call`/`tool_result` events.
5. Add mocked network tests for success, streaming, text-before-tool ordering, tools, missing key, and provider errors.
6. Confirm decrypted secrets stay in memory and are not written to Pi auth files.
7. Update `model-providers.md`, `signed-api.md`, `desktop-ui.md`, `pi-sdk-migration.md`, and `roadmap.md`.

## Highest-priority provider work

1. Real-provider smoke coverage for Anthropic and Google through Pi, including model-list behavior.
2. Provider test button.
3. Provider deletion/secret rotation UI.
4. Shared model/provider capability metadata.
