---
name: "RPC: Resource"
summary: "Fetches a resource (document, comment, redirect, …) by parsed id. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` fiel"
schemaDefinition: ipfs://bafyreifpfug5duvj5xk42wi7jq3vmed6umvrr5urcx7tfalxapjsdvgpjq
---
Fetches a resource (document, comment, redirect, …) by parsed id. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:0FgdDO0r -->

This document describes the **seed-rpc-resource** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:qsZY_yJS -->

# Shape <!-- id:wRYJGS_e -->

A **closed struct** with these fields: <!-- id:utly96z5 -->
  - `key` _(required)_ — `string` enum: `Resource` <!-- id:UToawi30 -->
  - `input` _(required)_ — [seed-id](./seed-id.md) <!-- id:FVQ72Tj4 -->
  - `output` _(required)_ — [seed-resource](./seed-resource.md) <!-- id:-cmT97ah -->

# Depends on <!-- id:jnPQmqvS -->

- [seed-id](./seed-id.md) <!-- id:gdMZoKdz -->
- [seed-resource](./seed-resource.md) <!-- id:Qt87mW4L -->
