---
name: Parsed Fragment
summary: "A parsed URL fragment addressing a block and, optionally, a range inside it."
schemaDefinition: ipfs://bafyreibjetwpvzie3paxrmpcsiq4ptcchzmtswldzor3t6bux3akfy6ihq
---
A parsed URL fragment addressing a block (and optionally a range inside it). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:z7-8RBgX -->

This page describes the **rpc/type/parsed-fragment** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:krFKHwrt -->

# Shape <!-- id:syZag7R2 -->

**Extends** [rpc/type/block-range](./block-range.md) with these added fields: <!-- id:yEQ1-H8j -->
  - `blockId` _(required)_ — [string](../../string.md) <!-- id:HheegK47 -->

# Depends on <!-- id:iQNSAaXE -->

- [string](../../string.md) <!-- id:TnlsTizM -->
- [rpc/type/block-range](./block-range.md) <!-- id:Szbd6UUI -->
