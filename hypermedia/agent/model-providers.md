---
name: Model Providers
summary: How an account tells its agents server which language-model backends to call, how provider credentials are stored encrypted, and how models and reasoning levels are chosen.
---
A model provider is a record, scoped to an [account](../protocol/identity.md), that tells the [Seed Agents](../agent.md) server how to call an LLM backend. Provider credentials are stored separately and encrypted. The record holds only a reference to them. <!-- id:F5iAgtU4 -->

# Provider record <!-- id:y4bEdiBm -->

The record is stored in `model_providers.config_cbor` (see [persistence](./persistence.md)) (`agents/protocol/src/index.ts`): <!-- id:oMY1mTll -->

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

These are [signed API](./signed-api.md) actions. <!-- id:oSxv44bd -->
  - `ListModelProviders`: redacted provider metadata. <!-- id:obDhDqLd -->
  - `ListProviderModels`: decrypts the API key server-side and queries the provider's model-list endpoint. <!-- id:emMglq7O -->
  - `SetModelProvider`: upserts provider config. <!-- id:z3UJn0_5 -->
  - `SetSecret`: encrypts and upserts a secret value. <!-- id:vEMVC60a -->
  - `DeleteModelProvider`: removes a provider record and its API-key secret. <!-- id:EPPvk15T -->
  - `StartProviderOAuth`, `SubmitProviderOAuthCode`, `GetProviderOAuthStatus`, `CancelProviderOAuth`: the subscription sign-in flow. <!-- id:c_F1btlK -->

Returned provider shape (`protocol/src/index.ts`): <!-- id:TaVAqOZZ -->

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

No provider API returns plaintext secrets. `ListProviderModels` (`api-service.ts`, `fetchProviderModels` at `:6725`) returns only `{id, name}`: <!-- id:b3voFvPO -->
  - **subscription providers** fetch the live Codex picker (`#listSubscriptionModels`): `GET https://chatgpt.com/backend-api/codex/models?client_version=…` with the stored sign-in as bearer auth. See _Subscription auth_ below for the fallback and auth-failure behavior; <!-- id:3aP3RC_5 -->
  - **openai strategy** (`openai`, `openrouter`, `deepseek`, `groq`, `xai`, `ollama`, `custom`): `GET {base}/models`. The `Authorization: Bearer` header is added only when a key exists, so keyless Ollama and custom providers work. `name` is the id, and there is no display name; <!-- id:ICG7Fs4X -->
  - **anthropic**: `GET {base}/v1/models` with `x-api-key` and `anthropic-version: 2023-06-01` instead of Bearer. `name` is `display_name` when present; <!-- id:hr1emxf1 -->
  - **google**: `GET {base}/models?key=…` with the key in the **query string**. It drops models whose `supportedGenerationMethods` exists and lacks `generateContent`, strips the `models/` id prefix, and prefers `displayName`. <!-- id:5FUg382Z -->

Errors: a missing key on a `requireApiKey` provider fails with 400 before any fetch. An unknown provider name is 404. A non-OK upstream response is `502 "<label> request failed: HTTP <status>"`, and a malformed body is `502 "<label> response is invalid"`. `joinUrlPath()` (`api-service.ts`) clears `search` and `hash`, so a custom base URL carrying a query string loses it on the model-list request. <!-- id:heoA52Dh -->

# Supported provider types <!-- id:dO5T0qHa -->

Provider behavior is driven by one code-owned registry, `PROVIDER_SPECS` (`agents/src/api-service.ts`). Adding a provider is usually one entry there plus a matching `PROVIDER_METADATA` entry in `frontend/packages/ui/src/agents/provider-registry.ts`. Most providers are OpenAI-compatible. They use the same `openai-completions` execution and `GET /models` list path and differ only by base URL. <!-- id:0Licoykk -->

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

\* `openai` switches to `openai-responses` whenever the resolved model is reasoning-flagged. See below. <!-- id:sdsIpE0- -->

