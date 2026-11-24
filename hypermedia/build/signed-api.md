---
name: Signed API
summary: "The signed API is how a program talks to an app environment: this page covers the endpoint, the signed envelope, protocol versions, errors, access levels, idempotency, and a table of every action."
---
An [app environment](../software/app-environment.md) is the server that runs [agents](../agent.md) and [apps](../app.md). You talk to it by sending signed actions. Each request is one action, such as `CreateSession`. The client packs it as [DAG-CBOR](../schema/dag-cbor.md) and signs it with a Seed [account](../protocol/identity.md) key, or with a key that account has authorized. The types are in `apps/protocol/src/index.ts`. The server code that handles them is in `apps/src/api-service.ts`, and the HTTP routes are in `apps/src/main.ts`. <!-- id:g-EvU-a4 -->

This page covers what every request shares: the endpoint, the envelope and how the server checks it, protocol versions, errors, access levels and idempotency. The request and response of each action are on six pages, one per kind of thing. [Actions](#actions) lists them. Live updates use the same envelope over a socket. [WebSocket subscriptions](./websocket-subscriptions.md) describes them.

# Endpoint <!-- id:pbaO7izF -->

```text <!-- id:O0-qNjbh -->
POST /hm/api/apps/message
Content-Type: application/cbor
Accept: application/cbor
```

`/hm/api/apps` is the main prefix of the API. It works on the app environment's own host and on the address of a [site](../protocol/sites.md) that forwards to it. The same routes answer under `/hm/api/agents`. Released clients, published bindings and webhook URLs that were already handed out use that second prefix. Both prefixes serve `message`, `ws`, `webhooks/<triggerId>`, `health`, `version`, `perf` and `metrics`.

Older paths are accepted too, for older clients and for a server on its own host. The ones a client of this API needs are `POST /api/message`, `POST /agents/api/message`, and the socket at `/agents/ws`. [Endpoints and health](../operate/endpoints-and-health.md#base-url) says where the service is mounted.

A response is an `AgentResponse` value, encoded as DAG-CBOR. Every response to a signed action carries the server's protocol version in the `X-Agents-Protocol` header. The `version` and `health` routes report it too, as `protocol` and `minClientProtocol`. <!-- id:bhXf9yiI -->

# Protocol versioning <!-- id:XZricGGS -->

Clients and servers are updated at different times. So the API has a version: one whole number, `AGENTS_PROTOCOL_VERSION` in `apps/protocol/src/version.ts`. <!-- id:PAx965qL -->

- A client says which version it speaks in `envelope.protocol`. An envelope with no `protocol` field is read as version 1.
- The server answers in the shape of that version. The code that converts is in `apps/src/protocol-compat.ts`.
- The server's version is 3, and `MIN_CLIENT_PROTOCOL` is 1.
- Below `MIN_CLIENT_PROTOCOL` the server refuses with HTTP 426 and `{_: 'Error', code: 'protocol_too_old'}`.
- A client below protocol 3 also gets this `426` when it tries to read or change a [trigger](../trigger.md) that needs protocol 3.

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

`signer` and `account` are [principals](../principal.md), and `sig` is an Ed25519 [signature](../signature.md), the same scheme used to sign [blobs](../protocol/blobs.md). The server checks, in this order: <!-- id:8LJhY3ZT -->
  1. envelope shape and `type`; <!-- id:75XviWi8 -->
  2. principal/signature byte shapes; <!-- id:_v8P7UA3 -->
  3. signed action timestamp is within five minutes of server local time; <!-- id:Zr6E8UHr -->
  4. Ed25519 signature through `verify()` from `@seed-hypermedia/client` (imported through the `@shm/shared/blobs` re-export); <!-- id:qOVjsEhi -->
  5. signer is the account, or a locally authorized signer for it, or presents a delegation: `capability` names a [Capability](../capability.md) blob whose bytes come from `capabilityBlob`, from a delegation this server verified before, or from the HM network; the blob must be issued by `account`, delegate to `signer`, carry role `AGENT` or `WRITER`, not be self-issued, be at most 64 KiB, and hash to the [CID](../cid.md) given in `capability`; <!-- id:84U_5iGK -->
  6. action is valid for the transport. <!-- id:1BkfRowE -->

Every failed check is HTTP 401. A body that is not `application/cbor` is 415. CBOR that cannot be decoded is 400. <!-- id:HxBosWOL -->

# Never sign `undefined` <!-- id:asgFXeqf -->

Leave a field with no value out of the action object before you sign. Do not set it to `undefined`. The [SDK](./sdk.md)'s DAG-CBOR encoder writes `undefined` as `null`. The server then reads `null`, the bytes it checks differ from the bytes you signed, and the signature fails. This includes `afterSeq` on `Subscribe`.

# Actions <!-- id:vqBlDC63 -->

An action is one member of the `UnsignedAgentAction` type in `apps/protocol/src/index.ts`, plus the signed `ts`. The tables list every action in that type.

The Level column is the [access level](#access-levels) the signer needs on the agent, [session](../agent/session.md), trigger or [run](../agent/runs.md) that the action names. "account" means the action reads or changes the signer's own account and names no agent. "none" means any signed account may send it.

## Agents

Reference: [agents](./signed-api-agents.md).

| Action | Level | What it does |
| --- | --- | --- |
| `ListAgents` | account | Lists the agents the account owns or collaborates on. |
| `CreateAgent` | account | Creates an agent from a definition. |
| `GetAgent` | reader | Returns one agent and its session count. |
| `UpdateAgent` | writer | Replaces the agent definition. |
| `DeleteAgent` | owner | Deletes the agent with its sessions, triggers and state. |
| `MountAgent` | owner | Gives an agent the identity of a published [document](../protocol/documents.md). |
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

Reference: [providers and identities](./signed-api-providers.md). `ListModelProviders`, `ListProviderModels` and `ListSigningIdentities` take an optional `agentId`. With it, they answer for the owner of an agent the signer can read.

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
| `UpdateSigningIdentity` | account | Renames a signing identity and republishes its [profile](../profile.md). |
| `DeleteSigningIdentity` | account | Deletes the stored key. |
| `SetSecret` | account | Encrypts and stores a secret. |
| `ListMcpServers` | account | Lists configured [MCP servers](../agent/mcp.md), redacted. |
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
| `RunTriggerNow` | writer (of the agent, or of the space holding the trigger document) | Fires a schedule trigger once, now. |

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
| `Subscribe` | reader, or account for an `account/` key | Opens a live subscription. Accepted only over WebSocket. |

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
| `GetHostConfig` | none | Names the private config fields an app or agent has set on this server. |
| `SetHostPrivateConfig` | space writer | Changes an app's or agent's private config on this server. |
| `CheckAppRun` | none | Says whether this server would run an app for the signer. |
| `CallAppTool` | none | Calls a tool of a running app. |
| `ListAppToolCalls` | none | Lists a tool's recorded calls. |
| `GetAppToolCall` | none | Returns one recorded call. |

# Responses <!-- id:P0ID1IyU -->

Each action has its own success response. Every error has this shape: <!-- id:KFAyl_Mc -->

```ts <!-- id:ieerbWxp -->
type ErrorResponse = {
  _: 'Error'
  message: string
  code?: ProtocolErrorCode // e.g. 'protocol_too_old'
}
```

An error the server expects carries its own HTTP status and sometimes a `code`. An error the server does not expect is logged and returned as `500` with `Internal server error: <message>`. <!-- id:pwrb18VG -->

What each status means: <!-- id:G8F0XiUW -->

| Status | Meaning |
| --- | --- |
| `400` | CBOR that cannot be decoded, an unknown action, or invalid input |
| `401` | the envelope or its delegation failed a check, or a provider sign-in has expired |
| `403` | your access level is too low |
| `404` | the thing does not exist or you may not see it (an agent you cannot read looks the same as one that does not exist) |
| `409` | the request conflicts with the current state, such as an idempotency id reused with a different body, a session with a live run, or an upload chunk at the wrong offset |
| `410` | an action that is no longer offered (`SaveAgentTool`) |
| `413` | an upload, chunk or attachment that is too big |
| `415` | a body that is not `application/cbor` |
| `426` | a client protocol the server no longer serves |
| `429` | too many uploads in progress |
| `502` | something the server depends on failed, such as a model provider, an MCP server or the Hypermedia server |
| `503` | the server is still starting; try again in a few seconds |

# Access levels <!-- id:qBDeejBl -->

An agent has one owner. It can have collaborators that accepted an invitation, each with the role `reader` or `writer`. When `publicRead` is on, every other signed account is a `reader`. When `publicChat` is on too, every other signed account is a `chatter`. Each action needs one of four levels: <!-- id:g6Rnpqgj -->

| Level | Who has it | What it allows |
| --- | --- | --- |
| reader | owner, writer, reader, chatter | read the agent, its sessions, triggers, memory and tools |
| chat | owner, writer, chatter (not a plain reader) | create a session, send it a message, upload an attachment, stop or retry a session |
| writer | owner, writer | edit the agent, its triggers, memory and tools; rename or delete a session; run a verb as the user; cancel or signal a run |
| owner | owner | manage collaborators and public access; mount, unmount and delete the agent; use the session browser |

Whatever your role, the agent's data is stored under its owner's account.

[Agent sharing](../agent/sharing.md) explains what the roles mean to the people who share an agent. These roles are separate from Hypermedia [roles](../protocol/permissions.md) on documents.

# Idempotency <!-- id:86xaRurd -->

Idempotency means a request you send twice is done once. Many actions take a client id (`clientRequestId` or `clientMessageId`) for this. For each id the server stores: <!-- id:OOJlJzY7 -->
  - account ID; <!-- id:goW-b9GO -->
  - action name; <!-- id:-a9nhdcq -->
  - client request or message ID; <!-- id:WBtePnRT -->
  - request CBOR bytes; <!-- id:CnwKXCEo -->
  - response CBOR bytes; <!-- id:nVl8nX67 -->
  - creation timestamp. <!-- id:eo-O9tll -->

If you send the same id with the same request bytes, the server returns the stored response again. If you send the same id with different request bytes, it returns `409`. <!-- id:uVVixCG7 -->

# See also <!-- id:P08ObkPt -->

- [WebSocket subscriptions](./websocket-subscriptions.md) <!-- id:OeziFpeC -->
- [Seed Agents](../agent.md) <!-- id:vocdFen8 -->
- [Security](../agent/security.md) <!-- id:6ebJZqJM -->
- [Persistence](../operate/persistence.md) <!-- id:ND3MfXyJ -->
- [Identity](../protocol/identity.md) for the keys that sign every request <!-- id:_fLN9hVS -->
