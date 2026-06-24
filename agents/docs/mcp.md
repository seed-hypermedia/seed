# MCP servers

Agents can be extended with tools from remote [Model Context Protocol](https://modelcontextprotocol.io) (MCP) servers.
MCP servers are configured per account (like model providers), and each agent chooses which of them to enable. When an
agent runs, the service connects to its enabled MCP servers, lists their tools, and exposes them to the model alongside
the built-in Seed tools.

## Scope and transports

Only **remote HTTP MCP servers** are supported. The hosted, multi-tenant Agents service never spawns local `stdio`
subprocesses. Two transports are accepted:

- `http` — Streamable HTTP (the current MCP transport);
- `sse` — legacy HTTP+SSE.

When a server's `transport` is left unset, the service tries Streamable HTTP first and falls back to SSE on connection
failure, matching the MCP backwards-compatibility guidance.

Implementation lives in `agents/src/mcp.ts` (connection + tool proxying) and `agents/src/api-service.ts` (CRUD actions
and runtime wiring). The MCP client is `@modelcontextprotocol/sdk`.

## Configuration model

An MCP server record is account-scoped and stored in the `mcp_servers` table (see `persistence.md`). Its CBOR config is:

```ts
type McpServerConfig = {
  url: string // http(s) endpoint of the remote MCP server
  transport?: 'http' | 'sse' // default: http with an SSE connect-time fallback
  headers?: Record<string, string> // non-secret headers sent on every request
  secretRefs?: Record<string, string> // header name -> account secret name, resolved to plaintext at connect time
}
```

Secret-backed headers (typically `Authorization`) are stored as encrypted account secrets, exactly like provider API
keys. The desktop client stores them under the name `mcp-<server>-<header>` and references them from `secretRefs`. The
plaintext is never returned to clients; list/redact responses expose only header names and a `hasSecrets` flag.

Per-agent enablement is stored on the agent definition:

```ts
type AgentDefinition = {
  // ...
  mcpServers?: string[] // names of account MCP servers whose tools this agent may use
}
```

## Signed actions

All actions require the standard signed envelope (see `signed-api.md`). They are account-scoped.

- `ListMcpServers` → `ListMcpServersResponse { servers: RedactedMcpServer[] }`
- `SetMcpServer { name, config }` → `SetMcpServerResponse { server }` — create or update by name.
- `DeleteMcpServer { name }` → `DeleteMcpServerResponse { name }` — also deletes header secrets it owns
  (`mcp-<name>-…`).
- `ListMcpServerTools { name }` → `ListMcpServerToolsResponse { name, tools: McpToolInfo[] }` — connects to the server
  and lists its advertised tools; used by the desktop Tools tab for inspection. Returns a `502` if the server cannot be
  reached.

`RedactedMcpServer` is `{id, name, url, transport, headerNames, secretHeaderNames, hasSecrets, createdAt, updatedAt}`.
`McpToolInfo` is `{name, qualifiedName, description?, inputSchema?}`.

## Runtime behavior

At the start of a run (`Service#runPiAgent`), `Service#connectAgentMcpServers` resolves the agent's enabled MCP servers,
connects to each, lists their tools, and builds a Pi tool definition per MCP tool. Those definitions are added to the Pi
session's `customTools`, and their names are added to the active `tools` list. Connections are closed in the run's
`finally` block.

Failure isolation: a missing or unreachable MCP server is logged (`[agents/mcp] …`) and skipped, so the run still
proceeds with whatever tools are available. The failure is also surfaced to the user as a durable `error` session event
(e.g. `MCP server "weather" could not connect: …`, or `… connected but advertised no tools.`) so a silently-missing tool
is visible in the chat rather than just absent. A tool call that the server reports as an error becomes a normal
`tool_result.error` so the model can react.

### Authentication and transports

The integration sends **static request headers** only (including secret-backed ones such as `Authorization: Bearer …`).
It does **not** perform an interactive OAuth authorization-code flow. MCP servers that are OAuth-protected resources
(they answer with `WWW-Authenticate: Bearer` and advertise `/.well-known/oauth-protected-resource`) require a
browser-based login the headless agent cannot complete, so they will fail to connect unless you can supply a
pre-obtained bearer token as a header. Servers that authenticate with a static API key / bearer token in a header work
today. Full OAuth support is a possible future enhancement.

### Tool namespacing

MCP tool names are namespaced per server to avoid collisions with Seed tools and across servers:

```
mcp__<server>__<tool>
```

Each segment is sanitized to the `[a-zA-Z0-9_-]` charset that providers accept for tool names. The model sees the
qualified name; the service maps it back to `(connection, original tool name)` when proxying the call.

### Result handling

MCP tool results are flattened to text for the model: `text` content parts are joined, non-text parts are JSON-encoded
as compact markers, and `structuredContent` is preserved as the tool-result `details`. Output is bounded to 256 KiB (the
tool-result cap) to protect against runaway servers.

## Desktop UI

The agent **Tools** tab has an **MCP servers** section (see `desktop-ui.md`):

- lists account MCP servers with a checkbox per server to enable it for the current agent (writes
  `definition.mcpServers`);
- an **Add server** dialog (name, URL, transport, optional encrypted auth header) backed by `useSaveMcpServer`;
- a per-server info dialog that calls `ListMcpServerTools` to show the tools a server advertises;
- a remove action backed by `useDeleteMcpServer`.

## Security notes

- MCP servers are reached with account-configured URLs and headers; the same outbound-network caveats as `read`/web
  tools apply (no private-network protection or allow/deny lists yet — see `security.md`).
- Secret headers are encrypted at rest and redacted in all responses. The desktop refuses to send a secret header to a
  non-HTTPS remote agent server.
- Enabled MCP tools run with whatever capability the remote server grants. Agent owners should only enable servers they
  trust, since those tools execute during the agent's run.

## Tests

- `agents/src/mcp.test.ts` — namespacing/header helpers plus an end-to-end test that stands up a real Streamable HTTP
  MCP server and verifies connect → list tools → proxy a tool call (including the auth header).
- `agents/src/api-service.test.ts` — MCP server CRUD, redaction, header-secret cleanup on delete, URL validation, and
  `mcpServers` persistence on an agent definition.