`custom` is the generic OpenAI-compatible type. The user supplies the base URL, so it covers self-hosted servers (LM Studio, vLLM, llama.cpp, LocalAI) and any future OpenAI-compatible endpoint without a code change. It has no default base URL, so the user must supply one. <!-- id:Z8omQ1eO -->

`ollama` and `custom` are the only two types with `allowCustomBaseUrl: true` and `requireApiKey: false`. The other seven are the inverse. `resolveProviderBaseUrl()` (`api-service.ts`) honors a stored `baseUrl` only for `ollama` and `custom`. For pinned providers the spec default always wins, so a stored API key cannot be redirected to an arbitrary host. When debugging, keep in mind that `SetModelProvider` still validates and stores a `baseUrl` on a pinned provider (`api-service.ts`). Execution ignores it, so the record can disagree with what runs. Because `custom` has an empty default, it is the only type that can hit the "Base URL is required for provider type: custom" 400. The trust rationale is in [security](./security.md). <!-- id:tlog-XGz -->

# Subscription auth ("Sign in with ChatGPT") <!-- id:_snc8urm -->

An OpenAI provider can authenticate with the user's ChatGPT plan instead of an API key. <!-- id:qXlToTAw -->
  - **Gated by the operator.** The flow is offered only when the server sets `SEED_AGENTS_SUBSCRIPTION_AUTH` (`config.subscriptionAuth`, `agents/src/config.ts`). It needs a client that can catch the provider's localhost redirect, which is the [desktop app](../apps/desktop.md), or a user willing to paste the redirect URL. The desktop checks the server's health flag before offering the option. <!-- id:BX2XRnyz -->
  - **The flow** lives in `agents/src/provider-oauth.ts`: PKCE against `https://auth.openai.com/oauth/authorize` and `/oauth/token`, client id `app_EMoamEEZ73f0CkXaXp7hrann`, redirect `http://localhost:1455/auth/callback`, scope `openid profile email offline_access`. One login per account runs at a time. `parseAuthorizationInput()` accepts either a bare code or the full pasted redirect URL. Credentials land in a stable per-account secret named `<type>-subscription-oauth`, so re-login overwrites in place. <!-- id:tSDG11fW -->
  - **Execution** re-points the provider entirely (`api-service.ts`): the Pi provider id becomes `openai-codex` (`SUBSCRIPTION_PI_PROVIDER_ID`), the base URL becomes `https://chatgpt.com/backend-api` (`SUBSCRIPTION_CODEX_BASE_URL`), and the API becomes `openai-codex-responses`. Credentials live in a credential store (`PersistedOAuthStore`) rather than as a fixed API key, so pi-ai re-resolves them per request and refreshes an expired access token under the store's lock (`openaiCodexSubscriptionAuth`). Rotated tokens are written back to the encrypted secret for future runs. <!-- id:i17XC_-M -->
  - **Failure is explicit.** The access token is resolved, and refreshed if needed, up front. If that fails, the secret is marked `needs-reauth` and the run fails with "Your OpenAI subscription sign-in has expired or was revoked. Open model provider settings and sign in with ChatGPT again." The user sees this message instead of a cryptic mid-stream 401 (`api-service.ts`). <!-- id:JGWi-2ic -->
  - **Models** come from the same ChatGPT backend endpoint the Codex CLI fills its picker from (`fetchCodexSubscriptionModels`): `GET {SUBSCRIPTION_CODEX_BASE_URL}/codex/models?client_version=…` with the access token as bearer auth and the workspace id in `ChatGPT-Account-Id`. The backend has no public docs for this; the response is `{models: [{slug, display_name, visibility, priority, supported_reasoning_levels, context_window, …}]}`. Entries with `visibility: "hide"` (internal review models) are dropped and the rest keep `priority` order. <!-- id:Zlrkeuct -->
    - `client_version` (`SUBSCRIPTION_CODEX_CLIENT_VERSION`) is required and gates what the backend returns (each entry has a `minimal_client_version`). Bump it with the Codex CLI when a new generation stops showing up. <!-- id:lU_L8GOQ -->
    - A network or backend failure falls back to `SUBSCRIPTION_CODEX_FALLBACK_MODELS`, a snapshot of the picker, so the agent form never gets an empty list. Pi-ai's `openai-codex` catalog is not used for this: it lags a generation and the backend rejects its older ids ("model is not supported when using Codex with a ChatGPT account"). <!-- id:QszbxdcN -->
    - A 401 from the endpoint flags the secret `needsReauth` and fails the listing with the re-auth message above. <!-- id:PRy_hkvO -->

