---
name: Raw capability
summary: A capability as indexed, in raw wire form (all fields optional strings). A derived read model computed by the Seed daemon/API for clients — not a signed network
schemaDefinition: ipfs://bafyreifsyqe5g5rpp6hdkdvf2ohlv3mfddxkkkhiaf4hkag2rzmqwp7com
---
A capability as indexed, in raw wire form (all fields optional strings). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:S4b_KI-P -->

This document describes the **seed-raw-capability** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:PjpY-Hh8 -->

# Shape <!-- id:kxlkQVIw -->

A **closed struct** with these fields: <!-- id:7_GLzvLR -->
  - `id` — [string](./hypermedia-string.md) <!-- id:U2Qviex5 -->
  - `issuer` — [string](./hypermedia-string.md) <!-- id:yOvtdkqY -->
  - `delegate` — [string](./hypermedia-string.md) <!-- id:TGDpUXn0 -->
  - `account` — [string](./hypermedia-string.md) <!-- id:4suz9Snp -->
  - `path` — [string](./hypermedia-string.md) <!-- id:eYzicjYG -->
  - `role` — [string](./hypermedia-string.md) <!-- id:d4nXy9NT -->
  - `noRecursive` — [boolean](./hypermedia-boolean.md) <!-- id:vSzBLiYk -->
  - `label` — [string](./hypermedia-string.md) <!-- id:YkFuZisn -->
  - `createTime` — [string](./hypermedia-string.md) <!-- id:naEyeK_O -->

# Depends on <!-- id:kqu-NLeV -->

- [boolean](./hypermedia-boolean.md) <!-- id:VgTRhZY0 -->
- [string](./hypermedia-string.md) <!-- id:Lc5Z-FdC -->
