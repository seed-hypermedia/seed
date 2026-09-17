---
name: MCP Servers
summary: How an account connects remote Model Context Protocol servers so its agents can call their tools as ordinary tool documents, which makes Seed Agents an MCP client.
---
Agents can call tools from remote [Model Context Protocol](https://modelcontextprotocol.io) (MCP) servers. An [account](../protocol/identity.md) connects servers the same way it configures [model providers](./model-providers.md), and each agent enables the servers it may use. The model-facing surface does not change. The verbs are still the whole surface, and every remote tool arrives as a [tool document](./tool-document.md) in the agent's `~/tools/`. So it is listed in the [Space index](./space-index.md), read as a [contract](./contract.md), dispatched through [call](./call.md), and [promoted](./promotion.md) like any builtin or lambda (see [tools](./tools.md)). <!-- id:c625NrrN -->

# Why Seed has no MCP server of its own

[Seed Agents](../agent.md) is an MCP client. It connects to MCP servers that other people run. Seed has no MCP server that exposes Hypermedia to outside assistants.

Hypermedia content must be [signed](../protocol/blobs.md) on the device that holds the key, and the [SDK](../build/sdk.md) or the [CLI](../build/cli.md) built on it does that signing. A hosted MCP server takes plain tool calls and acts on them remotely, so it would need your private key. Keys should never leave your device. The full reasoning, and how to run an MCP interface locally on the SDK, is in [Why there is no Seed MCP server](../build/agents.md).

An agents server does sign content, and that fits the same rule. The keys it signs with are the agent's own. `CreateSigningIdentity` generates a new key on that server, publishes a [profile](../protocol/identity.md) for it, and stores the key encrypted. Your account key stays on your device. For the agent to publish in your space, you delegate a `WRITER` or `AGENT` [capability](../protocol/permissions.md) to the agent's key.

Agent keys are less secure than your personal identity by design, because the agents server holds them. That is one reason to give an agent its own key instead of your personal one. `ImportSigningIdentity`, the Import key button in the accounts dialog, sends the seed of an existing `.hmkey.json` [key](../build/keys.md) to the server, so only import a key made for the agent. If you don't want a hosted server to hold your agent keys, [self-host the agents server](../apps/agents.md).

# Scope and transports <!-- id:S2QKCy5- -->

Only **remote HTTP MCP servers** work. The hosted, multi-tenant Agents service never spawns local `stdio` subprocesses. It accepts two transports: <!-- id:nVH6VoZU -->
  - `http`: Streamable HTTP (the current MCP transport); <!-- id:Ef0YAJO- -->
  - `sse`: legacy HTTP+SSE. <!-- id:b6zqDtTy -->

When `transport` is unset, the service tries Streamable HTTP first and falls back to SSE if the connect fails, following the MCP backwards-compatibility guidance. It reports the first error. <!-- id:OWJU85Jp -->

Authentication uses **static request headers**, usually `Authorization: Bearer …`, stored as encrypted account secrets. There is no interactive OAuth flow. You cannot connect an MCP server that needs a browser login unless you can paste a token you already have in as a header. <!-- id:yI5pbk6f -->

Code: `agents/src/mcp.ts` (connect, discover, proxy, the per-run connection pool), `agents/src/tool-documents.ts` (`syncMcpToolDocuments`, the projection), `agents/src/api-service.ts` (actions and runtime wiring). The client is `@modelcontextprotocol/sdk`. <!-- id:8Uz98Y4J -->

# The model <!-- id:1RSrme3h -->

``` <!-- id:GqUFP_6J -->
account ──< mcp_servers (name, config, discovered tools, status)
agent.definition.mcpServers = ['github', 'linear']         ← the grant
agent's tool_documents ⊇ {kind: 'mcp', name: 'github__create_issue', server: 'github', remoteName: 'create_issue', …}
```

<!-- id:PO23EJwG -->
- **Server record** (`mcp_servers`, see [persistence](./persistence.md)): `config_cbor` is `{url, transport?, headers?, secretRefs?}`. `tools_cbor` is the tool list from the last successful discovery. `status_cbor` is `{state: 'ok' | 'error' | 'unknown', error?, checkedAt?}`. <!-- id:s6JkDM8T -->
- **Grant**: `definition.mcpServers` names the servers an agent may call, at most 16 (see [grants](./grants.md)). Server names are slugs (`^[a-z0-9][a-z0-9_-]{0,31}$`) because they prefix every projected tool name. <!-- id:hGv-qhDO -->
- **Projection**: every tool of every enabled server is an `mcp` tool document named `<server>__<tool>`. The remote name is sanitized to `[A-Za-z0-9_-]`, and the whole name is capped at 64 characters, which is what providers accept as a tool name. The document carries the remote description and input schema, plus `server` and `remoteName`. Its [CID](../protocol/blobs.md) is its version, so when a server changes a contract the document gets a new CID. `syncMcpToolDocuments()` brings one agent's `mcp` documents in line with its grant. It runs right away on `CreateAgent`/`UpdateAgent`, on every discovery, and on `DeleteMcpServer`. As a best-effort refresh it also runs on `ListAgentTools`, at run start, and before a user's palette verb. It is idempotent and touches only the database. If an authored lambda already holds a name, the lambda keeps it and the conflict is logged. <!-- id:gv4IQ0Vg -->

The remote input schema is kept whole, minus `$schema` and `$id`. The bounded local validator ignores keywords it does not model. So `call` still validates what it can, touch-expand answers a miss with the real contract, and a promoted tool hands the provider the full schema. Only a root that is not an object falls back to `{type: 'object'}`. <!-- id:ADKoGGwK -->

# Discovery <!-- id:T5ec9JKZ -->

The service connects to a server to list its tools at these times: <!-- id:GcPRKHRI -->
  - on `SetMcpServer`. The response carries the result, so a client shows "connected, N tools" or the exact failure at once. A failed discovery **still saves** the record, because the owner may be fixing a header or the server may be down; <!-- id:gDBCqG_n -->
  - on `RefreshMcpServer`; <!-- id:f9tEWTJb -->
  - quietly, whenever a run opens a connection to the server (see below). A server that added tools yesterday is current the next time any agent calls it. <!-- id:H5rigbeb -->

A failed discovery records the error and keeps the last good tool list. An outage must not strip tools from agents that will call them once the server is back. A changed tool list is projected again onto every agent that enables the server, and emits `agent-tools-changed`, so an open Tools tab updates live. <!-- id:r_UXCaDW -->

# Runtime <!-- id:4uUfX7oE -->

Connections are **lazy and per run**. Nothing opens at run start. The first `call` of a server's tool connects (`McpConnectionPool`, where concurrent calls share the handshake), and the run's teardown closes whatever it opened. The pool exists in all three places a verb runs: the agent turn (`#runPiAgent`), a [script](./script.md) child's `ctx.call`, and a user's [wrench palette](./wrench-palette.md) verb (`InvokeSessionTool`). No place that can make a call lacks it. <!-- id:iygQm_x8 -->

`executeMcpTool` (`api-service.ts`) is the executor that `call` dispatches to for an enabled `mcp` document: <!-- id:6Yzn2rcM -->
  1. Validate the input against the document. A miss returns the contract, exactly like a builtin. <!-- id:IesStjEC -->
  2. Check the grant itself (`definition.mcpServers` includes the document's server). The projection is a cache of the grant. It is not the grant. <!-- id:0K8mZwC3 -->
  3. Proxy the call over the pool with a 120s timeout. <!-- id:OMcO8pAO -->
  4. A server-reported error (`isError`) and any transport failure are **thrown**. They land on the [log](./log.md) as `tool_result.error`, which the model can react to. <!-- id:TmDelVzG -->
  5. The result is `{summary, argument?, text?, result?, images?, durationMs}`. `argument` is the call's first string argument, if it is short enough (≤ 80 chars) to name what happened. `summary` is `<tool> · <argument>`, or "Ran \<tool> on the \<server> MCP server" without an argument. `text` is the joined text content, bounded at 256 KiB. `result` is the server's `structuredContent`. Image content goes to vision models as inline parts, and the durable event keeps only the count. The chat row shows `summary` on a `call` row, and just `argument` on a promoted row, whose label already names the server and tool. A `description` on the `call` wins over both. <!-- id:tSB7qBHL -->

**Promotion** covers remote tools. Once `read ~/tools/github__create_issue` or a `call` of it has entered the transcript, the next turn hands the provider that document's name, description, and schema as a provider tool (`toolMetadataFromDocument`). The promotion filter admits the enabled callable set plus the agent's own enabled non-builtin documents, derived again from the definition at run start. A hallucinated name that matches nothing does nothing. <!-- id:vlilaTLx -->

**Space index**: remote tools list as `- github__create_issue — Open an issue. (github MCP)`. A server with more than six tools collapses to one line, `- github__* — 23 tools from the github MCP server (read ~/tools/ to list them)`, so a large server does not overflow the index budget. `read ~/tools/` always lists every tool. <!-- id:mqiujPTt -->

**`read ~/self`** reports `grants.mcpServers`. <!-- id:_uzhv_kC -->

# Signed actions <!-- id:dyULjlLO -->

These are account-scoped and use the standard envelope ([signed API](./signed-api.md)): <!-- id:0AVScR1v -->
  - `ListMcpServers` returns `{servers: RedactedMcpServer[]}` <!-- id:QDr9JzQY -->
  - `SetMcpServer {name, config}` returns `{server}`. It creates or updates by name, then discovers. <!-- id:bPXP3def -->
  - `RefreshMcpServer {name}` returns `{server}`. It discovers again. <!-- id:A9ToD6Up -->
  - `DeleteMcpServer {name}` returns `{name}`. It deletes the record and the header secrets it owns (`mcp-<name>-…`), removes the name from every agent's `mcpServers`, and drops their projected documents. <!-- id:pYZU1WNL -->

`RedactedMcpServer` is `{id, name, url, transport, headerNames, secretHeaderNames, hasSecrets, tools, status, createdAt, updatedAt}`. Each `tools` entry is `{name, toolName, description?, inputSchema?}`, where `toolName` is the document name. Secret values never appear in any response. <!-- id:somuEqlA -->

# Desktop and web UI <!-- id:RUHSVzo5 -->

The Tools tab ends with an **MCP servers** section (see [desktop UI](./desktop-ui.md)). Each account server has one row with a per-agent checkbox, the tool count (or an **Unreachable** chip with the error underneath), an **Auth** chip when a secret header is set, the host, and refresh and remove buttons that show on hover. Clicking the row expands its tools, and a tool opens its contract. **Add server** takes a URL (the name is suggested from the host), an optional auth header, and the transport under Advanced. The dialog reports the connect result and enables the server for the current agent. <!-- id:de103FVW -->

# Screenshots <!-- id:qIYK5ezJ -->

The Tools tab with two connected servers, one expanded: <!-- id:17Xg_wEo -->

![Tools tab with MCP servers](ipfs://bafybeidwdn2m5uk3hfcbg7xdqftall32rzuum7qkj3ooluqbq7fvof4e64) <!-- id:XLYrrLZA -->

Adding a server. The name is suggested from the URL, and the record connects on save: <!-- id:BwtA2LBC -->

![Add MCP server dialog](ipfs://bafkreicw7mi45yejxyzcir7wjwgt3a5vna3lnbkmilt5whc2gxqcxdwusy) <!-- id:hjMKkMD_ -->

A session calling a remote tool through `call`, and a later turn using the promoted tool directly: <!-- id:i3J72GP_ -->

![Session calling an MCP tool](ipfs://bafybeibzb3rav5vl2wmbdatvbgmacc4wr243qu4sui5v4hfwlw6krmpwpy) <!-- id:NSSN0t2A -->

![Session using a promoted MCP tool](ipfs://bafybeihggvitrknklabs2j57h2pkw5jmqqsaiu6l6jswsio42ib7cajnn4) <!-- id:kfmFme7s -->

# Security notes <!-- id:fiOE6Odd -->

- The service reaches a server with URLs and headers the account configured. The same outbound-network rules as `read https://…` apply. There is no private-network allow or deny list yet ([security](./security.md)). <!-- id:_CkkzuvV -->
- Header values are encrypted at rest and redacted everywhere. The client refuses to send one to a remote agents server that is not on HTTPS. <!-- id:D1pDTsHJ -->
- An enabled server's tools can do whatever the remote server can do. Enabling a server is a grant as strong as `execute`, so the owner should trust the server. <!-- id:ebC4wvxV -->
- The projection is never the authority. `executeMcpTool` checks the grant again, and promotion is filtered against the agent's own enabled documents. <!-- id:jJUfsRjO -->

# Tests <!-- id:5L5OTGEm -->

- `agents/src/mcp.test.ts`: naming, headers, result flattening, a real Streamable HTTP round trip (auth header included), discovery, and the pool (one handshake per server, shared by concurrent calls, closed together). `agents/src/mcp-test-server.ts` is the throwaway server the tests start. <!-- id:fWdWlKKb -->
- `agents/src/tool-documents.test.ts`: the projection: sync, CID bump on a contract change, removal when disabled, lambda-name conflicts, refusal to delete or replace a remote tool. <!-- id:N1jdjOQv -->
- `agents/src/verbs.test.ts`: `call` dispatch to a remote tool, touch-expand on a miss, thrown server and transport errors, the grant check, image content, index and listing tags, and the per-server collapse. <!-- id:zF_OhFKt -->
- `agents/src/api-service.test.ts`: the actions end to end against a live test server. It covers discovery on save, invalid names, URLs, and headers, a saved but unreachable server, projection onto agents through `CreateAgent`/`UpdateAgent`, and delete scrubbing agents and secrets. It also runs a full session: the user calls a remote tool from the palette, the agent calls it through `call`, and the tool is promoted on the next turn. <!-- id:-mezCZ8h -->

# See also

- [Tools](./tools.md)
- [Grants](./grants.md)
- [Tool document](./tool-document.md)
- [Security](./security.md)
- [Signed API](./signed-api.md)
- [Model providers](./model-providers.md)
- [External agents and the SDK](../build/agents.md)
