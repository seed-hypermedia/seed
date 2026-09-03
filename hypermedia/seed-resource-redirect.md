---
name: "Resource: redirect"
summary: A resource that redirects to another id (optionally republishing its content in place). A derived read model computed by the Seed daemon/API for clients — not a
schemaDefinition: ipfs://bafyreihifumeluzft22knvf4ch2a3aftsuyb66rv6m6s4btsmwpre64iwu
---
A resource that redirects to another id (optionally republishing its content in place). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:nq0tvFEY -->

This document describes the **seed-resource-redirect** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:b0-_bSKN -->

# Shape <!-- id:yALIXyEj -->

A **closed struct** with these fields: <!-- id:gXsjb7Rl -->
  - `type` _(required)_ — `string` enum: `redirect` <!-- id:74-eVXWJ -->
  - `id` _(required)_ — [seed-id](./seed-id.md) <!-- id:KDi6IPw0 -->
  - `redirectTarget` _(required)_ — [seed-id](./seed-id.md) <!-- id:Vwc2UeaH -->
  - `republish` — [boolean](./onyx-boolean.md) <!-- id:D60uDSWr -->

# Depends on <!-- id:dIJpaWek -->

- [boolean](./onyx-boolean.md) <!-- id:GXI1oXzy -->
- [seed-id](./seed-id.md) <!-- id:ILFvu60V -->
