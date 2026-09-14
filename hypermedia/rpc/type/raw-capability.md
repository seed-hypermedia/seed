---
name: Raw Capability
summary: A capability as indexed, in raw wire form (all fields optional strings). A derived read model computed by the Seed daemon/API for clients — not a signed network
schemaDefinition: ipfs://bafyreih7cl5ll5xuv3ya7arsztmpc4hmnposa5oyq5y357icftw7twuzdm
---
A capability as indexed, in raw wire form (all fields optional strings). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:S4b_KI-P -->

This document describes the **rpc/type/raw-capability** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:PjpY-Hh8 -->

# Shape <!-- id:kxlkQVIw -->

A **closed struct** with these fields: <!-- id:7_GLzvLR -->
  - `id` — [string](../../schema/string.md) <!-- id:U2Qviex5 -->
  - `issuer` — [string](../../schema/string.md) <!-- id:yOvtdkqY -->
  - `delegate` — [string](../../schema/string.md) <!-- id:TGDpUXn0 -->
  - `account` — [string](../../schema/string.md) <!-- id:4suz9Snp -->
  - `path` — [string](../../schema/string.md) <!-- id:eYzicjYG -->
  - `role` — [string](../../schema/string.md) <!-- id:d4nXy9NT -->
  - `noRecursive` — [boolean](../../schema/boolean.md) <!-- id:vSzBLiYk -->
  - `label` — [string](../../schema/string.md) <!-- id:YkFuZisn -->
  - `createTime` — [string](../../schema/string.md) <!-- id:naEyeK_O -->

# Depends on <!-- id:kqu-NLeV -->

- [boolean](../../schema/boolean.md) <!-- id:VgTRhZY0 -->
- [string](../../schema/string.md) <!-- id:Lc5Z-FdC -->
