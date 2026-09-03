---
name: Capability
summary: A delegation granting a role (WRITER or AGENT) from a space owner (the signer) to a delegate key, optionally scoped to a path.
schemaDefinition: ipfs://bafyreidrbogadinyf4msbr67mefudmuijnznzd4jyumxnqocwvfozaxgny
---
This document describes the **hypermedia-capability** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:EoJZUC30 -->

# Shape <!-- id:Z4Q_8BDH -->

**Extends** [hypermedia-blob](./hypermedia-blob.md) with these added fields: <!-- id:r1SXPido -->
  - `type` — `string` enum: `Capability` <!-- id:SyOFox8W -->
  - `delegate` _(required)_ — [hypermedia-principal](./hypermedia-principal.md) <!-- id:kjRR_hac -->
  - `audience` — [hypermedia-principal](./hypermedia-principal.md) <!-- id:7U5hD2qS -->
  - `path` — [string](./onyx-string.md) <!-- id:1kkgb2vD -->
  - `role` — [hypermedia-role](./hypermedia-role.md) <!-- id:rR-UJPdL -->
  - `label` — [string](./onyx-string.md) <!-- id:vvjLBzH9 -->

# Depends on <!-- id:8jobVV8F -->

- [hypermedia-blob](./hypermedia-blob.md) <!-- id:-Km-MHD- -->
- [hypermedia-principal](./hypermedia-principal.md) <!-- id:3nHrzASo -->
- [hypermedia-role](./hypermedia-role.md) <!-- id:-FedhZti -->
- [string](./onyx-string.md) <!-- id:C6Jjf4J4 -->
