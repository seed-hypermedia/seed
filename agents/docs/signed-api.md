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

Current `AgentAction` union (`UnsignedAgentAction` in `agents/protocol/src/index.ts`, dispatched by the switch in
`Service.message()`):

- `ListAgents`
- `ListAgentInvites`
- `ListAgentCollaborators`
- `InviteAgentCollaborator`
- `RemoveAgentCollaborator`
- `SetAgentPublicRead`
- `AcceptAgentInvite`
- `DeclineAgentInvite`
- `CreateAgent`
- `ListModelProviders`
- `ListProviderModels`
- `ListSigningIdentities`
- `CreateSigningIdentity`
- `UpdateSigningIdentity`
- `DeleteSigningIdentity`
- `SetModelProvider`
- `DeleteModelProvider`
- `StartProviderOAuth`
- `SubmitProviderOAuthCode`
- `GetProviderOAuthStatus`
- `CancelProviderOAuth`
- `SetSecret`
- `GetAgent`
- `UpdateAgent`
- `DeleteAgent`
- `ListAgentTriggers`
- `GetAgentTrigger`
- `CreateAgentTrigger`
- `UpdateAgentTrigger`
- `DeleteAgentTrigger`
- `ListAgentMemory`
- `ListAgentTools`
- `ReadAgentMemoryFile`
- `WriteAgentMemoryFile`
- `DeleteAgentMemoryFile`
- `DownloadAgentMemoryFile`
- `UploadAgentMemoryFileToIpfs`
- `CreateSession`
- `ListSessions`
- `UpdateSession`
- `DeleteSession`
- `GetSession`
- `MessageSession`
- `InvokeSessionTool`
- `UploadSessionAttachment`
- `ReadSessionAttachment`
- `BeginFileUpload`
- `AppendFileUploadChunk`
- `CommitFileUpload`
- `AbortFileUpload`
- `StopSession`
- `RetrySession`
- `GetRun`
- `ListRuns`
- `CancelRun`
- `SignalRun`
- `GetRunJournal`
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

Lists agents owned by the verified account plus agents on which it is an accepted reader or writer, ordered by update
time descending. Each `AgentInfo.accessRole` is `owner`, `reader`, or `writer`; pending invitations are deliberately not
returned here.

### Agent invitations and collaborators

- `ListAgentInvites {}` returns pending `AgentInviteInfo` rows for the signed account. An invite discloses only the
  agent id/name, owner account, role, and timestamps; agent contents remain unavailable until acceptance.
- `ListAgentCollaborators {agentId}` returns the owner and accepted members plus the agent's `publicRead` flag. The
  owner also sees pending invitations.
- `InviteAgentCollaborator {agentId, accountId, role}` creates an invitation (`reader` or `writer`) or updates an
  existing member's role. Owner-only.
- `RemoveAgentCollaborator {agentId, accountId}` revokes an accepted member or cancels a pending invitation. Owner-only.
- `AcceptAgentInvite {agentId}` accepts the signed account's pending invitation and returns the now-accessible agent.
- `DeclineAgentInvite {agentId}` deletes the signed account's pending invitation.
- `SetAgentPublicRead {agentId, publicRead}` turns public read access on or off. Owner-only. While on, every signed
  account that knows the agent id is treated as a `reader` (the same view an invited reader gets, including live
  subscriptions); the agent is still never returned from `ListAgents` or account-wide `ListSessions` for accounts that
  are not owner or collaborator. `AgentInfo.publicRead` reports the flag.

Readers can inspect all agent-scoped state. Writers can additionally create/update/delete agent-scoped resources and
interact with sessions. Managing collaborators and deleting the agent remain owner-only. Account-scoped provider and
secret mutations are never inherited from an agent collaboration; agent settings may list the owner's redacted
providers/signing identities through optional `agentId` fields.

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

