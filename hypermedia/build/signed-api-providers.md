---
name: "Signed API: providers and identities"
summary: This page lists the signed API actions for an account's model providers, provider sign-in, signing identities, secrets and MCP servers.
---
These actions of the [signed API](./signed-api.md) set up what belongs to an [account](../protocol/identity.md), not to one [agent](../agent.md): [model providers](../agent/model-providers.md), the account keys the server signs with, secrets, and [MCP servers](../agent/mcp.md). No role on an agent lets you change them. The [signed API](./signed-api.md) page covers what every action shares: the endpoint, the envelope, errors, [access levels](./signed-api.md#access-levels) and idempotency.

# Model providers

## `ListModelProviders` <!-- id:wkEnoSTE -->

Request: <!-- id:K1behmhG -->

```ts <!-- id:3_dA5ja1 -->
{
  _: 'ListModelProviders'
  agentId?: string // list on behalf of an agent the signer can read
}
```

Response: <!-- id:HTXe1l6f -->

```ts <!-- id:gbJ6VNOc -->
{_: 'ListModelProvidersResponse'; providers: RedactedModelProvider[]}
```

Returns only the description of each provider. The config and the names of its secrets are left out. See [model providers](../agent/model-providers.md). <!-- id:4mUUWwCY -->

## `ListProviderModels` <!-- id:rPu2xgdM -->

Request: <!-- id:j_1euAtv -->

```ts <!-- id:CBaFMJfW -->
{
  _: 'ListProviderModels'
  provider: string
  agentId?: string
  refresh?: boolean // skip server-side caches behind the listing
}
```

Response: <!-- id:VXJSmJ0N -->

```ts <!-- id:X0Fx-7K9 -->
{
  _: 'ListProviderModelsResponse'
  models: Array<{id: string; name: string}>
}
```

Looks up one configured provider, reads its API key (or its stored sign-in, for a `subscription` provider) in memory, and asks the provider for its models. It returns `404` for an unknown provider and `401` when a subscription sign-in has expired. The response never holds a secret or the provider config. <!-- id:eXaVQliY -->

## `SetModelProvider` <!-- id:0TGt9T6- -->

Request: <!-- id:RoGVrVA9 -->

```ts <!-- id:tOau06pk -->
{
  _: 'SetModelProvider'
  name: string
  provider: ModelProviderConfig
}
```

Creates the provider config with this name, or replaces it. `ModelProviderConfig.authMode` says how requests to the provider sign in: `api-key` (the default, uses the `secretRefs.apiKey` secret) or `subscription` (uses the OAuth credentials in the `secretRefs.oauth` secret). Response: `{_: 'SetModelProviderResponse'; provider: RedactedModelProvider}`. <!-- id:EZ-N0L0Z -->

## `DeleteModelProvider` <!-- id:PntVgf2e -->

Request: <!-- id:DI0OZhn9 -->

```ts <!-- id:6WQ2zw1I -->
{
  _: 'DeleteModelProvider'
  name: string
}
```

Deletes the provider with this name, and every secret it used that no other provider uses. Subscription providers of one type share one OAuth secret, so that secret stays while another provider still uses it. Sessions that were pinned to this provider go back to the agent's own model. Agents drop it from `enabledModels`, and an agent that ran on it switches to the first model it has left. The answer is 404 when the account has no provider with that name. Response: `{_: 'DeleteModelProviderResponse'; name}`. <!-- id:HIzrYLKy -->

## Provider OAuth actions <!-- id:zc68Rblr -->

A provider in `subscription` mode signs in with four actions and needs no pasted API key. The server offers this only when it runs with `SEED_APPS_SUBSCRIPTION_AUTH` on (the `health` route shows it as `subscriptionAuth`). Otherwise `StartProviderOAuth` returns `403`. <!-- id:EoQaHbog -->
  - `StartProviderOAuth {providerType}` → `{_: 'StartProviderOAuthResponse'; loginId; authUrl; expiresAt}`. Only `openai` is supported. Starting a new login cancels the account's previous pending one. <!-- id:GezKgzV8 -->
  - `GetProviderOAuthStatus {loginId}` → `{_: 'ProviderOAuthStatusResponse'; loginId; status: 'pending' | 'completed' | 'failed'; secretName?; error?}`. On `completed`, `secretName` is the stored credentials secret to reference as `secretRefs.oauth`. <!-- id:vPtRT8RQ -->
  - `SubmitProviderOAuthCode {loginId, code}` → `{_: 'SubmitProviderOAuthCodeResponse'}`. Use it when the provider's redirect to localhost cannot reach the server: the client sends the code, or the whole redirect URL, that the person pasted. <!-- id:sewo852w -->
  - `CancelProviderOAuth {loginId}` → `{_: 'CancelProviderOAuthResponse'; loginId}`. <!-- id:htdvnbmn -->

After that, `RedactedModelProvider.authStatus` reports the state of the sign-in: `ok`, or `needs-login` when the credentials are missing or a token refresh failed. <!-- id:TmFl9mQ7 -->

# Signing identities

A signing identity is an account key that the server holds, so an agent can sign and publish with it. [Agent identity](../agent/identity.md) explains the idea.

## `ListSigningIdentities` <!-- id:tpwvOyDB -->

Request: <!-- id:DwaxPLc5 -->

```ts <!-- id:zsSkhNaf -->
{
  _: 'ListSigningIdentities'
  agentId?: string
}
```

Response: <!-- id:YKccDTQm -->

```ts <!-- id:QbpLGoa9 -->
{_: 'ListSigningIdentitiesResponse'; identities: SigningIdentity[]}
```

Lists the account's secrets whose metadata has `kind: 'hm-account-key'`. The response never holds the key itself. <!-- id:sYhgHgVm -->

- Without `agentId`, you see only the keys of your own account.
- With `agentId`, the list is for the owner of that shared agent. The owner sees every identity. A collaborator (reader or writer) sees only the identities granted to that agent. The owner's other keys stay private.
- Only the owner can change which identities an agent has (`definition.signingKeys`, through `UpdateAgent`). A writer's `UpdateAgent` must send the same set, or the server refuses it with 403.

## `CreateSigningIdentity` <!-- id:auvMDs17 -->

Request: <!-- id:0oK3hz7e -->

```ts <!-- id:4be0WzkU -->
{
  _: 'CreateSigningIdentity'
  label?: string
  clientRequestId?: string
}
```

Response: <!-- id:npIE5a-R -->

```ts <!-- id:H9it4-n3 -->
{
  _: 'CreateSigningIdentityResponse'
  identity: SigningIdentity
}
```

Makes a new Ed25519 [account key](./keys.md) on the server. The server publishes a [profile](../profile.md) and a [home document](../protocol/spaces.md) for the new account on the configured Hypermedia server. The name is your label or, without one, "Agent account" plus the start of the account id. If that publish fails, the action returns `502` and no key is stored. The server then encrypts the seed as a secret of your account, tagged `kind: 'hm-account-key'`, and returns the identity without the key. With a `clientRequestId`, sending the action again does not create a second key. <!-- id:AatBGOjy -->

## `ImportSigningIdentity`

```ts
{
  _: 'ImportSigningIdentity'
  seed: Uint8Array // raw 32-byte Ed25519 seed of the account key
  label?: string
  clientRequestId?: string
}
```

Response: `{_: 'ImportSigningIdentityResponse'; identity: SigningIdentity}`. Stores an existing account key for the server to sign with, such as one from an exported [key file](./keys.md) that the client decrypted. Import publishes nothing, so the account's profile and content stay as they are. The seed must be exactly 32 bytes, or you get a `400`. Importing a key the server already holds returns `409`.

## `UpdateSigningIdentity` <!-- id:bEHd5bWz -->

Request: <!-- id:ZxY_xq3E -->

```ts <!-- id:2eXaCYdF -->
{
  _: 'UpdateSigningIdentity'
  name: string
  label: string
  icon?: SigningIdentityIcon
}
```

Publishes the account's profile [blob](../protocol/blobs.md) again with the new display name, and updates the stored description. If the publish fails, the action returns `502`. Response: `{_: 'UpdateSigningIdentityResponse'; identity: SigningIdentity}`. <!-- id:98qmb3HA -->

## `DeleteSigningIdentity` <!-- id:mxoQln1X -->

Request: <!-- id:cIsPq69D -->

```ts <!-- id:7q7MhJyA -->
{
  _: 'DeleteSigningIdentity'
  name: string
}
```

Deletes the encrypted account key that the server holds. The key is also taken away from every agent that could sign with it. An agent that had only this key is left with no signing identity. Profile blobs that were published stay on the network, because published blobs are never removed. Response: `{_: 'DeleteSigningIdentityResponse'; name}`. <!-- id:eeDtnuRx -->

# Secrets

## `SetSecret` <!-- id:Lwc2nC08 -->

Request: <!-- id:QQn07xMt -->

```ts <!-- id:tgfEs2fE -->
{
  _: 'SetSecret'
  name: string
  value: Uint8Array
  metadata?: Record<string, unknown>
}
```

Encrypts a secret and stores it under `name`, replacing any secret with that name. A value over 64 KiB is refused with `400`. Response: `{_: 'SetSecretResponse'; secret: RedactedSecret}`, which never holds the value. <!-- id:a11jn1Hr -->

# MCP servers <!-- id:9TIrOZPc -->

MCP servers belong to the account, like model providers. [MCP servers](../agent/mcp.md) explains how they behave. <!-- id:cAwoDOo7 -->

```ts <!-- id:wCfEdkKV -->
{_: 'ListMcpServers'}                              → {_: 'ListMcpServersResponse'; servers: RedactedMcpServer[]}
{_: 'SetMcpServer'; name: string; config: McpServerConfig} → {_: 'SetMcpServerResponse'; server: RedactedMcpServer}
{_: 'RefreshMcpServer'; name: string}              → {_: 'SetMcpServerResponse'; server: RedactedMcpServer}
{_: 'DeleteMcpServer'; name: string}               → {_: 'DeleteMcpServerResponse'; name: string}
```

```ts <!-- id:-hzUDAoZ -->
type McpServerConfig = {
  url: string // http(s) only
  transport?: 'http' | 'sse' // absent: Streamable HTTP, then SSE
  headers?: Record<string, string> // non-secret headers
  secretRefs?: Record<string, string> // header name → account secret name
}

type RedactedMcpServer = {
  id: string
  name: string // slug, ^[a-z0-9][a-z0-9_-]{0,31}$
  url: string
  transport: 'http' | 'sse'
  headerNames: string[]
  secretHeaderNames: string[]
  hasSecrets: boolean
  tools: {name: string; toolName: string; description?: string; inputSchema?: JsonSchema}[]
  status: {state: 'ok' | 'error' | 'unknown'; error?: string; checkedAt?: number}
  createdAt: number
  updatedAt: number
}
```

- `SetMcpServer` checks the name (a slug), the URL (`http` or `https`), the transport and the two header maps (valid header names, at most 16 each, values at most 4 KiB). It saves the server, then connects to it to find its tools. The response reports `status` and `tools` in both cases: the server is saved even when finding the tools fails. <!-- id:0FW3wrCT -->
- `RefreshMcpServer` finds the tools again.
- `DeleteMcpServer` deletes the record and the `mcp-<name>-…` secrets it owns. It removes the name from every agent's `definition.mcpServers` and deletes the `mcp` [tool documents](../agent/tool-document.md) made from it.
- Each write sends `account-change` with reason `mcp-servers-changed`, plus `agent-tools-changed` for each agent whose tools changed.

# Delegated signers

## `RegisterSigner`

```ts
{_: 'RegisterSigner'; capability: Uint8Array} // DAG-CBOR bytes of a signed Capability blob
  → {_: 'RegisterSignerResponse'; accountId: string; signerId: string}
```

Registers the envelope's signer as a delegated signer for the account that issued the [capability](../protocol/permissions.md). The bytes are a [Capability](../capability.md) blob. The server accepts it for older clients. A capability that does not check out returns `400`. A newer client sends the delegation in every [envelope](./signed-api.md#signed-envelope) as `capability` and `capabilityBlob`, and registers nothing.

# See also

- [Signed API](./signed-api.md)
- [Agents](./signed-api-agents.md)
- [Model providers](../agent/model-providers.md)
- [MCP servers](../agent/mcp.md)
- [Keys](./keys.md)
