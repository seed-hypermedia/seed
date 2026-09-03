---
name: Model providers
summary: Model providers are account-scoped records telling the agent server how to call an LLM backend. Provider credentials are stored separately and encrypted;…
---
Model providers are account-scoped records telling the agent server how to call an LLM backend. Provider credentials are stored separately and encrypted; the record itself holds only a reference to them. <!-- id:F5iAgtU4 -->

# Provider record <!-- id:y4bEdiBm -->

Stored in `model_providers.config_cbor` (`agents/protocol/src/index.ts:718`): <!-- id:oMY1mTll -->

```ts <!-- id:pMz4s74H -->
type ModelProviderConfig = {
  type: string
  modelDefaults?: Record<string, unknown>
  secretRefs?: Record<string, string>
  baseUrl?: string
  /** `api-key` (default) reads secretRefs.apiKey; `subscription` reads secretRefs.oauth. */
  authMode?: 'api-key' | 'subscription'
}
```

Typical OpenAI provider: <!-- id:DOigYPgs -->

```ts <!-- id:xXTIklSP -->
{
  type: 'openai',
  secretRefs: {apiKey: 'openai-api-key'},
  modelDefaults: {temperature: 0.2}
}
```

Subscription provider: <!-- id:7jCnLfG9 -->

```ts <!-- id:Y17oLxK1 -->
{
  type: 'openai',
  authMode: 'subscription',
  secretRefs: {oauth: 'openai-subscription-oauth'}
}
```

# API actions <!-- id:seQkEzEa -->

<!-- id:oSxv44bd -->
- `ListModelProviders` — redacted provider metadata. <!-- id:obDhDqLd -->
- `ListProviderModels` — decrypts the API key server-side and queries the provider's model-list endpoint. <!-- id:emMglq7O -->
- `SetModelProvider` — upserts provider config. <!-- id:z3UJn0_5 -->
- `SetSecret` — encrypts/upserts a secret value. <!-- id:EPPvk15T -->
- `StartProviderOAuth` / `SubmitProviderOAuthCode` / `GetProviderOAuthStatus` / `CancelProviderOAuth` — the subscription sign-in flow. <!-- id:c_F1btlK -->

Returned provider shape (`protocol/src/index.ts:1078`): <!-- id:TaVAqOZZ -->

```ts <!-- id:tU03Do2h -->
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

No provider API returns plaintext secrets. `ListProviderModels` (`api-service.ts:989`, `fetchProviderModels` at `:6725`) returns only `{id, name}`: <!-- id:b3voFvPO -->
  - **subscription providers short-circuit before any HTTP** and return the static catalog (`api-service.ts:1003`); <!-- id:3aP3RC_5 -->
  - **openai strategy** (`openai`, `openrouter`, `deepseek`, `groq`, `xai`, `ollama`, `custom`): `GET {base}/models`, with the `Authorization: Bearer` header added only when a key exists — which is what makes keyless Ollama/custom work. `name` is the id; there is no display name; <!-- id:ICG7Fs4X -->
  - **anthropic**: `GET {base}/v1/models` with `x-api-key` and `anthropic-version: 2023-06-01` (not Bearer); `name` is `display_name` when present; <!-- id:hr1emxf1 -->
  - **google**: `GET {base}/models?key=…` with the key in the **query string**, dropping models whose `supportedGenerationMethods` exists and lacks `generateContent`, stripping the `models/` id prefix, and preferring `displayName`. <!-- id:5FUg382Z -->

Errors: a missing key on a `requireApiKey` provider fails with 400 before any fetch, an unknown provider name is 404, a non-OK upstream response is `502 "<label> request failed: HTTP <status>"`, and a malformed body is `502 "<label> response is invalid"`. Note that `joinUrlPath()` (`api-service.ts:6788`) clears `search` and `hash`, so a custom base URL carrying a query string loses it on the model-list request. <!-- id:heoA52Dh -->

# Supported provider types <!-- id:dO5T0qHa -->

Provider behavior is driven by one code-owned registry, `PROVIDER_SPECS` (`agents/src/api-service.ts:6603`). Adding a provider is usually one entry there plus a matching `PROVIDER_METADATA` entry in `frontend/apps/desktop/src/pages/agents/provider-registry.ts`. Most providers are OpenAI-compatible and ride the same `openai-completions` execution and `GET /models` list path, differing only by base URL. <!-- id:0Licoykk -->

<!-- id:CaCYyomB -->
| type <!-- col:rIZ8I7hq --> | Pi API <!-- col:y_MYituR --> | default base URL <!-- col:D3AxfQ-x --> | base URL editable <!-- col:5q6PJbaj --> | API key <!-- col:T-SLNGtx --> | model list <!-- col:VzlfocgI --> <!-- id:c7jSC36w --> |
| --- | --- | --- | --- | --- | --- |
| `openai` | openai-completions\* | `https://api.openai.com/v1` | no | required | openai <!-- id:QEQlxybO --> |
| `anthropic` | anthropic-messages | `https://api.anthropic.com` | no | required | anthropic <!-- id:OyzrJyGM --> |
| `google` | google-generative-ai | `https://generativelanguage.googleapis.com/v1beta` | no | required | google <!-- id:cT3dk9Bb --> |
| `openrouter` | openai-completions | `https://openrouter.ai/api/v1` | no | required | openai <!-- id:L9WozYHm --> |
| `deepseek` | openai-completions | `https://api.deepseek.com` | no | required | openai <!-- id:fuYjr9zj --> |
| `groq` | openai-completions | `https://api.groq.com/openai/v1` | no | required | openai <!-- id:aZ0uOf44 --> |
| `xai` | openai-completions | `https://api.x.ai/v1` | no | required | openai <!-- id:gjepeH9E --> |
| `ollama` | openai-completions | `http://localhost:11434/v1` | **yes** | optional | openai <!-- id:fITtikMX --> |
| `custom` | openai-completions | (user-supplied, no default) | **yes** | optional | openai <!-- id:ioV0g-TE --> |

