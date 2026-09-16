---
name: Capability
summary: A delegation granting a role (WRITER or AGENT) from a space owner (the signer) to a delegate key, optionally scoped to a path.
schemaDefinition: ipfs://bafyreic6t7cjpkoib3hc6cy53it2x6al4xd6evwgq6trzco3uoq2eygmbe
---
This document describes the **capability** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:EoJZUC30 -->

# Shape <!-- id:Z4Q_8BDH -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:r1SXPido -->
  - `type` — `"Capability"` <!-- id:SyOFox8W -->
  - `delegate` _(required)_ — [principal](./principal.md) <!-- id:kjRR_hac -->
  - `audience` — [principal](./principal.md) <!-- id:7U5hD2qS -->
  - `path` — [string](./string.md) <!-- id:1kkgb2vD -->
  - `role` — [role](./role.md) <!-- id:rR-UJPdL -->
  - `label` — [string](./string.md) <!-- id:vvjLBzH9 -->

# Depends on <!-- id:8jobVV8F -->

- [blob](./blob.md) <!-- id:-Km-MHD- -->
- [principal](./principal.md) <!-- id:3nHrzASo -->
- [role](./role.md) <!-- id:-FedhZti -->
- [string](./string.md) <!-- id:C6Jjf4J4 -->
