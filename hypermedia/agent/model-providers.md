---
name: Model providers
summary: A model provider tells an app environment which language-model service to call for an account, with its credentials stored encrypted and its address fixed for every hosted provider type.
---
A **model provider** tells the [Seed Agents](../agent.md) server how to reach a language model, for example "OpenAI, with this API key". It is a record that belongs to one [account](../protocol/identity.md). The server stores the credentials separately and encrypted. The record holds only a reference to them. <!-- id:F5iAgtU4 -->

An agent names one provider and one model on it. This page covers the provider record, the provider types, the actions that manage providers, and how to add one in the app. Two other pages hold the rest: [reasoning levels](./reasoning-levels.md) says how much a model thinks, and [Sign in with ChatGPT](./chatgpt-sign-in.md) covers using a ChatGPT plan in place of an API key.

# Adding a provider in the app

1. Open the **Settings** tab of an agent that runs on the server and choose **Model providers**. Only the owner sees it. The Create Agent dialog also asks for a provider when the server has none.
2. Pick a type and give the provider a name.
3. Paste an API key, or choose **Sign in with ChatGPT**. `ollama` and `custom` also take a base URL, and their key is optional.

The dialog refuses to send a key to a remote server over plain HTTP. Each provider shows a list of its models that you can open, and a **Refresh** button. If the list cannot be loaded, the error shows in the same place. See [Agents in the Seed app](./in-the-app.md).

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

Most providers are OpenAI-compatible: the server calls them the same way and lists their models the same way. They differ only by base URL, the address of the service. <!-- id:0Licoykk -->

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

`custom` is the type for any other OpenAI-compatible service. You give the base URL. So it covers servers you host yourself (LM Studio, vLLM, llama.cpp, LocalAI) and any other OpenAI-compatible service, without a code change. It has no default base URL, so you must give one. <!-- id:Z8omQ1eO -->

`ollama` and `custom` are the only two types that accept your own base URL and need no API key. For the other seven types the address is fixed. You can save a `baseUrl` on one of them, and `SetModelProvider` checks and stores it, but the server never uses it. This keeps a saved API key from being sent to another host. Because `custom` has no default, it is the only type that can fail with "Base URL is required for provider type: custom". The reasons are in the [security model](./security.md). <!-- id:tlog-XGz -->

No test runs against the real Anthropic and Google services. `deepseek` and `openrouter` models run without reasoning control.

# API actions <!-- id:seQkEzEa -->

These are [signed API](../build/signed-api.md) actions. <!-- id:oSxv44bd -->
  - `ListModelProviders`: the providers, without their secrets. <!-- id:obDhDqLd -->
  - `ListProviderModels`: the server reads the credentials and asks the provider for its list of models. Optional `refresh: true` skips the server's cached Codex release lookup for subscription providers. <!-- id:emMglq7O -->
  - `SetModelProvider`: creates or updates a provider. <!-- id:z3UJn0_5 -->
  - `SetSecret`: encrypts a secret value and creates or updates it. <!-- id:vEMVC60a -->
  - `DeleteModelProvider`: removes a provider record and its secrets (the API key or the ChatGPT sign-in), unless another provider still uses them. <!-- id:EPPvk15T -->
  - `StartProviderOAuth`, `SubmitProviderOAuthCode`, `GetProviderOAuthStatus`, `CancelProviderOAuth`: the subscription sign-in flow. <!-- id:c_F1btlK -->

A provider is returned in this shape: <!-- id:TaVAqOZZ -->

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

No provider action returns a secret. `ListProviderModels` returns only `{id, name}`. How it gets the list depends on the type: <!-- id:b3voFvPO -->
  - **subscription providers** list the models of the ChatGPT plan, as [Sign in with ChatGPT](./chatgpt-sign-in.md) describes; <!-- id:3aP3RC_5 -->
  - **openai strategy** (`openai`, `openrouter`, `deepseek`, `groq`, `xai`, `ollama`, `custom`): `GET {base}/models`. The `Authorization: Bearer` header is added only when a key exists, so keyless Ollama and custom providers work. `name` is the id, and there is no display name; <!-- id:ICG7Fs4X -->
  - **anthropic**: `GET {base}/v1/models` with `x-api-key` and `anthropic-version: 2023-06-01` instead of Bearer. `name` is `display_name` when present; <!-- id:hr1emxf1 -->
  - **google**: `GET {base}/models?key=…` with the key in the **query string**. It drops models whose `supportedGenerationMethods` exists and lacks `generateContent`, strips the `models/` id prefix, and prefers `displayName`. <!-- id:5FUg382Z -->

Errors: a missing key on a `requireApiKey` provider fails with 400 before any fetch. An unknown provider name is 404. A non-OK upstream response is `502 "<label> request failed: HTTP <status>"`, and a malformed body is `502 "<label> response is invalid"`. A custom base URL that carries a query string loses it on the model-list request. <!-- id:heoA52Dh -->

# How a model is set up for a run <!-- id:qdW0mdOj -->

Each run uses exactly one model, set up from the agent's definition.

  - **Image input.** Whether a model takes images decides whether an attached image reaches it as an image or as a line of metadata. <!-- id:KxXI7lQq -->
  - **Context window.** It is the most prompt tokens the model accepts, taken from the model catalog: for example 272k for gpt-5.5 and later, 200k or 1M for Claude, and 128k for gpt-4o. Ollama reports the context a model is actually loaded with and OpenRouter reports each route's limit, and those values win. The context meter and the `<context_usage>` text sent to the model use it; see [session continuation](./session-continuation.md). A hosted model the server does not know gets 128k, and a local or custom one gets 32k until its server reports more. The reply is limited to 16384 tokens, except on a ChatGPT-plan provider. <!-- id:jgZ3Sgim -->
  - **Usage.** Token counts are real. Cost is recorded as zero, so usage is counted in tokens and never in money.
  - **Reasoning.** See [reasoning levels](./reasoning-levels.md).

Before the server sends a request, it logs the [session](./session.md), agent, provider, model, reasoning level and tool names. Read that line first when a provider rejects a call. <!-- id:yWv424ld -->

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
- [Operating an app environment](../operate/operations.md) <!-- id:m0u21V9S -->
