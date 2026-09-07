---
name: Raw citation
summary: A citation in raw indexed form, before client-side resolution into a seed-citation. A derived read model computed by the Seed daemon/API for clients — not a sig
schemaDefinition: ipfs://bafyreidtrezri3tslycxlkoe7qbm5laqvklxvwiqq75ctnhssa6oikmmyq
---
A citation in raw indexed form, before client-side resolution into a seed-citation. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:ax5Fn9Xm -->

This document describes the **seed-raw-citation** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Wy3Bfu0Z -->

# Shape <!-- id:Qooxep7h -->

A **closed struct** with these fields: <!-- id:VSMoMOwV -->
  - `source` _(required)_ — [string](./hypermedia-string.md) <!-- id:xbMuwlRc -->
  - `sourceType` — [string](./hypermedia-string.md) <!-- id:QCGc8Mib -->
  - `sourceContext` — [string](./hypermedia-string.md) <!-- id:EB2X99HS -->
  - `sourceBlob` — map { 3 fields } <!-- id:HWqmQC6t -->
  - `sourceDocument` — [string](./hypermedia-string.md) <!-- id:tGPuH7j_ -->
  - `target` — [string](./hypermedia-string.md) <!-- id:mcQ_zF31 -->
  - `targetVersion` — [string](./hypermedia-string.md) <!-- id:9r6v5-Jt -->
  - `targetFragment` — [string](./hypermedia-string.md) <!-- id:ETitOUBu -->
  - `isExactVersion` — [boolean](./hypermedia-boolean.md) <!-- id:JjU7xHVn -->
  - `targetBlockRevision` — [string](./hypermedia-string.md) <!-- id:5F30tb_v -->
  - `mentionType` — [string](./hypermedia-string.md) <!-- id:wQ9hjuTI -->
  - `isExact` — [boolean](./hypermedia-boolean.md) <!-- id:PmdMfCaq -->

# Depends on <!-- id:dPIrJcel -->

- [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:hBJ55G_b -->
- [boolean](./hypermedia-boolean.md) <!-- id:lRrCLPEF -->
- [string](./hypermedia-string.md) <!-- id:Z4_aA0VM -->
