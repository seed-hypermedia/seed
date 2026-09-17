---
name: "RPC: Resource"
summary: "Fetches a resource by parsed id and returns whichever state it is in: document, comment, redirect, not found, tombstone, or error."
schemaDefinition: ipfs://bafyreifkdekhx2khdpw74hg65kisb7xprznasxhzx6ewbmozdpj7c4u5zq
---
Fetches a resource (document, comment, redirect, …) by parsed id. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:0FgdDO0r -->

This page describes the **rpc/resource** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:qsZY_yJS -->

# Shape <!-- id:wRYJGS_e -->

A **closed struct** with these fields: <!-- id:utly96z5 -->
  - `key` _(required)_ — `"Resource"` <!-- id:UToawi30 -->
  - `input` _(required)_ — [rpc/type/id](./type/id.md) <!-- id:FVQ72Tj4 -->
  - `output` _(required)_ — [rpc/type/resource](./type/resource.md) <!-- id:-cmT97ah -->

# Depends on <!-- id:jnPQmqvS -->

- [rpc/type/id](./type/id.md) <!-- id:gdMZoKdz -->
- [rpc/type/resource](./type/resource.md) <!-- id:Qt87mW4L -->