When the definition's primary `signingKey` resolves to an `hm-account-key` secret, the server also auto-creates a
default enabled `user-mention` trigger that follows that signing identity's account uid (prompt: "Respond to the
mention, performing the action requested."), so mentioning the agent's account starts a session in which it responds.
This is best-effort and never blocks agent creation; agents without a signing key get no default trigger.

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
  agentId?: string
}
```

Response:

```ts
{_: 'ListSigningIdentitiesResponse'; identities: SigningIdentity[]}
```

Lists account-scoped secrets whose metadata has `kind: 'hm-account-key'`. Plain secret material is never returned, and
only keys uploaded by the signed account are visible. With `agentId`, the request resolves against the owning account of
a shared agent: the owner sees every identity, while collaborators (reader or writer) only see the identities granted to
that agent — the owner's other keys are private to the owner. Changing the granted set itself (`definition.signingKeys`
via `UpdateAgent`) is owner-only; a writer's `UpdateAgent` must carry the grant set unchanged or it is rejected
with 403.

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

Upserts provider config by account/name. `ModelProviderConfig.authMode` selects how requests authenticate: `api-key`
(default, uses the `secretRefs.apiKey` secret) or `subscription` (uses OAuth credentials in the `secretRefs.oauth`
secret).

### `DeleteModelProvider`

Request:

```ts
{
  _: 'DeleteModelProvider'
  name: string
}
```

Deletes the named provider record for the account, plus every secret it referenced that no remaining provider still
references — subscription providers of the same type share one OAuth secret, so a shared credential survives the
deletion of one of its providers. 404 when the account has no provider by that name. Response:
`{_: 'DeleteModelProviderResponse'; name}`.

### Provider OAuth actions ("Sign in with ChatGPT")

Subscription-authenticated providers are configured through a four-action login flow instead of a pasted API key. It is
offered only when the server runs with `SEED_AGENTS_SUBSCRIPTION_AUTH` enabled (surfaced as `subscriptionAuth` on
`/api/health`); `StartProviderOAuth` returns `403` otherwise. Implementation lives in `agents/src/provider-oauth.ts`.

- `StartProviderOAuth {providerType}` → `{_: 'StartProviderOAuthResponse'; loginId; authUrl; expiresAt}`. Only `openai`
  is supported. Starting a new login cancels the account's previous pending one.
- `GetProviderOAuthStatus {loginId}` →
  `{_: 'ProviderOAuthStatusResponse'; loginId; status: 'pending' | 'completed' | 'failed'; secretName?; error?}`. On
  `completed`, `secretName` is the stored credentials secret to reference as `secretRefs.oauth`.
- `SubmitProviderOAuthCode {loginId, code}` → `{_: 'SubmitProviderOAuthCodeResponse'}`. For deployments where the
  provider's localhost redirect cannot reach the server, the client pastes the code (or the full redirect URL).
- `CancelProviderOAuth {loginId}` → `{_: 'CancelProviderOAuthResponse'; loginId}`.

`RedactedModelProvider.authStatus` reports subscription health afterwards: `ok`, or `needs-login` when credentials are
missing or a token refresh failed.

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

Requires owner, reader, or writer access to the agent.

### `UpdateAgent`

Request:

```ts
{
  _: 'UpdateAgent'
  agentId: string
  definition: AgentDefinition
}
```

Updates the definition for the owner or an accepted writer after validating the owning account's provider and signing
identities.

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
and per-agent state directory. Live runs of the agent are canceled first (cascading through their trees); run history
survives detached — `runs.agent_id`, `runs.session_id`, and `runs.trigger_firing_id` are nulled inside the delete
transaction (they are enforced foreign keys; without the detach, any agent that had ever executed a run was
undeletable), and sub-sessions of _other_ agents hanging off this agent's sessions promote to top level.

### Agent trigger actions

The trigger API supports signed CRUD for agent-scoped triggers. HM activity triggers are processed by the ActivityFeed
monitor, and schedule triggers are processed by the schedule monitor.

Trigger source shape:

```ts
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

Trigger prompts accept the same rich Seed block format as agent system prompts. Legacy string input is parsed as
markdown; trigger prompt blocks are converted to resolved markdown before starting the triggered session.

A `user-mention` source watches a list of accounts; a legacy singular `mentionedAccount` on input is still normalized
into `mentionedAccounts`, and an empty list is rejected.

`continuation` says what a firing _does_. Omitted (or `newThread`) starts a fresh thread from the trigger's prompt —
what every trigger did before continuations existed. `wake` delivers a signal to a run parked on `ctx.waitForEvent`
instead, riding the same delivery path as `SignalRun`; without `runId` the account's parked runs are searched for one
the signal satisfies.

