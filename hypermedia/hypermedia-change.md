---
name: Change
summary: An append-only change to a document, linked into a causal DAG via deps. Carries the operations that mutate document content and metadata.
schemaDefinition: ipfs://bafyreieerrzcxv7wbswn5c5fhw5tgsf2tuzw7qga3gynuvhwxy7hd3mxha
---
This document describes the **hypermedia-change** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:v0dbkIbB -->

# Shape <!-- id:NQM1VhDF -->

**Extends** [hypermedia-blob](./hypermedia-blob.md) with these added fields: <!-- id:WtuABanO -->
  - `type` — `string` enum: `Change` <!-- id:vuVh1zRN -->
  - `genesis` — [hypermedia-cid](./hypermedia-cid.md) <!-- id:OjyRoI0Z -->
  - `deps` — list of [hypermedia-cid](./hypermedia-cid.md) <!-- id:14sUK5dG -->
  - `depth` — [integer](./onyx-integer.md) <!-- id:WymiRSox -->
  - `body` — [hypermedia-change-body](./hypermedia-change-body.md)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:uBgg3XsN -->

**Generic** over `⟨Block⟩` (default [hypermedia-block](./hypermedia-block.md)). <!-- id:R7cLitDd -->

# Depends on <!-- id:04pSmVGM -->

- [hypermedia-blob](./hypermedia-blob.md) <!-- id:WMAGmaBA -->
- [hypermedia-block](./hypermedia-block.md) <!-- id:FapoGwga -->
- [hypermedia-change-body](./hypermedia-change-body.md) <!-- id:_jOGY6LF -->
- [hypermedia-cid](./hypermedia-cid.md) <!-- id:63xfnTGa -->
- [integer](./onyx-integer.md) <!-- id:fvXmpXcE -->
