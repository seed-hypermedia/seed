---
name: MCP Servers
summary: An account can connect remote Model Context Protocol (MCP) servers, and its agents then call the tools of those servers like any other tool.
---
An **MCP server** is a program, run by someone else, that offers tools over the [Model Context Protocol](https://modelcontextprotocol.io) (MCP). An agent can call those tools. For example, an owner can connect a GitHub MCP server, and the agent can then open an issue with `call {tool: "github__create_issue", …}`. <!-- id:c625NrrN -->

An [account](../protocol/identity.md) connects servers the same way it sets up [model providers](./model-providers.md). Each agent then enables the servers it may use.

Nothing changes in what the model is given. The verbs are still everything. Every remote tool arrives as a [tool document](./tool-document.md) in the agent's `~/tools/`, in its [Space](./space.md). So a remote tool is listed in the [Space index](./space-index.md), read as a [contract](./contract.md), run through [call](./call.md), and [promoted](./promotion.md), like any built-in tool (see [tools](./tools.md)).

This page covers why Seed is an MCP client and not a server, which servers can be connected, how a server's tools become tool documents, what happens when a tool is called, the signed actions that manage servers, and how to connect one in the app.

# Why Seed has no MCP server of its own <!-- id:Dwg2TLco -->

[Seed Agents](../agent.md) is an MCP client. It connects to MCP servers that other people run. Seed has no MCP server that gives outside assistants access to Hypermedia [documents](../protocol/documents.md). <!-- id:BeWYleM1 -->

Hypermedia content must be [signed](../protocol/blobs.md) on the device that holds the key, and the [SDK](../build/sdk.md) or the [CLI](../build/cli.md) built on it does that signing. A hosted MCP server takes plain tool calls and acts on them remotely, so it would need your private key. Keys should never leave your device. The full reasoning, and how to run an MCP interface locally on the SDK, is in [Why there is no Seed MCP server](../build/agents.md). <!-- id:cjYyi-9w -->

An [app environment](../software/app-environment.md) (the server that runs agents) does sign content, with keys that belong to the agent and never with your account key. [Agent identity](./identity.md) explains those keys.

# Scope and transports <!-- id:S2QKCy5- -->

Only **remote HTTP MCP servers** work. The app environment is a hosted server shared by many accounts, so it never starts local `stdio` programs. It accepts two transports: <!-- id:nVH6VoZU -->
  - `http`: Streamable HTTP (the current MCP transport); <!-- id:Ef0YAJO- -->
  - `sse`: legacy HTTP+SSE. <!-- id:b6zqDtTy -->

When `transport` is unset, the service tries Streamable HTTP first. If that fails to connect, it tries SSE, as the MCP guidance for older servers says. It reports the first error. <!-- id:OWJU85Jp -->

The service proves who it is with **fixed request headers**, usually `Authorization: Bearer …` followed by a secret token. The headers are stored as encrypted account secrets. There is no OAuth sign-in. You cannot connect an MCP server that needs a browser login, unless you already have a token that you can paste in as a header. <!-- id:yI5pbk6f -->

Code: `apps/src/mcp.ts` (connect, discover, proxy, the per-run connection pool), `apps/src/tool-documents.ts` (`syncMcpToolDocuments`, the projection), `apps/src/api-service.ts` (actions and runtime wiring). The client is `@modelcontextprotocol/sdk`. <!-- id:8Uz98Y4J -->

# The model <!-- id:1RSrme3h -->

``` <!-- id:GqUFP_6J -->
account ──< mcp_servers (name, config, discovered tools, status)
agent.definition.mcpServers = ['github', 'linear']         ← the grant
agent's tool_documents ⊇ {kind: 'mcp', name: 'github__create_issue', server: 'github', remoteName: 'create_issue', …}
```

<!-- id:PO23EJwG -->
- **Server record** (`mcp_servers`, see [persistence](../operate/persistence.md)): `config_cbor` is `{url, transport?, headers?, secretRefs?}`. `tools_cbor` is the tool list from the last successful discovery. `status_cbor` is `{state: 'ok' | 'error' | 'unknown', error?, checkedAt?}`. <!-- id:s6JkDM8T -->
- **Grant**: `definition.mcpServers` names the servers an agent may call, at most 16 (see [grants](./grants.md)). Server names are slugs (`^[a-z0-9][a-z0-9_-]{0,31}$`) because they prefix every projected tool name. <!-- id:hGv-qhDO -->
- **Projection**: every tool of every enabled server is an `mcp` tool document named `<server>__<tool>`. The remote name is cleaned to `[A-Za-z0-9_-]`, and the whole name is at most 64 characters, which is what providers accept as a tool name. <!-- id:gv4IQ0Vg -->
- The tool document carries the remote description and input schema, plus `server` and `remoteName`. Its [CID](../cid.md) is its version. So when a server changes a contract, the tool document gets a new CID.
- `syncMcpToolDocuments()` brings one agent's `mcp` tool documents in line with its grant. It runs at once on `CreateAgent` and `UpdateAgent`, on every discovery, and on `DeleteMcpServer`. It also runs as a refresh on `ListAgentTools`, at run start, and before a tool that a person runs themselves. It is safe to run many times, and it touches only the database. If a tool document that is not an MCP projection already has a name, it keeps the name, and the conflict is logged.

The remote input schema is kept whole, without `$schema` and `$id`. The local validator is small and ignores keywords it does not know. So `call` still checks what it can, a miss is answered with the real contract, and a promoted tool gives the provider the full schema. Only a schema whose root is not an object is replaced by `{type: 'object'}`. <!-- id:ADKoGGwK -->

# Discovery <!-- id:T5ec9JKZ -->

The service connects to a server to list its tools at these times: <!-- id:GcPRKHRI -->
  - on `SetMcpServer`. The response carries the result, so a client shows "connected, N tools" or the exact failure at once. A failed discovery **still saves** the record, because the owner may be fixing a header or the server may be down; <!-- id:gDBCqG_n -->
  - on `RefreshMcpServer`; <!-- id:f9tEWTJb -->
  - quietly, whenever a run opens a connection to the server (see below). A server that added tools yesterday is current the next time any agent calls it. <!-- id:H5rigbeb -->

A failed discovery records the error and keeps the last good tool list. An outage must not strip tools from agents that will call them once the server is back. A changed tool list is projected again onto every agent that enables the server, and emits `agent-tools-changed`, so an open MCP servers page updates live. <!-- id:r_UXCaDW -->

# Runtime <!-- id:4uUfX7oE -->

A connection opens **only when needed, and only for one run**. Nothing opens when a run starts. The first `call` of a server's tool connects (`McpConnectionPool`; calls made at the same time share one connection). When the run ends, it closes whatever it opened. The pool exists in all three places a verb runs: the agent turn (`#runPiAgent`), a [script](./script.md) child's `ctx.call`, and a tool that a [person runs themselves](./wrench-palette.md) (`InvokeSessionTool`). <!-- id:iygQm_x8 -->

`executeMcpTool` (`api-service.ts`) is the function that `call` uses for an enabled `mcp` tool document: <!-- id:6Yzn2rcM -->
  1. Check the input against the tool document. A miss returns the contract, exactly like a builtin. <!-- id:IesStjEC -->
  2. Check the grant itself (`definition.mcpServers` includes the tool document's server). The projection is a cached copy of the grant. It is not the grant. A server that is not enabled is refused with a 403. <!-- id:0K8mZwC3 -->
  3. Pass the call to the server over the pool, with a 120 second timeout. <!-- id:OMcO8pAO -->
  4. An error the server reports (`isError`, status 400) and any connection failure (status 502) are **thrown**. They land on the [log](./log.md) as `tool_result.error`, which the model can react to. <!-- id:TmDelVzG -->
  5. The result is `{summary, argument?, text?, result?, images?, durationMs}`. <!-- id:tSB7qBHL -->

The fields of the result:

- `argument` is the call's first string argument, if it is short enough (80 characters or fewer) to name what happened.
- `summary` is `<tool> · <argument>`, where `<tool>` is the tool's remote name, without the server prefix. With no argument it is "Ran \<tool> on the \<server> MCP server".
- `text` is the text content joined together, limited to 256 KiB.
- `result` is the server's `structuredContent`.
- Image content goes to models that can view images. The saved event keeps only the count.
- The chat row shows `summary` on a `call` row. On a promoted row it shows only `argument`, because the row's label already names the server and tool. A `description` on the `call` wins over both.

**Promotion** covers remote tools. Once `read ~/tools/github__create_issue` or a `call` of it has entered the transcript, the next turn gives the provider that tool document's name, description, and schema as a provider tool (`toolMetadataFromDocument`). The promotion filter lets through the enabled callable set and the agent's own enabled tool documents that are not builtins, worked out again from the definition when the run starts. A name the model invented, which matches nothing, does nothing. <!-- id:vlilaTLx -->

**Space index**: remote tools list as `- github__create_issue — Open an issue. (github MCP)`. A server with more than six tools becomes one line, `- github__* — 23 tools from the github MCP server (read ~/tools/ to list them)`. So a large server does not fill the index. `read ~/tools/` always lists every tool. <!-- id:mqiujPTt -->

**`read ~/self`** reports `grants.mcpServers`. <!-- id:_uzhv_kC -->

# Signed actions <!-- id:dyULjlLO -->

These actions belong to an account and use the standard signed request ([signed API](../build/signed-api.md)): <!-- id:0AVScR1v -->
  - `ListMcpServers` returns `{servers: RedactedMcpServer[]}` <!-- id:QDr9JzQY -->
  - `SetMcpServer {name, config}` returns `{server}`. It creates or updates by name, then discovers. <!-- id:bPXP3def -->
  - `RefreshMcpServer {name}` returns `{server}`. It discovers again. <!-- id:A9ToD6Up -->
  - `DeleteMcpServer {name}` returns `{name}`. It deletes the record and the header secrets it owns (`mcp-<name>-…`), removes the name from every agent's `mcpServers`, and removes their projected tool documents. <!-- id:pYZU1WNL -->

`RedactedMcpServer` is `{id, name, url, transport, headerNames, secretHeaderNames, hasSecrets, tools, status, createdAt, updatedAt}`. Each `tools` entry is `{name, toolName, description?, inputSchema?}`, where `toolName` is the name of the tool document. Secret values never appear in any response. <!-- id:somuEqlA -->

# Connect a server in the app

The agent's Settings tab has an **MCP servers** page (see [in the app](./in-the-app.md)). To connect a server:

1. Open the agent's Settings tab and choose **MCP servers**.
2. Choose **Add server** and enter the server's URL. The name is suggested from the host.
3. If the server needs a token, add an auth header. The transport is under Advanced; leave it unset to let the service pick.
4. Save. The dialog reports the connect result and enables the server for the current agent.
5. To let another agent on the account use the server, open that agent's MCP servers page and tick the server's checkbox.

Each account server has one row. The row shows the per-agent checkbox, the tool count (or an **Unreachable** chip with the error underneath), an **Auth** chip when a secret header is set, the host, and refresh and remove buttons that show on hover. Clicking the row expands its tools, and a tool opens its contract.

The MCP servers page with two connected servers, one expanded: <!-- id:17Xg_wEo -->

![MCP servers page](ipfs://bafybeidwdn2m5uk3hfcbg7xdqftall32rzuum7qkj3ooluqbq7fvof4e64) <!-- id:XLYrrLZA -->

Adding a server. The name is suggested from the URL, and the record connects on save: <!-- id:BwtA2LBC -->

![Add MCP server dialog](ipfs://bafkreicw7mi45yejxyzcir7wjwgt3a5vna3lnbkmilt5whc2gxqcxdwusy) <!-- id:hjMKkMD_ -->

A [session](./session.md) calling a remote tool through `call`, and a later turn using the promoted tool directly: <!-- id:i3J72GP_ -->

![Session calling an MCP tool](ipfs://bafybeibzb3rav5vl2wmbdatvbgmacc4wr243qu4sui5v4hfwlw6krmpwpy) <!-- id:NSSN0t2A -->

![Session using a promoted MCP tool](ipfs://bafybeihggvitrknklabs2j57h2pkw5jmqqsaiu6l6jswsio42ib7cajnn4) <!-- id:kfmFme7s -->

# Security notes <!-- id:fiOE6Odd -->

- The service reaches a server with URLs and headers the account configured. The same outbound-network rules as `read https://…` apply. There is no private-network allow or deny list ([security](./security.md)). <!-- id:_CkkzuvV -->
- Header values are encrypted at rest and redacted everywhere. The client refuses to send one to a remote app environment that is not on HTTPS. <!-- id:D1pDTsHJ -->
- An enabled server's tools can do whatever the remote server can do. Enabling a server is a grant as strong as [`execute`](./code-execution.md), so the owner should trust the server. <!-- id:ebC4wvxV -->
- The projection is never the authority. `executeMcpTool` checks the grant again, and promotion is filtered against the agent's own enabled tool documents. <!-- id:jJUfsRjO -->

# See also <!-- id:TndNkW8b -->

- [Tools](./tools.md) <!-- id:qgB8xKaF -->
- [Grants](./grants.md) <!-- id:l49WGpFN -->
- [Tool document](./tool-document.md) <!-- id:Q3Dg5LhN -->
- [Call](./call.md) and [callable tools](./callables.md)
- [Agent identity](./identity.md)
- [Security](./security.md) <!-- id:ei-dRYjr -->
- [Signed API](../build/signed-api.md) <!-- id:2fqIPl6q -->
- [Model providers](./model-providers.md) <!-- id:iqVg_ymP -->
- [External agents and the SDK](../build/agents.md) <!-- id:COGSkyzI -->