`run-completed` is the source that lets automations chain: it fires when a run of this account reaches a terminal
status. Chains are loop-guarded — a firing whose ancestry already contains the same trigger within 8 hops is skipped
(`TRIGGER_CHAIN_MAX_HOPS` in `api-service.ts`).

The `agent_triggers` table carries a `cooldown_ms` column, but no protocol field writes it and no monitor reads it. It
is vestigial; do not document a cooldown feature until one exists.

Actions:

- `ListAgentTriggers {agentId}` returns `{_: 'ListAgentTriggersResponse'; triggers: AgentTriggerInfo[]}`.
- `GetAgentTrigger {triggerId}` returns
  `{_: 'GetAgentTriggerResponse'; trigger: AgentTriggerInfo; sessions: SessionInfo[]}`.
- `CreateAgentTrigger {agentId, trigger, clientRequestId?}` returns `{_: 'CreateAgentTriggerResponse'; trigger}`.
- `UpdateAgentTrigger {triggerId, patch}` returns `{_: 'UpdateAgentTriggerResponse'; trigger}`.
- `DeleteAgentTrigger {triggerId}` returns `{_: 'DeleteAgentTriggerResponse'; triggerId}`.

All trigger actions verify account ownership through the owning agent/trigger rows. `CreateAgentTrigger` supports the
same `clientRequestId` idempotency pattern as other create actions.

### Agent memory actions

Each agent owns a private memory filesystem at `<stateDir>/memory` — the `~/memory/` half of its Space, reached by the
agent through the `read` and `write` verbs and shown to its owner on the desktop Memory tab. All actions validate agent
ownership for the signed account, and every path is a sandboxed relative path (no absolute paths, no `..`, symlinks
refused). Files can be UTF-8 text or binary.

```ts
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

Actions:

- `ListAgentMemory {agentId}` returns `{_: 'ListAgentMemoryResponse'; agentId; entries: AgentMemoryEntry[]; totalBytes}`
  with every file and directory sorted by path.
- `ReadAgentMemoryFile {agentId, path}` returns `{_: 'ReadAgentMemoryFileResponse'; agentId; file: AgentMemoryFile}`.
  Small clean-UTF-8 files come back as text; everything else comes back as raw bytes for preview/download in the Memory
  tab.
- `WriteAgentMemoryFile {agentId, path, content}` returns `{_: 'WriteAgentMemoryFileResponse'; agentId; entry}` after
  writing the full file content, creating parent directories as needed. `content` may be a string (UTF-8 text) or
  `Uint8Array` bytes (e.g. a local file uploaded from the Memory tab). Writes, downloads, and deletes emit an
  `account-change` event with reason `agent-memory-changed`, which is also fanned out to `agents/<agentId>` WebSocket
  subscribers so open Memory tabs refresh.
- `DeleteAgentMemoryFile {agentId, path}` returns `{_: 'DeleteAgentMemoryFileResponse'; agentId; path; deleted}` and
  removes a file, or a directory recursively; `deleted` is false when nothing existed.
- `DownloadAgentMemoryFile {agentId, url, path?}` server-side fetches a public http(s) URL into memory (streamed, with a
  60-second idle timeout) and returns `{_: 'DownloadAgentMemoryFileResponse'; agentId; entry; finalUrl; contentType?}`.
  Omitting `path` stores the file under `downloads/` named from the URL; extension-less paths gain an extension from the
  response content type.
- `UploadAgentMemoryFileToIpfs {agentId, path}` chunks the file as UnixFS and publishes its blocks through the typed HM
  API's `PublishBlobs` action, then returns
  `{_: 'UploadAgentMemoryFileToIpfsResponse'; agentId; path; cid; url; size; mimeType?}`, where `url` is the
  `ipfs://<cid>` URL usable from Hypermedia content. Publishing makes the file publicly retrievable.

Path limits (`agents/src/agent-memory.ts`): 512 bytes per normalized relative path, 16 levels of nesting. Memory itself
carries no per-file, per-agent, or entry-count size cap — the server accepts uploads of any size (`main.ts` raises Bun's
request-body limit for exactly this). The 256 KiB `MAX_WRITE_CONTENT_BYTES` bound in `api-service.ts` applies to
hypermedia content the `write` verb publishes, not to memory files.

### `ListAgentTools`

Request:

```ts
{
  _: 'ListAgentTools'
  agentId: string
}
```

Response:

```ts
{_: 'ListAgentToolsResponse'; agentId: string; tools: AgentToolInfo[]}
```

