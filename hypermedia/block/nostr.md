---
name: Nostr Block
summary: "An embed of a Nostr event by nostr: URL."
schemaDefinition: ipfs://bafyreiayvzq6jrzhuvd7o3iqackcomxgboi72ek2xkdwfcyokcub45n2um
---
A Nostr embed: `link` is required and is a `nostr:` URL naming an event. The app fetches and renders the event; the block has no text and no attributes of its own.

# Shape <!-- id:DfGwDfS7 -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:SjE4B4KF -->
  - `type`: `"Nostr"` <!-- id:MoC4GFpU -->
  - `link` _(required)_: [string](../string.md) <!-- id:SUQtq_Ry -->

# Depends on <!-- id:pTk5fJAj -->

- [block/base](./base.md) <!-- id:7wMfK90x -->
- [string](../string.md) <!-- id:MfbwVRsn -->
