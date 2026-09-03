---
name: Signed API
summary: The Agents HTTP API is a signed, DAG-CBOR encoded action API. Canonical protocol types live in agents/protocol/src/index.ts and are re-exported from…
---
The Agents HTTP API is a signed, DAG-CBOR encoded action API. Canonical protocol types live in `agents/protocol/src/index.ts` and are re-exported from `agents/src/api.ts`; dispatch lives in `agents/src/api-service.ts`; HTTP routing lives in `agents/src/main.ts`. <!-- id:g-EvU-a4 -->

# Endpoint <!-- id:pbaO7izF -->

```text <!-- id:O0-qNjbh -->
POST /api/message
Content-Type: application/cbor
Accept: application/cbor
```

Equivalent prefixed endpoint: <!-- id:YXgAPHd9 -->

```text <!-- id:-XPoSzZ6 -->
POST /agents/api/message
```

Responses are DAG-CBOR encoded `AgentResponse` values. <!-- id:bhXf9yiI -->

# Signed envelope <!-- id:gGou4ap_ -->

```ts <!-- id:16U7fDXM -->
type SignedActionEnvelope = {
  type: 'AgentsAction'
  signer: blobs.Principal
  sig: blobs.Signature
  account: blobs.Principal
  action: AgentAction
}

type AgentAction = UnsignedAgentAction & {
  ts: number // Unix epoch milliseconds
}
```

Server validation: <!-- id:8LJhY3ZT -->
  1. envelope shape and `type`; <!-- id:75XviWi8 -->
  2. principal/signature byte shapes; <!-- id:_v8P7UA3 -->
  3. signed action timestamp is within 30 seconds of server local time; <!-- id:Zr6E8UHr -->
  4. Ed25519 signature through `@shm/shared/blobs.verify()`; <!-- id:qOVjsEhi -->
  5. signer is account or locally authorized for account; <!-- id:84U_5iGK -->
  6. action is valid for the transport. <!-- id:1BkfRowE -->

Implementation: <!-- id:siTzEryg -->
  - `agents/src/auth.ts` — shape/signature/authorization. <!-- id:ifLx8GI- -->
  - `agents/src/api-service.ts` — action dispatch and ownership checks. <!-- id:KxS_yJfG -->
  - `frontend/apps/desktop/src/agents-client.ts` — daemon-backed desktop signing. <!-- id:XxzGLFqk -->

# Signing caveat: omit undefined <!-- id:asgFXeqf -->

DAG-CBOR helpers encode `undefined` as `null` in some paths. If a desktop action is signed while containing explicit `undefined`, then decoded on the server as `null`, signature verification fails. <!-- id:9Eyp-Nvg -->

Desktop now calls `omitUndefined()` before signing in `signAgentAction()`, adds `ts: Date.now()` to the signed action, and also avoids constructing `Subscribe` with `afterSeq: undefined`. <!-- id:umh1jteT -->

Future agents must preserve this rule: **never sign action objects containing explicit `undefined` fields.** <!-- id:aacusbfo -->

# Actions <!-- id:vqBlDC63 -->

Current `AgentAction` union (`UnsignedAgentAction` in `agents/protocol/src/index.ts`, dispatched by the switch in `Service.message()`): <!-- id:dUWGdW72 -->
  - `ListAgents` <!-- id:qai6nbcf -->
  - `ListAgentInvites` <!-- id:uUf6bK4N -->
  - `ListAgentCollaborators` <!-- id:aoMnBkFu -->
  - `InviteAgentCollaborator` <!-- id:7KbjFgC4 -->
  - `RemoveAgentCollaborator` <!-- id:1l-4R3WJ -->
  - `SetAgentPublicRead` <!-- id:TnoUEgh3 -->
  - `SetAgentPublicChat` <!-- id:OIbNGuwr -->
  - `AcceptAgentInvite` <!-- id:fExqoDNH -->
  - `DeclineAgentInvite` <!-- id:LV3pDWa2 -->
  - `CreateAgent` <!-- id:nhBHYrI4 -->
  - `ListModelProviders` <!-- id:e5KU5XA1 -->
  - `ListProviderModels` <!-- id:oPLPzwN6 -->
  - `ListSigningIdentities` <!-- id:yyZ8FPaw -->
  - `CreateSigningIdentity` <!-- id:6Ca13BQP -->
  - `UpdateSigningIdentity` <!-- id:zyhMULnQ -->
  - `DeleteSigningIdentity` <!-- id:RBO5xQtN -->
  - `SetModelProvider` <!-- id:28sE8sjF -->
  - `DeleteModelProvider` <!-- id:_D_OXZks -->
  - `StartProviderOAuth` <!-- id:16BlkH2W -->
  - `SubmitProviderOAuthCode` <!-- id:vR34qrpZ -->
  - `GetProviderOAuthStatus` <!-- id:Qjiiyb0h -->
  - `CancelProviderOAuth` <!-- id:liu6iRv_ -->
  - `SetSecret` <!-- id:NI0hTFIg -->
  - `GetAgent` <!-- id:Hud0FKeJ -->
  - `UpdateAgent` <!-- id:vAg-7_PX -->
  - `DeleteAgent` <!-- id:qwa__7uq -->
  - `ListAgentTriggers` <!-- id:qe0-cmSS -->
  - `GetAgentTrigger` <!-- id:O-x1lh8M -->
  - `CreateAgentTrigger` <!-- id:e-DLTg3i -->
  - `UpdateAgentTrigger` <!-- id:hkAMZHcp -->
  - `DeleteAgentTrigger` <!-- id:DRLpAMii -->
  - `ListAgentMemory` <!-- id:6JNPVeDk -->
  - `ListAgentTools` <!-- id:CdHDZq2J -->
  - `ReadAgentMemoryFile` <!-- id:zURG_ATO -->
  - `WriteAgentMemoryFile` <!-- id:vrAHyHX- -->
  - `DeleteAgentMemoryFile` <!-- id:XQ3Loys4 -->
  - `DownloadAgentMemoryFile` <!-- id:dGbWnbgT -->
  - `UploadAgentMemoryFileToIpfs` <!-- id:0KjvEkNW -->
  - `CreateSession` <!-- id:ghDivIqB -->
  - `ListSessions` <!-- id:wqbz7SSl -->
  - `UpdateSession` <!-- id:AhCWr-hY -->
  - `DeleteSession` <!-- id:vyqpa9m8 -->
  - `GetSession` <!-- id:iszDQeOJ -->
  - `MessageSession` <!-- id:PPkdIoCy -->
  - `InvokeSessionTool` <!-- id:-HEDVrWa -->
  - `UploadSessionAttachment` <!-- id:sYDub4m5 -->
  - `ReadSessionAttachment` <!-- id:vAnzWTse -->
  - `BeginFileUpload` <!-- id:F-et46Of -->
  - `AppendFileUploadChunk` <!-- id:1PMeyTgJ -->
  - `CommitFileUpload` <!-- id:iyG3O11o -->
  - `AbortFileUpload` <!-- id:s1aiqGA3 -->
  - `StopSession` <!-- id:7YJCyIiT -->
  - `RetrySession` <!-- id:M85Z0OM4 -->
  - `GetRun` <!-- id:I2ze8Rjh -->
  - `ListRuns` <!-- id:_7C2SvjZ -->
  - `CancelRun` <!-- id:mOHPJyDL -->
  - `SignalRun` <!-- id:sCjxR51y -->
  - `GetRunJournal` <!-- id:HiFMha8M -->
  - `Subscribe` <!-- id:TdtlS4WK -->

