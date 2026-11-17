---
name: Model providers
summary: A model provider tells an app environment which language-model backend to call for an account, with its credentials stored encrypted and its base URL pinned for every hosted provider type.
---
A model provider is a record, scoped to an [account](../protocol/identity.md), that tells the [Seed Agents](../agent.md) server how to call an LLM backend. Provider credentials are stored separately and encrypted. The record holds only a reference to them. <!-- id:F5iAgtU4 -->

An agent names one provider and one model on it. This page covers the provider record, the provider types, the actions that manage providers, and how to add one in the app. Two neighbours hold the rest: [reasoning levels](./reasoning-levels.md) says how much a model thinks, and [Sign in with ChatGPT](./chatgpt-sign-in.md) covers using a ChatGPT plan in place of an API key.

# Adding a provider in the app

Open the **Settings** tab of an agent that runs on the server and choose **Model providers**. Only the owner sees it. The Create Agent dialog also asks for a provider when the server has none. In the dialog, pick a type, give the provider a name, and either paste an API key or choose **Sign in with ChatGPT**. `ollama` and `custom` also take a base URL, and their key is optional. The dialog refuses to send a key to a remote server over plain HTTP. Each provider shows an expandable list of its models and a **Refresh** button, and a failure to list shows inline. See [Agents in the Seed app](./in-the-app.md).

# Provider record <!-- id:y4bEdiBm -->

The record has this shape: <!-- id:oMY1mTll -->

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

The credentials are [secrets](./identity.md) of the account, named by `secretRefs`.

# Supported provider types <!-- id:dO5T0qHa -->

Most providers are OpenAI-compatible. They are called the same way and their models are listed the same way, and they differ only by base URL. <!-- id:0Licoykk -->

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

\* `openai` uses `openai-responses` for a model that reasons. See [reasoning levels](./reasoning-levels.md). <!-- id:sdsIpE0- -->

`custom` is the generic OpenAI-compatible type. The user supplies the base URL, so it covers self-hosted servers (LM Studio, vLLM, llama.cpp, LocalAI) and any future OpenAI-compatible endpoint without a code change. It has no default base URL, so the user must supply one. <!-- id:Z8omQ1eO -->

`ollama` and `custom` are the only two types that accept a custom base URL and need no API key. The other seven are the inverse: for them the default base URL always wins, so a stored API key cannot be redirected to an arbitrary host. `SetModelProvider` still validates and stores a `baseUrl` on a pinned provider, and execution ignores it, so the record can disagree with what runs. Because `custom` has no default, it is the only type that can fail with "Base URL is required for provider type: custom". The trust rationale is in the [security model](./security.md). <!-- id:tlog-XGz -->

Anthropic and Google are not covered by tests against the real providers. `deepseek` and `openrouter` models run without reasoning control.

# API actions <!-- id:seQkEzEa -->

These are [signed API](../build/signed-api.md) actions. <!-- id:oSxv44bd -->
  - `ListModelProviders`: redacted provider metadata. <!-- id:obDhDqLd -->
  - `ListProviderModels`: resolves credentials server-side and queries the provider's model-list endpoint. Optional `refresh: true` bypasses the server's cached Codex release lookup for subscription providers. <!-- id:emMglq7O -->
  - `SetModelProvider`: upserts provider config. <!-- id:z3UJn0_5 -->
  - `SetSecret`: encrypts and upserts a secret value. <!-- id:vEMVC60a -->
  - `DeleteModelProvider`: removes a provider record and its API-key secret. <!-- id:EPPvk15T -->
  - `StartProviderOAuth`, `SubmitProviderOAuthCode`, `GetProviderOAuthStatus`, `CancelProviderOAuth`: the subscription sign-in flow. <!-- id:c_F1btlK -->

Returned provider shape: <!-- id:TaVAqOZZ -->

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

No provider action returns plaintext secrets. `ListProviderModels` returns only `{id, name}`: <!-- id:b3voFvPO -->
  - **subscription providers** list the models of the ChatGPT plan, as [Sign in with ChatGPT](./chatgpt-sign-in.md) describes; <!-- id:3aP3RC_5 -->
  - **openai strategy** (`openai`, `openrouter`, `deepseek`, `groq`, `xai`, `ollama`, `custom`): `GET {base}/models`. The `Authorization: Bearer` header is added only when a key exists, so keyless Ollama and custom providers work. `name` is the id, and there is no display name; <!-- id:ICG7Fs4X -->
  - **anthropic**: `GET {base}/v1/models` with `x-api-key` and `anthropic-version: 2023-06-01` instead of Bearer. `name` is `display_name` when present; <!-- id:hr1emxf1 -->
  - **google**: `GET {base}/models?key=…` with the key in the **query string**. It drops models whose `supportedGenerationMethods` exists and lacks `generateContent`, strips the `models/` id prefix, and prefers `displayName`. <!-- id:5FUg382Z -->

Errors: a missing key on a `requireApiKey` provider fails with 400 before any fetch. An unknown provider name is 404. A non-OK upstream response is `502 "<label> request failed: HTTP <status>"`, and a malformed body is `502 "<label> response is invalid"`. A custom base URL that carries a query string loses it on the model-list request. <!-- id:heoA52Dh -->

# How a model is set up for a run <!-- id:qdW0mdOj -->

Each run registers exactly one model, built from the agent's definition.

  - **Image input.** Whether a model takes images decides whether an attached image reaches it as an image or as a line of metadata. <!-- id:KxXI7lQq -->
  - **Context window.** It is known per model family, for example 400k tokens for gpt-5 and later, 200k or 1M for Claude, and 128k for gpt-4o. The context meter and the `<context_usage>` block use it; see [session continuation](./session-continuation.md). The reply is capped at 16384 tokens. <!-- id:jgZ3Sgim -->
  - **Usage.** Token counts are real. Cost is recorded as zero, so usage is counted in tokens and never in money.
  - **Reasoning.** See [reasoning levels](./reasoning-levels.md).

Every request logs the session, agent, provider, model, reasoning level and tool names before it is sent. Read that line first when a provider rejects a call. <!-- id:yWv424ld -->

What the provider receives on each request is described in [what an agent is told](./prompt.md).

# See also <!-- id:Tmv4gUhn -->

- [Reasoning levels](./reasoning-levels.md)
- [Sign in with ChatGPT](./chatgpt-sign-in.md)
- [Signed API](../build/signed-api.md) <!-- id:Mkhv-xvr -->
- [Security model](./security.md) <!-- id:jGxLYbem -->
- [Persistence](../operate/persistence.md) <!-- id:IP49a6Ve -->
- [What an agent is told](./prompt.md) <!-- id:WCT2M2dx -->
- [Agents in the Seed app](./in-the-app.md) <!-- id:c78-tdP7 -->
- [Troubleshooting](../operate/troubleshooting.md) <!-- id:bTwdA-Fh -->
- [Operations](../operate/operations.md) <!-- id:m0u21V9S -->
