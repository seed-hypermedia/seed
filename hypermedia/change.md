---
name: Change
summary: An append-only change to a document, linked into a causal DAG via deps. Carries the operations that mutate document content and metadata.
schemaDefinition: ipfs://bafyreiddv4pzps23hq6idsv3hr3sw56vmcvh62yq3ktcc4n5b6bd7rzjpu
---
This document describes the **change** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:v0dbkIbB -->

# Shape <!-- id:NQM1VhDF -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:WtuABanO -->
  - `type` — `"Change"` <!-- id:vuVh1zRN -->
  - `genesis` — [cid](./cid.md) <!-- id:OjyRoI0Z -->
  - `deps` — list of [cid](./cid.md) <!-- id:14sUK5dG -->
  - `depth` — [integer](./schema/integer.md) <!-- id:WymiRSox -->
  - `body` — [schema/change-body](./schema/change-body.md)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:uBgg3XsN -->

**Generic** over `⟨Block⟩` (default [block](./block.md)). <!-- id:R7cLitDd -->

# Depends on <!-- id:04pSmVGM -->

- [blob](./blob.md) <!-- id:WMAGmaBA -->
- [block](./block.md) <!-- id:FapoGwga -->
- [schema/change-body](./schema/change-body.md) <!-- id:_jOGY6LF -->
- [cid](./cid.md) <!-- id:63xfnTGa -->
- [integer](./schema/integer.md) <!-- id:fvXmpXcE -->
