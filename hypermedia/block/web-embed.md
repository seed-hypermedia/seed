---
name: Web Embed Block
summary: "An embed of an external web page or post by https:// URL."
schemaDefinition: ipfs://bafyreidrpljtmo5qmjycsar7dp273zu6fo2a67m3s4sos7fwdletgblfha
---
A **web embed block** embeds an external web page or post. `link` is required and is an `http(s)://` URL. The app renders known providers (such as X, Instagram and YouTube posts) as previews and everything else as a link card. The block has no text and no attributes of its own.

# Shape <!-- id:Q5buqKEc -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:smg-tBbR -->
  - `type`: `"WebEmbed"` <!-- id:c2wlVeW6 -->
  - `link` _(required)_: [string](../string.md) <!-- id:-den0FTt -->

# Depends on <!-- id:U9-iiqv6 -->

- [block/base](./base.md) <!-- id:aptiE36d -->
- [string](../string.md) <!-- id:vCCkhfdX -->

# See also

- [block/embed](./embed.md): embeds of Hypermedia content.
- [block/nostr](./nostr.md): embeds of Nostr events.
- [block/video](./video.md): web video links.
- [Blocks](../protocol/blocks.md): the block model.
