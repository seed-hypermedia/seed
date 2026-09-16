---
name: Ref
summary: A signed pointer (like a Git ref) claiming that a path in a space points at the current head Changes of a document.
schemaDefinition: ipfs://bafyreiduqxxs33cs7fat6cnc426whpk6jdrl5ayrg5ov6iwn3xioyoutde
---
This document describes the **ref** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:5X7JPVaE -->

# Shape <!-- id:dpE2fWQB -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:6u-Qshey -->
  - `type` — `"Ref"` <!-- id:4LKiQ2kT -->
  - `space` — [principal](./principal.md) <!-- id:idNr9FJM -->
  - `path` — [string](./string.md) <!-- id:8izgFQy0 -->
  - `genesisBlob` — [cid](./cid.md) <!-- id:cob0_GUo -->
  - `capability` — [cid](./cid.md) <!-- id:Wv5xpNAJ -->
  - `heads` _(required)_ — list of [cid](./cid.md) <!-- id:_B1tM30h -->
  - `redirect` — [ref/redirect-target](./ref/redirect-target.md) <!-- id:F5YoHwBj -->
  - `generation` — [integer](./integer.md) <!-- id:tPhi-Hlj -->
  - `visibility` — [visibility](./visibility.md) <!-- id:CgsyURu- -->

# Depends on <!-- id:L4KMjf3U -->

- [blob](./blob.md) <!-- id:qR-dN0GK -->
- [cid](./cid.md) <!-- id:h6XHAqQF -->
- [principal](./principal.md) <!-- id:CCI4-2aZ -->
- [ref/redirect-target](./ref/redirect-target.md) <!-- id:x_NaRzFr -->
- [visibility](./visibility.md) <!-- id:CDnB2GqZ -->
- [integer](./integer.md) <!-- id:1vZFCegM -->
- [string](./string.md) <!-- id:B2_Qyt3Z -->