Lists every tool document in the agent's `~/tools` — builtin bindings and authored lambdas alike — from the
`tool_documents` table, materializing the builtin rows first if the registry contract has changed. This is the owner's
transparency view: the same documents the agent sees when it reads `~/tools/`.

```ts
type AgentToolInfo = {
  name: string
  kind: 'builtin' | 'lambda'
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

### `ListSessions`

Request:

```ts
{
  _: 'ListSessions'
  agentId?: string
  limit?: number
  cursor?: {updatedBefore: number; idBefore: string}
  parentSessionId?: string
  includeChildren?: boolean
}
```

Lists the signed account's sessions newest-first across every agent on the server, or a single agent's sessions when
`agentId` is set. Response:

```ts
{
  _: 'ListSessionsResponse'
  sessions: SessionInfo[]
  agents: AgentInfo[]
  nextCursor?: {updatedBefore: number; idBefore: string}
}
```

`agents` contains only the agents referenced by `sessions`, so a client rendering a cross-agent session list can label
each row without a follow-up `GetAgent` per session. This exists because the desktop assistant sidebar shows one merged
list spanning every agent on every configured server; without it the client would have to walk `ListAgents` and then
`GetAgent` per agent just to enumerate sessions.

`limit` defaults to 50 and is clamped to 200.

Pagination is keyset on the composite `(updatedAt, id)`, not on `updatedAt` alone. Sessions routinely share an
`updatedAt` millisecond — one trigger firing over a batch of activity events creates several at once — and a
timestamp-only cursor silently drops every tied row past a page boundary. Pass `nextCursor` back verbatim as `cursor`;
its absence means the list is exhausted.

Child sessions (spawned by `delegate`, a script's `ctx.delegate`, or an agent starting a session) are **included by
default**: an absent `includeChildren` returns every session, because older deployed clients cannot send the field and
hiding agent-started sessions from them would be a silent regression. Lineage-aware clients (the current desktop) pass
`includeChildren: false` explicitly to get top-level rows only — parents carry `childSessionCount` — and fetch children
per parent with `parentSessionId` (which ignores `includeChildren`).

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
`session-updated`. A title saved this way is marked `title_source = 'user'`, which the server's automatic session
titling refuses to overwrite.

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

Deletes an account-owned session and its durable events. Every live run rooted at the session is canceled first —
**including descendants** (spawned sub-sessions and workflows) — so a parked parent can never be stranded `waiting` by
its session disappearing, and no executor streams into deleted rows. Run history survives detached (`runs.session_id`
nulled); child sessions promote to top level (`parent_session_id` nulled); a creating trigger firing is retained but
detached. The server emits an account change with reason `session-deleted`.

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
  content: Array<
    | {type: 'text'; text: string; blocks?: AgentMessageBlock[]}
    | {type: 'context'; lines: string[]}
    | {type: 'attachment'; id: string}
  >
  clientMessageId?: string
}
```

`context` parts carry ambient client state — the desktop sidebar sends the current window (open document, view, focused
block) so "this document" resolves for the model. All context lines in a request collapse onto its first user message as
`contextLines`, reach the model appended to that message inside a `<window_context>` block, and never appear in the
transcript `content`. At least one `text` part is required.

`attachment` parts reference files already staged with `UploadSessionAttachment` (or a committed chunked upload). They
are session-private: they live with the session, the agent reaches them through `read attachment:<id>`, and they are
deleted with the session.

Flow:

1. verify the signed account has write access to the session's agent;
2. append the durable user message immediately, with `content`/`rawMarkdown`, optional rich `blocks`, and
   `meta.accountId` plus the exact cryptographic `meta.signerId` from the verified envelope;
3. enqueue a durable run for that message;
4. claim it inline when no other turn owns the session, otherwise leave it queued behind the current turn;
5. run the model loop with one model turn at a time per session;
6. emit live partials over WebSocket;
7. append tool events and final assistant/error event;
8. start the next queued collaborator turn, if any.

Multiple writers may therefore submit to one session concurrently. Their messages are saved and broadcast in append
order instead of receiving `409` while the agent is streaming; model turns remain serialized. A queued turn gets an
in-memory handoff identifying the exact message events that arrived during the preceding response, so later assistant
events from that preceding turn are not mistaken for answers to the newly queued messages.