# Model registration and reasoning <!-- id:qdW0mdOj -->

`piModelForDefinition()` (`api-service.ts`) builds the single model entry registered per run. <!-- id:EE_4R6ZB -->

For subscription runs it prefers Pi's `openai-codex` catalog entry (accurate context window, image support, cost). For unknown ids it synthesizes a default, and marks it as a reasoning model because all Codex models are reasoning models. <!-- id:lfXqNoRu -->

For everything else: <!-- id:bGOJ6vf9 -->
  - `reasoning` is set when the agent selected a level **or** when the model needs an explicit "no reasoning" value. Pi only sends reasoning parameters for models flagged `reasoning`. OpenAI's newer chat models turn reasoning on by default server-side and reject function tools unless it is explicitly disabled. So the flag has to be on to send `effort: 'none'`. <!-- id:Sc89-Xri -->
  - `api` is `openai-responses` for reasoning-flagged OpenAI models, and the spec's API otherwise. OpenAI's gpt-5.1+ models reject function tools on `/v1/chat/completions` unless reasoning is explicitly disabled, and reject tools entirely once an effort is set there. The Responses API is the supported path for tools plus reasoning. <!-- id:UKxLkNYj -->
  - `input` is `['text', 'image']` when `modelSupportsImageInput()` says so. This decides whether image attachments reach the model as image parts or as metadata text (`protocol/src/model-capabilities.ts`). <!-- id:KxXI7lQq -->
  - For non-subscription models, `cost` is zeroed and `maxTokens` is a fixed 16384 while `contextWindow` comes from `modelContextWindow()` in `agents/protocol/src/model-capabilities.ts` per model family (for example 400k for gpt-5 and later, 200k or 1M for Claude, 128k for gpt-4o); a subscription model's synthesized entry uses 272000/128000. Token counts are real, but dollar figures are not yet. <!-- id:jgZ3Sgim -->

## Reasoning levels <!-- id:cAV_thkI -->