`Subscribe` is signed with the same envelope type but is accepted over WebSocket, not HTTP. <!-- id:LcvSE3aX -->

# Responses <!-- id:P0ID1IyU -->

Success responses are action-specific. Errors use: <!-- id:KFAyl_Mc -->

```ts <!-- id:ieerbWxp -->
type ErrorResponse = {
  _: 'Error'
  message: string
}
```

HTTP status is set on expected API errors. Unexpected errors are logged and returned as `500` with a generic message. <!-- id:pwrb18VG -->

# Action reference <!-- id:TvquiIFE -->

## `ListAgents` <!-- id:DL_rh9m0 -->

Request: <!-- id:ymfi0Cqj -->

```ts <!-- id:TVO-m3cV -->
{
  _: 'ListAgents'
}
```

Response: <!-- id:7zadqKbL -->

```ts <!-- id:aBQ1mm29 -->
{_: 'ListAgentsResponse'; agents: AgentInfo[]}
```

Lists agents owned by the verified account plus agents on which it is an accepted reader or writer, ordered by update time descending. Each `AgentInfo.accessRole` is `owner`, `reader`, or `writer` (an agent read through public access reports `reader`, or `chatter` when public chat is on); pending invitations are deliberately not returned here. <!-- id:f9TOEq_f -->

## Agent invitations and collaborators <!-- id:XeJ06-b- -->

<!-- id:uP1RBPH- -->
- `ListAgentInvites {}` returns pending `AgentInviteInfo` rows for the signed account. An invite discloses only the agent id/name, owner account, role, and timestamps; agent contents remain unavailable until acceptance. <!-- id:QXdXZAig -->
- `ListAgentCollaborators {agentId}` returns the owner and accepted members plus the agent's `publicRead` and `publicChat` flags. The owner also sees pending invitations. <!-- id:Y3SsfCzn -->
- `InviteAgentCollaborator {agentId, accountId, role}` creates an invitation (`reader` or `writer`) or updates an existing member's role. Owner-only. <!-- id:3S5ypQUs -->
- `RemoveAgentCollaborator {agentId, accountId}` revokes an accepted member or cancels a pending invitation. Owner-only. <!-- id:AFxP1gCb -->
- `AcceptAgentInvite {agentId}` accepts the signed account's pending invitation and returns the now-accessible agent. <!-- id:hwpaVx_z -->
- `DeclineAgentInvite {agentId}` deletes the signed account's pending invitation. <!-- id:y1o0tauS -->
- `SetAgentPublicRead {agentId, publicRead}` turns public read access on or off. Owner-only. While on, every signed account that knows the agent id is treated as a `reader` (the same view an invited reader gets, including live subscriptions); the agent is still never returned from `ListAgents` or account-wide `ListSessions` for accounts that are not owner or collaborator. `AgentInfo.publicRead` reports the flag. Turning it off also clears `publicChat`. <!-- id:elsEgXJK -->
- `SetAgentPublicChat {agentId, publicChat}` turns public chat on or off. Owner-only, and enabling requires `publicRead` to already be on (400 otherwise). While on, every signed account that reads the agent publicly is a `chatter`: it may `CreateSession`, `MessageSession`, `UploadSessionAttachment` (and the chunked-upload actions targeting a session), `StopSession`, and `RetrySession` on any of the agent's sessions. It still cannot do anything writer-level — `UpdateAgent`, memory/tool/trigger writes, `UpdateSession`, `DeleteSession`, `InvokeSessionTool`, `CancelRun`, `SignalRun`. `AgentInfo.publicChat` reports the flag. This is deliberately narrower than inviting a `writer`: public chat lets the world talk to the agent, not reshape it. <!-- id:K_uUcnRP -->

Readers can inspect all agent-scoped state. Chatters (public chat only; not an invitable role) can additionally create, message, and stop sessions. Writers can additionally create/update/delete agent-scoped resources, rename/delete sessions, control runs, and run session tools. Managing collaborators and deleting the agent remain owner-only. Account-scoped provider and secret mutations are never inherited from an agent collaboration; agent settings may list the owner's redacted providers/signing identities through optional `agentId` fields. <!-- id:eZPO0wwz -->

## `CreateAgent` <!-- id:DeLxhuvH -->

Request: <!-- id:JSY487AM -->

```ts <!-- id:DECcpfSS -->
{
  _: 'CreateAgent'
  definition: AgentDefinition
  clientRequestId?: string
}
```

Creates a new agent. Validates referenced provider exists for the account. Creates a per-agent state directory. <!-- id:UpqB-RM_ -->

