---
name: "Resource: Redirect"
summary: "A resource that redirects to another id, optionally republishing its content in place."
schemaDefinition: ipfs://bafyreiesad52jom3u2rikyc2y4kbangshn7zulnv6ft7hwhz5rxwsknq5y
---
A [resource](../../glossary.md) that redirects to another id, optionally republishing its content in place. [Documents](../../protocol/documents.md) explains redirects. It is one state of [rpc/type/resource](./resource.md). <!-- id:nq0tvFEY -->

This page describes the **rpc/type/resource-redirect** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:b0-_bSKN -->

# Shape <!-- id:yALIXyEj -->

A **closed struct** with these fields: <!-- id:gXsjb7Rl -->
  - `type` _(required)_: `"redirect"` <!-- id:74-eVXWJ -->
  - `id` _(required)_: [rpc/type/id](./id.md) <!-- id:KDi6IPw0 -->
  - `redirectTarget` _(required)_: [rpc/type/id](./id.md) <!-- id:Vwc2UeaH -->
  - `republish`: [boolean](../../boolean.md) <!-- id:D60uDSWr -->

# Depends on <!-- id:dIJpaWek -->

- [boolean](../../boolean.md) <!-- id:GXI1oXzy -->
- [rpc/type/id](./id.md) <!-- id:ILFvu60V -->

# See also

- [Resource](./resource.md): every resource state.
- [Redirect Info](./redirect-info.md): the redirect marker on listings.
- [Ref](../../ref.md): the signed ref that carries a redirect.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
