# Signed API

The Agents HTTP API is a signed, DAG-CBOR encoded action API. Canonical protocol types live in
`agents/protocol/src/index.ts` and are re-exported from `agents/src/api.ts`; dispatch lives in
`agents/src/api-service.ts`; HTTP routing lives in `agents/src/main.ts`.

## Endpoint

```text
POST /api/message
Content-Type: application/cbor
Accept: application/cbor
```

Equivalent prefixed endpoint:

```text
POST /agents/api/message
```

Responses are DAG-CBOR encoded `AgentResponse` values.

## Signed envelope

```ts
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

Server validation:

1. envelope shape and `type`;
2. principal/signature byte shapes;
3. signed action timestamp is within 30 seconds of server local time;
4. Ed25519 signature through `@shm/shared/blobs.verify()`;
5. signer is account or locally authorized for account;
6. action is valid for the transport.

Implementation:

- `agents/src/auth.ts` — shape/signature/authorization.
- `agents/src/api-service.ts` — action dispatch and ownership checks.
- `frontend/apps/desktop/src/agents-client.ts` — daemon-backed desktop signing.

## Signing caveat: omit undefined

DAG-CBOR helpers encode `undefined` as `null` in some paths. If a desktop action is signed while containing explicit
`undefined`, then decoded on the server as `null`, signature verification fails.

Desktop now calls `omitUndefined()` before signing in `signAgentAction()`, adds `ts: Date.now()` to the signed action,
and also avoids constructing `Subscribe` with `afterSeq: undefined`.

Future agents must preserve this rule: **never sign action objects containing explicit `undefined` fields.**

## Actions

Current `AgentAction` union:

- `ListAgents`
- `CreateAgent`
- `ListModelProviders`
- `ListProviderModels`
- `ListSigningIdentities`
- `CreateSigningIdentity`
- `UpdateSigningIdentity`
- `DeleteSigningIdentity`
- `SetModelProvider`
- `SetSecret`
- `GetAgent`
- `UpdateAgent`
- `DeleteAgent`
- `ListAgentTriggers`
- `GetAgentTrigger`
- `CreateAgentTrigger`
- `UpdateAgentTrigger`
- `DeleteAgentTrigger`
- `CreateSession`
- `UpdateSession`
- `DeleteSession`
- `GetSession`
- `MessageSession`
- `StopSession`
- `Subscribe`

`Subscribe` is signed with the same envelope type but is accepted over WebSocket, not HTTP.

## Responses

Success responses are action-specific. Errors use:

```ts
type ErrorResponse = {
  _: 'Error'
  message: string
}
```

HTTP status is set on expected API errors. Unexpected errors are logged and returned as `500` with a generic message.

## Action reference

### `ListAgents`

Request:

```ts
{
  _: 'ListAgents'
}
```

Response:

```ts
{_: 'ListAgentsResponse'; agents: AgentInfo[]}
```

Lists agents for the verified account, ordered by update time descending.

### `CreateAgent`

Request:

```ts
{
  _: 'CreateAgent'
  definition: AgentDefinition
  clientRequestId?: string
}
```

Creates a new agent. Validates referenced provider exists for the account. Creates a per-agent state directory.

Idempotent when `clientRequestId` is supplied.

### `ListModelProviders`

Request:

```ts
{
  _: 'ListModelProviders'
}
```

Response:

```ts
{_: 'ListModelProvidersResponse'; providers: RedactedModelProvider[]}
```

Returns provider metadata only; config and secret refs are redacted.

### `ListProviderModels`

Request:

```ts
{
  _: 'ListProviderModels'
  provider: string
}
```

Response:

```ts
{
  _: 'ListProviderModelsResponse'
  models: Array<{id: string; name: string}>
}
```

Looks up one configured provider for the verified account, decrypts its referenced API key in memory, and calls the
provider's model-list endpoint. Plain secrets and provider config are not returned.

### `ListSigningIdentities`

Request:

```ts
{
  _: 'ListSigningIdentities'
}
```

Response:

```ts
{_: 'ListSigningIdentitiesResponse'; identities: SigningIdentity[]}
```

Lists account-scoped secrets whose metadata has `kind: 'hm-account-key'`. Plain secret material is never returned, and
only keys uploaded by the signed account are visible.

### `CreateSigningIdentity`

Request:

```ts
{
  _: 'CreateSigningIdentity'
  label?: string
  clientRequestId?: string
}
```

Response:

```ts
{
  _: 'CreateSigningIdentityResponse'
  identity: SigningIdentity
}
```

Generates a new server-side Ed25519 HM account key, publishes a profile blob with the supplied label to the configured
HM server, encrypts the raw seed as an account-scoped secret tagged `kind: 'hm-account-key'`, and returns redacted
identity metadata. `clientRequestId` makes repeated creates idempotent.

### `UpdateSigningIdentity`

Request:

```ts
{
  _: 'UpdateSigningIdentity'
  name: string
  label: string
}
```

Republishes the server-side account's profile blob with the new display name and updates redacted metadata.

### `DeleteSigningIdentity`

Request:

```ts
{
  _: 'DeleteSigningIdentity'
  name: string
}
```

Deletes the encrypted server-side account key secret for the signed account. Published profile blobs are append-only and
are not deleted from HM storage.

### `SetModelProvider`

Request:

```ts
{
  _: 'SetModelProvider'
  name: string
  provider: ModelProviderConfig
}
```

Upserts provider config by account/name.

### `SetSecret`

Request:

```ts
{
  _: 'SetSecret'
  name: string
  value: Uint8Array
  metadata?: Record<string, unknown>
}
```

Encrypts and upserts a secret. Response is redacted and never includes the secret value.

### `GetAgent`

Request:

```ts
{
  _: 'GetAgent'
  agentId: string
}
```

Response:

```ts
{_: 'GetAgentResponse'; agent: AgentInfo; sessions: SessionInfo[]}
```

Requires the agent to belong to the verified account.

### `UpdateAgent`

Request:

```ts
{
  _: 'UpdateAgent'
  agentId: string
  definition: AgentDefinition
}
```

Updates definition after validating account ownership and provider existence.

### `DeleteAgent`

Request:

```ts
{
  _: 'DeleteAgent'
  agentId: string
}
```

Response:

```ts
{
  _: 'DeleteAgentResponse'
  agentId: string
}
```

Deletes the agent after validating ownership, including its triggers, sessions, session events, trigger firings, drafts,
and per-agent state directory.

### Agent trigger actions

The trigger API supports signed CRUD for agent-scoped triggers. HM activity triggers are processed by the ActivityFeed
monitor, and schedule triggers are processed by the schedule monitor.

Trigger source shape:

```ts
type AgentTriggerSource =
  | {type: 'document-comment'; resource: string; author?: string}
  | {type: 'user-mention'; mentionedAccount: string; resourcePrefix?: string}
  | {type: 'site-update'; resourcePrefix: string; eventTypes?: string[]}
  | {type: 'schedule'; schedule: AgentScheduleTrigger}

