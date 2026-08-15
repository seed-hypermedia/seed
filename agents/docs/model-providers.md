# Model providers

Model providers are account-scoped records telling the agent server how to call an LLM backend. Provider credentials are
stored separately and encrypted; the record itself holds only a reference to them.

## Provider record

Stored in `model_providers.config_cbor` (`agents/protocol/src/index.ts:718`):

```ts
type ModelProviderConfig = {
  type: string
  modelDefaults?: Record<string, unknown>
  secretRefs?: Record<string, string>
  baseUrl?: string
  /** `api-key` (default) reads secretRefs.apiKey; `subscription` reads secretRefs.oauth. */
  authMode?: 'api-key' | 'subscription'
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

Subscription provider:

```ts
{
  type: 'openai',
  authMode: 'subscription',
  secretRefs: {oauth: 'openai-subscription-oauth'}
}
```

## API actions

- `ListModelProviders` — redacted provider metadata.
- `ListProviderModels` — decrypts the API key server-side and queries the provider's model-list endpoint.
- `SetModelProvider` — upserts provider config.
- `SetSecret` — encrypts/upserts a secret value.
- `StartProviderOAuth` / `SubmitProviderOAuthCode` / `GetProviderOAuthStatus` / `CancelProviderOAuth` — the subscription
  sign-in flow.

Returned provider shape (`protocol/src/index.ts:1078`):

```ts
type RedactedModelProvider = {
  id: string
  name: string
  type: string
  hasSecrets: boolean
  authMode?: 'api-key' | 'subscription'
  /** Subscription health: `ok`, or `needs-login` when credentials are missing or a refresh failed. */
  authStatus?: 'ok' | 'needs-login'
  createdAt: number
  updatedAt: number
}
```

No provider API returns plaintext secrets. `ListProviderModels` (`api-service.ts:989`, `fetchProviderModels` at `:6725`)
returns only `{id, name}`:

- **subscription providers short-circuit before any HTTP** and return the static catalog (`api-service.ts:1003`);
- **openai strategy** (`openai`, `openrouter`, `deepseek`, `groq`, `xai`, `ollama`, `custom`): `GET {base}/models`, with
  the `Authorization: Bearer` header added only when a key exists — which is what makes keyless Ollama/custom work.
  `name` is the id; there is no display name;
- **anthropic**: `GET {base}/v1/models` with `x-api-key` and `anthropic-version: 2023-06-01` (not Bearer); `name` is
  `display_name` when present;
- **google**: `GET {base}/models?key=…` with the key in the **query string**, dropping models whose
  `supportedGenerationMethods` exists and lacks `generateContent`, stripping the `models/` id prefix, and preferring
  `displayName`.

Errors: a missing key on a `requireApiKey` provider fails with 400 before any fetch, an unknown provider name is 404, a
non-OK upstream response is `502 "<label> request failed: HTTP <status>"`, and a malformed body is
`502 "<label> response is invalid"`. Note that `joinUrlPath()` (`api-service.ts:6788`) clears `search` and `hash`, so a
custom base URL carrying a query string loses it on the model-list request.

## Supported provider types

Provider behavior is driven by one code-owned registry, `PROVIDER_SPECS` (`agents/src/api-service.ts:6603`). Adding a
provider is usually one entry there plus a matching `PROVIDER_METADATA` entry in
`frontend/apps/desktop/src/pages/agents/provider-registry.ts`. Most providers are OpenAI-compatible and ride the same
`openai-completions` execution and `GET /models` list path, differing only by base URL.

| type         | Pi API               | default base URL                                   | base URL editable | API key  | model list |
| ------------ | -------------------- | -------------------------------------------------- | ----------------- | -------- | ---------- |
| `openai`     | openai-completions\* | `https://api.openai.com/v1`                        | no                | required | openai     |
| `anthropic`  | anthropic-messages   | `https://api.anthropic.com`                        | no                | required | anthropic  |
| `google`     | google-generative-ai | `https://generativelanguage.googleapis.com/v1beta` | no                | required | google     |
| `openrouter` | openai-completions   | `https://openrouter.ai/api/v1`                     | no                | required | openai     |
| `deepseek`   | openai-completions   | `https://api.deepseek.com`                         | no                | required | openai     |
| `groq`       | openai-completions   | `https://api.groq.com/openai/v1`                   | no                | required | openai     |
| `xai`        | openai-completions   | `https://api.x.ai/v1`                              | no                | required | openai     |
| `ollama`     | openai-completions   | `http://localhost:11434/v1`                        | **yes**           | optional | openai     |
| `custom`     | openai-completions   | (user-supplied, no default)                        | **yes**           | optional | openai     |

\* `openai` switches to `openai-responses` whenever the resolved model is reasoning-flagged — see below.

`custom` is the generic OpenAI-compatible type: the user supplies the base URL, so it covers self-hosted servers (LM
Studio, vLLM, llama.cpp, LocalAI) and any future OpenAI-compatible endpoint without a code change. It has no default
base URL, so one must be supplied.