\* `openai` switches to `openai-responses` whenever the resolved model is reasoning-flagged — see below. <!-- id:sdsIpE0- -->

`custom` is the generic OpenAI-compatible type: the user supplies the base URL, so it covers self-hosted servers (LM Studio, vLLM, llama.cpp, LocalAI) and any future OpenAI-compatible endpoint without a code change. It has no default base URL, so one must be supplied. <!-- id:Z8omQ1eO -->

`ollama` and `custom` are the only two types with `allowCustomBaseUrl: true` and `requireApiKey: false`; the other seven are the inverse. `resolveProviderBaseUrl()` (`api-service.ts:6718`) honors a stored `baseUrl` only for the former; for pinned providers the spec default always wins, which keeps a stored API key from being redirected to an arbitrary host. Worth knowing when debugging: `SetModelProvider` still validates and stores a `baseUrl` on a pinned provider (`api-service.ts:6533`) — it is simply ignored at execution time, so the record can disagree with reality. And because `custom` has an empty default, it is the only type that can reach the "Base URL is required for provider type: custom" 400. The trust rationale is in `security.md`. <!-- id:tlog-XGz -->

# Subscription auth ("Sign in with ChatGPT") <!-- id:_snc8urm -->

An OpenAI provider can authenticate with the user's ChatGPT plan instead of an API key. <!-- id:qXlToTAw -->
  - **Gated by the operator.** The flow is offered only when the server sets `SEED_AGENTS_SUBSCRIPTION_AUTH` (`config.subscriptionAuth`, `agents/src/config.ts:20`), because it needs a client that can catch the provider's localhost redirect — the desktop app — or a user willing to paste the redirect URL. The desktop checks the server's health flag before offering the option. <!-- id:BX2XRnyz -->
  - **The flow** lives in `agents/src/provider-oauth.ts`: PKCE against `https://auth.openai.com/oauth/authorize` and `/oauth/token`, client id `app_EMoamEEZ73f0CkXaXp7hrann`, redirect `http://localhost:1455/auth/callback`, scope `openid profile email offline_access`. One login per account runs at a time. `parseAuthorizationInput()` accepts either a bare code or the full pasted redirect URL. Credentials land in a stable per-account secret named `<type>-subscription-oauth`, so re-login overwrites in place. <!-- id:tSDG11fW -->
  - **Execution** re-points the provider entirely (`api-service.ts:4246`): the Pi provider id becomes `openai-codex` (`SUBSCRIPTION_PI_PROVIDER_ID`), the base URL becomes `https://chatgpt.com/backend-api` (`SUBSCRIPTION_CODEX_BASE_URL`), and the API becomes `openai-codex-responses`. Credentials live in `AuthStorage` rather than as a runtime API key, so Pi re-resolves them per request and auto-refreshes expired access tokens through the shared persisted backend — rotated tokens are saved for future runs. <!-- id:i17XC_-M -->
  - **Failure is explicit.** The access token is resolved (and refreshed if needed) up front; if that fails the secret is marked `needs-reauth` and the run fails with "Your OpenAI subscription sign-in has expired or was revoked. Open model provider settings and sign in with ChatGPT again." rather than a cryptic mid-stream 401 (`api-service.ts:4262`). <!-- id:JGWi-2ic -->
  - **Models** come from a static catalog (`SUBSCRIPTION_CODEX_MODELS`, `api-service.ts:6700`) that mirrors the current Codex CLI picker rather than pi-ai's `openai-codex` catalog, which lags: the backend rejects the older ids outright ("model is not supported when using Codex with a ChatGPT account") and misses the current generation. Keep this list current when Codex changes its picker. <!-- id:Zlrkeuct -->

