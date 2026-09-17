---
name: External Comment Group
summary: A comment thread from another document that cites this one, with its target’s metadata payload.
schemaDefinition: ipfs://bafyreieinuvrdx3c3uofgivn2nhs2i2begspipkbbj6qloj2jwr7ib7ufa
---
A [comment](../../protocol/comments.md) thread from a different document that cites this one, with its target's [metadata payload](./metadata-payload.md). <!-- id:IQ1q6cc0 -->

This page describes the **rpc/type/external-comment-group** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:RaXFBiUz -->

# Shape <!-- id:PPPTPxbz -->

A **closed struct** with these fields: <!-- id:cipbf9F9 -->
  - `comments` _(required)_: list of [rpc/type/comment](./comment.md) <!-- id:qmdxLO_A -->
  - `moreCommentsCount` _(required)_: `integer` <!-- id:-VwVHou7 -->
  - `id` _(required)_: [string](../../string.md) <!-- id:WG16mV8b -->
  - `target` _(required)_: [rpc/type/metadata-payload](./metadata-payload.md) <!-- id:orsrQswM -->
  - `type` _(required)_: `"externalCommentGroup"` <!-- id:tH1zI9sl -->

# Depends on <!-- id:GONsXZm0 -->

- [string](../../string.md) <!-- id:FI8ROgf3 -->
- [rpc/type/comment](./comment.md) <!-- id:HUGkQkES -->
- [rpc/type/metadata-payload](./metadata-payload.md) <!-- id:Q5L7rBRv -->

# See also <!-- id:N1FTRW62 -->

- [Comment Group](./comment-group.md): a thread on the document itself. <!-- id:TMpm3OrF -->
- [ListDiscussions](../list-discussions.md): the method that returns it. <!-- id:MbqpY4i_ -->
- [Citation](./citation.md): how one resource cites another. <!-- id:HdeViDyb -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:lNx8tSP0 -->