`ollama` and `custom` are the only two types with `allowCustomBaseUrl: true` and `requireApiKey: false`; the other seven
are the inverse. `resolveProviderBaseUrl()` (`api-service.ts:6718`) honors a stored `baseUrl` only for the former; for
pinned providers the spec default always wins, which keeps a stored API key from being redirected to an arbitrary host.
Worth knowing when debugging: `SetModelProvider` still validates and stores a `baseUrl` on a pinned provider
(`api-service.ts:6533`) — it is simply ignored at execution time, so the record can disagree with reality. And because
`custom` has an empty default, it is the only type that can reach the "Base URL is required for provider type:
custom" 400. The trust rationale is in `security.md`.

## Subscription auth ("Sign in with ChatGPT")

An OpenAI provider can authenticate with the user's ChatGPT plan instead of an API key.

- **Gated by the operator.** The flow is offered only when the server sets `SEED_AGENTS_SUBSCRIPTION_AUTH`
  (`config.subscriptionAuth`, `agents/src/config.ts:20`), because it needs a client that can catch the provider's
  localhost redirect — the desktop app — or a user willing to paste the redirect URL. The desktop checks the server's
  health flag before offering the option.
- **The flow** lives in `agents/src/provider-oauth.ts`: PKCE against `https://auth.openai.com/oauth/authorize` and
  `/oauth/token`, client id `app_EMoamEEZ73f0CkXaXp7hrann`, redirect `http://localhost:1455/auth/callback`, scope
  `openid profile email offline_access`. One login per account runs at a time. `parseAuthorizationInput()` accepts
  either a bare code or the full pasted redirect URL. Credentials land in a stable per-account secret named
  `<type>-subscription-oauth`, so re-login overwrites in place.
- **Execution** re-points the provider entirely (`api-service.ts:4246`): the Pi provider id becomes `openai-codex`
  (`SUBSCRIPTION_PI_PROVIDER_ID`), the base URL becomes `https://chatgpt.com/backend-api`
  (`SUBSCRIPTION_CODEX_BASE_URL`), and the API becomes `openai-codex-responses`. Credentials live in `AuthStorage`
  rather than as a runtime API key, so Pi re-resolves them per request and auto-refreshes expired access tokens through
  the shared persisted backend — rotated tokens are saved for future runs.
- **Failure is explicit.** The access token is resolved (and refreshed if needed) up front; if that fails the secret is
  marked `needs-reauth` and the run fails with "Your OpenAI subscription sign-in has expired or was revoked. Open model
  provider settings and sign in with ChatGPT again." rather than a cryptic mid-stream 401 (`api-service.ts:4262`).
- **Models** come from a static catalog (`SUBSCRIPTION_CODEX_MODELS`, `api-service.ts:6700`) that mirrors the current
  Codex CLI picker rather than pi-ai's `openai-codex` catalog, which lags: the backend rejects the older ids outright
  ("model is not supported when using Codex with a ChatGPT account") and misses the current generation. Keep this list
  current when Codex changes its picker.

## Model registration and reasoning

`piModelForDefinition()` (`api-service.ts:6800`) builds the single model entry registered per run.

For subscription runs it prefers Pi's `openai-codex` catalog entry (accurate context window, image support, cost) and
synthesizes a default for unknown ids — Codex models are all reasoning models.

For everything else:

- `reasoning` is set when the agent selected a level **or** when the model needs an explicit "no reasoning" value. Pi
  only sends reasoning parameters for models flagged `reasoning`, and OpenAI's newer chat models default reasoning on
  server-side and reject function tools unless it is explicitly disabled — so the flag has to go on to send
  `effort: 'none'`.
- `api` is `openai-responses` for reasoning-flagged OpenAI models and the spec's API otherwise. OpenAI's gpt-5.1+ models
  reject function tools on `/v1/chat/completions` unless reasoning is explicitly disabled, and reject tools entirely
  once an effort is set there; the Responses API is the supported path for tools plus reasoning.
- `input` is `['text', 'image']` when `modelSupportsImageInput()` says so, which is what decides whether image
  attachments reach the model as image parts or as metadata text (`protocol/src/model-capabilities.ts`).
- `cost` is zeroed and `contextWindow`/`maxTokens` are fixed defaults (128000/16384) for non-subscription models, so
  token counts are real but dollar figures are not yet.

### Reasoning levels

`agents/protocol/src/reasoning.ts` is shared by the server and every model picker. Levels are `minimal`, `low`,
`medium`, `high`, `xhigh`, and the lists are **empirically verified against live provider APIs**, not scraped, because
providers gate levels per model generation:

