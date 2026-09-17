---
name: Query Result
summary: "The documents a query matched, listed under the queried id together with the mode (children or all descendants) that was used."
schemaDefinition: ipfs://bafyreigsuyglngb3yrik7kdvsczwgjheao7ccd6ncwif6zp5kenon2cvka
---
This page describes the **rpc/type/query-result** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:02nM8--s -->

# Shape <!-- id:IU9zCBCy -->

A **closed struct** with these fields: <!-- id:EvmdoseV -->
  - `in` _(required)_ — [rpc/type/id](./id.md) <!-- id:JZ6P9O4y -->
  - `results` _(required)_ — list of [rpc/type/document-info](./document-info.md) <!-- id:eo8ia6we -->
  - `mode` — one of `"Children"` | `"AllDescendants"` <!-- id:RePHCtTX -->

# Depends on <!-- id:uRtiQkyh -->

- [rpc/type/document-info](./document-info.md) <!-- id:U3vw88Mz -->
- [rpc/type/id](./id.md) <!-- id:l99ph1Cb -->
