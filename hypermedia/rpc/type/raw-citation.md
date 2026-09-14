---
name: Raw citation
summary: A citation in raw indexed form, before client-side resolution into a rpc/type/citation. A derived read model computed by the Seed daemon/API for clients — not a sig
schemaDefinition: ipfs://bafyreievxmfst75yek3vkyjxc7epdleew2eienl6hdep23u3ggifof7yh4
---
A citation in raw indexed form, before client-side resolution into a rpc/type/citation. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:ax5Fn9Xm -->

This document describes the **rpc/type/raw-citation** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Wy3Bfu0Z -->

# Shape <!-- id:Qooxep7h -->

A **closed struct** with these fields: <!-- id:VSMoMOwV -->
  - `source` _(required)_ — [string](../../schema/string.md) <!-- id:xbMuwlRc -->
  - `sourceType` — [string](../../schema/string.md) <!-- id:QCGc8Mib -->
  - `sourceContext` — [string](../../schema/string.md) <!-- id:EB2X99HS -->
  - `sourceBlob` — map { 3 fields } <!-- id:HWqmQC6t -->
  - `sourceDocument` — [string](../../schema/string.md) <!-- id:tGPuH7j_ -->
  - `target` — [string](../../schema/string.md) <!-- id:mcQ_zF31 -->
  - `targetVersion` — [string](../../schema/string.md) <!-- id:9r6v5-Jt -->
  - `targetFragment` — [string](../../schema/string.md) <!-- id:ETitOUBu -->
  - `isExactVersion` — [boolean](../../schema/boolean.md) <!-- id:JjU7xHVn -->
  - `targetBlockRevision` — [string](../../schema/string.md) <!-- id:5F30tb_v -->
  - `mentionType` — [string](../../schema/string.md) <!-- id:wQ9hjuTI -->
  - `isExact` — [boolean](../../schema/boolean.md) <!-- id:PmdMfCaq -->

# Depends on <!-- id:dPIrJcel -->

- [schema/timestamp](../../schema/timestamp.md) <!-- id:hBJ55G_b -->
- [boolean](../../schema/boolean.md) <!-- id:lRrCLPEF -->
- [string](../../schema/string.md) <!-- id:Z4_aA0VM -->
