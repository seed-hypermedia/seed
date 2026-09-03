---
name: Nostr block
summary: "An embed of a Nostr event (a nostr: URL)."
schemaDefinition: ipfs://bafyreig6gkto4q7bmg7hpmyharlmzzk7u4awrpiqk2zuyjbmsqdjmmeeou
---
This document describes the **hypermedia-block-nostr** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:H3trKSWw -->

# Shape <!-- id:DfGwDfS7 -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:SjE4B4KF -->
  - `type` — `string` enum: `Nostr` <!-- id:MoC4GFpU -->
  - `link` _(required)_ — [string](./onyx-string.md) <!-- id:SUQtq_Ry -->

# Depends on <!-- id:pTk5fJAj -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:7wMfK90x -->
- [string](./onyx-string.md) <!-- id:MfbwVRsn -->