When the definition's primary `signingKey` resolves to an `hm-account-key` secret, the server also auto-creates a default enabled `user-mention` trigger that follows that signing identity's account uid (prompt: "Respond to the mention, performing the action requested."), so mentioning the agent's account starts a session in which it responds. This is best-effort and never blocks agent creation; agents without a signing key get no default trigger. <!-- id:wKRI3r0c -->

Idempotent when `clientRequestId` is supplied. <!-- id:jGg7N_6g -->

## `ListModelProviders` <!-- id:wkEnoSTE -->

Request: <!-- id:K1behmhG -->

```ts <!-- id:3_dA5ja1 -->
{
  _: 'ListModelProviders'
}
```

Response: <!-- id:HTXe1l6f -->

```ts <!-- id:gbJ6VNOc -->
{_: 'ListModelProvidersResponse'; providers: RedactedModelProvider[]}
```

Returns provider metadata only; config and secret refs are redacted. <!-- id:4mUUWwCY -->

## `ListProviderModels` <!-- id:rPu2xgdM -->

Request: <!-- id:j_1euAtv -->

```ts <!-- id:CBaFMJfW -->
{
  _: 'ListProviderModels'
  provider: string
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

Lists account-scoped secrets whose metadata has `kind: 'hm-account-key'`. Plain secret material is never returned, and only keys uploaded by the signed account are visible. With `agentId`, the request resolves against the owning account of a shared agent: the owner sees every identity, while collaborators (reader or writer) only see the identities granted to that agent — the owner's other keys are private to the owner. Changing the granted set itself (`definition.signingKeys` via `UpdateAgent`) is owner-only; a writer's `UpdateAgent` must carry the grant set unchanged or it is rejected with 403. <!-- id:sYhgHgVm -->

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

Generates a new server-side Ed25519 HM account key, publishes a profile blob with the supplied label to the configured HM server, encrypts the raw seed as an account-scoped secret tagged `kind: 'hm-account-key'`, and returns redacted identity metadata. `clientRequestId` makes repeated creates idempotent. <!-- id:AatBGOjy -->

## `UpdateSigningIdentity` <!-- id:bEHd5bWz -->

Request: <!-- id:ZxY_xq3E -->

```ts <!-- id:2eXaCYdF -->
{
  _: 'UpdateSigningIdentity'
  name: string
  label: string
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

Deletes the encrypted server-side account key secret for the signed account. Published profile blobs are append-only and are not deleted from HM storage. <!-- id:eeDtnuRx -->

## `SetModelProvider` <!-- id:0TGt9T6- -->

Request: <!-- id:RoGVrVA9 -->

```ts <!-- id:tOau06pk -->
{
  _: 'SetModelProvider'
  name: string
  provider: ModelProviderConfig
}
```

Upserts provider config by account/name. `ModelProviderConfig.authMode` selects how requests authenticate: `api-key` (default, uses the `secretRefs.apiKey` secret) or `subscription` (uses OAuth credentials in the `secretRefs.oauth` secret). <!-- id:EZ-N0L0Z -->

## `DeleteModelProvider` <!-- id:PntVgf2e -->

Request: <!-- id:DI0OZhn9 -->

```ts <!-- id:6WQ2zw1I -->
{
  _: 'DeleteModelProvider'
  name: string
}
```

Deletes the named provider record for the account, plus every secret it referenced that no remaining provider still references — subscription providers of the same type share one OAuth secret, so a shared credential survives the deletion of one of its providers. 404 when the account has no provider by that name. Response: `{_: 'DeleteModelProviderResponse'; name}`. <!-- id:HIzrYLKy -->

## Provider OAuth actions ("Sign in with ChatGPT") <!-- id:zc68Rblr -->

Subscription-authenticated providers are configured through a four-action login flow instead of a pasted API key. It is offered only when the server runs with `SEED_AGENTS_SUBSCRIPTION_AUTH` enabled (surfaced as `subscriptionAuth` on `/api/health`); `StartProviderOAuth` returns `403` otherwise. Implementation lives in `agents/src/provider-oauth.ts`. <!-- id:EoQaHbog -->
  - `StartProviderOAuth {providerType}` → `{_: 'StartProviderOAuthResponse'; loginId; authUrl; expiresAt}`. Only `openai` is supported. Starting a new login cancels the account's previous pending one. <!-- id:GezKgzV8 -->
  - `GetProviderOAuthStatus {loginId}` → `{_: 'ProviderOAuthStatusResponse'; loginId; status: 'pending' | 'completed' | 'failed'; secretName?; error?}`. On `completed`, `secretName` is the stored credentials secret to reference as `secretRefs.oauth`. <!-- id:vPtRT8RQ -->
  - `SubmitProviderOAuthCode {loginId, code}` → `{_: 'SubmitProviderOAuthCodeResponse'}`. For deployments where the provider's localhost redirect cannot reach the server, the client pastes the code (or the full redirect URL). <!-- id:sewo852w -->
  - `CancelProviderOAuth {loginId}` → `{_: 'CancelProviderOAuthResponse'; loginId}`. <!-- id:htdvnbmn -->

`RedactedModelProvider.authStatus` reports subscription health afterwards: `ok`, or `needs-login` when credentials are missing or a token refresh failed. <!-- id:TmFl9mQ7 -->

## MCP server actions <!-- id:9TIrOZPc -->

Account-scoped, like model providers. Full behavior in [`mcp.md`](./agent-mcp.md). <!-- id:cAwoDOo7 -->

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

`SetMcpServer` validates the name (slug), URL (`http`/`https`), transport, and header maps (valid header names, at most 16 each, values ≤ 4 KiB), saves, then connects to discover the server's tools; the response reports `status` and `tools` either way — a failed discovery still saves. `RefreshMcpServer` discovers again. `DeleteMcpServer` deletes the record, the `mcp-<name>-…` secrets it owns, removes the name from every agent's `definition.mcpServers`, and drops their projected `mcp` tool documents. Writes emit `account-change` with reason `mcp-servers-changed`, plus `agent-tools-changed` per re-projected agent. <!-- id:0FW3wrCT -->

`AgentDefinition.mcpServers?: string[]` (≤ 16 names) is the per-agent grant, accepted by `CreateAgent` and `UpdateAgent`. <!-- id:O34ZBJJq -->

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

Encrypts and upserts a secret. Response is redacted and never includes the secret value. <!-- id:a11jn1Hr -->

## `GetAgent` <!-- id:c6cK3cIm -->

Request: <!-- id:naq8zR8m -->

```ts <!-- id:oAv78FUu -->
{
  _: 'GetAgent'
  agentId: string
}
```

Response: <!-- id:Kw8EAjk_ -->

```ts <!-- id:1UQ_SBPB -->
{_: 'GetAgentResponse'; agent: AgentInfo; sessions: SessionInfo[]}
```

Requires owner, reader, or writer access to the agent. <!-- id:5OveoAaK -->

## `UpdateAgent` <!-- id:YMWNoJDM -->

Request: <!-- id:6hWqBlwi -->

```ts <!-- id:hNnkEZ67 -->
{
  _: 'UpdateAgent'
  agentId: string
  definition: AgentDefinition
}
```

Updates the definition for the owner or an accepted writer after validating the owning account's provider and signing identities. <!-- id:ki1fJPuP -->

## `DeleteAgent` <!-- id:7jJan3SL -->

Request: <!-- id:q66rTKnc -->

```ts <!-- id:n95UTzDB -->
{
  _: 'DeleteAgent'
  agentId: string
}
```

Response: <!-- id:OIZXPeTZ -->

```ts <!-- id:EmRLePx2 -->
{
  _: 'DeleteAgentResponse'
  agentId: string
}
```

Deletes the agent after validating ownership, including its triggers, sessions, session events, trigger firings, drafts, and per-agent state directory. Live runs of the agent are canceled first (cascading through their trees); run history survives detached — `runs.agent_id`, `runs.session_id`, and `runs.trigger_firing_id` are nulled inside the delete transaction (they are enforced foreign keys; without the detach, any agent that had ever executed a run was undeletable), and sub-sessions of _other_ agents hanging off this agent's sessions promote to top level. <!-- id:A1zp81Vg -->

## Agent trigger actions <!-- id:WzWoLy7W -->

The trigger API supports signed CRUD for agent-scoped triggers. HM activity triggers are processed by the ActivityFeed monitor, and schedule triggers are processed by the schedule monitor. <!-- id:b6i0-Q2r -->

Trigger source shape: <!-- id:3XyV0fxQ -->

```ts <!-- id:SqGO3ixi -->
type AgentTriggerSource =
  | {type: 'document-comment'; resource: string; author?: string}
  | {type: 'user-mention'; mentionedAccounts: string[]; resourcePrefix?: string}
  | {type: 'site-update'; resourcePrefix: string; eventTypes?: string[]}
  | {type: 'schedule'; schedule: AgentScheduleTrigger}
  | {
      type: 'run-completed'
      agentId?: string
      status?: 'succeeded' | 'failed' | 'canceled'
      titleMatch?: string
    }

type AgentScheduleTrigger =
  | {kind: 'interval'; every: number; unit: 'minutes' | 'hours'}
  | {kind: 'weekly'; daysOfWeek: number[]; timeOfDay: string; timezone: string}
  | {kind: 'once'; runAt: number; timezone?: string}

type TriggerContinuation = {kind: 'newThread'} | {kind: 'wake'; signal: string; runId?: string; payload?: unknown}

type AgentTriggerInput = {
  name: string
  enabled?: boolean
  source: AgentTriggerSource
  prompt: string | AgentPromptBlock[]
  continuation?: TriggerContinuation
}
```

Trigger prompts accept the same rich Seed block format as agent system prompts. Legacy string input is parsed as markdown; trigger prompt blocks are converted to resolved markdown before starting the triggered session. <!-- id:_BARyrTk -->

A `user-mention` source watches a list of accounts; a legacy singular `mentionedAccount` on input is still normalized into `mentionedAccounts`, and an empty list is rejected. <!-- id:DEsKZQQU -->

`continuation` says what a firing _does_. Omitted (or `newThread`) starts a fresh thread from the trigger's prompt — what every trigger did before continuations existed. `wake` delivers a signal to a run parked on `ctx.waitForEvent` instead, riding the same delivery path as `SignalRun`; without `runId` the account's parked runs are searched for one the signal satisfies. <!-- id:htPFS_iB -->

`run-completed` is the source that lets automations chain: it fires when a run of this account reaches a terminal status. Chains are loop-guarded — a firing whose ancestry already contains the same trigger within 8 hops is skipped (`TRIGGER_CHAIN_MAX_HOPS` in `api-service.ts`). <!-- id:yhR4cigG -->

The `agent_triggers` table carries a `cooldown_ms` column, but no protocol field writes it and no monitor reads it. It is vestigial; do not document a cooldown feature until one exists. <!-- id:joDAplYR -->

Actions: <!-- id:bwunosHW -->
  - `ListAgentTriggers {agentId}` returns `{_: 'ListAgentTriggersResponse'; triggers: AgentTriggerInfo[]}`. <!-- id:bXFKEmdY -->
  - `GetAgentTrigger {triggerId}` returns `{_: 'GetAgentTriggerResponse'; trigger: AgentTriggerInfo; sessions: SessionInfo[]}`. <!-- id:zek5I_eN -->
  - `CreateAgentTrigger {agentId, trigger, clientRequestId?}` returns `{_: 'CreateAgentTriggerResponse'; trigger}`. <!-- id:0u89fDzQ -->
  - `UpdateAgentTrigger {triggerId, patch}` returns `{_: 'UpdateAgentTriggerResponse'; trigger}`. <!-- id:GD1HRkZ9 -->
  - `DeleteAgentTrigger {triggerId}` returns `{_: 'DeleteAgentTriggerResponse'; triggerId}`. <!-- id:6K2fNfnq -->

All trigger actions verify account ownership through the owning agent/trigger rows. `CreateAgentTrigger` supports the same `clientRequestId` idempotency pattern as other create actions. <!-- id:GOO4iIKu -->

## Agent memory actions <!-- id:sl55O0AI -->

Each agent owns a private memory filesystem at `<stateDir>/memory` — the `~/memory/` half of its Space, reached by the agent through the `read` and `write` verbs and shown to its owner on the desktop Memory tab. All actions validate agent ownership for the signed account, and every path is a sandboxed relative path (no absolute paths, no `..`, symlinks refused). Files can be UTF-8 text or binary. <!-- id:F4plBjdL -->

```ts <!-- id:igtkULLY -->
type AgentMemoryEntry = {path: string; type: 'file' | 'dir'; size: number; updatedAt: number; mimeType?: string}
type AgentMemoryFile = {
  path: string
  size: number
  updatedAt: number
  mimeType?: string
  encoding: 'utf8' | 'binary'
  content?: string // present when encoding is 'utf8'
  data?: Uint8Array // present when encoding is 'binary'
}
```

Actions: <!-- id:dRAJrWd3 -->
  - `ListAgentMemory {agentId}` returns `{_: 'ListAgentMemoryResponse'; agentId; entries: AgentMemoryEntry[]; totalBytes}` with every file and directory sorted by path. <!-- id:5oZzSBlu -->
  - `ReadAgentMemoryFile {agentId, path}` returns `{_: 'ReadAgentMemoryFileResponse'; agentId; file: AgentMemoryFile}`. Small clean-UTF-8 files come back as text; everything else comes back as raw bytes for preview/download in the Memory tab. <!-- id:gcXVifoW -->
  - `WriteAgentMemoryFile {agentId, path, content}` returns `{_: 'WriteAgentMemoryFileResponse'; agentId; entry}` after writing the full file content, creating parent directories as needed. `content` may be a string (UTF-8 text) or `Uint8Array` bytes (e.g. a local file uploaded from the Memory tab). Writes, downloads, and deletes emit an `account-change` event with reason `agent-memory-changed`, which is also fanned out to `agents/<agentId>` WebSocket subscribers so open Memory tabs refresh. <!-- id:Pf3XwaO2 -->
  - `DeleteAgentMemoryFile {agentId, path}` returns `{_: 'DeleteAgentMemoryFileResponse'; agentId; path; deleted}` and removes a file, or a directory recursively; `deleted` is false when nothing existed. <!-- id:hslyEoNq -->
  - `DownloadAgentMemoryFile {agentId, url, path?}` server-side fetches a public http(s) URL into memory (streamed, with a 60-second idle timeout) and returns `{_: 'DownloadAgentMemoryFileResponse'; agentId; entry; finalUrl; contentType?}`. Omitting `path` stores the file under `downloads/` named from the URL; extension-less paths gain an extension from the response content type. <!-- id:iCJPpKHx -->
  - `UploadAgentMemoryFileToIpfs {agentId, path}` chunks the file as UnixFS and publishes its blocks through the typed HM API's `PublishBlobs` action, then returns `{_: 'UploadAgentMemoryFileToIpfsResponse'; agentId; path; cid; url; size; mimeType?}`, where `url` is the `ipfs://<cid>` URL usable from Hypermedia content. Publishing makes the file publicly retrievable. <!-- id:b7BdF2s4 -->

Path limits (`agents/src/agent-memory.ts`): 512 bytes per normalized relative path, 16 levels of nesting. Memory itself carries no per-file, per-agent, or entry-count size cap — the server accepts uploads of any size (`main.ts` raises Bun's request-body limit for exactly this). The 256 KiB `MAX_WRITE_CONTENT_BYTES` bound in `api-service.ts` applies to hypermedia content the `write` verb publishes, not to memory files. <!-- id:eXN97pf8 -->

## `ListAgentTools` <!-- id:mFvD0Lfj -->

Request: <!-- id:QWEqNeUO -->

```ts <!-- id:rbtcO2Ul -->
{
  _: 'ListAgentTools'
  agentId: string
}
```

Response: <!-- id:Z80S3kNI -->

```ts <!-- id:csRpK2JE -->
{_: 'ListAgentToolsResponse'; agentId: string; tools: AgentToolInfo[]}
```

Lists every tool document in the agent's `~/tools` — builtin bindings and authored lambdas alike — from the `tool_documents` table, materializing the builtin rows first if the registry contract has changed. This is the owner's transparency view: the same documents the agent sees when it reads `~/tools/`. <!-- id:ckP2uqGJ -->

```ts <!-- id:9UmcWORw -->
type AgentToolInfo = {
  name: string
  kind: 'builtin' | 'lambda' | 'mcp'
  server?: string // mcp: the account MCP server it is projected from
  remoteName?: string // mcp: the tool's name on that server
  summary: string // one line, for listings and the Space index
  description: string // full model-facing instructions
  input: Record<string, unknown> // JSON Schema
  output?: Record<string, unknown> // JSON Schema, when declared
  source?: string // lambda source, exactly as authored
  runtime?: 'typescript' | 'python'
  cid: string // DAG-CBOR CIDv1 of the document; changes on every edit
  enabled: boolean
  granted: boolean // builtins: whether the agent's grant set offers it. Lambdas: always true
  createdAt: number
  updatedAt: number
}
```

## `CreateSession` <!-- id:N87txKiA -->

Request: <!-- id:_jZCrYXr -->

```ts <!-- id:AHVfu61k -->
{
  _: 'CreateSession'
  agentId: string
  title?: string
  clientRequestId?: string
}
```

Creates an `idle` session for an account-owned agent. <!-- id:SmvTBbqB -->

Idempotent when `clientRequestId` is supplied. <!-- id:T5Yb-Vc0 -->

## `ListSessions` <!-- id:7NiHz9QA -->

Request: <!-- id:zPLgZqk2 -->

```ts <!-- id:keSJI_nU -->
{
  _: 'ListSessions'
  agentId?: string
  limit?: number
  cursor?: {updatedBefore: number; idBefore: string}
  parentSessionId?: string
  includeChildren?: boolean
}
```

Lists the signed account's sessions newest-first across every agent on the server, or a single agent's sessions when `agentId` is set. Response: <!-- id:ntqH1GN6 -->

```ts <!-- id:uV3Pdvxz -->
{
  _: 'ListSessionsResponse'
  sessions: SessionInfo[]
  agents: AgentInfo[]
  nextCursor?: {updatedBefore: number; idBefore: string}
}
```

`agents` contains only the agents referenced by `sessions`, so a client rendering a cross-agent session list can label each row without a follow-up `GetAgent` per session. This exists because the desktop assistant sidebar shows one merged list spanning every agent on every configured server; without it the client would have to walk `ListAgents` and then `GetAgent` per agent just to enumerate sessions. <!-- id:b1mOqhdT -->

`limit` defaults to 50 and is clamped to 200. <!-- id:l9a-a7RP -->

Pagination is keyset on the composite `(updatedAt, id)`, not on `updatedAt` alone. Sessions routinely share an `updatedAt` millisecond — one trigger firing over a batch of activity events creates several at once — and a timestamp-only cursor silently drops every tied row past a page boundary. Pass `nextCursor` back verbatim as `cursor`; its absence means the list is exhausted. <!-- id:eSwNTsbV -->

Child sessions (spawned by `delegate`, a script's `ctx.delegate`, or an agent starting a session) are **included by default**: an absent `includeChildren` returns every session, because older deployed clients cannot send the field and hiding agent-started sessions from them would be a silent regression. Lineage-aware clients (the current desktop) pass `includeChildren: false` explicitly to get top-level rows only — parents carry `childSessionCount` — and fetch children per parent with `parentSessionId` (which ignores `includeChildren`). <!-- id:oLkAiW5x -->

## `UpdateSession` <!-- id:9vin5_GJ -->

Request: <!-- id:eVAU-w3G -->

```ts <!-- id:4Qr4qC3b -->
{
  _: 'UpdateSession'
  sessionId: string
  title: string
}
```

Updates editable session metadata for an account-owned session. The server trims and bounds the title, marks the title as user-authored, updates `updatedAt`, emits `session-change`, and fans out an account change with reason `session-updated`. A title saved this way is marked `title_source = 'user'`, which the server's automatic session titling refuses to overwrite. <!-- id:1AIBMSfj -->

Response: <!-- id:erqwMMRA -->

```ts <!-- id:SxvkOfIC -->
{
  _: 'UpdateSessionResponse'
  session: SessionInfo
}
```

## `DeleteSession` <!-- id:1waSBAm- -->

Request: <!-- id:lTgSOZRY -->

```ts <!-- id:nCIlEviZ -->
{
  _: 'DeleteSession'
  sessionId: string
}
```

Deletes an account-owned session and its durable events. Every live run rooted at the session is canceled first — **including descendants** (spawned sub-sessions and workflows) — so a parked parent can never be stranded `waiting` by its session disappearing, and no executor streams into deleted rows. Run history survives detached (`runs.session_id` nulled); child sessions promote to top level (`parent_session_id` nulled); a creating trigger firing is retained but detached. The server emits an account change with reason `session-deleted`. <!-- id:9nrPnwl9 -->

Response: <!-- id:NBRFJ4zC -->

```ts <!-- id:mdtT26nF -->
{
  _: 'DeleteSessionResponse'
  sessionId: string
  agentId: string
}
```

## `GetSession` <!-- id:3MOfBWTH -->

Request: <!-- id:oHMeIP3k -->

```ts <!-- id:y3T9Vra- -->
{
  _: 'GetSession'
  sessionId: string
  afterSeq?: number
}
```

Returns session metadata, durable events with `seq > afterSeq` if provided, and `systemPromptMarkdown`, the current markdown system prompt that would be used to continue the session. <!-- id:AbyNtRFS -->

## `MessageSession` <!-- id:TKV37DpX -->

Request: <!-- id:05bA7uU0 -->

```ts <!-- id:j-_MMU73 -->
{
  _: 'MessageSession'
  sessionId: string
  content: Array<
    | {type: 'text'; text: string; blocks?: AgentMessageBlock[]}
    | {type: 'context'; lines: string[]}
    | {type: 'attachment'; id: string}
  >
  clientMessageId?: string
}
```

`context` parts carry ambient client state — the desktop sidebar sends the current window (open document, view, focused block) so "this document" resolves for the model. All context lines in a request collapse onto its first user message as `contextLines`, reach the model appended to that message inside a `<window_context>` block, and never appear in the transcript `content`. At least one `text` part is required. <!-- id:ANF-JVop -->

`attachment` parts reference files already staged with `UploadSessionAttachment` (or a committed chunked upload). They are session-private: they live with the session, the agent reaches them through `read attachment:<id>`, and they are deleted with the session. <!-- id:wmDG8nTx -->

Flow: <!-- id:yODE0MM7 -->
  1. verify the signed account has write access to the session's agent; <!-- id:hNR1Yvfr -->
  2. append the durable user message immediately, with `content`/`rawMarkdown`, optional rich `blocks`, and `meta.accountId` plus the exact cryptographic `meta.signerId` from the verified envelope; <!-- id:34Huc5Bs -->
  3. enqueue a durable run for that message; <!-- id:RvJ6zK-m -->
  4. claim it inline when no other turn owns the session, otherwise leave it queued behind the current turn; <!-- id:i6rKWsUz -->
  5. run the model loop with one model turn at a time per session; <!-- id:8J9gYKnV -->
  6. emit live partials over WebSocket; <!-- id:lKQtSEkZ -->
  7. append tool events and final assistant/error event; <!-- id:VrTZxokq -->
  8. start the next queued collaborator turn, if any. <!-- id:vtBpOjB9 -->

Multiple writers may therefore submit to one session concurrently. Their messages are saved and broadcast in append order instead of receiving `409` while the agent is streaming; model turns remain serialized. A queued turn gets an in-memory handoff identifying the exact message events that arrived during the preceding response, so later assistant events from that preceding turn are not mistaken for answers to the newly queued messages. <!-- id:B6IH4P5t -->

Internally each turn is a durable run row in the dispatch queue (`agents/src/runs.ts`). `MessageSessionResponse.assistantEventId` is an **empty string** when the request returned before a final assistant event existed: concurrent/background enqueues (including triggers and agent-started sessions) and turns that parked on children spawned with `delegate` — the rest of the turn streams over WebSocket. <!-- id:12QoX7ZX -->

Idempotent through `clientMessageId`, but intentionally avoids one long SQLite transaction around network calls. <!-- id:0xWuAdF5 -->

## `InvokeSessionTool` <!-- id:OttXxoDi -->

Request: <!-- id:CglXQoKo -->

```ts <!-- id:TSz13bD4 -->
{
  _: 'InvokeSessionTool'
  sessionId: string
  verb: 'read' | 'write' | 'call'
  input: unknown
}
```

Response: <!-- id:sySpl5Ga -->

```ts <!-- id:hB1fnM4l -->
{
  _: 'InvokeSessionToolResponse'
  sessionId: string
  resultEventId: string // durable event id of the appended tool_result
  output?: unknown
  error?: string
}
```

Runs one verb **as the user** against the session's shared log. The log is a shared workspace log, not a chat: the same `read`/`write`/`call` implementations the agent uses execute here, and both the call and its result append as durable events stamped `actor: 'user'`, so the agent reads them on its next turn as ground truth — there is no side channel. This is what the desktop composer's wrench palette sends. <!-- id:FYxYqayk -->

Only those three verbs are accepted. `delegate` and `plan` are deliberately not user-invocable — delegation is a conversational ask, and any path that reaches session-spawning from a user verb rejects with "Delegation is a conversational ask; message the agent instead". <!-- id:LgrMffAe -->

Execution failures are themselves log entries — the user's failed attempt is context too — and come back in `error` rather than as an HTTP error. Only pre-execution problems reject the request outright: an unknown verb (400), an unowned session (404), and a session with a live run (409, "The agent is working in this thread right now"). <!-- id:0cIP9m_n -->

## Session attachments and chunked uploads <!-- id:2JNT-ocN -->

<!-- id:yaivXodZ -->
- `UploadSessionAttachment {sessionId, name, mimeType?, content}` → `{_: 'UploadSessionAttachmentResponse'; attachment: SessionAttachmentInfo}`. The attachment id is the SHA-256 hex of the bytes, so re-uploading the same file returns the same id. Caps: 100 MiB per attachment and 200 attachments per session (`agents/src/session-attachments.ts`), stored under `<stateDir>/session-attachments/<sessionId>/`. <!-- id:-ax7SDcO -->
- `ReadSessionAttachment {sessionId, attachmentId}` → `{_: 'ReadSessionAttachmentResponse'; attachment; data}` for rendering an attachment back in the thread. <!-- id:GDrE1qlb -->

Large files upload in bounded chunks instead, so each signed action stays small and clients can show progress: <!-- id:NWuxtcq2 -->
  - `BeginFileUpload {target, size}` → `{_: 'BeginFileUploadResponse'; uploadId; maxChunkBytes}`. `target` is `{kind: 'memory', agentId, path}` or `{kind: 'session-attachment', sessionId, name, mimeType?}`, validated up front so a long upload cannot fail at the very end. `maxChunkBytes` is 8 MiB. <!-- id:e80mVQU_ -->
  - `AppendFileUploadChunk {uploadId, offset, content}` → `{_: 'AppendFileUploadChunkResponse'; uploadId; received}`. Chunks must arrive in order: `offset` must equal the bytes already staged. Oversized chunks return `413`. <!-- id:ta2EIYUV -->
  - `CommitFileUpload {uploadId}` → `{_: 'CommitFileUploadResponse'; entry?; attachment?}` — `entry` for a memory target, `attachment` for a session attachment. The staged byte count must equal the declared `size`. <!-- id:xRZdKHtN -->
  - `AbortFileUpload {uploadId}` → `{_: 'AbortFileUploadResponse'; uploadId}`. Staged uploads also expire after an hour. <!-- id:rBJMxIwS -->

## `StopSession` <!-- id:bdR9aKBf -->

Request: <!-- id:rf66gPpx -->

```ts <!-- id:4u2Dyxwd -->
{
  _: 'StopSession'
  sessionId: string
}
```

Response: <!-- id:iUaJWmmb -->

```ts <!-- id:Rv-DmzB4 -->
{
  _: 'StopSessionResponse'
  sessionId: string
  stopped: boolean
}
```

Stops the in-flight Pi agent turn for the signed account/session when one is active, and cancels every live run rooted at the session **including descendants** (delegated model children and script children). `stopped` is `false` when the session is already idle. <!-- id:7M-SU2I2 -->

## `RetrySession` <!-- id:NFpBJSjD -->

Request: <!-- id:4zGSJo4i -->

```ts <!-- id:M7QY9xx8 -->
{
  _: 'RetrySession'
  sessionId: string
}
```

Response: <!-- id:t2CbzisF -->

```ts <!-- id:GuF6qLKn -->
{
  _: 'RetrySessionResponse'
  sessionId: string
  assistantEventId: string
}
```

Re-runs a session whose latest run failed, without appending a new user message: the turn re-enters from the durable transcript, and error events are not replayed to the provider. Rejected when a run is live or the latest run did not fail. `assistantEventId` is an empty string when the retried turn parked (the rest streams over WebSocket), exactly like `MessageSession`. <!-- id:ED1LMrQz -->

## `GetRun` <!-- id:Jj_eiypN -->

`{_: 'GetRun', runId}` → `{_: 'GetRunResponse', run: RunInfo}`. 404 when the run does not belong to the account. <!-- id:9wrExQSN -->

## `ListRuns` <!-- id:vPQfRrOv -->

```ts <!-- id:UrWMTPX_ -->
{
  _: 'ListRuns'
  rootRunId?: string // the whole tree of one root, oldest first (tree rendering)
  sessionId?: string // root runs referencing a session, newest first
  agentId?: string // runs of one agent, newest first
  status?: RunStatus
  limit?: number // default 50, clamped to 200
}
```

Exactly one selector is required. Response: `{_: 'ListRunsResponse', runs: RunInfo[]}`. <!-- id:eHggxzXS -->

## `CancelRun` <!-- id:9aUU90Sl -->

`{_: 'CancelRun', runId}` → `{_: 'CancelRunResponse', runId, canceled}`. Cancels the run and every non-terminal descendant: queued runs never start, waiting runs never wake, executing runs are aborted (Pi abort for agent runs, VM interrupt for script runs). `canceled` is `false` when everything was already terminal. <!-- id:fv9P1IT2 -->

## `SignalRun` <!-- id:mr25qIWh -->

```ts <!-- id:rM0ixYPG -->
{
  _: 'SignalRun'
  runId: string
  signal: string // a wait with no criteria accepts any name
  payload?: unknown // must be JSON-serializable
}
```

Response: `{_: 'SignalRunResponse', runId, delivered}`. <!-- id:qIWUpNgB -->

Delivers a named signal to a run parked on `ctx.waitForEvent`, waking it with the payload. This is how a person (or another system) answers a workflow waiting for something the activity feed cannot express — an approval, a webhook, a human decision; the run card's **Answer** button sends the run's `RunWaitInfo.answerWith` signal. Signalling a run that is not listening for this signal is not an error: `delivered` is simply `false`. A trigger with a `wake` continuation rides this same delivery path. <!-- id:0pKr7fmV -->

## `GetRunJournal` <!-- id:Gpszao3B -->

`{_: 'GetRunJournal', runId, afterSeq?}` → `{_: 'GetRunJournalResponse', runId, entries}` — a script (workflow) run's durable journal entries (`{runId, seq, entry, createdAt}`), empty for agent runs, replayable with `afterSeq` like session events. <!-- id:YfIYxv-k -->

## `Subscribe` <!-- id:H8dAcKct -->

Request: <!-- id:9rEtnIIc -->

```ts <!-- id:I6YTsRwb -->
{
  _: 'Subscribe'
  key: `account/${string}` | `agents/${string}` | `sessions/${string}` | `runs/${string}`
  afterSeq?: number
}
```

Used over `/agents/ws`. See [WebSocket subscriptions](./agent-websocket-subscriptions.md). <!-- id:Ibn2PhkU -->

# Idempotency <!-- id:86xaRurd -->

Idempotency rows store: <!-- id:OOJlJzY7 -->
  - account ID; <!-- id:goW-b9GO -->
  - action name; <!-- id:-a9nhdcq -->
  - client request/message ID; <!-- id:WBtePnRT -->
  - request CBOR bytes; <!-- id:CnwKXCEo -->
  - response CBOR bytes; <!-- id:nVl8nX67 -->
  - creation timestamp. <!-- id:eo-O9tll -->

Same ID and same request bytes replay the response. Same ID with different request bytes returns `409`. <!-- id:uVVixCG7 -->

# Agent definition <!-- id:MQfS-lax -->

```ts <!-- id:iQMhgrPv -->
type AgentDefinition = {
  name: string
  systemPrompt: string | AgentPromptBlock[]
  modelProvider: string
  model: string
  reasoningLevel?: ReasoningLevel
  tools?: string[]
  signingKey?: string
  signingKeys?: string[]
  metadata?: Record<string, unknown>
}

type AgentPromptBlock = {
  block: Record<string, unknown> & {id: string; type: string}
  children?: AgentPromptBlock[]
}
```

`systemPrompt` is normalized to Seed block nodes on create/update; legacy string input is parsed as markdown first. Before a model run, the server converts the stored blocks back to markdown and appends the shared runtime instructions and the agent's `<space>` index. <!-- id:lhfIMIOl -->

`reasoningLevel` applies to reasoning-capable models and must be one of the levels `modelReasoningSupport` reports for the model (`agents/protocol/src/reasoning.ts`); absent means off, or the provider default where reasoning cannot be disabled. <!-- id:MeW0UZKi -->

`tools` is a **grant list, not the tool surface**. The five verbs — `read`, `write`, `call`, `delegate`, `plan` — are always on and can never be granted or revoked; see [the glossary](./agent-glossary.md). (The one exception is structural, not a permission: `delegate` needs a run to park on, so the rare runless invocation simply omits it.) What `tools` narrows is: <!-- id:69h9HRvq -->
  - the **callable set** dispatched through `call` (today `search`, `web_search`, `execute`; `navigate` is assistant-runtime only). An omitted `tools` array grants every service-runtime callable; an explicit array keeps only the names it lists. Unknown and legacy names are ignored, and `execute_code` normalizes to `execute` (`normalizeSeedToolName`). `execute` is dropped silently on hosts that cannot run sandboxes, so the model never sees a tool that can only fail. <!-- id:zNYgtpXZ -->
  - the **publish grant**: the pseudo-tool name `publish` authorizes signed public writing (`hm://` documents and comments, IPFS uploads). Legacy write-group names (`write`, `memory_publish_document`, `ipfs_write`, `attachment_to_ipfs`) still count so a pre-verbs agent keeps the posture its owner configured, and an omitted `tools` array publishes. Memory writes are never gated. <!-- id:-GXtTNC3 -->

`signingKeys` stores the selected uploaded HM account key secret names for signing/publishing; `signingKey` is retained as a legacy single-key field. When an agent runs, selected keys are appended to the system prompt with both profile names and public key IDs so the model can map user-facing names to signing IDs. Pi's own builtin tools are disabled by the Seed runner (`noTools: 'builtin'`). <!-- id:U9fN8wVf -->

# Protocol sync <!-- id:7-eqGvuo -->

Desktop and server now consume the same private package, `@seed-hypermedia/agents-protocol`, instead of maintaining manual protocol mirrors. Change protocol action, response, session-event, or WebSocket-event types in `agents/protocol/src/index.ts`; `agents/src/api.ts` re-exports those types for service-local imports, and `frontend/apps/desktop/src/agents-client.ts` aliases them for desktop callers. <!-- id:Cn08kTEd -->

When changing the protocol package, update service dispatch, desktop behavior, and docs in the same change. <!-- id:mj-buzJQ -->
