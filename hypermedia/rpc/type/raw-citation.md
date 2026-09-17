---
name: Raw Citation
summary: A citation in raw indexed form, before client-side resolution into a citation read model.
schemaDefinition: ipfs://bafyreig6plnf6lzprkerpm5gmheeicd2crba3nqlgmnxgdguek2szkucby
---
A [citation](../../protocol/comments.md) in raw indexed form, before the client resolves it into a [citation](./citation.md). [rpc/list-citations](../list-citations.md) returns these. <!-- id:ax5Fn9Xm -->

This page describes the **rpc/type/raw-citation** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:Wy3Bfu0Z -->

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

# See also <!-- id:Khae6tLn -->

- [Citation](./citation.md): the resolved form. <!-- id:Kc_3MdM3 -->
- [ListCitations](../list-citations.md): the method that returns it. <!-- id:Xx7fqTS7 -->
- [Comments](../../protocol/comments.md): citations and backlinks. <!-- id:oPFTujVY -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:SlcL_NVh -->
