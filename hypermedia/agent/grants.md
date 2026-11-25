---
name: Grants
summary: "Grants are an agent's permissions: which callable tools it may use, whether it may publish signed content, and which MCP servers it may reach."
---
**Grants** are an [agent](../agent.md)'s permissions. The owner sets them, and they say what the agent is allowed to do. For example, an owner can let an agent search the web but not run code. <!-- id:LJVrqOOs -->

Three things are granted:

- which [callable tools](./callables.md) the agent may use: `search`, `web_search`, [`execute`](./code-execution.md), `browser`;
- whether it holds **publish**, the right to publish signed public content (see [write](./write.md));
- which [MCP servers](./mcp.md) it may reach.

Verbs are never grants. They are always on. So are the `query` and `attributes` callables, which only read the [attributes](../metadata.md) of [documents](../protocol/documents.md) the agent can already read.

A grant is a setting on the agent's definition in the [app environment](../software/app-environment.md). It is not a protocol [capability](../protocol/permissions.md). A capability gives one key write access to another key's space on the network. A grant decides what the agent's runtime lets the model do. To publish in someone's space an agent needs both: the publish grant, and a capability for one of its [signing identities](./identity.md).

# What is granted <!-- id:tPg5Z6sN -->

The callable tools and publishing live in `definition.tools`. MCP servers live in `definition.mcpServers`. <!-- id:dEtv6vHA -->
  - **The callable set.** `enabledCallableTools()` (`api-service.ts`) keeps the server's callables that `definition.tools` also names. An undefined `tools` array grants all of them. `execute` is left out when the host cannot run sandboxes, so the model never sees a tool that can only fail. <!-- id:22xP_Z0w -->
  - **Publish.** `publishGrantEnabled()` (`api-service.ts`) looks for the name `publish` in `definition.tools`. The older names `write`, `memory_publish_document`, `ipfs_write` and `attachment_to_ipfs` count as `publish` too. An undefined `tools` array grants publish. Without the grant, a `write` to `hm://` or `ipfs://` returns 403. Memory writes never need a grant. <!-- id:27po_PK5 -->
  - **MCP servers.** `definition.mcpServers` names the MCP servers of the [account](../protocol/identity.md) that the agent may call, at most 16. The grant is checked again at call time. See [MCP servers](./mcp.md).

Limits on the definition: at most 32 tool names, 128 bytes each, 4 KiB total (`api-service.ts`). <!-- id:H43msgHh -->

Unknown names in `tools` are ignored. `execute_code` is read as `execute` (`normalizeSeedToolName()`).

# How grants are enforced

- A callable the agent is not granted reads as "no tool named …". So a read does not reveal which grants exist. See [read](./read.md#tool-contracts).
- A [promoted](./promotion.md) tool reaches the provider only if the agent is granted it. See [touch-expand and promotion](./tools.md#touch-expand-and-promotion).
- A delegated [child](./child.md) can have the same grants as its parent or fewer, never more. See [delegate](./delegate.md).
- `read ~/self` shows the agent its own grants (`callableTools`, `publish`, `mcpServers`).
- The threat model behind these rules is in [security](./security.md).

# See also <!-- id:9jBWDcZ- -->

- [Call](./call.md) <!-- id:n9eg3YZk -->
- [Write](./write.md) <!-- id:rPjQci6m -->
- [MCP servers](./mcp.md) <!-- id:20a5RPs6 -->
- [Promotion](./promotion.md) <!-- id:vkOIfAsj -->
- [Tools](./tools.md) <!-- id:fgi6zYqs -->
- [Security](./security.md) <!-- id:yiEe8NkR -->
- [Capabilities in the protocol](../protocol/permissions.md) <!-- id:EACUHzq2 -->
- [Agent identity](./identity.md)