| family                           | levels                     | leaving it unset                 |
| -------------------------------- | -------------------------- | -------------------------------- |
| OpenAI gpt-5 / gpt-5-mini        | minimal, low, medium, high | provider default (can't disable) |
| OpenAI gpt-5.1                   | low, medium, high          | off (sends `effort: 'none'`)     |
| OpenAI gpt-5.2+ (incl. 5.4, 5.6) | low, medium, high, xhigh   | off (sends `effort: 'none'`)     |
| OpenAI o-series (o1/o3/o4)       | low, medium, high          | provider default                 |
| Anthropic claude-3-7 and later   | minimal, low, medium, high | off                              |
| Google gemini-2.5+               | minimal, low, medium, high | off, except `-pro` (default)     |

`gpt-5-chat*` variants expose no reasoning control. Anything else — including every OpenAI-compatible passthrough type —
returns null, and the desktop's `ReasoningSelect` renders nothing for it.

The selected level rides on `AgentDefinition.reasoningLevel` and is passed to Pi as `thinkingLevel` at session creation
(`api-service.ts:4333`, defaulting to `'off'`). `restoreReasoningEffort()` (`api-service.ts:9255`) then re-asserts it on
the outgoing payload: when Pi has already produced a `reasoning.effort` that disagrees with the stored level, the
agent's choice wins.

## Pi request behavior

Each run creates an in-memory Pi session (`#runPiAgent`, `api-service.ts:4298`) with:

- `AuthStorage` — `inMemory()` with a runtime-only API key for api-key providers, or `fromStorage()` over the persisted
  OAuth backend for subscription providers;
- `ModelRegistry.inMemory()` plus a per-run provider/model registration;
- `SessionManager.inMemory()` so Pi persists no session JSONL of its own;
- `SettingsManager.inMemory({compaction: {enabled: false}})`;
- a no-discovery `ResourceLoader` whose system prompt is the assembled agent prompt (see `prompt-injection-map.md`);
- `noTools: 'builtin'` and an explicit tool list: the five verbs, plus any promoted callables, plus `return_result` for
  typed children. `delegate` is included only when the turn has a run to park on.

`provider.modelDefaults` is merged into the payload immediately before dispatch. `mergePiPayloadDefaults()`
(`api-service.ts:9243`) is a **shallow** `{...payload, ...defaults}` — the stored values win over Pi's generated fields
rather than backfilling them, so "defaults" is a misnomer. It also runs **after** `restoreReasoningEffort` in both
`onPayload` sites, which means a `modelDefaults` key named `reasoning` clobbers the agent's restored effort. Treat it as
an advanced escape hatch and prefer explicit typed settings for product UI. It is validated at write time
(`api-service.ts:6543`): a non-array object, CBOR-encoding to at most 16 KiB.

Every request logs `{sessionId, agentId, provider, model, reasoningLevel, activeTools, payloadTools}` before dispatch,
which is the first thing to read when a provider rejects a call.

## Message context

Pi receives, in order:

1. the assembled system prompt (agent definition + shared instructions + memory + user-actions + Space index + signing
   identities);
2. durable Seed user/assistant messages converted to Pi messages, with user-actor tool events replayed as
   `<user_action>` blocks;
3. durable `tool_call` events reconstructed as Pi assistant tool-call messages;
4. durable `tool_result` events as Pi tool-result messages;
5. ephemeral per-turn blocks: `<background_work_update>` when a park-resume ends on an assistant message, and the
   `<plan_state>` checklist last.

Historical tool events are reconstructed as paired assistant tool-call/tool-result messages so later turns replay valid
provider history instead of orphaned tool results.

## Session titling

Untitled sessions get a title from one minimal, tool-less model call (`#generateSessionTitle`, `api-service.ts:2966`),
gated by `SEED_AGENTS_SESSION_TITLE_GENERATION` (`config.titleGeneration`; the server default is on, the `Service`
option default is off so mocked test providers never see surprise requests).

It resolves its model through `piProviderRuntimeForTitle()` — the same `#piProviderRuntime` an agent run uses — rather
than an inline resolution. That matters: subscription providers have no `apiKey` secret, and the old inline path
silently bailed, leaving every subscription-provider session untitled. The call runs with `thinkingLevel: 'off'`, no
tools, and the same `modelDefaults`/reasoning payload treatment as a normal run; the first line of the reply is stripped
of quotes and stored. A title the user edited through `UpdateSession` is never overwritten.

## Adding or changing provider execution

1. Add the `PROVIDER_SPECS` entry (and the desktop `PROVIDER_METADATA` entry).
2. If the model needs reasoning control, add its generation to `reasoning.ts` with a note on how the levels were
   verified; if it takes images, add it to `model-capabilities.ts`.
3. Preserve session lifecycle and WebSocket partials.
4. Map Pi assistant/tool events into ordered `message`/`tool_call`/`tool_result` events.
5. Add mocked network tests for success, streaming, text-before-tool ordering, tools, missing key, and provider errors.
6. Confirm decrypted secrets stay in memory and are never written to Pi auth files.
7. Update `model-providers.md`, `signed-api.md`, `desktop-ui.md`, and `roadmap.md`.

## Open provider work

1. Real-provider smoke coverage for Anthropic and Google through Pi, including model-list behavior.
2. A provider test button.
3. Provider deletion and secret rotation UI.
4. Real cost tables — `cost` is currently zeroed, so usage is counted in tokens and never in money.
5. Per-provider reasoning payload quirks (`compat.thinkingFormat` for `deepseek`/`openrouter`) are still unwired; those
   types register as non-reasoning models.
