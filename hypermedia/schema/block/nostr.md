---
name: Nostr block
summary: "An embed of a Nostr event (a nostr: URL)."
schemaDefinition: ipfs://bafyreidx3jtc2pxsc2t6gt4xpi5stxjezby4kcejlcbum2qvkk5sim63sm
---
This document describes the **schema/block/nostr** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:H3trKSWw -->

# Shape <!-- id:DfGwDfS7 -->

**Extends** [schema/block/base](./base.md) with these added fields: <!-- id:SjE4B4KF -->
  - `type` — `"Nostr"` <!-- id:MoC4GFpU -->
  - `link` _(required)_ — [string](../string.md) <!-- id:SUQtq_Ry -->

# Depends on <!-- id:pTk5fJAj -->

- [schema/block/base](./base.md) <!-- id:7wMfK90x -->
- [string](../string.md) <!-- id:MfbwVRsn -->
