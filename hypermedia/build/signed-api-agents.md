---
name: "Signed API: agents"
summary: This page lists the signed API actions that create, read, update, share and delete an agent and list its tools, and it defines the AgentDefinition type.
---
These actions of the [signed API](./signed-api.md) create, read, change, share and delete an [agent](../agent.md). The page also defines `AgentDefinition`, the type that describes an agent. The [signed API](./signed-api.md) page covers what every action shares: the endpoint, the envelope, errors, [access levels](./signed-api.md#access-levels) and idempotency.

# Agents

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

Lists the agents that the signing [account](../protocol/identity.md) owns, plus the agents where it is an accepted reader or writer. The most recently updated agent comes first. Each `AgentInfo.accessRole` is `owner`, `reader`, or `writer`. Pending invitations are not in this list; `ListAgentInvites` returns them. <!-- id:f9TOEq_f -->

## `CreateAgent` <!-- id:DeLxhuvH -->

Request: <!-- id:JSY487AM -->

```ts <!-- id:DECcpfSS -->
{
  _: 'CreateAgent'
  definition: AgentDefinition
  mount?: {documentId: string; blobs?: {cid: string; data: Uint8Array}[]} // create at this published document
  clientRequestId?: string
}
```

Response: `{_: 'CreateAgentResponse'; agentId: string}`.

Creates a new agent. The server checks that the account has the model provider the definition names, and creates a state folder for the agent. <!-- id:UpqB-RM_ -->

When the agent has at least one signing identity, the server also creates one enabled `activity` [trigger](../trigger.md) named "Mentions, replies, and comments for \<name>". It has three conditions: a `user-mention`, a `comment-reply` and a `document-author-comment`. Each one names the account `self`, which means whichever accounts the agent signs as at the time, so the trigger keeps working if the agent's account changes. Its prompt is "Respond to the mention, reply, or comment on your document, performing any action requested." So when someone [mentions](../protocol/links-and-citations.md) the agent's account, replies to one of its [comments](../protocol/comments.md), or comments on a [document](../protocol/documents.md) it wrote, one session starts and the agent responds in it. If creating this trigger fails, the agent is still created. An agent with no signing identity gets no default trigger. [Agent triggers](../agent/triggers.md) has the details. <!-- id:wKRI3r0c -->

With a `clientRequestId`, the action is [idempotent](./signed-api.md#idempotency). <!-- id:jGg7N_6g -->

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
{_: 'GetAgentResponse'; agent: AgentInfo; sessionCount: number}
```

Needs reader access. `sessionCount` counts top-level [sessions](../agent/session.md). To get the sessions themselves, send `ListSessions {agentId, includeChildren: false}`. A protocol 1 client also receives a `sessions` array with the newest 50. If you read the agent through public access, `agent.accessRole` is `reader`, or `chatter` when public chat is on. <!-- id:5OveoAaK -->

## `UpdateAgent` <!-- id:YMWNoJDM -->

Request: <!-- id:6hWqBlwi -->

```ts <!-- id:hNnkEZ67 -->
{
  _: 'UpdateAgent'
  agentId: string
  definition: AgentDefinition
}
```

Replaces the definition. The owner or an accepted writer can send it. The server first checks the model provider and the signing identities against the owner's account. <!-- id:ki1fJPuP -->

Response: `GetAgentResponse`, the agent as it is after the change. If the agent is mounted on a document, its name comes from the document and the `name` you send is ignored. Only the owner can change `signingKeys`; a writer who changes them gets a `403`.

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

Deletes the agent. Only the owner can do this. The server deletes the agent's triggers, sessions, session events, trigger firings, drafts and state folder. Its tool documents, collaborators, pending invitations and webhook secrets are deleted too. The server first cancels the agent's live [runs](../agent/runs.md) and every run below them. The history of runs stays, but no longer points at the agent: `runs.agent_id`, `runs.session_id` and `runs.trigger_firing_id` are set to null in the same transaction. A sub-session of another agent that hung under one of this agent's sessions becomes a top-level session. <!-- id:A1zp81Vg -->

## `MountAgent` and `UnmountAgent`

```ts
{_: 'MountAgent'; agentId: string; documentId: string; blobs?: {cid: string; data: Uint8Array}[]}
{_: 'UnmountAgent'; agentId: string} // the agent's current hm:// id
```

`MountAgent` gives an existing agent the identity of a published [agent document](../agent.md): `documentId` becomes its id. `blobs` are the signed [blobs](../protocol/blobs.md) of the document, so the server has the document at once. `UnmountAgent` takes the agent out of its document. The agent gets back the server id it had before the mount, or a new one, and keeps its sessions, memory and triggers. Only the owner can send either action. Both answer with `GetAgentResponse` for the agent under its new id, and both return 409 while a memory upload for the agent is in progress. [Mounting](../agent/mounting.md) explains the idea.

# Invitations and collaborators <!-- id:XeJ06-b- -->

<!-- id:uP1RBPH- -->
- `ListAgentInvites {}` returns pending `AgentInviteInfo` rows for the signed account. An invite shows only the agent id and name, owner account, role, and timestamps. Agent contents stay hidden until the invite is accepted. <!-- id:QXdXZAig -->
- `ListAgentCollaborators {agentId}` returns the owner and accepted members plus the agent's `publicRead` and `publicChat` flags. The owner also sees pending invitations. <!-- id:Y3SsfCzn -->
- `InviteAgentCollaborator {agentId, accountId, role}` creates an invitation (`reader` or `writer`) or updates an existing member's role. Owner-only. <!-- id:3S5ypQUs -->
- `RemoveAgentCollaborator {agentId, accountId}` revokes an accepted member or cancels a pending invitation. Owner-only. <!-- id:AFxP1gCb -->
- `AcceptAgentInvite {agentId}` accepts the signed account's pending invitation and returns the now-accessible agent. <!-- id:hwpaVx_z -->
- `DeclineAgentInvite {agentId}` deletes the signed account's pending invitation. <!-- id:y1o0tauS -->
- `SetAgentPublicRead {agentId, publicRead}` turns public read access on or off. Owner-only. While it is on, every signed account that knows the agent id is a `reader`. It sees what an invited reader sees, including live subscriptions. `ListAgents` and the account-wide `ListSessions` still never return the agent to an account that is not the owner or a collaborator. `AgentInfo.publicRead` reports the flag. Turning it off also turns `publicChat` off. Turning it on disconnects any [session browser](./signed-api-sessions.md#session-browser). <!-- id:elsEgXJK -->
- `SetAgentPublicChat {agentId, publicChat}` turns public chat on or off. Owner-only. You can turn it on only when `publicRead` is already on; otherwise the answer is 400. While it is on, every signed account that reads the agent publicly is a `chatter`: it may `CreateSession`, `MessageSession`, `UploadSessionAttachment` (and the chunked-upload actions targeting a session), `StopSession`, and `RetrySession` on any of the agent's sessions. It still cannot do anything writer-level: `UpdateAgent`, memory, tool, or trigger writes, `UpdateSession`, `DeleteSession`, `InvokeSessionTool`, `CancelRun`, `SignalRun`. `AgentInfo.publicChat` reports the flag. <!-- id:K_uUcnRP -->

[Access levels](./signed-api.md#access-levels) lists the roles and what each may do. [Agent sharing](../agent/sharing.md) explains sharing for the people involved. No role on an agent lets you change the owner's providers or secrets.

# Tools

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

Lists every [tool document](../agent/tool-document.md) in the agent's `~/tools`. These are the same documents the agent sees when it reads `~/tools/`. Before it answers, the server rewrites any built-in tool document whose definition in the code has changed. See [tools](../agent/tools.md). <!-- id:ckP2uqGJ -->

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

## `SaveAgentTool` and `DeleteAgentTool`

```ts
{_: 'SaveAgentTool'; agentId: string; tool: AgentToolInput; previousName?: string}
{_: 'DeleteAgentTool'; agentId: string; name: string}
  → {_: 'DeleteAgentToolResponse'; agentId: string; name: string; deleted: boolean}
```

The server refuses `SaveAgentTool` with 410. An agent does not hold private code tools: a [tool](../tool.md) is a document published under an app or an agent. `DeleteAgentTool` deletes one authored tool document that the server still stores. `deleted` is false when there was nothing to delete.

# Agent definition <!-- id:MQfS-lax -->

```ts <!-- id:iQMhgrPv -->
type AgentDefinition = {
  name: string
  systemPrompt: string | AgentPromptBlock[]
  modelProvider: string
  model: string
  reasoningLevel?: ReasoningLevel
  thoroughness?: Thoroughness // delegation preset: quick, normal, deep
  enabledModels?: AgentModelRef[] // extra models the user ticked: shown in the model switcher, and allowed for delegate children
  tools?: string[]
  mcpServers?: string[]
  signingKey?: string
  signingKeys?: string[]
  metadata?: Record<string, unknown>
}

type AgentPromptBlock = {
  block: Record<string, unknown> & {id: string; type: string}
  children?: AgentPromptBlock[]
}
```

The [agent](../agent.md) page explains what an agent is. The server applies these rules to the fields:

- `systemPrompt` is stored as a tree of [blocks](../protocol/blocks.md), in the [block node](../block/node.md) shape. The server parses a string as markdown. <!-- id:lhfIMIOl -->
- `reasoningLevel` applies to models that can reason. It must be one of the levels that `modelReasoningSupport` reports for the model (`apps/protocol/src/reasoning.ts`). Without it, reasoning is off, or at the provider's default where reasoning cannot be turned off. <!-- id:MeW0UZKi -->
- `tools` is a list of [grants](../agent/grants.md). It does not decide which verbs the agent has: the verbs are never granted or taken away. With no array, the agent may call every tool and may publish. With an array, the agent keeps only the names in it, and `publish` is the name that allows signed public writing. <!-- id:69h9HRvq -->
- `mcpServers` lists the account's [MCP servers](../agent/mcp.md) this agent may call, at most 16 names. <!-- id:O34ZBJJq -->
- `signingKeys` holds the secret names of the [signing identities](./signed-api-providers.md#signing-identities) the agent may sign with. `signingKey` is the form with one key, accepted for older clients. Only the owner may change the set. <!-- id:U9fN8wVf -->

# See also

- [Signed API](./signed-api.md)
- [Providers and identities](./signed-api-providers.md)
- [Sessions and runs](./signed-api-sessions.md)
- [Agent](../agent.md)
- [Grants](../agent/grants.md)
- [Tools](../agent/tools.md) <!-- id:zhoOWj1- -->
