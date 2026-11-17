---
name: Signed API
summary: "The signed HTTP API of an app environment: the endpoint, the signed envelope and how the server checks it, protocol versions, errors, access levels, idempotency, and a table of every action."
---
The [Seed Agents](../agent.md) HTTP API is a signed action API encoded as [DAG-CBOR](../protocol/blobs.md). Every request is signed with a Seed [account](../protocol/identity.md) key, or with a key that account has authorized. Canonical protocol types live in `apps/protocol/src/index.ts` and are re-exported from `apps/src/api.ts`. Dispatch lives in `apps/src/api-service.ts`. HTTP routing lives in `apps/src/main.ts`. <!-- id:g-EvU-a4 -->

This page covers what every request shares: the endpoint, the envelope and how the server checks it, protocol versions, errors, access levels and idempotency. The request and response of each action are on six pages, one per kind of resource, listed under [Actions](#actions). Live updates use the same envelope over a socket and are described in [WebSocket subscriptions](./websocket-subscriptions.md).

# Endpoint <!-- id:pbaO7izF -->

```text <!-- id:O0-qNjbh -->
POST /hm/api/apps/message
Content-Type: application/cbor
Accept: application/cbor
```

`/hm/api/apps` is the canonical prefix of the API, on the app environment's own host or on a site's origin. The same routes answer under `/hm/api/agents`, the prefix that released clients, published bindings and handed-out webhook URLs name. Both prefixes serve `message`, `ws`, `webhooks/<triggerId>`, `health`, `version`, `perf` and `metrics`.

Three more paths are accepted for older clients and for a server on its own host: `POST /api/message`, `POST /agents/api/message`, and the socket at `/agents/ws`. [Operations](../operate/endpoints-and-health.md#base-url) says where the service is mounted.

Responses are DAG-CBOR encoded `AgentResponse` values. Every response carries the server's protocol version in the `X-Agents-Protocol` header (also in the `version` and `health` routes as `protocol` and `minClientProtocol`). <!-- id:bhXf9yiI -->

# Protocol versioning <!-- id:XZricGGS -->

Clients and servers are deployed independently, so the wire surface is versioned by a single integer, `AGENTS_PROTOCOL_VERSION` in `apps/protocol/src/version.ts`. A client declares the version it speaks in `envelope.protocol`. The server answers in that version's shape (shims in `apps/src/protocol-compat.ts`). Below `MIN_CLIENT_PROTOCOL` it refuses with HTTP 426 and `{_: 'Error', code: 'protocol_too_old'}`. The current version is 3 and `MIN_CLIENT_PROTOCOL` is 1. An envelope with no `protocol` field is read as version 1. <!-- id:PAx965qL -->

# Signed envelope <!-- id:gGou4ap_ -->

```ts <!-- id:16U7fDXM -->
type SignedActionEnvelope = {
  type: 'AgentsAction'
  signer: blobs.Principal
  sig: blobs.Signature
  account: blobs.Principal
  protocol?: number // AGENTS_PROTOCOL_VERSION of the client; absent = 1
  capability?: string // CID of the Capability blob a delegated signer acts under
  capabilityBlob?: Uint8Array // its bytes, so any server can verify without the network
  action: AgentAction
}

type AgentAction = UnsignedAgentAction & {
  ts: number // Unix epoch milliseconds
}
```

`signer` and `account` are [principals](../principal.md), and `sig` is an Ed25519 [signature](../signature.md), the same scheme used to sign [blobs](../protocol/blobs.md). Server validation: <!-- id:8LJhY3ZT -->
  1. envelope shape and `type`; <!-- id:75XviWi8 -->
  2. principal/signature byte shapes; <!-- id:_v8P7UA3 -->
  3. signed action timestamp is within five minutes of server local time; <!-- id:Zr6E8UHr -->
  4. Ed25519 signature through `verify()` from `@seed-hypermedia/client` (imported through the `@shm/shared/blobs` re-export); <!-- id:qOVjsEhi -->
  5. signer is the account, or a locally authorized signer for it, or presents a delegation: `capability` names a [Capability](../capability.md) blob whose bytes come from `capabilityBlob`, from a delegation this server verified before, or from the HM network; the blob must be issued by `account`, delegate to `signer`, carry role `AGENT` or `WRITER`, not be self-issued, and be under 64 KiB; <!-- id:84U_5iGK -->
  6. action is valid for the transport. <!-- id:1BkfRowE -->

Every verification failure is HTTP 401. A body that is not `application/cbor` is 415, and undecodable CBOR is 400. <!-- id:HxBosWOL -->

# Never sign `undefined` <!-- id:asgFXeqf -->

DAG-CBOR helpers encode `undefined` as `null` in some paths. The server then decodes `null`, the signed bytes differ, and signature verification fails. Leave an absent field out of the action object before signing. This includes `afterSeq` on `Subscribe`.

# Actions <!-- id:vqBlDC63 -->

The `AgentAction` union is `UnsignedAgentAction` in `apps/protocol/src/index.ts` plus the signed `ts`. The tables list every action in it. Level is the [access level](#access-levels) the signer needs on the agent, session, trigger or run the action names. "account" means the action reads or changes the signer's own account and names no agent. "none" means any signed account may send it.

## Agents

Reference: [agents](./signed-api-agents.md).

| Action | Level | What it does |
| --- | --- | --- |
| `ListAgents` | account | Lists the agents the account owns or collaborates on. |
| `CreateAgent` | account | Creates an agent from a definition. |
| `GetAgent` | reader | Returns one agent and its session count. |
| `UpdateAgent` | writer | Replaces the agent definition. |
| `DeleteAgent` | owner | Deletes the agent with its sessions, triggers and state. |
| `MountAgent` | owner | Gives an agent the identity of a published document. |
| `UnmountAgent` | owner | Takes a mounted agent out of its document. |
| `ListAgentInvites` | account | Lists pending invitations sent to the account. |
| `AcceptAgentInvite` | account | Accepts an invitation and returns the agent. |
| `DeclineAgentInvite` | account | Deletes a pending invitation. |
| `ListAgentCollaborators` | reader | Lists the owner, members and public flags of an agent. |
| `InviteAgentCollaborator` | owner | Invites an account as reader or writer, or changes a role. |
| `RemoveAgentCollaborator` | owner | Removes a member or cancels an invitation. |
| `SetAgentPublicRead` | owner | Turns public read access on or off. |
| `SetAgentPublicChat` | owner | Turns public chat on or off. |
| `ListAgentTools` | reader | Lists the tool documents in the agent's `~/tools`. |
| `SaveAgentTool` | writer | Refused with 410: agents do not hold private code tools. |
| `DeleteAgentTool` | writer | Deletes one authored tool document. |

## Providers, identities and secrets

Reference: [providers and identities](./signed-api-providers.md). With an `agentId`, the three list actions resolve against the owner of an agent the signer can read.

| Action | Level | What it does |
| --- | --- | --- |
| `ListModelProviders` | account | Lists configured model providers, redacted. |
| `ListProviderModels` | account | Asks one provider for its model list. |
| `SetModelProvider` | account | Creates or replaces a provider config. |
| `DeleteModelProvider` | account | Deletes a provider and the secrets only it used. |
| `StartProviderOAuth` | account | Starts a subscription login. |
| `SubmitProviderOAuthCode` | account | Completes a login with a pasted code. |
| `GetProviderOAuthStatus` | account | Reports whether a login is pending, completed or failed. |
| `CancelProviderOAuth` | account | Cancels a pending login. |
| `ListSigningIdentities` | account | Lists the account keys the server holds for signing. |
| `CreateSigningIdentity` | account | Generates a new account key on the server. |
| `ImportSigningIdentity` | account | Stores an existing account key for the server to sign with. |
| `UpdateSigningIdentity` | account | Renames a signing identity and republishes its profile. |
| `DeleteSigningIdentity` | account | Deletes the stored key. |
| `SetSecret` | account | Encrypts and stores a secret. |
| `ListMcpServers` | account | Lists configured MCP servers, redacted. |
| `SetMcpServer` | account | Creates or replaces an MCP server and discovers its tools. |
| `RefreshMcpServer` | account | Discovers an MCP server's tools again. |
| `DeleteMcpServer` | account | Deletes an MCP server and its secrets. |
| `RegisterSigner` | none | Registers a delegated signer ahead of time. Accepted for older clients. |

## Triggers

Reference: [triggers](./signed-api-triggers.md).

| Action | Level | What it does |
| --- | --- | --- |
| `ListAgentTriggers` | reader | Lists an agent's triggers. |
| `GetAgentTrigger` | reader | Returns one trigger with its sessions and recent firings. |
| `CreateAgentTrigger` | writer | Creates a trigger. |
| `UpdateAgentTrigger` | writer | Patches a trigger. |
| `CombineAgentTriggers` | writer | Merges one activity trigger into another. |
| `DeleteAgentTrigger` | writer | Deletes a trigger. |
| `ListHostTriggers` | none | Lists the triggers that an app's or agent's trigger documents define on this server. |
| `RunTriggerNow` | writer | Fires a schedule trigger once, now. |

## Sessions and runs

Reference: [sessions and runs](./signed-api-sessions.md).

| Action | Level | What it does |
| --- | --- | --- |
| `CreateSession` | chat | Creates an idle session on an agent. |
| `ListSessions` | reader | Lists sessions, newest first, with keyset paging. |
| `GetSession` | reader | Returns a session and a page of its durable events. |
| `GetSessionEvent` | reader | Returns one durable event whole. |
| `UpdateSession` | writer | Changes the title, model override or thoroughness. |
| `DeleteSession` | writer | Deletes a session and its events. |
| `MessageSession` | chat | Appends a user message and queues a run for it. |
| `InvokeSessionTool` | writer | Runs `read`, `write` or `call` as the user in the session. |
| `StopSession` | chat | Stops the running turn and cancels the session's live runs. |
| `RetrySession` | chat | Runs again a session whose latest run failed. |
| `ConnectSessionBrowser` | owner | Attaches a desktop browser window to a session. |
| `PollSessionBrowser` | owner | Waits for the next browser command. |
| `ResolveSessionBrowser` | owner | Returns the result of one browser command. |
| `DisconnectSessionBrowser` | owner | Detaches the desktop browser. |
| `GetRun` | reader | Returns one run. |
| `ListRuns` | reader | Lists runs of a root run, a session or an agent. |
| `CancelRun` | writer | Cancels a run and its descendants. |
| `SignalRun` | writer | Delivers a named signal to a parked run. |
| `GetRunJournal` | reader | Returns a script run's journal entries. |
| `Subscribe` | reader | Opens a live subscription. Accepted only over WebSocket. |

## Memory and uploads

Reference: [memory and uploads](./signed-api-memory.md).

| Action | Level | What it does |
| --- | --- | --- |
| `ListAgentMemory` | reader | Lists every memory file and directory. |
| `ListAgentMemoryDir` | reader | Lists one directory level. |
| `ReadAgentMemoryFile` | reader | Returns one file. |
| `WriteAgentMemoryFile` | writer | Writes a whole file. |
| `DeleteAgentMemoryFile` | writer | Deletes a file or a directory. |
| `DownloadAgentMemoryFile` | writer | Fetches a public URL into memory. |
| `UploadAgentMemoryFileToIpfs` | writer | Publishes a memory file as an `ipfs://` file. |
| `UploadSessionAttachment` | chat | Stages a file for a session message. |
| `ReadSessionAttachment` | reader | Returns an attachment's bytes. |
| `BeginFileUpload` | writer or chat | Starts a chunked upload to memory (writer) or to a session (chat). |
| `AppendFileUploadChunk` | as the upload | Adds the next chunk. |
| `CommitFileUpload` | as the upload | Finishes the upload. |
| `AbortFileUpload` | as the upload | Discards the upload. |

## Running apps

Reference: [running apps](./signed-api-apps.md). "Space writer" means the signer can write the [space](../protocol/spaces.md) that holds the app document.

| Action | Level | What it does |
| --- | --- | --- |
| `RunApp` | space writer | Runs an app on this server, or replaces its private config. |
| `StopApp` | space writer | Stops an app and forgets its private config. |
| `GetAppRun` | none | Says whether an app runs on this server. |
| `CheckAppRun` | none | Says whether this server would run an app for the signer. |
| `CallAppTool` | none | Calls a tool of a running app. |
| `ListAppToolCalls` | none | Lists a tool's recorded calls. |
| `GetAppToolCall` | none | Returns one recorded call. |

# Responses <!-- id:P0ID1IyU -->

Success responses are action-specific. Errors use: <!-- id:KFAyl_Mc -->

```ts <!-- id:ieerbWxp -->
type ErrorResponse = {
  _: 'Error'
  message: string
  code?: ProtocolErrorCode // e.g. 'protocol_too_old'
}
```

HTTP status is set on expected API errors (`APIError`, with an optional `code`). Unexpected errors are logged and returned as `500` with `Internal server error: <message>`. <!-- id:pwrb18VG -->

The status map: `401` any envelope or delegation failure; `415` a body that is not `application/cbor`; `400` undecodable CBOR, an unknown action, or invalid input; `403` the actor's access level is too low; `404` the resource does not exist or is not accessible (an agent you cannot read looks identical to one that does not exist); `409` an idempotency key reused with a different body, or a session with a live run; `413` an oversized upload chunk or attachment; `426` a client protocol the server no longer serves. <!-- id:G8F0XiUW -->

# Access levels <!-- id:qBDeejBl -->

An agent has an owner, accepted collaborators with role `reader` or `writer`, and, when `publicRead` or `publicChat` is on, every other signed account as a `reader` or `chatter`. Actions are gated by level: **reader** (any of those), **chat** (every role except `reader`: owner, writer, chatter), **writer** (owner or writer), and **owner**. Reading an agent, its sessions, triggers, memory, and tools is reader level; creating a session, messaging it, uploading an attachment, stopping or retrying a session is chat level; editing the agent, its triggers, memory, and tools, renaming or deleting a session, invoking a tool as the user, and cancelling or signalling a run is writer level; collaborators and public access are owner level. State is stored under the owner's account whatever the actor's role; `#actionAccountId` resolves the owner for every action that names an agent, session, trigger, or run. <!-- id:g6Rnpqgj -->

What the roles mean to the people sharing an agent is in [agent sharing](../agent/sharing.md). These roles are separate from Hypermedia [roles](../protocol/permissions.md) on documents.

# Idempotency <!-- id:86xaRurd -->

Idempotency rows store: <!-- id:OOJlJzY7 -->
  - account ID; <!-- id:goW-b9GO -->
  - action name; <!-- id:-a9nhdcq -->
  - client request or message ID; <!-- id:WBtePnRT -->
  - request CBOR bytes; <!-- id:CnwKXCEo -->
  - response CBOR bytes; <!-- id:nVl8nX67 -->
  - creation timestamp. <!-- id:eo-O9tll -->

Same ID and same request bytes replay the response. Same ID with different request bytes returns `409`. <!-- id:uVVixCG7 -->

# See also <!-- id:P08ObkPt -->

- [WebSocket subscriptions](./websocket-subscriptions.md) <!-- id:OeziFpeC -->
- [Seed Agents](../agent.md) <!-- id:vocdFen8 -->
- [Security](../agent/security.md) <!-- id:6ebJZqJM -->
- [Persistence](../operate/persistence.md) <!-- id:ND3MfXyJ -->
- [Identity](../protocol/identity.md) for the keys that sign every request <!-- id:_fLN9hVS -->