`agents/protocol/src/reasoning.ts` is shared by the server and every model picker. Levels are `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Providers gate levels per model generation, so the lists below were **tested against live provider APIs** instead of copied from provider docs: <!-- id:o0RRTzN9 -->

<!-- id:w2DBomCg -->
| family <!-- col:TbnFySPL --> | levels <!-- col:sraKZh6w --> | leaving it unset <!-- col:KEjviHEU --> <!-- id:fkOMp1v4 --> |
| --- | --- | --- |
| OpenAI gpt-5 / gpt-5-mini | minimal, low, medium, high | provider default (can't disable) <!-- id:G66u980h --> |
| OpenAI gpt-5.1 | low, medium, high | off (sends `effort: 'none'`) <!-- id:NLKtzFqk --> |
| OpenAI gpt-5.2+ (incl. 5.4, 5.6) | low, medium, high, xhigh | off (sends `effort: 'none'`) <!-- id:P_htn8ec --> |
| OpenAI gpt-6+ (e.g. gpt-6-astra) | low, medium, high, xhigh, max | provider default (rejects `none`, can't disable) <!-- id:WgwQFUTj --> |
| OpenAI o-series (o1/o3/o4) | low, medium, high | provider default <!-- id:IAXkw7dU --> |
| Anthropic claude-3-7 and later | minimal, low, medium, high | off <!-- id:moUuGMt9 --> |
| Google gemini-2.5+ | minimal, low, medium, high | off, except `-pro` (default) <!-- id:ZPj6RMRf --> |

`gpt-5-chat*` variants expose no reasoning control. Anything else returns null, including every OpenAI-compatible passthrough type, and the shared `ReasoningSelect` picker renders nothing for it. <!-- id:1zBT-TX_ -->

Each run opens the session's [durable store](./durable-sessions.md) (`#runPiAgent` in `api-service.ts`) with: <!-- id:8GvfxwcF -->
  - a pi-ai `Models` collection built for this run (`#piProviderRuntime`), holding one provider with one model. An api-key provider resolves the decrypted key from memory. A subscription provider resolves through `PersistedOAuthStore`, a credential store over the encrypted OAuth secret; <!-- id:ydcMAJua -->
  - a wrapper around the provider's streaming implementation (`withProviderRequestHooks`) that rewrites each outgoing payload and reports the first streamed event, because the harness issues the requests and Seed does not; <!-- id:cOzZ5JAV -->
  - a fresh registry holding one extension, so nothing but this turn's tools and prompt can run; <!-- id:b24OJJek -->
  - harness settings with compaction off, the harness's own retries off, and two client-side retries per request for transient failures; <!-- id:3gtf99zH -->
  - one system prompt section holding the assembled agent prompt (see the [prompt injection map](./prompt-injection-map.md)); <!-- id:vS47YBmy -->
  - an explicit tool list: the verbs, plus any [promoted](./promotion.md) callables, plus `return_result` for [typed children](./typed-result.md). `delegate` is included only when the turn has a run to park on and room in its delegation budget, and `continue_session` only for a foreground conversation. <!-- id:cQrTAIZl -->

The selected level rides on `AgentDefinition.reasoningLevel` and is set as the conversation's `thinkingLevel` before each turn (`#runPiAgent` in `api-service.ts`, defaulting to `'off'`). `applyReasoningEffort()` then decides what the outgoing OpenAI Responses payload says about effort. The stored level wins over anything Pi produced, because Pi clamps levels for models its catalog does not know. With no level, the request sends `none` where the generation accepts it. Otherwise it omits the effort so the provider default applies. Pi writes `none` for every level-less reasoning model, and gpt-6+ rejects that. <!-- id:n3rwsNjt -->

The matrix is a starting guess, and the runtime corrects it. When a provider rejects the effort a run sent ("Unsupported value: 'none' is not supported with the 'gpt-6-astra' model. Supported values are: 'low', …"), `learnReasoningEffortSupport()` records the accepted list for that model in process memory. `applyReasoningEffort()` uses that list on every later request. A rejected `none` is dropped in favor of the provider default, and a rejected level moves to the nearest accepted one. So a model newer than this file costs one failed turn and then runs. Extend the matrix afterwards so the picker offers the right levels. <!-- id:a_HKwf5s -->

Every request logs `{sessionId, agentId, provider, model, reasoningLevel, activeTools, payloadTools}` before dispatch. Read that line first when a provider rejects a call. <!-- id:yWv424ld -->

# Message context <!-- id:4bmgIq8a -->

The provider receives, in order: <!-- id:HJOieZI9 -->
  1. the assembled system prompt (agent definition + shared instructions + memory + user-actions + signing identities). It carries no clock, no [Space index](./space-index.md) and no running counts, so it does not change from turn to turn; <!-- id:cHiwa70H -->
  2. the session's durable conversation: user messages, with user-[actor](./actor.md) tool events as `<user_action>` blocks, and every earlier provider response and tool result exactly as it was recorded; <!-- id:xCwoy-jM -->
  3. this turn's input: the newest user message, or `<background_work_update>` when a [park](./park.md)-resume has no new message to answer; <!-- id:eR2-2Cj4 -->
  4. per-turn state behind the input, never stored: the `<space>` index, `<delegation_budget>`, the `<plan_state>` checklist, `<context_usage>`, `<session_status>`, and `<current_time>`. <!-- id:nmrtuP4i -->