# Model registration and reasoning <!-- id:qdW0mdOj -->

`piModelForDefinition()` (`api-service.ts:6800`) builds the single model entry registered per run. <!-- id:EE_4R6ZB -->

For subscription runs it prefers Pi's `openai-codex` catalog entry (accurate context window, image support, cost) and synthesizes a default for unknown ids — Codex models are all reasoning models. <!-- id:lfXqNoRu -->

For everything else: <!-- id:bGOJ6vf9 -->
  - `reasoning` is set when the agent selected a level **or** when the model needs an explicit "no reasoning" value. Pi only sends reasoning parameters for models flagged `reasoning`, and OpenAI's newer chat models default reasoning on server-side and reject function tools unless it is explicitly disabled — so the flag has to go on to send `effort: 'none'`. <!-- id:Sc89-Xri -->
  - `api` is `openai-responses` for reasoning-flagged OpenAI models and the spec's API otherwise. OpenAI's gpt-5.1+ models reject function tools on `/v1/chat/completions` unless reasoning is explicitly disabled, and reject tools entirely once an effort is set there; the Responses API is the supported path for tools plus reasoning. <!-- id:UKxLkNYj -->
  - `input` is `['text', 'image']` when `modelSupportsImageInput()` says so, which is what decides whether image attachments reach the model as image parts or as metadata text (`protocol/src/model-capabilities.ts`). <!-- id:KxXI7lQq -->
  - `cost` is zeroed and `contextWindow`/`maxTokens` are fixed defaults (128000/16384) for non-subscription models, so token counts are real but dollar figures are not yet. <!-- id:jgZ3Sgim -->

## Reasoning levels <!-- id:cAV_thkI -->

`agents/protocol/src/reasoning.ts` is shared by the server and every model picker. Levels are `minimal`, `low`, `medium`, `high`, `xhigh`, and the lists are **empirically verified against live provider APIs**, not scraped, because providers gate levels per model generation: <!-- id:MKDKGzBg -->

