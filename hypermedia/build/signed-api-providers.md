---
name: "Signed API: providers and identities"
summary: The signed API actions for an account's model providers, provider sign-in, signing identities, secrets and MCP servers.
---
These are the actions of the [signed API](./signed-api.md) that configure what belongs to an account, not to one agent: [model providers](../agent/model-providers.md), the account keys the server signs with, secrets, and [MCP servers](../agent/mcp.md). An agent role never grants changes to them. The envelope, the endpoint, errors, [access levels](./signed-api.md#access-levels) and idempotency are on the [signed API](./signed-api.md) page.

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

Returns provider metadata only. Config and secret refs are redacted. See [model providers](../agent/model-providers.md). <!-- id:4mUUWwCY -->

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

Looks up one configured provider for the verified account, decrypts its referenced API key in memory, and calls the provider's model-list endpoint. Plain secrets and provider config are not returned. <!-- id:eXaVQliY -->

## `SetModelProvider` <!-- id:0TGt9T6- -->

Request: <!-- id:RoGVrVA9 -->

```ts <!-- id:tOau06pk -->
{
  _: 'SetModelProvider'
  name: string
  provider: ModelProviderConfig
}
```

Upserts provider config by account and name. `ModelProviderConfig.authMode` selects how requests authenticate: `api-key` (default, uses the `secretRefs.apiKey` secret) or `subscription` (uses OAuth credentials in the `secretRefs.oauth` secret). <!-- id:EZ-N0L0Z -->

## `DeleteModelProvider` <!-- id:PntVgf2e -->

Request: <!-- id:DI0OZhn9 -->

```ts <!-- id:6WQ2zw1I -->
{
  _: 'DeleteModelProvider'
  name: string
}
```

Deletes the named provider record for the account, plus every secret it referenced that no remaining provider still references. Subscription providers of the same type share one OAuth secret, so a shared credential survives the deletion of one of its providers. 404 when the account has no provider by that name. Response: `{_: 'DeleteModelProviderResponse'; name}`. <!-- id:HIzrYLKy -->

## Provider OAuth actions <!-- id:zc68Rblr -->

Subscription-authenticated providers use a four-action login flow in place of a pasted API key. The flow is offered only when the server runs with `SEED_APPS_SUBSCRIPTION_AUTH` enabled (shown as `subscriptionAuth` on the `health` route). Otherwise `StartProviderOAuth` returns `403`. <!-- id:EoQaHbog -->
  - `StartProviderOAuth {providerType}` → `{_: 'StartProviderOAuthResponse'; loginId; authUrl; expiresAt}`. Only `openai` is supported. Starting a new login cancels the account's previous pending one. <!-- id:GezKgzV8 -->
  - `GetProviderOAuthStatus {loginId}` → `{_: 'ProviderOAuthStatusResponse'; loginId; status: 'pending' | 'completed' | 'failed'; secretName?; error?}`. On `completed`, `secretName` is the stored credentials secret to reference as `secretRefs.oauth`. <!-- id:vPtRT8RQ -->
  - `SubmitProviderOAuthCode {loginId, code}` → `{_: 'SubmitProviderOAuthCodeResponse'}`. For deployments where the provider's localhost redirect cannot reach the server, the client pastes the code (or the full redirect URL). <!-- id:sewo852w -->
  - `CancelProviderOAuth {loginId}` → `{_: 'CancelProviderOAuthResponse'; loginId}`. <!-- id:htdvnbmn -->

`RedactedModelProvider.authStatus` reports subscription health afterwards: `ok`, or `needs-login` when credentials are missing or a token refresh failed. <!-- id:TmFl9mQ7 -->

# Signing identities

A signing identity is an account key the server holds so an agent can sign and publish with it.

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

Lists account-scoped secrets whose metadata has `kind: 'hm-account-key'`. Plain secret material is never returned, and only keys uploaded by the signed account are visible. With `agentId`, the request resolves against the owning account of a shared agent. The owner sees every identity. Collaborators (reader or writer) see only the identities granted to that agent, and the owner's other keys stay private to the owner. Changing the granted set itself (`definition.signingKeys` via `UpdateAgent`) is owner-only. A writer's `UpdateAgent` must carry the grant set unchanged, or it is rejected with 403. <!-- id:sYhgHgVm -->

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

Generates a new server-side Ed25519 HM [account key](./keys.md), publishes a [profile blob](../profile.md) with the supplied label to the configured HM server, encrypts the raw seed as an account-scoped secret tagged `kind: 'hm-account-key'`, and returns redacted identity metadata. `clientRequestId` makes repeated creates idempotent. <!-- id:AatBGOjy -->

## `ImportSigningIdentity`

```ts
{
  _: 'ImportSigningIdentity'
  seed: Uint8Array // raw 32-byte Ed25519 seed of the account key
  label?: string
  clientRequestId?: string
}
```

Response: `{_: 'ImportSigningIdentityResponse'; identity: SigningIdentity}`. Stores an existing account key, such as one from an exported [key file](./keys.md) decrypted by the client, for the server to sign with. Nothing is published on import, so the account's existing profile and content are untouched.

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

Republishes the server-side account's profile blob with the new display name and updates redacted metadata. <!-- id:98qmb3HA -->

## `DeleteSigningIdentity` <!-- id:mxoQln1X -->

Request: <!-- id:cIsPq69D -->

```ts <!-- id:7q7MhJyA -->
{
  _: 'DeleteSigningIdentity'
  name: string
}
```

Deletes the encrypted server-side account key secret for the signed account. Published profile blobs are append-only and stay in HM storage. <!-- id:eeDtnuRx -->

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

Encrypts and upserts a secret. The response is redacted and never includes the secret value. <!-- id:a11jn1Hr -->

# MCP servers <!-- id:9TIrOZPc -->

Account-scoped, like model providers. Full behavior is in [MCP servers](../agent/mcp.md). <!-- id:cAwoDOo7 -->

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

`SetMcpServer` validates the name (slug), URL (`http`/`https`), transport, and header maps (valid header names, at most 16 each, values ≤ 4 KiB), saves, then connects to discover the server's tools. The response reports `status` and `tools` either way, and a failed discovery still saves. `RefreshMcpServer` discovers again. `DeleteMcpServer` deletes the record and the `mcp-<name>-…` secrets it owns, removes the name from every agent's `definition.mcpServers`, and drops their projected `mcp` [tool documents](../agent/tool-document.md). Writes emit `account-change` with reason `mcp-servers-changed`, plus `agent-tools-changed` per re-projected agent. <!-- id:0FW3wrCT -->

# Delegated signers

## `RegisterSigner`

```ts
{_: 'RegisterSigner'; capability: Uint8Array} // DAG-CBOR bytes of a signed Capability blob
  → {_: 'RegisterSignerResponse'; accountId: string; signerId: string}
```

Registers the envelope's signer as a delegated signer for the account that issued the [capability](../capability.md). It is accepted for older clients. A current client sends the delegation in every [envelope](./signed-api.md#signed-envelope) as `capability` and `capabilityBlob`, and registers nothing.

# See also

- [Signed API](./signed-api.md)
- [Agents](./signed-api-agents.md)
- [Model providers](../agent/model-providers.md)
- [MCP servers](../agent/mcp.md)
- [Keys](./keys.md)
