---
name: "Resource: Redirect"
summary: "A resource that redirects to another id, optionally republishing its content in place."
schemaDefinition: ipfs://bafyreiesad52jom3u2rikyc2y4kbangshn7zulnv6ft7hwhz5rxwsknq5y
---
A resource that redirects to another id (optionally republishing its content in place). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:nq0tvFEY -->

This page describes the **rpc/type/resource-redirect** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:b0-_bSKN -->

# Shape <!-- id:yALIXyEj -->

A **closed struct** with these fields: <!-- id:gXsjb7Rl -->
  - `type` _(required)_ — `"redirect"` <!-- id:74-eVXWJ -->
  - `id` _(required)_ — [rpc/type/id](./id.md) <!-- id:KDi6IPw0 -->
  - `redirectTarget` _(required)_ — [rpc/type/id](./id.md) <!-- id:Vwc2UeaH -->
  - `republish` — [boolean](../../boolean.md) <!-- id:D60uDSWr -->

# Depends on <!-- id:dIJpaWek -->

- [boolean](../../boolean.md) <!-- id:GXI1oXzy -->
- [rpc/type/id](./id.md) <!-- id:ILFvu60V -->
