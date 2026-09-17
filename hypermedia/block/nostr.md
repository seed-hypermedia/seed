---
name: Nostr Block
summary: "An embed of a Nostr event by nostr: URL."
schemaDefinition: ipfs://bafyreiayvzq6jrzhuvd7o3iqackcomxgboi72ek2xkdwfcyokcub45n2um
---
A **Nostr block** embeds a Nostr event. `link` is required and is a `nostr:` URL naming the event. The app fetches and renders the event. The block has no text and no attributes of its own. <!-- id:D55guKwB -->

# Shape <!-- id:DfGwDfS7 -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:SjE4B4KF -->
  - `type`: `"Nostr"` <!-- id:MoC4GFpU -->
  - `link` _(required)_: [string](../string.md) <!-- id:SUQtq_Ry -->

# Depends on <!-- id:pTk5fJAj -->

- [block/base](./base.md) <!-- id:7wMfK90x -->
- [string](../string.md) <!-- id:MfbwVRsn -->

# See also <!-- id:WuIEfUX5 -->

- [block/web-embed](./web-embed.md): embeds of web pages and posts. <!-- id:yufi0_rA -->
- [block/embed](./embed.md): embeds of Hypermedia content. <!-- id:pKVDRe9e -->
- [block/core](./core.md): all built-in block types. <!-- id:G6ouGAo7 -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:Mie2NvnI -->
