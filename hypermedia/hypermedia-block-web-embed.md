---
name: Web embed block
summary: An embed of an external web resource (an http(s) URL).
schemaDefinition: ipfs://bafyreieiuy3danxvva5acfu2corcetk7stnmjyvb6ydn44rkgovcy6aaae
---
This document describes the **hypermedia-block-web-embed** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:XGtQTo6l -->

# Shape <!-- id:Q5buqKEc -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:smg-tBbR -->
  - `type` — `string` enum: `WebEmbed` <!-- id:c2wlVeW6 -->
  - `link` _(required)_ — [string](./hypermedia-string.md) <!-- id:-den0FTt -->

# Depends on <!-- id:U9-iiqv6 -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:aptiE36d -->
- [string](./hypermedia-string.md) <!-- id:vCCkhfdX -->