<!-- id:jJYsBfZi -->
| family <!-- col:42ut9Uu0 --> | levels <!-- col:hfeSMcIL --> | leaving it unset <!-- col:Ke4uH2p8 --> <!-- id:DdgtsuZm --> |
| --- | --- | --- |
| OpenAI gpt-5 / gpt-5-mini | minimal, low, medium, high | provider default (can't disable) <!-- id:J4w2Z5iJ --> |
| OpenAI gpt-5.1 | low, medium, high | off (sends `effort: 'none'`) <!-- id:_Ks-7NJp --> |
| OpenAI gpt-5.2+ (incl. 5.4, 5.6) | low, medium, high, xhigh | off (sends `effort: 'none'`) <!-- id:wSKzKqVJ --> |
| OpenAI o-series (o1/o3/o4) | low, medium, high | provider default <!-- id:33iJ5Egr --> |
| Anthropic claude-3-7 and later | minimal, low, medium, high | off <!-- id:L8l3dsqZ --> |
| Google gemini-2.5+ | minimal, low, medium, high | off, except `-pro` (default) <!-- id:WNdvNKTs --> |

`gpt-5-chat*` variants expose no reasoning control. Anything else — including every OpenAI-compatible passthrough type — returns null, and the desktop's `ReasoningSelect` renders nothing for it. <!-- id:1zBT-TX_ -->

The selected level rides on `AgentDefinition.reasoningLevel` and is passed to Pi as `thinkingLevel` at session creation (`api-service.ts:4333`, defaulting to `'off'`). `restoreReasoningEffort()` (`api-service.ts:9255`) then re-asserts it on the outgoing payload: when Pi has already produced a `reasoning.effort` that disagrees with the stored level, the agent's choice wins. <!-- id:2YQcvlO9 -->

# Pi request behavior <!-- id:YSeuSy5T -->

Each run creates an in-memory Pi session (`#runPiAgent`, `api-service.ts:4298`) with: <!-- id:8GvfxwcF -->
  - `AuthStorage` — `inMemory()` with a runtime-only API key for api-key providers, or `fromStorage()` over the persisted OAuth backend for subscription providers; <!-- id:ydcMAJua -->
  - `ModelRegistry.inMemory()` plus a per-run provider/model registration; <!-- id:cOzZ5JAV -->
  - `SessionManager.inMemory()` so Pi persists no session JSONL of its own; <!-- id:b24OJJek -->
  - `SettingsManager.inMemory({compaction: {enabled: false}})`; <!-- id:3gtf99zH -->
  - a no-discovery `ResourceLoader` whose system prompt is the assembled agent prompt (see `prompt-injection-map.md`); <!-- id:vS47YBmy -->
  - `noTools: 'builtin'` and an explicit tool list: the five verbs, plus any promoted callables, plus `return_result` for typed children. `delegate` is included only when the turn has a run to park on. <!-- id:cQrTAIZl -->

`provider.modelDefaults` is merged into the payload immediately before dispatch. `mergePiPayloadDefaults()` (`api-service.ts:9243`) is a **shallow** `{...payload, ...defaults}` — the stored values win over Pi's generated fields rather than backfilling them, so "defaults" is a misnomer. It also runs **after** `restoreReasoningEffort` in both `onPayload` sites, which means a `modelDefaults` key named `reasoning` clobbers the agent's restored effort. Treat it as an advanced escape hatch and prefer explicit typed settings for product UI. It is validated at write time (`api-service.ts:6543`): a non-array object, CBOR-encoding to at most 16 KiB. <!-- id:TP5rm18X -->

Every request logs `{sessionId, agentId, provider, model, reasoningLevel, activeTools, payloadTools}` before dispatch, which is the first thing to read when a provider rejects a call. <!-- id:yWv424ld -->

# Message context <!-- id:4bmgIq8a -->

Pi receives, in order: <!-- id:HJOieZI9 -->
  1. the assembled system prompt (agent definition + shared instructions + memory + user-actions + Space index + signing identities); <!-- id:cHiwa70H -->
  2. durable Seed user/assistant messages converted to Pi messages, with user-actor tool events replayed as `<user_action>` blocks; <!-- id:xCwoy-jM -->
  3. durable `tool_call` events reconstructed as Pi assistant tool-call messages; <!-- id:eR2-2Cj4 -->
  4. durable `tool_result` events as Pi tool-result messages; <!-- id:nmrtuP4i -->
  5. ephemeral per-turn blocks: `<background_work_update>` when a park-resume ends on an assistant message, and the `<plan_state>` checklist last. <!-- id:LzvTGdnF -->

Historical tool events are reconstructed as paired assistant tool-call/tool-result messages so later turns replay valid provider history instead of orphaned tool results. <!-- id:8dI8vdJp -->

# Session titling <!-- id:p6ZW9E5O -->

Untitled sessions get a title from one minimal, tool-less model call (`#generateSessionTitle`, `api-service.ts:2966`), gated by `SEED_AGENTS_SESSION_TITLE_GENERATION` (`config.titleGeneration`; the server default is on, the `Service` option default is off so mocked test providers never see surprise requests). <!-- id:HdUSyPlp -->

It resolves its model through `piProviderRuntimeForTitle()` — the same `#piProviderRuntime` an agent run uses — rather than an inline resolution. That matters: subscription providers have no `apiKey` secret, and the old inline path silently bailed, leaving every subscription-provider session untitled. The call runs with `thinkingLevel: 'off'`, no tools, and the same `modelDefaults`/reasoning payload treatment as a normal run; the first line of the reply is stripped of quotes and stored. A title the user edited through `UpdateSession` is never overwritten. <!-- id:zdKvhJBu -->

# Adding or changing provider execution <!-- id:52gF6XVq -->

1. Add the `PROVIDER_SPECS` entry (and the desktop `PROVIDER_METADATA` entry). <!-- id:Yitpyyku -->
2. If the model needs reasoning control, add its generation to `reasoning.ts` with a note on how the levels were verified; if it takes images, add it to `model-capabilities.ts`. <!-- id:y2sD7Ow4 -->
3. Preserve session lifecycle and WebSocket partials. <!-- id:x2MC9twp -->
4. Map Pi assistant/tool events into ordered `message`/`tool_call`/`tool_result` events. <!-- id:g94NWpwe -->
5. Add mocked network tests for success, streaming, text-before-tool ordering, tools, missing key, and provider errors. <!-- id:qyB36rw2 -->
6. Confirm decrypted secrets stay in memory and are never written to Pi auth files. <!-- id:5tgYb53d -->
7. Update `model-providers.md`, `signed-api.md`, `desktop-ui.md`, and `roadmap.md`. <!-- id:DHV236EQ -->

# Open provider work <!-- id:cjFNxmFv -->

1. Real-provider smoke coverage for Anthropic and Google through Pi, including model-list behavior. <!-- id:Z7dlT2Z_ -->
2. A provider test button. <!-- id:e_N8dAPv -->
3. Provider deletion and secret rotation UI. <!-- id:YHUxPjUs -->
4. Real cost tables — `cost` is currently zeroed, so usage is counted in tokens and never in money. <!-- id:7Wl-vPBv -->
5. Per-provider reasoning payload quirks (`compat.thinkingFormat` for `deepseek`/`openrouter`) are still unwired; those types register as non-reasoning models. <!-- id:Khfw6YkX -->
