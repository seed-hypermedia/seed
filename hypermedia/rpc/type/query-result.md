---
name: Query Result
summary: The documents a query matched, listed under the queried id. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreiavgrtyh2klx3ksvpvb5zgl7hzkpjfrkjgmjoh6irpqi55tsum6nu
---
This document describes the **rpc/type/query-result** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:02nM8--s -->

# Shape <!-- id:IU9zCBCy -->

A **closed struct** with these fields: <!-- id:EvmdoseV -->
  - `in` _(required)_ — [rpc/type/id](./id.md) <!-- id:JZ6P9O4y -->
  - `results` _(required)_ — list of [rpc/type/document-info](./document-info.md) <!-- id:eo8ia6we -->
  - `mode` — one of `"Children"` | `"AllDescendants"` <!-- id:RePHCtTX -->

# Depends on <!-- id:uRtiQkyh -->

- [rpc/type/document-info](./document-info.md) <!-- id:U3vw88Mz -->
- [rpc/type/id](./id.md) <!-- id:l99ph1Cb -->
