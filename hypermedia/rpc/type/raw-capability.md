---
name: Raw Capability
summary: A capability as indexed, in raw wire form (all fields optional strings). A derived read model computed by the Seed daemon/API for clients — not a signed network
schemaDefinition: ipfs://bafyreiegfpd7ckxnwpzkff4m5cqufvc4finj6ce25agxfzbnerwjcq457y
---
A capability as indexed, in raw wire form (all fields optional strings). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:S4b_KI-P -->

This document describes the **rpc/type/raw-capability** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:PjpY-Hh8 -->

# Shape <!-- id:kxlkQVIw -->

A **closed struct** with these fields: <!-- id:7_GLzvLR -->
  - `id` — [string](../../string.md) <!-- id:U2Qviex5 -->
  - `issuer` — [string](../../string.md) <!-- id:yOvtdkqY -->
  - `delegate` — [string](../../string.md) <!-- id:TGDpUXn0 -->
  - `account` — [string](../../string.md) <!-- id:4suz9Snp -->
  - `path` — [string](../../string.md) <!-- id:eYzicjYG -->
  - `role` — [string](../../string.md) <!-- id:d4nXy9NT -->
  - `noRecursive` — [boolean](../../boolean.md) <!-- id:vSzBLiYk -->
  - `label` — [string](../../string.md) <!-- id:YkFuZisn -->
  - `createTime` — [string](../../string.md) <!-- id:naEyeK_O -->

# Depends on <!-- id:kqu-NLeV -->

- [boolean](../../boolean.md) <!-- id:VgTRhZY0 -->
- [string](../../string.md) <!-- id:Lc5Z-FdC -->
