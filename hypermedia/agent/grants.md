---
name: Grants
summary: "Grants are an agent's permissions: which callable tools it may use, whether it may publish signed content, and which MCP servers it may reach."
---
**Grants** are an agent's permissions. They list the [callable tools](./callables.md) it may use (`search`, `web_search`, `execute`, `browser`), whether it holds **publish** (signed public writing, see [write](./write.md)), and which [MCP servers](./mcp.md) are enabled. The verbs are never grants: they are always on. So are the `query` and `attributes` callables. <!-- id:LJVrqOOs -->

A grant is a setting on the agent's definition in the app environment. It is not a protocol [capability](../protocol/permissions.md): a capability delegates write access from one key to another on the network, and a grant decides what the agent's runtime will let the model do. An agent needs both to publish in someone's space: the publish grant, and a capability for one of its [signing identities](./identity.md).

# What is granted <!-- id:tPg5Z6sN -->

Verbs are never grants. They are always on. Two things are granted per agent, both through `definition.tools`: <!-- id:dEtv6vHA -->
  - **The callable set.** `enabledCallableTools()` (`api-service.ts`) intersects the service callables with `definition.tools` (normalized, unknown names ignored). An undefined `tools` array grants all of them. `execute` drops out silently when the host cannot run sandboxes, so the model never sees a tool that can only fail. <!-- id:22xP_Z0w -->
  - **Publish.** `publishGrantEnabled()` (`api-service.ts`) checks for the pseudo-tool name `publish` in `definition.tools`. The older write-group names `write`, `memory_publish_document`, `ipfs_write` and `attachment_to_ipfs` count as `publish` too. An undefined `tools` array publishes. Without the grant, `write` to `hm://` or `ipfs://` returns 403 (`api-service.ts`, `api-service.ts`). Memory writes are never gated. <!-- id:27po_PK5 -->

A third grant sits beside them: `definition.mcpServers` names the account's MCP servers the agent may call, at most 16. It is checked again at call time. See [MCP servers](./mcp.md).

Definition limits: at most 32 tool names, 128 bytes each, 4 KiB total (`api-service.ts`). <!-- id:H43msgHh -->

Unknown names in `tools` are ignored. `execute_code` is read as `execute` (`normalizeSeedToolName()`).

# How grants are enforced

- A callable outside the grant set reads as "no tool named …", so probing does not reveal grants. See [read](./read.md#tool-contracts).
- [Promotion](./promotion.md) is intersected with the grant set before any tool reaches the provider. See [touch-expand and promotion](./tools.md#touch-expand-and-promotion).
- A delegated [child](./child.md) can only narrow its parent's grants. See [delegate](./delegate.md).
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
