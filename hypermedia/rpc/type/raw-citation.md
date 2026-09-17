---
name: Raw Citation
summary: "A citation in raw indexed form, before client-side resolution into a citation read model."
schemaDefinition: ipfs://bafyreig6plnf6lzprkerpm5gmheeicd2crba3nqlgmnxgdguek2szkucby
---
A citation in raw indexed form, before client-side resolution into a rpc/type/citation. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:ax5Fn9Xm -->

This page describes the **rpc/type/raw-citation** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:Wy3Bfu0Z -->

# Shape <!-- id:Qooxep7h -->

A **closed struct** with these fields: <!-- id:VSMoMOwV -->
  - `source` _(required)_: [string](../../string.md) <!-- id:xbMuwlRc -->
  - `sourceType`: [string](../../string.md) <!-- id:QCGc8Mib -->
  - `sourceContext`: [string](../../string.md) <!-- id:EB2X99HS -->
  - `sourceBlob`: map { 3 fields } <!-- id:HWqmQC6t -->
  - `sourceDocument`: [string](../../string.md) <!-- id:tGPuH7j_ -->
  - `target`: [string](../../string.md) <!-- id:mcQ_zF31 -->
  - `targetVersion`: [string](../../string.md) <!-- id:9r6v5-Jt -->
  - `targetFragment`: [string](../../string.md) <!-- id:ETitOUBu -->
  - `isExactVersion`: [boolean](../../boolean.md) <!-- id:JjU7xHVn -->
  - `targetBlockRevision`: [string](../../string.md) <!-- id:5F30tb_v -->
  - `mentionType`: [string](../../string.md) <!-- id:wQ9hjuTI -->
  - `isExact`: [boolean](../../boolean.md) <!-- id:PmdMfCaq -->

# Depends on <!-- id:dPIrJcel -->

- [timestamp](../../timestamp.md) <!-- id:hBJ55G_b -->
- [boolean](../../boolean.md) <!-- id:lRrCLPEF -->
- [string](../../string.md) <!-- id:Z4_aA0VM -->