Internally each turn is a durable run row in the dispatch queue (`agents/src/runs.ts`).
`MessageSessionResponse.assistantEventId` is an **empty string** when the request returned before a final assistant
event existed: concurrent/background enqueues (including triggers and agent-started sessions) and turns that parked on
children spawned with `delegate` — the rest of the turn streams over WebSocket.

Idempotent through `clientMessageId`, but intentionally avoids one long SQLite transaction around network calls.

### `InvokeSessionTool`

Request:

```ts
{
  _: 'InvokeSessionTool'
  sessionId: string
  verb: 'read' | 'write' | 'call'
  input: unknown
}
```

Response:

```ts
{
  _: 'InvokeSessionToolResponse'
  sessionId: string
  resultEventId: string // durable event id of the appended tool_result
  output?: unknown
  error?: string
}
```

Runs one verb **as the user** against the session's shared log. The log is a shared workspace log, not a chat: the same
`read`/`write`/`call` implementations the agent uses execute here, and both the call and its result append as durable
events stamped `actor: 'user'`, so the agent reads them on its next turn as ground truth — there is no side channel.
This is what the desktop composer's wrench palette sends.

Only those three verbs are accepted. `delegate` and `plan` are deliberately not user-invocable — delegation is a
conversational ask, and any path that reaches session-spawning from a user verb rejects with "Delegation is a
conversational ask; message the agent instead".

Execution failures are themselves log entries — the user's failed attempt is context too — and come back in `error`
rather than as an HTTP error. Only pre-execution problems reject the request outright: an unknown verb (400), an unowned
session (404), and a session with a live run (409, "The agent is working in this thread right now").

### Session attachments and chunked uploads

- `UploadSessionAttachment {sessionId, name, mimeType?, content}` →
  `{_: 'UploadSessionAttachmentResponse'; attachment: SessionAttachmentInfo}`. The attachment id is the SHA-256 hex of
  the bytes, so re-uploading the same file returns the same id. Caps: 100 MiB per attachment and 200 attachments per
  session (`agents/src/session-attachments.ts`), stored under `<stateDir>/session-attachments/<sessionId>/`.
- `ReadSessionAttachment {sessionId, attachmentId}` → `{_: 'ReadSessionAttachmentResponse'; attachment; data}` for
  rendering an attachment back in the thread.

Large files upload in bounded chunks instead, so each signed action stays small and clients can show progress:

- `BeginFileUpload {target, size}` → `{_: 'BeginFileUploadResponse'; uploadId; maxChunkBytes}`. `target` is
  `{kind: 'memory', agentId, path}` or `{kind: 'session-attachment', sessionId, name, mimeType?}`, validated up front so
  a long upload cannot fail at the very end. `maxChunkBytes` is 8 MiB.
- `AppendFileUploadChunk {uploadId, offset, content}` → `{_: 'AppendFileUploadChunkResponse'; uploadId; received}`.
  Chunks must arrive in order: `offset` must equal the bytes already staged. Oversized chunks return `413`.
- `CommitFileUpload {uploadId}` → `{_: 'CommitFileUploadResponse'; entry?; attachment?}` — `entry` for a memory target,
  `attachment` for a session attachment. The staged byte count must equal the declared `size`.
- `AbortFileUpload {uploadId}` → `{_: 'AbortFileUploadResponse'; uploadId}`. Staged uploads also expire after an hour.

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

Stops the in-flight Pi agent turn for the signed account/session when one is active, and cancels every live run rooted
at the session **including descendants** (delegated model children and script children). `stopped` is `false` when the
session is already idle.

### `RetrySession`

Request:

```ts
{
  _: 'RetrySession'
  sessionId: string
}
```

Response:

```ts
{
  _: 'RetrySessionResponse'
  sessionId: string
  assistantEventId: string
}
```

Re-runs a session whose latest run failed, without appending a new user message: the turn re-enters from the durable
transcript, and error events are not replayed to the provider. Rejected when a run is live or the latest run did not
fail. `assistantEventId` is an empty string when the retried turn parked (the rest streams over WebSocket), exactly like
`MessageSession`.

### `GetRun`

`{_: 'GetRun', runId}` → `{_: 'GetRunResponse', run: RunInfo}`. 404 when the run does not belong to the account.

### `ListRuns`