When the conversation has to be rebuilt from the log, tool events are replayed as paired assistant tool-call and tool-result messages, so the provider never sees an orphaned tool result. [Durable sessions](./durable-sessions.md) explains when that happens. <!-- id:8dI8vdJp -->

# Session titling <!-- id:p6ZW9E5O -->

Untitled sessions get a title from one minimal model call with no tools (`#generateSessionTitle`, `api-service.ts`). It is gated by `SEED_AGENTS_SESSION_TITLE_GENERATION` (`config.titleGeneration`). The server default is on. The `Service` option default is off, so mocked test providers never see surprise requests. <!-- id:HdUSyPlp -->

It resolves its model through `piProviderRuntimeForTitle()`, which uses the same `#piProviderRuntime` as an agent run. Subscription providers have no `apiKey` secret, and the old inline resolution silently gave up, so every subscription-provider session stayed untitled. The call runs with `thinkingLevel: 'off'`, no tools, and the same `modelDefaults` and reasoning payload treatment as a normal run. The first line of the reply is stripped of quotes and stored. A title the user edited through `UpdateSession` is never overwritten. <!-- id:zdKvhJBu -->

# Adding or changing provider execution <!-- id:52gF6XVq -->

1. Add the `PROVIDER_SPECS` entry (and the shared UI's `PROVIDER_METADATA` entry). <!-- id:Yitpyyku -->
2. If the model needs reasoning control, add its generation to `reasoning.ts` with a note on how the levels were verified. If it takes images, add it to `model-capabilities.ts`. <!-- id:y2sD7Ow4 -->
3. Preserve session lifecycle and [WebSocket](./websocket-subscriptions.md) partials. <!-- id:x2MC9twp -->
4. Check that the store's assistant and tool-result entries project into ordered `message`, `tool_call`, and `tool_result` events. <!-- id:g94NWpwe -->
5. Add mocked network tests for success, streaming, text-before-tool ordering, tools, missing key, and provider errors. <!-- id:qyB36rw2 -->
6. Confirm decrypted secrets stay in memory and never reach the durable store or a Pi auth file. <!-- id:5tgYb53d -->
7. Update this page, [signed API](./signed-api.md), [desktop UI](./desktop-ui.md), and [roadmap](./roadmap.md). <!-- id:DHV236EQ -->

# Open provider work <!-- id:cjFNxmFv -->

1. Real-provider smoke coverage for Anthropic and Google through pi-ai, including model-list behavior. <!-- id:Z7dlT2Z_ -->
2. A provider test button. <!-- id:e_N8dAPv -->
3. Secret rotation UI (providers can already be deleted). <!-- id:YHUxPjUs -->
4. Real cost tables. `cost` is zeroed today, so usage is counted in tokens and never in money. <!-- id:7Wl-vPBv -->
5. Per-provider reasoning payload quirks (`compat.thinkingFormat` for `deepseek` and `openrouter`) are not wired up yet. Those types register as non-reasoning models. <!-- id:Khfw6YkX -->

# See also <!-- id:Tmv4gUhn -->

- [Signed API](./signed-api.md) <!-- id:Mkhv-xvr -->
- [Security](./security.md) <!-- id:jGxLYbem -->
- [Persistence](./persistence.md) <!-- id:IP49a6Ve -->
- [Prompt injection map](./prompt-injection-map.md) <!-- id:WCT2M2dx -->
- [Desktop UI](./desktop-ui.md) <!-- id:c78-tdP7 -->
- [Troubleshooting](./troubleshooting.md) <!-- id:bTwdA-Fh -->
- [Operations](./operations.md) <!-- id:m0u21V9S -->
