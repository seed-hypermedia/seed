---
name: Parsed Fragment
summary: A parsed URL fragment addressing a block (and optionally a range inside it). A derived read model computed by the Seed daemon/API for clients — not a signed net
schemaDefinition: ipfs://bafyreihp4hmyow36vgofwwiwhddzrsyexxna2i46t3mo5txpgkph6n7b5y
---
A parsed URL fragment addressing a block (and optionally a range inside it). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:z7-8RBgX -->

This document describes the **rpc/type/parsed-fragment** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:krFKHwrt -->

# Shape <!-- id:syZag7R2 -->

**Extends** [rpc/type/block-range](./block-range.md) with these added fields: <!-- id:yEQ1-H8j -->
  - `blockId` _(required)_ — [string](../../schema/string.md) <!-- id:HheegK47 -->

# Depends on <!-- id:iQNSAaXE -->

- [string](../../schema/string.md) <!-- id:TnlsTizM -->
- [rpc/type/block-range](./block-range.md) <!-- id:Szbd6UUI -->