```ts
{
  _: 'ListRuns'
  rootRunId?: string // the whole tree of one root, oldest first (tree rendering)
  sessionId?: string // root runs referencing a session, newest first
  agentId?: string // runs of one agent, newest first
  status?: RunStatus
  limit?: number // default 50, clamped to 200
}
```

Exactly one selector is required. Response: `{_: 'ListRunsResponse', runs: RunInfo[]}`.

### `CancelRun`

`{_: 'CancelRun', runId}` → `{_: 'CancelRunResponse', runId, canceled}`. Cancels the run and every non-terminal
descendant: queued runs never start, waiting runs never wake, executing runs are aborted (Pi abort for agent runs, VM
interrupt for script runs). `canceled` is `false` when everything was already terminal.

### `SignalRun`

```ts
{
  _: 'SignalRun'
  runId: string
  signal: string // a wait with no criteria accepts any name
  payload?: unknown // must be JSON-serializable
}
```

Response: `{_: 'SignalRunResponse', runId, delivered}`.

Delivers a named signal to a run parked on `ctx.waitForEvent`, waking it with the payload. This is how a person (or
another system) answers a workflow waiting for something the activity feed cannot express — an approval, a webhook, a
human decision; the run card's **Answer** button sends the run's `RunWaitInfo.answerWith` signal. Signalling a run that
is not listening for this signal is not an error: `delivered` is simply `false`. A trigger with a `wake` continuation
rides this same delivery path.

### `GetRunJournal`

`{_: 'GetRunJournal', runId, afterSeq?}` → `{_: 'GetRunJournalResponse', runId, entries}` — a script (workflow) run's
durable journal entries (`{runId, seq, entry, createdAt}`), empty for agent runs, replayable with `afterSeq` like
session events.

### `Subscribe`

Request:

```ts
{
  _: 'Subscribe'
  key: `account/${string}` | `agents/${string}` | `sessions/${string}` | `runs/${string}`
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

`systemPrompt` is normalized to Seed block nodes on create/update; legacy string input is parsed as markdown first.
Before a model run, the server converts the stored blocks back to markdown and appends the shared runtime instructions
and the agent's `<space>` index.

`reasoningLevel` applies to reasoning-capable models and must be one of the levels `modelReasoningSupport` reports for
the model (`agents/protocol/src/reasoning.ts`); absent means off, or the provider default where reasoning cannot be
disabled.

`tools` is a **grant list, not the tool surface**. The five verbs — `read`, `write`, `call`, `delegate`, `plan` — are
always on and can never be granted or revoked; see [the glossary](./glossary.md). (The one exception is structural, not
a permission: `delegate` needs a run to park on, so the rare runless invocation simply omits it.) What `tools` narrows
is:

- the **callable set** dispatched through `call` (today `search`, `web_search`, `execute`; `navigate` is
  assistant-runtime only). An omitted `tools` array grants every service-runtime callable; an explicit array keeps only
  the names it lists. Unknown and legacy names are ignored, and `execute_code` normalizes to `execute`
  (`normalizeSeedToolName`). `execute` is dropped silently on hosts that cannot run sandboxes, so the model never sees a
  tool that can only fail.
- the **publish grant**: the pseudo-tool name `publish` authorizes signed public writing (`hm://` documents and
  comments, IPFS uploads). Legacy write-group names (`write`, `memory_publish_document`, `ipfs_write`,
  `attachment_to_ipfs`) still count so a pre-verbs agent keeps the posture its owner configured, and an omitted `tools`
  array publishes. Memory writes are never gated.

`signingKeys` stores the selected uploaded HM account key secret names for signing/publishing; `signingKey` is retained
as a legacy single-key field. When an agent runs, selected keys are appended to the system prompt with both profile
names and public key IDs so the model can map user-facing names to signing IDs. Pi's own builtin tools are disabled by
the Seed runner (`noTools: 'builtin'`).

## Protocol sync

Desktop and server now consume the same private package, `@seed-hypermedia/agents-protocol`, instead of maintaining
manual protocol mirrors. Change protocol action, response, session-event, or WebSocket-event types in
`agents/protocol/src/index.ts`; `agents/src/api.ts` re-exports those types for service-local imports, and
`frontend/apps/desktop/src/agents-client.ts` aliases them for desktop callers.

When changing the protocol package, update service dispatch, desktop behavior, and docs in the same change.