type AgentScheduleTrigger =
  | {kind: 'interval'; every: number; unit: 'minutes' | 'hours'}
  | {kind: 'weekly'; daysOfWeek: number[]; timeOfDay: string; timezone: string}
  | {kind: 'once'; runAt: number; timezone?: string}

type AgentTriggerInput = {
  name: string
  enabled?: boolean
  source: AgentTriggerSource
  prompt: string | AgentPromptBlock[]
  cooldownMs?: number
}
```

Trigger prompts accept the same rich Seed block format as agent system prompts. Legacy string input is parsed as
markdown; trigger prompt blocks are converted to resolved markdown before starting the triggered session.

`cooldownMs` is optional. When present, matching activity is skipped while the trigger is still inside its cooldown
window after the last successful firing.

Actions:

- `ListAgentTriggers {agentId}` returns `{_: 'ListAgentTriggersResponse'; triggers: AgentTriggerInfo[]}`.
- `GetAgentTrigger {triggerId}` returns
  `{_: 'GetAgentTriggerResponse'; trigger: AgentTriggerInfo; sessions: SessionInfo[]}`.
- `CreateAgentTrigger {agentId, trigger, clientRequestId?}` returns `{_: 'CreateAgentTriggerResponse'; trigger}`.
- `UpdateAgentTrigger {triggerId, patch}` returns `{_: 'UpdateAgentTriggerResponse'; trigger}`.
- `DeleteAgentTrigger {triggerId}` returns `{_: 'DeleteAgentTriggerResponse'; triggerId}`.

All trigger actions verify account ownership through the owning agent/trigger rows. `CreateAgentTrigger` supports the
same `clientRequestId` idempotency pattern as other create actions.

### `CreateSession`

Request:

```ts
{
  _: 'CreateSession'
  agentId: string
  title?: string
  clientRequestId?: string
}
```

Creates an `idle` session for an account-owned agent.

Idempotent when `clientRequestId` is supplied.

### `UpdateSession`

Request:

```ts
{
  _: 'UpdateSession'
  sessionId: string
  title: string
}
```

Updates editable session metadata for an account-owned session. The server trims and bounds the title, marks the title
as user-authored, updates `updatedAt`, emits `session-change`, and fans out an account change with reason
`session-updated`. User-authored titles are not overwritten by the agent's hidden `set_session_title` runtime tool.

Response:

```ts
{
  _: 'UpdateSessionResponse'
  session: SessionInfo
}
```

### `DeleteSession`

Request:

```ts
{
  _: 'DeleteSession'
  sessionId: string
}
```

Deletes an account-owned session and its durable events. If the session was created by a trigger firing, the firing row
is retained but detached from the deleted session. The server emits an account change with reason `session-deleted`.

Response:

```ts
{
  _: 'DeleteSessionResponse'
  sessionId: string
  agentId: string
}
```

### `GetSession`

Request:

```ts
{
  _: 'GetSession'
  sessionId: string
  afterSeq?: number
}
```

Returns session metadata, durable events with `seq > afterSeq` if provided, and `systemPromptMarkdown`, the current
markdown system prompt that would be used to continue the session.

### `MessageSession`

Request:

```ts
{
  _: 'MessageSession'
  sessionId: string
  content: Array<{type: 'text'; text: string; blocks?: AgentMessageBlock[]}>
  clientMessageId?: string
}
```

Flow:

1. verify session belongs to account;
2. reject if session is already `streaming`;
3. append durable user message with `content`/`rawMarkdown` set to the model-facing markdown and optional `blocks`
   preserved for rich UI replay;
4. set session `streaming`;
5. run model loop;
6. emit live partials over WebSocket;
7. append tool events and final assistant/error event;
8. set session `idle` or `error`.

Idempotent through `clientMessageId`, but intentionally avoids one long SQLite transaction around network calls.

### `StopSession`

Request:

```ts
{
  _: 'StopSession'
  sessionId: string
}
```

Response:

```ts
{
  _: 'StopSessionResponse'
  sessionId: string
  stopped: boolean
}
```

Stops the in-flight Pi agent turn for the signed account/session when one is active. `stopped` is `false` when the
session is already idle.

### `Subscribe`

Request:

```ts
{
  _: 'Subscribe'
  key: `account/${string}` | `agents/${string}` | `sessions/${string}`
  afterSeq?: number
}
```

Used over `/agents/ws`. See [WebSocket subscriptions](./websocket-subscriptions.md).

## Idempotency

Idempotency rows store:

- account ID;
- action name;
- client request/message ID;
- request CBOR bytes;
- response CBOR bytes;
- creation timestamp.

Same ID and same request bytes replay the response. Same ID with different request bytes returns `409`.

## Agent definition

```ts
type AgentDefinition = {
  name: string
  systemPrompt: string | AgentPromptBlock[]
  modelProvider: string
  model: string
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

`systemPrompt` is normalized to Seed block nodes on create/update; legacy string input is parsed as markdown first.
Before a model run, the server converts the stored blocks back to markdown and appends dynamic runtime instructions.

`tools` controls Seed-approved tool exposure. Existing agents with `tools` omitted receive the legacy default `read`;
agents with an explicit empty array receive no Seed tools. `signingKeys` stores the selected uploaded HM account key
secret names for signing/publishing tools; `signingKey` is retained as a legacy single-key field. When an agent runs,
selected keys are appended to the system prompt with both profile names and public key IDs so the model can map
user-facing names to signing IDs. Pi default coding tools are disabled by the Seed runner.

## Protocol sync

Desktop and server now consume the same private package, `@seed-hypermedia/agents-protocol`, instead of maintaining
manual protocol mirrors. Change protocol action, response, session-event, or WebSocket-event types in
`agents/protocol/src/index.ts`; `agents/src/api.ts` re-exports those types for service-local imports, and
`frontend/apps/desktop/src/agents-client.ts` aliases them for desktop callers.

When changing the protocol package, update service dispatch, desktop behavior, and docs in the same change.
