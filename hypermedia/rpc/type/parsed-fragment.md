---
name: Parsed Fragment
summary: "A parsed URL fragment addressing a block and, optionally, a range inside it."
schemaDefinition: ipfs://bafyreibjetwpvzie3paxrmpcsiq4ptcchzmtswldzor3t6bux3akfy6ihq
---
A parsed URL fragment that addresses a [block](../../protocol/blocks.md), and optionally a [range](./block-range.md) inside it. <!-- id:z7-8RBgX -->

This page describes the **rpc/type/parsed-fragment** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:krFKHwrt -->

# Shape <!-- id:syZag7R2 -->

**Extends** [rpc/type/block-range](./block-range.md) with these added fields: <!-- id:yEQ1-H8j -->
  - `blockId` _(required)_: [string](../../string.md) <!-- id:HheegK47 -->

# Depends on <!-- id:iQNSAaXE -->

- [string](../../string.md) <!-- id:TnlsTizM -->
- [rpc/type/block-range](./block-range.md) <!-- id:Szbd6UUI -->

# See also

- [Hypermedia URLs](../../protocol/urls.md): fragments and block references.
- [Citation](./citation.md): where the API returns it.
- [Block Range](./block-range.md): the range it extends.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
