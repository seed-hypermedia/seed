---
name: "Signed API: agents"
summary: The signed API actions that create, read, update, share and delete an agent, list its tools, and the AgentDefinition type.
---
These are the actions of the [signed API](./signed-api.md) that create, read, change, share and delete an [agent](../agent.md), plus the `AgentDefinition` type they carry. The envelope, the endpoint, errors, [access levels](./signed-api.md#access-levels) and idempotency are on the [signed API](./signed-api.md) page.

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

Lists agents owned by the verified account plus agents on which it is an accepted reader or writer, ordered by update time descending. Each `AgentInfo.accessRole` is `owner`, `reader`, or `writer`. An agent read through public access reports `reader`, or `chatter` when public chat is on. Pending invitations are not returned here, on purpose. <!-- id:f9TOEq_f -->

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

Creates a new agent. Checks that the referenced provider exists for the account. Creates a per-agent state directory. <!-- id:UpqB-RM_ -->

When the definition's primary `signingKey` resolves to an `hm-account-key` secret, the server also creates a default enabled activity [trigger](../agent/triggers.md), "Mentions, replies, and comments for \<name>", for that signing identity's account uid: a `user-mention`, a `comment-reply`, and a `document-author-comment` condition (prompt: "Respond to the mention, reply, or comment on your document, performing any action requested."). [Mentioning](../protocol/comments.md) the agent's account, replying to one of its comments, or commenting on a document it authored then starts one session in which it responds. This is best-effort and never blocks agent creation. Agents without a signing key get no default trigger. <!-- id:wKRI3r0c -->

Idempotent when `clientRequestId` is supplied. <!-- id:jGg7N_6g -->

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

Requires reader access. `sessionCount` counts top-level sessions. The sessions themselves come from `ListSessions {agentId, includeChildren: false}`. A protocol 1 client also receives a `sessions` array holding the newest 50. <!-- id:5OveoAaK -->

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

Deletes the agent after validating ownership, including its triggers, sessions, session events, trigger firings, drafts, and per-agent state directory. Live runs of the agent are canceled first, cascading through their trees. Run history survives, detached: `runs.agent_id`, `runs.session_id`, and `runs.trigger_firing_id` are nulled inside the delete transaction. Sub-sessions of _other_ agents hanging off this agent's sessions promote to top level. <!-- id:A1zp81Vg -->

## `MountAgent` and `UnmountAgent`

```ts
{_: 'MountAgent'; agentId: string; documentId: string; blobs?: {cid: string; data: Uint8Array}[]}
{_: 'UnmountAgent'; agentId: string} // the agent's current hm:// id
```

`MountAgent` gives an existing agent the identity of a published [agent document](../agent.md): `documentId` becomes its id. `blobs` are the signed document blobs, so the server finds the document at once. `UnmountAgent` takes the agent out of its document. It gets back the server id it had before the mount, or a fresh one, and keeps its sessions, memory and triggers. Both are owner-only, answer `GetAgentResponse` for the agent under its new id, and return 409 while a memory upload for the agent is in progress.

# Invitations and collaborators <!-- id:XeJ06-b- -->

<!-- id:uP1RBPH- -->
- `ListAgentInvites {}` returns pending `AgentInviteInfo` rows for the signed account. An invite shows only the agent id and name, owner account, role, and timestamps. Agent contents stay hidden until the invite is accepted. <!-- id:QXdXZAig -->
- `ListAgentCollaborators {agentId}` returns the owner and accepted members plus the agent's `publicRead` and `publicChat` flags. The owner also sees pending invitations. <!-- id:Y3SsfCzn -->
- `InviteAgentCollaborator {agentId, accountId, role}` creates an invitation (`reader` or `writer`) or updates an existing member's role. Owner-only. <!-- id:3S5ypQUs -->
- `RemoveAgentCollaborator {agentId, accountId}` revokes an accepted member or cancels a pending invitation. Owner-only. <!-- id:AFxP1gCb -->
- `AcceptAgentInvite {agentId}` accepts the signed account's pending invitation and returns the now-accessible agent. <!-- id:hwpaVx_z -->
- `DeclineAgentInvite {agentId}` deletes the signed account's pending invitation. <!-- id:y1o0tauS -->
- `SetAgentPublicRead {agentId, publicRead}` turns public read access on or off. Owner-only. While on, every signed account that knows the agent id is treated as a `reader` (the same view an invited reader gets, including live subscriptions). The agent is still never returned from `ListAgents` or account-wide `ListSessions` for accounts that are not owner or collaborator. `AgentInfo.publicRead` reports the flag. Turning it off also clears `publicChat`. <!-- id:elsEgXJK -->
- `SetAgentPublicChat {agentId, publicChat}` turns public chat on or off. Owner-only, and enabling requires `publicRead` to already be on (400 otherwise). While on, every signed account that reads the agent publicly is a `chatter`: it may `CreateSession`, `MessageSession`, `UploadSessionAttachment` (and the chunked-upload actions targeting a session), `StopSession`, and `RetrySession` on any of the agent's sessions. It still cannot do anything writer-level: `UpdateAgent`, memory, tool, or trigger writes, `UpdateSession`, `DeleteSession`, `InvokeSessionTool`, `CancelRun`, `SignalRun`. `AgentInfo.publicChat` reports the flag. <!-- id:K_uUcnRP -->

The roles and what each may do are in [access levels](./signed-api.md#access-levels). How sharing works for the people involved is in [agent sharing](../agent/sharing.md). An agent role never grants changes to the owner's providers or secrets.

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

Lists every [tool document](../agent/tool-document.md) in the agent's `~/tools` from the `tool_documents` table. It rebuilds the builtin rows first if the registry contract has changed. This is the reader's view of the same documents the agent sees when it reads `~/tools/`. See [tools](../agent/tools.md). <!-- id:ckP2uqGJ -->

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

`SaveAgentTool` is refused with 410. An agent does not hold private code tools: a [tool](../tool.md) is a document published under an app or an agent. `DeleteAgentTool` deletes one authored tool document that is still stored. `deleted` is false when it was already absent.

# Agent definition <!-- id:MQfS-lax -->

```ts <!-- id:iQMhgrPv -->
type AgentDefinition = {
  name: string
  systemPrompt: string | AgentPromptBlock[]
  modelProvider: string
  model: string
  reasoningLevel?: ReasoningLevel
  thoroughness?: Thoroughness // delegation preset: quick, normal, deep
  enabledModels?: AgentModelRef[] // models a delegate child may pick
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

The agent as a concept is on the [agent](../agent.md) page. The rules the server applies to the fields:

- `systemPrompt` is stored as Seed [block nodes](../block/node.md). A string is parsed as markdown. <!-- id:lhfIMIOl -->
- `reasoningLevel` applies to reasoning-capable models and must be one of the levels `modelReasoningSupport` reports for the model (`apps/protocol/src/reasoning.ts`). Absent means off, or the provider default where reasoning cannot be disabled. <!-- id:MeW0UZKi -->
- `tools` is a grant list. It does not define the tool surface: the verbs are never granted or revoked. An omitted array grants every callable tool and the right to publish. An explicit array keeps only the names it lists, and `publish` is the name that allows signed public writing. See [grants](../agent/grants.md). <!-- id:69h9HRvq -->
- `AgentDefinition.mcpServers?: string[]` (≤ 16 names) is the per-agent [grant](../agent/grants.md), accepted by `CreateAgent` and `UpdateAgent`. <!-- id:O34ZBJJq -->
- `signingKeys` holds the secret names of the [signing identities](./signed-api-providers.md#signing-identities) the agent may sign with. `signingKey` is the single-key form, accepted for older clients. Only the owner may change the set. <!-- id:U9fN8wVf -->

# See also

- [Signed API](./signed-api.md)
- [Providers and identities](./signed-api-providers.md)
- [Sessions and runs](./signed-api-sessions.md)
- [Agent](../agent.md)
- [Grants](../agent/grants.md)
- [Tools](../agent/tools.md) <!-- id:zhoOWj1- -->
