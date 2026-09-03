---
name: Ref
summary: A signed pointer (like a Git ref) claiming that a path in a space points at the current head Changes of a document.
schemaDefinition: ipfs://bafyreidwhsrp4gcbkcgnu4p5lk6btdtki6kr2f3ve6sbdzuh66e4di4hsy
---
This document describes the **hypermedia-ref** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:5X7JPVaE -->

# Shape <!-- id:dpE2fWQB -->

**Extends** [hypermedia-blob](./hypermedia-blob.md) with these added fields: <!-- id:6u-Qshey -->
  - `type` — `string` enum: `Ref` <!-- id:4LKiQ2kT -->
  - `space` — [hypermedia-principal](./hypermedia-principal.md) <!-- id:idNr9FJM -->
  - `path` — [string](./onyx-string.md) <!-- id:8izgFQy0 -->
  - `genesisBlob` — [hypermedia-cid](./hypermedia-cid.md) <!-- id:cob0_GUo -->
  - `capability` — [hypermedia-cid](./hypermedia-cid.md) <!-- id:Wv5xpNAJ -->
  - `heads` _(required)_ — list of [hypermedia-cid](./hypermedia-cid.md) <!-- id:_B1tM30h -->
  - `redirect` — [hypermedia-redirect-target](./hypermedia-redirect-target.md) <!-- id:F5YoHwBj -->
  - `generation` — [integer](./onyx-integer.md) <!-- id:tPhi-Hlj -->
  - `visibility` — [hypermedia-visibility](./hypermedia-visibility.md) <!-- id:CgsyURu- -->

# Depends on <!-- id:L4KMjf3U -->

- [hypermedia-blob](./hypermedia-blob.md) <!-- id:qR-dN0GK -->
- [hypermedia-cid](./hypermedia-cid.md) <!-- id:h6XHAqQF -->
- [hypermedia-principal](./hypermedia-principal.md) <!-- id:CCI4-2aZ -->
- [hypermedia-redirect-target](./hypermedia-redirect-target.md) <!-- id:x_NaRzFr -->
- [hypermedia-visibility](./hypermedia-visibility.md) <!-- id:CDnB2GqZ -->
- [integer](./onyx-integer.md) <!-- id:1vZFCegM -->
- [string](./onyx-string.md) <!-- id:B2_Qyt3Z -->
